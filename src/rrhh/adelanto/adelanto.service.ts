import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CajaService } from '../../caja/caja.service';
import { aplicarEgresoConFuente } from '../../caja/aplicar-egreso-fuente.util';
import {
  EstadoAdelanto,
  CategoriaMovimientoCaja,
  Prisma,
} from '@prisma/client';
import { CreateAdelantoDto } from './dto/create-adelanto.dto';
import { QueryAdelantosDto } from './dto/query-adelantos.dto';
import { PagarAdelantoDto } from './dto/pagar-adelanto.dto';

@Injectable()
export class AdelantoService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CajaService))
    private readonly cajaService: CajaService,
  ) {}

  // =============================================================
  // CREAR ADELANTO
  // =============================================================

  async create(empresaId: string, dto: CreateAdelantoDto) {
    // Validar que el empleado pertenezca a la empresa
    const empleado = await this.prisma.empleado.findFirst({
      where: {
        id: dto.empleadoId,
        empresaId,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado en esta empresa');
    }

    const adelanto = await this.prisma.adelantoPago.create({
      data: {
        empleadoId: dto.empleadoId,
        empresaId,
        monto: dto.monto,
        motivo: dto.motivo,
        estado: EstadoAdelanto.PENDIENTE_ADELANTO,
      },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            cargo: true,
            usuario: {
              select: {
                persona: { select: { nombres: true, apellidos: true, dni: true } },
              },
            },
          },
        },
      },
    });

    return adelanto;
  }

  // =============================================================
  // LISTAR ADELANTOS (PAGINADO + FILTROS)
  // =============================================================

  async findAll(empresaId: string, query: QueryAdelantosDto) {
    const { empleadoId, estado, page = 1, limit = 20 } = query;

    const where: Prisma.AdelantoPagoWhereInput = { empresaId };

    if (empleadoId) {
      where.empleadoId = empleadoId;
    }

    if (estado) {
      where.estado = estado;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.adelantoPago.findMany({
        where,
        include: {
          empleado: {
            select: {
              id: true,
              codigo: true,
              cargo: true,
              usuario: {
                select: {
                  persona: { select: { nombres: true, apellidos: true, dni: true } },
                },
              },
            },
          },
          aprobadoPor: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.adelantoPago.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // =============================================================
  // APROBAR ADELANTO
  // =============================================================

  async aprobar(empresaId: string, id: string, usuarioId: string) {
    const adelanto = await this.prisma.adelantoPago.findFirst({
      where: { id, empresaId },
    });

    if (!adelanto) {
      throw new NotFoundException('Adelanto no encontrado');
    }

    if (adelanto.estado !== EstadoAdelanto.PENDIENTE_ADELANTO) {
      throw new BadRequestException(
        'Solo se puede aprobar un adelanto en estado PENDIENTE',
      );
    }

    return this.prisma.adelantoPago.update({
      where: { id },
      data: {
        estado: EstadoAdelanto.APROBADO_ADELANTO,
        aprobadoPorId: usuarioId,
        fechaAprobacion: new Date(),
      },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            usuario: {
              select: {
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        },
      },
    });
  }

  // =============================================================
  // RECHAZAR ADELANTO
  // =============================================================

  async rechazar(empresaId: string, id: string, motivoRechazo: string, usuarioId: string) {
    const adelanto = await this.prisma.adelantoPago.findFirst({
      where: { id, empresaId },
    });

    if (!adelanto) {
      throw new NotFoundException('Adelanto no encontrado');
    }

    if (adelanto.estado !== EstadoAdelanto.PENDIENTE_ADELANTO) {
      throw new BadRequestException(
        'Solo se puede rechazar un adelanto en estado PENDIENTE',
      );
    }

    return this.prisma.adelantoPago.update({
      where: { id },
      data: {
        estado: EstadoAdelanto.RECHAZADO_ADELANTO,
        aprobadoPorId: usuarioId,
        fechaAprobacion: new Date(),
        motivoRechazo,
      },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            usuario: {
              select: {
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        },
      },
    });
  }

  // =============================================================
  // PAGAR ADELANTO
  // =============================================================

  async pagar(empresaId: string, id: string, dto: PagarAdelantoDto, usuarioId: string) {
    // 1. Obtener adelanto con empleado
    const adelanto = await this.prisma.adelantoPago.findFirst({
      where: { id, empresaId },
      include: {
        empleado: {
          include: {
            usuario: {
              select: {
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        },
      },
    });

    if (!adelanto) {
      throw new NotFoundException('Adelanto no encontrado');
    }

    if (adelanto.estado !== EstadoAdelanto.APROBADO_ADELANTO) {
      throw new BadRequestException(
        'Solo se puede pagar un adelanto en estado APROBADO',
      );
    }

    const nombres = adelanto.empleado.usuario.persona?.nombres ?? '';
    const apellidos = adelanto.empleado.usuario.persona?.apellidos ?? '';

    // 2. Transacción: rutear egreso según fuente + actualizar adelanto
    const result = await this.prisma.$transaction(async (tx) => {
      // a. Rutear el egreso a TESORERIA / CAJA / BANCO (no más "se descuenta
      //    en la caja con un método que no tiene saldo"). El monto sale del
      //    lugar correcto y nunca deja la caja en negativo.
      const egreso = await aplicarEgresoConFuente(tx, this.cajaService, {
        empresaId,
        sedeId: adelanto.empleado.sedeId,
        usuarioId,
        metodoPago: dto.metodoPago,
        monto: Number(adelanto.monto),
        fuente: dto.fuente,
        bancoId: dto.bancoId,
        categoria: CategoriaMovimientoCaja.ADELANTO_EMPLEADO,
        descripcion: `Adelanto de sueldo - ${nombres} ${apellidos}`,
        adelantoPagoId: adelanto.id,
      });

      // b. Actualizar adelanto (snapshot de fuente + banco + movimiento)
      const adelantoActualizado = await tx.adelantoPago.update({
        where: { id },
        data: {
          estado: EstadoAdelanto.PAGADO_ADELANTO,
          pagadoPorId: usuarioId,
          metodoPago: egreso.metodoPago,
          fuentePago: egreso.fuente,
          bancoId: egreso.bancoId,
          movimientoCajaId: egreso.movimientoCajaId,
        },
        include: {
          empleado: {
            select: {
              id: true,
              codigo: true,
              usuario: {
                select: {
                  persona: { select: { nombres: true, apellidos: true } },
                },
              },
            },
          },
        },
      });

      return adelantoActualizado;
    });

    return result;
  }
}
