import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EstadoRepartidorSyncronize, Rol } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ConsultasExternasService } from '../consultas-externas/consultas-externas.service';
import { EvolutionApiService } from '../whatsapp/evolution-api.service';
import {
  ActualizarPerfilRepartidorDto,
  RegistroRepartidorDto,
} from './dto/repartidores.dto';

/**
 * Repartidores FREELANCE de Syncronize (R1): registro público con DNI
 * validado en RENIEC, verificación de celular por OTP (WhatsApp) y
 * aprobación manual del super admin. Recién APROBADO puede ver/tomar el
 * pool externo (empresas con opt-in, en sus zonas).
 */
@Injectable()
export class RepartidoresService {
  private readonly logger = new Logger(RepartidoresService.name);

  private static readonly OTP_VIGENCIA_MIN = 10;

  constructor(
    private readonly prisma: PrismaService,
    private readonly consultas: ConsultasExternasService,
    private readonly evolution: EvolutionApiService,
  ) {}

  // ── Registro público ──

  /**
   * Registra al freelance: valida el DNI en RENIEC (el nombre queda el
   * OFICIAL), crea la cuenta si no existe (Persona + Usuario login-DNI +
   * AuthProvider PASSWORD — mismo camino que el resto del sistema) y deja
   * el perfil en PENDIENTE hasta que el super admin apruebe.
   */
  async registrar(dto: RegistroRepartidorDto) {
    const existente = await this.prisma.repartidorSyncronize.findUnique({
      where: { dni: dto.dni },
      select: { id: true, estado: true },
    });
    if (existente) {
      throw new ConflictException(
        'Este DNI ya está registrado como repartidor (estado: ' +
          `${existente.estado})`,
      );
    }

    // Nombre OFICIAL de RENIEC — sin esto no hay registro.
    let nombreCompleto: string;
    try {
      const r: any = await this.consultas.consultarDni(dto.dni);
      nombreCompleto = [r.nombres, r.apellidoPaterno, r.apellidoMaterno]
        .filter(Boolean)
        .join(' ')
        .trim();
      if (!nombreCompleto) throw new Error('sin nombre');
    } catch {
      throw new BadRequestException(
        'No pudimos validar tu DNI en RENIEC. Verifica el número.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const usuario = await this.prisma.$transaction(async (tx) => {
      // Persona por DNI (puede existir como cliente de alguna empresa).
      let persona = await tx.persona.findUnique({ where: { dni: dto.dni } });
      if (!persona) {
        const partes = nombreCompleto.split(' ');
        persona = await tx.persona.create({
          data: {
            dni: dto.dni,
            nombres: partes.slice(0, -2).join(' ') || nombreCompleto,
            apellidos: partes.slice(-2).join(' '),
            // "Datos personales" del perfil leen de Persona — sin esto el
            // celular del registro no aparecía en la app.
            telefono: dto.celular,
            esUsuario: true,
          },
        });
      } else if (!persona.telefono) {
        // Persona reusada (era cliente): completar el teléfono SOLO si no
        // tenía — jamás pisar el que ya declaró en otra empresa.
        persona = await tx.persona.update({
          where: { id: persona.id },
          data: { telefono: dto.celular, esUsuario: true },
        });
      }

      // Usuario: si ya tiene cuenta, se reusa (no se toca su password).
      let user = await tx.usuario.findUnique({
        where: { personaId: persona.id },
      });
      if (!user) {
        user = await tx.usuario.create({
          data: {
            personaId: persona.id,
            passwordHash,
            metodoPrincipalLogin: 'DNI',
            dniVerificado: true,
            authMethodsCount: 1,
            // El freelance NO tiene email (canal = celular vía OTP) — sin
            // esto el login exige "verifica tu email" y lo deja fuera.
            emailVerificado: true,
          },
        });
        await tx.authProvider.create({
          data: {
            userId: user.id,
            provider: 'PASSWORD',
            providerId: dto.dni,
            email: `repartidor.${dto.dni}@syncronize.repartidor`,
          },
        });
      }

      await tx.repartidorSyncronize.create({
        data: {
          usuarioId: user.id,
          dni: dto.dni,
          nombreCompleto,
          celular: dto.celular,
          zonas: dto.zonas.map((z) => z.trim()).filter((z) => z.length > 0),
          placaVehiculo: dto.placaVehiculo ?? null,
        },
      });
      return user;
    });

    // OTP de verificación del celular — best-effort, no bloquea el registro.
    void this.enviarOtp(usuario.id).catch((e) =>
      this.logger.warn(`OTP registro ${dto.dni}: ${(e as Error).message}`),
    );

    return {
      ok: true,
      estado: EstadoRepartidorSyncronize.PENDIENTE,
      nombreCompleto,
      mensaje:
        'Registro recibido. Verifica tu celular con el código que te ' +
        'enviamos por WhatsApp; tu solicitud pasará a revisión.',
    };
  }

  // ── OTP por WhatsApp ──

  /**
   * Genera y envía el OTP al celular del repartidor por WhatsApp. Requiere
   * la instancia Evolution de la PLATAFORMA (env SYNCRONIZE_WA_INSTANCE);
   * sin ella queda registrado el código y la verificación será manual del
   * admin al aprobar.
   */
  async enviarOtp(usuarioId: string) {
    const rep = await this.cargarPorUsuario(usuarioId);
    if (rep.celularVerificado) return { ok: true, yaVerificado: true };

    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    await this.prisma.repartidorSyncronize.update({
      where: { id: rep.id },
      data: {
        otpCodigo: codigo,
        otpExpiraEn: new Date(
          Date.now() + RepartidoresService.OTP_VIGENCIA_MIN * 60_000,
        ),
      },
    });

    const instancia = process.env.SYNCRONIZE_WA_INSTANCE;
    if (!instancia) {
      this.logger.warn(
        `OTP ${rep.dni}: falta SYNCRONIZE_WA_INSTANCE — verificación manual`,
      );
      return { ok: true, enviado: false };
    }
    await this.evolution.sendText({
      instanceName: instancia,
      number: `51${rep.celular}`,
      text:
        `🛵 Syncronize Repartidores\nTu código de verificación es: *${codigo}*\n` +
        `Vence en ${RepartidoresService.OTP_VIGENCIA_MIN} minutos.`,
    });
    return { ok: true, enviado: true };
  }

  async verificarOtp(usuarioId: string, codigo: string) {
    const rep = await this.cargarPorUsuario(usuarioId);
    if (rep.celularVerificado) return { ok: true };
    if (
      !rep.otpCodigo ||
      rep.otpCodigo !== codigo ||
      !rep.otpExpiraEn ||
      rep.otpExpiraEn < new Date()
    ) {
      throw new BadRequestException('Código inválido o vencido');
    }
    await this.prisma.repartidorSyncronize.update({
      where: { id: rep.id },
      data: { celularVerificado: true, otpCodigo: null, otpExpiraEn: null },
    });
    return { ok: true };
  }

  // ── Perfil ──

  async miPerfil(usuarioId: string) {
    const rep = await this.cargarPorUsuario(usuarioId);
    const { otpCodigo: _otp, ...publico } = rep;
    return publico;
  }

  async actualizarPerfil(usuarioId: string, dto: ActualizarPerfilRepartidorDto) {
    const rep = await this.cargarPorUsuario(usuarioId);
    return this.prisma.repartidorSyncronize.update({
      where: { id: rep.id },
      data: {
        ...(dto.fotoUrl !== undefined && { fotoUrl: dto.fotoUrl }),
        ...(dto.placaVehiculo !== undefined && {
          placaVehiculo: dto.placaVehiculo,
        }),
        ...(dto.antecedentesUrl !== undefined && {
          antecedentesUrl: dto.antecedentesUrl,
        }),
        ...(dto.zonas !== undefined && {
          zonas: dto.zonas.map((z) => z.trim()).filter((z) => z.length > 0),
        }),
      },
    });
  }

  // ── Administración (super admin de la plataforma) ──

  private async verificarSuperAdmin(usuarioId: string) {
    const user = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { rolGlobal: true },
    });
    if (user?.rolGlobal === Rol.SUPER_ADMIN) return;
    const rol = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId,
        rol: Rol.SUPER_ADMIN,
        isActive: true,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!rol) {
      throw new ForbiddenException('Solo el super admin gestiona repartidores');
    }
  }

  async listar(adminUserId: string, estado?: EstadoRepartidorSyncronize) {
    await this.verificarSuperAdmin(adminUserId);
    return this.prisma.repartidorSyncronize.findMany({
      where: estado ? { estado } : {},
      orderBy: { creadoEn: 'desc' },
      take: 100,
    });
  }

  async aprobar(adminUserId: string, repartidorId: string) {
    await this.verificarSuperAdmin(adminUserId);
    const rep = await this.prisma.repartidorSyncronize.update({
      where: { id: repartidorId },
      data: {
        estado: EstadoRepartidorSyncronize.APROBADO,
        aprobadoPor: adminUserId,
        aprobadoEn: new Date(),
        motivoEstado: null,
      },
    });
    void this.avisarRepartidor(
      rep,
      '🎉 ¡Tu solicitud fue APROBADA! Ya puedes ver y tomar pedidos de ' +
        'delivery en tus zonas desde la app Syncronize.',
    );
    return rep;
  }

  async suspender(adminUserId: string, repartidorId: string, motivo?: string) {
    await this.verificarSuperAdmin(adminUserId);
    const rep = await this.prisma.repartidorSyncronize.update({
      where: { id: repartidorId },
      data: {
        estado: EstadoRepartidorSyncronize.SUSPENDIDO,
        motivoEstado: motivo ?? null,
      },
    });
    void this.avisarRepartidor(
      rep,
      `⛔ Tu cuenta de repartidor fue suspendida${motivo ? `: ${motivo}` : ''}.`,
    );
    return rep;
  }

  // ── Helpers ──

  private async cargarPorUsuario(usuarioId: string) {
    if (!usuarioId) throw new BadRequestException('usuario obligatorio');
    const rep = await this.prisma.repartidorSyncronize.findUnique({
      where: { usuarioId },
    });
    if (!rep) {
      throw new NotFoundException('No estás registrado como repartidor');
    }
    return rep;
  }

  private async avisarRepartidor(
    rep: { celular: string },
    texto: string,
  ): Promise<void> {
    const instancia = process.env.SYNCRONIZE_WA_INSTANCE;
    if (!instancia) return;
    try {
      await this.evolution.sendText({
        instanceName: instancia,
        number: `51${rep.celular}`,
        text: texto,
      });
    } catch (e) {
      this.logger.warn(`WhatsApp repartidor: ${(e as Error).message}`);
    }
  }
}
