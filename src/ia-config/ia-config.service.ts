import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Rol, ModoAgenteIA } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { cifrarSecreto } from './crypto-key.util';
import { UpdateIaConfigDto, IaConfigResponseDto } from './dto/ia-config.dto';

/**
 * Configuración del agente IA vendedor por WhatsApp, una por empresa
 * (IntegracionAgenteIA). Panel de la empresa: personalidad, alcance y — si trae
 * su propio proveedor (BYOK) — su API key, que se guarda CIFRADA y se enmascara
 * al leer. Cambiar el proveedor/key resetea la aprobación del super admin.
 */
@Injectable()
export class IaConfigService {
  private readonly logger = new Logger(IaConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Mismo criterio que IntegracionYape: SUPER_ADMIN / EMPRESA_ADMIN activos. */
  private async verificarAdmin(empresaId: string, userId: string): Promise<void> {
    const userRole = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: userId,
        isActive: true,
        deletedAt: null,
        rol: { in: [Rol.SUPER_ADMIN, Rol.EMPRESA_ADMIN] },
      },
    });
    if (!userRole) {
      throw new ForbiddenException(
        'No tienes permisos para gestionar el agente IA',
      );
    }
  }

  private async cargar(empresaId: string) {
    return this.prisma.integracionAgenteIA.findUnique({ where: { empresaId } });
  }

  private aResponse(cfg: Awaited<ReturnType<IaConfigService['cargar']>>): IaConfigResponseDto {
    return {
      configurado: !!cfg,
      habilitado: cfg?.habilitado ?? false,
      nombreAgente: cfg?.nombreAgente ?? null,
      promptPersonalidad: cfg?.promptPersonalidad ?? null,
      mensajeBienvenida: cfg?.mensajeBienvenida ?? null,
      modo: cfg?.modo ?? ModoAgenteIA.SOLO_CONSULTA,
      puedeCobrarYape: cfg?.puedeCobrarYape ?? false,
      escalarAHumano: cfg?.escalarAHumano ?? true,
      horarioTexto: cfg?.horarioTexto ?? null,
      proveedorPropio: cfg?.proveedorPropio ?? false,
      proveedorTipo: cfg?.proveedorTipo ?? null,
      proveedorModelo: cfg?.proveedorModelo ?? null,
      // La key va cifrada en BD; para la máscara mostramos prefijo+sufijo del
      // texto guardado (basta para que el admin reconozca "hay una key puesta").
      proveedorApiKeyMask: cfg?.proveedorApiKey ? '••••…' + cfg.id.slice(-4) : null,
      proveedorAprobado: cfg?.proveedorAprobado ?? false,
      modeloProveedor: cfg?.modeloProveedor ?? null,
      maxProductosMostrar: cfg?.maxProductosMostrar ?? 5,
      actualizadoEn: cfg?.actualizadoEn ?? null,
    };
  }

  /** Devuelve la config de la empresa (API key SIEMPRE enmascarada). */
  async getConfig(empresaId: string, userId: string): Promise<IaConfigResponseDto> {
    await this.verificarAdmin(empresaId, userId);
    return this.aResponse(await this.cargar(empresaId));
  }

  /**
   * Crea o actualiza la config. La API key nueva se CIFRA antes de guardar y
   * solo se toca si viene con valor. Cambiar proveedor/modelo/key resetea
   * `proveedorAprobado` → el super admin debe re-validar antes de que la empresa
   * pueda usar su proveedor.
   */
  async upsertConfig(
    empresaId: string,
    userId: string,
    dto: UpdateIaConfigDto,
  ): Promise<IaConfigResponseDto> {
    await this.verificarAdmin(empresaId, userId);
    const existente = await this.cargar(empresaId);

    const apiKeyNueva = dto.proveedorApiKey?.trim();
    // Un cambio de key, tipo o modelo del proveedor invalida la aprobación.
    const cambiaProveedor =
      (apiKeyNueva && apiKeyNueva.length > 0) ||
      (dto.proveedorTipo !== undefined &&
        dto.proveedorTipo !== existente?.proveedorTipo) ||
      (dto.proveedorModelo !== undefined &&
        dto.proveedorModelo !== existente?.proveedorModelo);

    const comun = {
      ...(dto.habilitado !== undefined && { habilitado: dto.habilitado }),
      ...(dto.nombreAgente !== undefined && {
        nombreAgente: dto.nombreAgente.trim() || null,
      }),
      ...(dto.promptPersonalidad !== undefined && {
        promptPersonalidad: dto.promptPersonalidad.trim() || null,
      }),
      ...(dto.mensajeBienvenida !== undefined && {
        mensajeBienvenida: dto.mensajeBienvenida.trim() || null,
      }),
      ...(dto.modo !== undefined && { modo: dto.modo as ModoAgenteIA }),
      ...(dto.puedeCobrarYape !== undefined && {
        puedeCobrarYape: dto.puedeCobrarYape,
      }),
      ...(dto.escalarAHumano !== undefined && {
        escalarAHumano: dto.escalarAHumano,
      }),
      ...(dto.horarioTexto !== undefined && {
        horarioTexto: dto.horarioTexto.trim() || null,
      }),
      ...(dto.proveedorPropio !== undefined && {
        proveedorPropio: dto.proveedorPropio,
      }),
      ...(dto.proveedorTipo !== undefined && {
        proveedorTipo: dto.proveedorTipo || null,
      }),
      ...(dto.proveedorModelo !== undefined && {
        proveedorModelo: dto.proveedorModelo.trim() || null,
      }),
      ...(apiKeyNueva && { proveedorApiKey: cifrarSecreto(apiKeyNueva) }),
      ...(cambiaProveedor && { proveedorAprobado: false }),
    };

    if (!existente) {
      await this.prisma.integracionAgenteIA.create({
        data: { empresaId, ...comun },
      });
    } else {
      await this.prisma.integracionAgenteIA.update({
        where: { empresaId },
        data: comun,
      });
    }

    this.logger.log(`IntegracionAgenteIA actualizada (empresa ${empresaId})`);
    return this.aResponse(await this.cargar(empresaId));
  }
}
