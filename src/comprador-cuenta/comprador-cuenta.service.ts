import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EvolutionApiService } from '../whatsapp/evolution-api.service';
import { ConsultasExternasService } from '../consultas-externas/consultas-externas.service';
import { AuthService } from '../auth/auth.service';

/**
 * Qué pasa con un DNI que llega a comprar a la tienda web:
 * - NUEVO: no existe en el sistema → se registra (nombre de RENIEC).
 * - ACTIVA: ya tiene cuenta y la usa → ingresa con su contraseña.
 * - POR_ACTIVAR: una tienda lo cargó como cliente (cuenta con contraseña
 *   temporal = DNI que nunca cambió, o persona sin cuenta) → activa con un
 *   código al celular QUE YA TIENE REGISTRADO.
 * - SIN_CONTACTO: POR_ACTIVAR pero sin celular válido: no hay cómo probar que
 *   es él → que la tienda le actualice el celular.
 *
 * 🔴 El DNI solo NO alcanza para entrar: la contraseña temporal de las
 * cuentas creadas por una tienda ES el DNI, y cualquiera que lo sepa vería
 * sus cotizaciones, pedidos y direcciones. Por eso la web nunca usa esa
 * contraseña: la cuenta se toma probando el celular.
 */
export type EstadoDni = 'NUEVO' | 'ACTIVA' | 'POR_ACTIVAR' | 'SIN_CONTACTO';

interface OtpGuardado {
  hash: string;
  celular: string;
  intentos: number;
  /** Nombre OFICIAL de RENIEC para un DNI nuevo: no se acepta el que mande el cliente. */
  nombres?: string;
  apellidos?: string;
}

@Injectable()
export class CompradorCuentaService {
  private readonly logger = new Logger(CompradorCuentaService.name);

  private static readonly OTP_TTL_SEG = 10 * 60;
  private static readonly REENVIO_SEG = 60;
  private static readonly MAX_INTENTOS = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly evolution: EvolutionApiService,
    private readonly consultas: ConsultasExternasService,
    private readonly auth: AuthService,
  ) {}

  // ── Estado del DNI ──

  async estado(dni: string) {
    const d = this.validarDni(dni);
    const persona = await this.buscarPersona(d);

    if (!persona) {
      // Nombre de RENIEC para mostrarlo en el registro. Si RENIEC falla el
      // registro sigue: el cliente escribe su nombre.
      const reniec = await this.nombreReniec(d);
      return { estado: 'NUEVO' as EstadoDni, ...reniec };
    }

    const usuario = persona.usuario;
    if (usuario && !usuario.requiereCambioPassword && usuario.isActive && !usuario.deletedAt) {
      return { estado: 'ACTIVA' as EstadoDni, nombres: persona.nombres };
    }

    const celular = this.celularDe(usuario?.telefono ?? persona.telefono);
    if (!celular) {
      return { estado: 'SIN_CONTACTO' as EstadoDni, nombres: persona.nombres };
    }
    return {
      estado: 'POR_ACTIVAR' as EstadoDni,
      nombres: persona.nombres,
      celularEnmascarado: this.enmascarar(celular),
    };
  }

  // ── Código por WhatsApp ──

  /**
   * Manda el código. A quién:
   * - cuenta existente (activa u "olvidé mi contraseña", o por activar) → al
   *   celular YA registrado; el `celular` que mande el cliente se ignora.
   * - DNI nuevo → al `celular` que escribe (prueba que ese número es suyo).
   */
  async enviarCodigo(dni: string, celularNuevo?: string) {
    const d = this.validarDni(dni);

    const clave = `comprador:otp:${d}`;
    const bloqueo = `comprador:otp-reenvio:${d}`;
    if (await this.redis.exists(bloqueo)) {
      throw new HttpException('Espera un minuto antes de pedir otro código', HttpStatus.TOO_MANY_REQUESTS);
    }

    const persona = await this.buscarPersona(d);
    let celular: string | null;
    let nombreReniec: { nombres?: string; apellidos?: string } = {};

    if (persona) {
      celular = this.celularDe(persona.usuario?.telefono ?? persona.telefono);
      if (!celular) {
        throw new BadRequestException(
          'No tienes un celular registrado. Pide a la tienda que lo actualice para activar tu cuenta.',
        );
      }
    } else {
      celular = this.celularDe(celularNuevo);
      if (!celular) throw new BadRequestException('Ingresa un celular válido de 9 dígitos');
      // El celular es @unique en Usuario: si ya es de otra cuenta, que entre por esa.
      const ocupado = await this.prisma.usuario.findUnique({
        where: { telefono: celular },
        select: { id: true },
      });
      if (ocupado) {
        throw new ConflictException('Ese celular ya pertenece a otra cuenta. Ingresa con el DNI de esa cuenta.');
      }
      nombreReniec = await this.nombreReniec(d);
    }

    const codigo = String(randomInt(100000, 1000000));
    const guardado: OtpGuardado = { hash: this.hash(d, codigo), celular, intentos: 0, ...nombreReniec };
    await this.redis.setex(clave, CompradorCuentaService.OTP_TTL_SEG, JSON.stringify(guardado));
    await this.redis.setex(bloqueo, CompradorCuentaService.REENVIO_SEG, '1');

    const enviado = await this.mandarWhatsapp(celular, codigo);
    if (!enviado) {
      await this.redis.del(clave);
      throw new HttpException(
        'No pudimos enviar el código por WhatsApp. Intenta en unos minutos.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { enviado: true, celularEnmascarado: this.enmascarar(celular) };
  }

  // ── Confirmar: crea o toma la cuenta y deja la sesión abierta ──

  async confirmar(
    dto: { dni: string; codigo: string; password: string; nombres?: string; apellidos?: string; email?: string },
    request?: any,
  ) {
    const d = this.validarDni(dto.dni);
    const otp = await this.verificarCodigo(d, dto.codigo);
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const email = dto.email?.trim().toLowerCase() || null;

    if (email) {
      const conEseEmail = await this.prisma.usuario.findUnique({ where: { email }, select: { personaId: true } });
      const persona = await this.buscarPersona(d);
      if (conEseEmail && conEseEmail.personaId !== persona?.id) {
        throw new ConflictException('Ese correo ya pertenece a otra cuenta');
      }
    }

    const persona = await this.buscarPersona(d);
    let usuarioId: string;

    if (!persona) {
      usuarioId = await this.crearCuentaNueva(d, otp, passwordHash, email, dto);
    } else if (!persona.usuario) {
      usuarioId = await this.crearUsuarioSobrePersona(persona, otp.celular, passwordHash, email);
    } else {
      const u = persona.usuario;
      await this.prisma.usuario.update({
        where: { id: u.id },
        data: {
          passwordHash,
          requiereCambioPassword: false,
          telefonoVerificado: true,
          ...(email && !u.email && { email }),
          // Con correo sin verificar y login por EMAIL el login lo bloquea: el
          // celular recién verificado alcanza, así que entra por DNI.
          ...(u.metodoPrincipalLogin === 'EMAIL' && !u.emailVerificado && { metodoPrincipalLogin: 'DNI' }),
        },
      });
      // Una cuenta vieja podía no tener método PASSWORD (p. ej. solo Google).
      const tienePassword = await this.prisma.authProvider.findFirst({
        where: { userId: u.id, provider: 'PASSWORD' },
        select: { id: true, isActive: true },
      });
      if (!tienePassword) {
        await this.prisma.authProvider.create({
          data: { userId: u.id, provider: 'PASSWORD', providerId: u.id, email: u.email || d, isActive: true },
        });
      } else if (!tienePassword.isActive) {
        await this.prisma.authProvider.update({ where: { id: tienePassword.id }, data: { isActive: true } });
      }
      usuarioId = u.id;
    }

    await this.redis.del(`comprador:otp:${d}`);
    return this.auth.emitirSesionComprador(usuarioId, request);
  }

  // ── Internos ──

  private async crearCuentaNueva(
    dni: string,
    otp: OtpGuardado,
    passwordHash: string,
    email: string | null,
    dto: { nombres?: string; apellidos?: string },
  ): Promise<string> {
    // RENIEC manda; si no respondió, lo que escribió el cliente.
    const nombres = (otp.nombres || dto.nombres || '').trim();
    const apellidos = (otp.apellidos || dto.apellidos || '').trim();
    if (nombres.length < 2 || apellidos.length < 2) {
      throw new BadRequestException('Ingresa tus nombres y apellidos');
    }
    return this.prisma.$transaction(async (tx) => {
      const persona = await tx.persona.create({
        data: { dni, nombres, apellidos, telefono: otp.celular, email, esUsuario: true, esCliente: true },
      });
      const usuario = await tx.usuario.create({
        data: {
          personaId: persona.id,
          email,
          telefono: otp.celular,
          passwordHash,
          emailVerificado: false,
          telefonoVerificado: true,
          authMethodsCount: 1,
          metodoPrincipalLogin: 'DNI',
          requiereCambioPassword: false,
          dniVerificado: !!otp.nombres,
          rolGlobal: 'CLIENTE',
        },
      });
      await tx.authProvider.create({
        data: { userId: usuario.id, provider: 'PASSWORD', providerId: usuario.id, email: email || dni, isActive: true },
      });
      return usuario.id;
    });
  }

  /** Persona que una tienda cargó sin cuenta: la cuenta se arma sobre ella (conserva su historial). */
  private async crearUsuarioSobrePersona(
    persona: { id: string; dni: string | null; email: string | null },
    celular: string,
    passwordHash: string,
    email: string | null,
  ): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const ocupado = await tx.usuario.findUnique({ where: { telefono: celular }, select: { id: true } });
      const correo = email || persona.email || null;
      const correoLibre = correo
        ? !(await tx.usuario.findUnique({ where: { email: correo }, select: { id: true } }))
        : false;
      const usuario = await tx.usuario.create({
        data: {
          personaId: persona.id,
          email: correoLibre ? correo : null,
          telefono: ocupado ? null : celular,
          passwordHash,
          emailVerificado: false,
          telefonoVerificado: true,
          authMethodsCount: 1,
          metodoPrincipalLogin: 'DNI',
          requiereCambioPassword: false,
          dniVerificado: false,
          rolGlobal: 'CLIENTE',
        },
      });
      await tx.persona.update({ where: { id: persona.id }, data: { esUsuario: true } });
      await tx.authProvider.create({
        data: {
          userId: usuario.id,
          provider: 'PASSWORD',
          providerId: usuario.id,
          email: (correoLibre ? correo : null) || persona.dni || usuario.id,
          isActive: true,
        },
      });
      return usuario.id;
    });
  }

  private async verificarCodigo(dni: string, codigo: string): Promise<OtpGuardado> {
    const clave = `comprador:otp:${dni}`;
    const crudo = await this.redis.get(clave);
    if (!crudo) throw new BadRequestException('El código venció. Pide uno nuevo.');
    const otp = JSON.parse(crudo) as OtpGuardado;

    if (otp.intentos >= CompradorCuentaService.MAX_INTENTOS) {
      await this.redis.del(clave);
      throw new BadRequestException('Demasiados intentos. Pide un código nuevo.');
    }
    if (this.hash(dni, (codigo || '').trim()) !== otp.hash) {
      otp.intentos += 1;
      const restante = await this.redis.ttl(clave);
      await this.redis.setex(clave, Math.max(restante, 1), JSON.stringify(otp));
      throw new BadRequestException('Código incorrecto');
    }
    return otp;
  }

  private async mandarWhatsapp(celular: string, codigo: string): Promise<boolean> {
    const instancia = process.env.SYNCRONIZE_WA_INSTANCE;
    if (!instancia || !this.evolution.disponible) {
      this.logger.warn('Código de comprador: falta SYNCRONIZE_WA_INSTANCE o Evolution');
      return false;
    }
    try {
      await this.evolution.sendText({
        instanceName: instancia,
        // Guardado en 9 dígitos, como el resto del sistema; WhatsApp lo quiere con el 51.
        number: `51${celular}`,
        text:
          `🛍️ Tu código para activar tu cuenta de compras es: *${codigo}*\n` +
          `Vence en 10 minutos. No lo compartas con nadie.`,
      });
      return true;
    } catch (e) {
      this.logger.warn(`Código de comprador a ${this.enmascarar(celular)}: ${(e as Error).message}`);
      return false;
    }
  }

  private buscarPersona(dni: string) {
    return this.prisma.persona.findUnique({
      where: { dni },
      select: {
        id: true,
        dni: true,
        nombres: true,
        telefono: true,
        email: true,
        usuario: {
          select: {
            id: true,
            telefono: true,
            email: true,
            emailVerificado: true,
            metodoPrincipalLogin: true,
            requiereCambioPassword: true,
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });
  }

  private async nombreReniec(dni: string): Promise<{ nombres?: string; apellidos?: string }> {
    try {
      const r = await this.consultas.consultarDni(dni);
      if (!r?.nombres) return {};
      return {
        nombres: r.nombres,
        apellidos: [r.apellidoPaterno, r.apellidoMaterno].filter(Boolean).join(' '),
      };
    } catch {
      return {};
    }
  }

  private validarDni(dni: string): string {
    const d = (dni || '').trim();
    if (!/^\d{8}$/.test(d)) throw new BadRequestException('El DNI debe tener 8 dígitos');
    return d;
  }

  /**
   * Celular peruano en 9 dígitos (como lo guarda todo el sistema, y así es
   * `Usuario.telefono @unique`), o null si no es un celular.
   */
  private celularDe(valor?: string | null): string | null {
    const dig = (valor || '').replace(/\D/g, '');
    if (/^9\d{8}$/.test(dig)) return dig;
    if (/^519\d{8}$/.test(dig)) return dig.slice(2);
    return null;
  }

  private enmascarar(celular: string): string {
    return `${celular[0]}•• ••• ${celular.slice(-3)}`;
  }

  private hash(dni: string, codigo: string): string {
    return createHash('sha256').update(`${dni}:${codigo}`).digest('hex');
  }
}
