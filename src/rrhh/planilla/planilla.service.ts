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
  EstadoPeriodoPlanilla,
  EstadoBoletaPago,
  CategoriaMovimientoCaja,
  Prisma,
} from '@prisma/client';
import { CreatePeriodoPlanillaDto } from './dto/create-periodo-planilla.dto';
import { QueryPeriodosPlanillaDto } from './dto/query-periodos-planilla.dto';
import { PagarBoletaDto } from './dto/pagar-boleta.dto';

@Injectable()
export class PlanillaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => CajaService))
    private readonly cajaService: CajaService,
  ) {}

  // =============================================================
  // CREAR PERIODO DE PLANILLA
  // =============================================================

  async createPeriodo(empresaId: string, dto: CreatePeriodoPlanillaDto, usuarioId: string) {
    // Parsear periodo para extraer mes y año
    const [anioStr, mesStr] = dto.periodo.split('-');
    const anio = parseInt(anioStr, 10);
    const mes = parseInt(mesStr, 10);

    // Calcular fechaInicio y fechaFin
    const fechaInicio = new Date(Date.UTC(anio, mes - 1, 1));
    const fechaFin = new Date(Date.UTC(anio, mes, 0)); // Último día del mes

    // Verificar que no exista un periodo duplicado
    const existente = await this.prisma.periodoPlanilla.findFirst({
      where: {
        empresaId,
        periodo: dto.periodo,
        sedeId: dto.sedeId ?? null,
      },
    });

    if (existente) {
      throw new BadRequestException(
        `Ya existe un periodo de planilla para ${dto.periodo}${dto.sedeId ? ' en esta sede' : ''}`,
      );
    }

    // Validar sede si se proporcionó
    if (dto.sedeId) {
      const sede = await this.prisma.sede.findFirst({
        where: { id: dto.sedeId, empresaId },
      });

      if (!sede) {
        throw new NotFoundException('La sede no pertenece a esta empresa');
      }
    }

    const periodo = await this.prisma.periodoPlanilla.create({
      data: {
        empresaId,
        sedeId: dto.sedeId ?? null,
        periodo: dto.periodo,
        mes,
        anio,
        fechaInicio,
        fechaFin,
        estado: EstadoPeriodoPlanilla.BORRADOR,
        observaciones: dto.observaciones,
      },
      include: {
        sede: { select: { id: true, nombre: true } },
      },
    });

    return periodo;
  }

  // =============================================================
  // LISTAR PERIODOS (PAGINADO + FILTROS)
  // =============================================================

  async findAllPeriodos(empresaId: string, query: QueryPeriodosPlanillaDto) {
    const { anio, estado, page = 1, limit = 20 } = query;

    const where: Prisma.PeriodoPlanillaWhereInput = { empresaId };

    if (anio) {
      where.anio = anio;
    }

    if (estado) {
      where.estado = estado;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.periodoPlanilla.findMany({
        where,
        include: {
          sede: { select: { id: true, nombre: true } },
          _count: { select: { boletasPago: true } },
        },
        orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.periodoPlanilla.count({ where }),
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
  // OBTENER PERIODO POR ID
  // =============================================================

  async findOnePeriodo(empresaId: string, id: string) {
    const periodo = await this.prisma.periodoPlanilla.findFirst({
      where: { id, empresaId },
      include: {
        sede: { select: { id: true, nombre: true } },
        calculadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        aprobadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        boletasPago: {
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
          orderBy: { creadoEn: 'asc' },
        },
        _count: { select: { boletasPago: true } },
      },
    });

    if (!periodo) {
      throw new NotFoundException('Periodo de planilla no encontrado');
    }

    return periodo;
  }

  // =============================================================
  // APROBAR PERIODO
  // =============================================================

  async aprobarPeriodo(empresaId: string, id: string, usuarioId: string) {
    const periodo = await this.prisma.periodoPlanilla.findFirst({
      where: { id, empresaId },
    });

    if (!periodo) {
      throw new NotFoundException('Periodo de planilla no encontrado');
    }

    if (periodo.estado !== EstadoPeriodoPlanilla.CALCULADA) {
      throw new BadRequestException(
        'Solo se puede aprobar un periodo en estado CALCULADA',
      );
    }

    return this.prisma.periodoPlanilla.update({
      where: { id },
      data: {
        estado: EstadoPeriodoPlanilla.APROBADA,
        aprobadoPorId: usuarioId,
        fechaAprobacion: new Date(),
      },
      include: {
        sede: { select: { id: true, nombre: true } },
        _count: { select: { boletasPago: true } },
      },
    });
  }

  // =============================================================
  // PAGAR BOLETA INDIVIDUAL
  // =============================================================

  async pagarBoleta(empresaId: string, boletaId: string, dto: PagarBoletaDto, usuarioId: string) {
    // 1. Obtener boleta con periodo y empleado
    const boleta = await this.prisma.boletaPago.findFirst({
      where: { id: boletaId, empresaId },
      include: {
        periodo: true,
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

    if (!boleta) {
      throw new NotFoundException('Boleta de pago no encontrada');
    }

    if (boleta.estado !== EstadoBoletaPago.PENDIENTE_BOLETA) {
      throw new BadRequestException('La boleta no está en estado PENDIENTE');
    }

    if (boleta.periodo.estado !== EstadoPeriodoPlanilla.APROBADA &&
        boleta.periodo.estado !== EstadoPeriodoPlanilla.PAGADA) {
      throw new BadRequestException(
        'El periodo de planilla debe estar APROBADO para poder pagar boletas',
      );
    }

    const nombres = boleta.empleado.usuario.persona?.nombres ?? '';
    const apellidos = boleta.empleado.usuario.persona?.apellidos ?? '';

    // 2. Transacción: rutear egreso según fuente + actualizar boleta
    const result = await this.prisma.$transaction(async (tx) => {
      // a. Rutear el egreso a TESORERIA / CAJA / BANCO (nunca deja la caja en
      //    negativo: el digital sale del banco, no del cubo del método).
      const egreso = await aplicarEgresoConFuente(tx, this.cajaService, {
        empresaId,
        sedeId: boleta.empleado.sedeId,
        usuarioId,
        metodoPago: dto.metodoPago,
        monto: Number(boleta.totalNeto),
        fuente: dto.fuente,
        bancoId: dto.bancoId,
        categoria: CategoriaMovimientoCaja.PAGO_PLANILLA,
        descripcion: `Pago planilla ${boleta.periodo.periodo} - ${nombres} ${apellidos}`,
        boletaPagoId: boleta.id,
      });

      // b. Actualizar boleta (snapshot de fuente + banco + movimiento)
      const boletaActualizada = await tx.boletaPago.update({
        where: { id: boletaId },
        data: {
          estado: EstadoBoletaPago.PAGADA_BOLETA,
          fechaPago: new Date(),
          pagadoPorId: usuarioId,
          metodoPago: egreso.metodoPago,
          fuentePago: egreso.fuente,
          bancoId: egreso.bancoId,
          movimientoCajaId: egreso.movimientoCajaId,
        },
      });

      // c. Verificar si todas las boletas del periodo están pagadas
      const boletasPendientes = await tx.boletaPago.count({
        where: {
          periodoId: boleta.periodoId,
          estado: { not: EstadoBoletaPago.PAGADA_BOLETA },
        },
      });

      if (boletasPendientes === 0) {
        await tx.periodoPlanilla.update({
          where: { id: boleta.periodoId },
          data: { estado: EstadoPeriodoPlanilla.PAGADA },
        });
      }

      return boletaActualizada;
    });

    return result;
  }

  // =============================================================
  // PAGAR PLANILLA COMPLETA (BULK)
  // =============================================================

  async pagarPlanilla(empresaId: string, periodoId: string, dto: PagarBoletaDto, usuarioId: string) {
    const periodo = await this.prisma.periodoPlanilla.findFirst({
      where: { id: periodoId, empresaId },
    });

    if (!periodo) {
      throw new NotFoundException('Periodo de planilla no encontrado');
    }

    if (periodo.estado !== EstadoPeriodoPlanilla.APROBADA &&
        periodo.estado !== EstadoPeriodoPlanilla.PAGADA) {
      throw new BadRequestException(
        'El periodo debe estar APROBADO para poder pagar las boletas',
      );
    }

    // Obtener todas las boletas pendientes
    const boletasPendientes = await this.prisma.boletaPago.findMany({
      where: {
        periodoId,
        empresaId,
        estado: EstadoBoletaPago.PENDIENTE_BOLETA,
      },
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

    if (boletasPendientes.length === 0) {
      throw new BadRequestException(
        'No hay boletas pendientes de pago en este periodo',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let pagadas = 0;

      for (const boleta of boletasPendientes) {
        const nombres = boleta.empleado.usuario.persona?.nombres ?? '';
        const apellidos = boleta.empleado.usuario.persona?.apellidos ?? '';

        // Rutear el egreso a TESORERIA / CAJA / BANCO (misma fuente para todas
        // las boletas del periodo).
        const egreso = await aplicarEgresoConFuente(tx, this.cajaService, {
          empresaId,
          sedeId: boleta.empleado.sedeId,
          usuarioId,
          metodoPago: dto.metodoPago,
          monto: Number(boleta.totalNeto),
          fuente: dto.fuente,
          bancoId: dto.bancoId,
          categoria: CategoriaMovimientoCaja.PAGO_PLANILLA,
          descripcion: `Pago planilla ${periodo.periodo} - ${nombres} ${apellidos}`,
          boletaPagoId: boleta.id,
        });

        // Actualizar boleta (snapshot de fuente + banco + movimiento)
        await tx.boletaPago.update({
          where: { id: boleta.id },
          data: {
            estado: EstadoBoletaPago.PAGADA_BOLETA,
            fechaPago: new Date(),
            pagadoPorId: usuarioId,
            metodoPago: egreso.metodoPago,
            fuentePago: egreso.fuente,
            bancoId: egreso.bancoId,
            movimientoCajaId: egreso.movimientoCajaId,
          },
        });

        pagadas++;
      }

      // Actualizar periodo a PAGADA
      await tx.periodoPlanilla.update({
        where: { id: periodoId },
        data: { estado: EstadoPeriodoPlanilla.PAGADA },
      });

      return { boletasPagadas: pagadas };
    });

    return result;
  }

  // =============================================================
  // LISTAR BOLETAS
  // =============================================================

  async findBoletas(
    empresaId: string,
    query: { periodoId?: string; empleadoId?: string; estado?: EstadoBoletaPago; page?: number; limit?: number },
  ) {
    const { periodoId, empleadoId, estado, page = 1, limit = 20 } = query;

    const where: Prisma.BoletaPagoWhereInput = { empresaId };

    if (periodoId) {
      where.periodoId = periodoId;
    }

    if (empleadoId) {
      where.empleadoId = empleadoId;
    }

    if (estado) {
      where.estado = estado;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.boletaPago.findMany({
        where,
        include: {
          empleado: {
            select: {
              id: true,
              codigo: true,
              cargo: true,
              departamento: true,
              usuario: {
                select: {
                  persona: { select: { nombres: true, apellidos: true, dni: true } },
                },
              },
            },
          },
          periodo: {
            select: { id: true, periodo: true, estado: true },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.boletaPago.count({ where }),
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
  // OBTENER BOLETA POR ID CON DETALLES
  // =============================================================

  async findOneBoleta(empresaId: string, boletaId: string) {
    const boleta = await this.prisma.boletaPago.findFirst({
      where: { id: boletaId, empresaId },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            cargo: true,
            departamento: true,
            salarioBase: true,
            usuario: {
              select: {
                email: true,
                persona: { select: { nombres: true, apellidos: true, dni: true } },
              },
            },
            sede: { select: { id: true, nombre: true } },
          },
        },
        periodo: {
          select: { id: true, periodo: true, mes: true, anio: true, estado: true },
        },
        detalles: {
          orderBy: [{ tipo: 'asc' }, { concepto: 'asc' }],
        },
        pagadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        adelantosDescontados: {
          select: {
            id: true,
            monto: true,
            motivo: true,
            fechaSolicitud: true,
          },
        },
      },
    });

    if (!boleta) {
      throw new NotFoundException('Boleta de pago no encontrada');
    }

    return boleta;
  }
}
