import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoAviso } from '@prisma/client';
import { QueryAvisoMantenimientoDto } from './dto/query-aviso-mantenimiento.dto';
import { UpdateEstadoAvisoDto } from './dto/update-estado-aviso.dto';
import { UpdateConfiguracionAvisoDto } from './dto/update-configuracion-aviso.dto';
import { createCursorPaginatedResponse } from '../common/utils/pagination.util';

const DEFAULT_INTERVALOS: Record<string, number> = {
  MANTENIMIENTO: 120,
  REPARACION: 180,
  INSTALACION: 365,
  LIMPIEZA: 90,
  ACTUALIZACION: 180,
  CONFIGURACION: 365,
  DIAGNOSTICO: 180,
  RECUPERACION_DATOS: 365,
  CONSULTORIA: 365,
  FORMACION: 365,
  SOPORTE: 180,
};

const VALID_TRANSITIONS: Record<EstadoAviso, EstadoAviso[]> = {
  PENDIENTE: [EstadoAviso.NOTIFICADO, EstadoAviso.ATENDIDO, EstadoAviso.DESCARTADO],
  NOTIFICADO: [EstadoAviso.ATENDIDO, EstadoAviso.DESCARTADO],
  ATENDIDO: [],
  DESCARTADO: [],
};

@Injectable()
export class AvisoMantenimientoService {
  constructor(private prisma: PrismaService) {}

  async findAll(empresaId: string, query: QueryAvisoMantenimientoDto) {
    const limit = Math.min(Number(query.limit) || 20, 100);

    const where: any = { empresaId };

    if (query.estado) where.estado = query.estado;
    if (query.clienteId) where.clienteId = query.clienteId;
    if (query.tipoServicio) where.tipoServicio = query.tipoServicio;

    if (query.fechaDesde || query.fechaHasta) {
      where.fechaRecomendada = {};
      if (query.fechaDesde) where.fechaRecomendada.gte = new Date(query.fechaDesde);
      if (query.fechaHasta) where.fechaRecomendada.lte = new Date(query.fechaHasta);
    }

    const findArgs: any = {
      where,
      orderBy: { fechaRecomendada: 'asc' },
      take: limit,
      include: {
        cliente: { include: { persona: true } },
        ordenServicio: {
          select: {
            id: true,
            codigo: true,
            tipoServicio: true,
            tipoEquipo: true,
            marcaEquipo: true,
            estado: true,
          },
        },
      },
    };

    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }

    const [data, total] = await Promise.all([
      this.prisma.avisoMantenimiento.findMany(findArgs),
      this.prisma.avisoMantenimiento.count({ where }),
    ]);

    return createCursorPaginatedResponse(data, total, limit, (item) => item.id);
  }

  async findOne(empresaId: string, id: string) {
    const aviso = await this.prisma.avisoMantenimiento.findFirst({
      where: { id, empresaId },
      include: {
        cliente: { include: { persona: true } },
        ordenServicio: {
          select: {
            id: true,
            codigo: true,
            tipoServicio: true,
            tipoEquipo: true,
            marcaEquipo: true,
            estado: true,
            costoTotal: true,
            fechaEntrega: true,
          },
        },
      },
    });

    if (!aviso) {
      throw new NotFoundException('Aviso de mantenimiento no encontrado');
    }

    return aviso;
  }

  async updateEstado(empresaId: string, id: string, dto: UpdateEstadoAvisoDto) {
    const aviso = await this.findOne(empresaId, id);

    const allowed = VALID_TRANSITIONS[aviso.estado];
    if (!allowed.includes(dto.nuevoEstado)) {
      throw new BadRequestException(
        `No se puede cambiar de "${aviso.estado}" a "${dto.nuevoEstado}". ` +
        `Transiciones válidas: ${allowed.join(', ') || 'ninguna'}`,
      );
    }

    const updateData: any = { estado: dto.nuevoEstado };
    if (dto.notas) updateData.notas = dto.notas;
    if (dto.nuevoEstado === EstadoAviso.NOTIFICADO) {
      updateData.notificadoEn = new Date();
    }

    return this.prisma.avisoMantenimiento.update({
      where: { id },
      data: updateData,
      include: {
        cliente: { include: { persona: true } },
        ordenServicio: {
          select: { id: true, codigo: true, tipoServicio: true },
        },
      },
    });
  }

  async getConfiguracion(empresaId: string) {
    let config = await this.prisma.configuracionAvisoMantenimiento.findUnique({
      where: { empresaId },
    });

    if (!config) {
      // Retornar defaults sin crear en DB
      return {
        id: null,
        empresaId,
        intervalos: DEFAULT_INTERVALOS,
        diasAnticipacion: 7,
        habilitado: true,
      };
    }

    return config;
  }

  async updateConfiguracion(empresaId: string, dto: UpdateConfiguracionAvisoDto) {
    const data: any = {};
    if (dto.intervalos !== undefined) data.intervalos = dto.intervalos;
    if (dto.diasAnticipacion !== undefined) data.diasAnticipacion = dto.diasAnticipacion;
    if (dto.habilitado !== undefined) data.habilitado = dto.habilitado;

    return this.prisma.configuracionAvisoMantenimiento.upsert({
      where: { empresaId },
      create: {
        empresaId,
        intervalos: dto.intervalos ?? DEFAULT_INTERVALOS,
        diasAnticipacion: dto.diasAnticipacion ?? 7,
        habilitado: dto.habilitado ?? true,
      },
      update: data,
    });
  }

  async getResumen(empresaId: string) {
    const [pendientes, notificados, atendidos, proximosSemana] = await Promise.all([
      this.prisma.avisoMantenimiento.count({
        where: { empresaId, estado: EstadoAviso.PENDIENTE },
      }),
      this.prisma.avisoMantenimiento.count({
        where: { empresaId, estado: EstadoAviso.NOTIFICADO },
      }),
      this.prisma.avisoMantenimiento.count({
        where: { empresaId, estado: EstadoAviso.ATENDIDO },
      }),
      this.prisma.avisoMantenimiento.count({
        where: {
          empresaId,
          estado: { in: [EstadoAviso.PENDIENTE, EstadoAviso.NOTIFICADO] },
          fechaRecomendada: {
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    return {
      pendientes,
      notificados,
      atendidos,
      proximosSemana,
      totalActivos: pendientes + notificados,
    };
  }

  /**
   * Crear aviso para una orden completada.
   * Llamado desde el cron job o al completar una orden.
   */
  async crearAvisoParaOrden(orden: {
    id: string;
    empresaId: string;
    clienteId: string;
    tipoServicio: string;
    tipoEquipo?: string | null;
    marcaEquipo?: string | null;
    fechaEntrega?: Date | null;
    actualizadoEn: Date;
    fechaAvisoPersonalizado?: Date | null;
  }) {
    // Verificar que no exista un aviso activo para esta orden
    const existing = await this.prisma.avisoMantenimiento.findFirst({
      where: {
        ordenServicioId: orden.id,
        estado: { in: [EstadoAviso.PENDIENTE, EstadoAviso.NOTIFICADO] },
      },
    });
    if (existing) return null;

    const fechaBase = orden.fechaEntrega ?? orden.actualizadoEn;
    let fechaRecomendada: Date;

    if (orden.fechaAvisoPersonalizado) {
      // Usar la fecha personalizada del cliente
      fechaRecomendada = orden.fechaAvisoPersonalizado;
    } else {
      // Calcular según intervalos configurados
      const config = await this.getConfiguracion(orden.empresaId);
      const intervalos = config.intervalos as Record<string, number>;
      const dias = intervalos[orden.tipoServicio];

      if (!dias) return null; // Tipo de servicio sin intervalo configurado
      fechaRecomendada = new Date(fechaBase.getTime() + dias * 24 * 60 * 60 * 1000);
    }

    const equipoParts = [orden.tipoEquipo, orden.marcaEquipo].filter(Boolean);
    const equipoDescripcion = equipoParts.length > 0 ? equipoParts.join(' - ') : null;

    return this.prisma.avisoMantenimiento.create({
      data: {
        empresaId: orden.empresaId,
        ordenServicioId: orden.id,
        clienteId: orden.clienteId,
        tipoServicio: orden.tipoServicio,
        equipoDescripcion,
        fechaUltimoServicio: fechaBase,
        fechaRecomendada,
      },
    });
  }
}
