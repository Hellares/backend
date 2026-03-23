import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, TipoAsistencia } from '@prisma/client';
import { RegistrarAsistenciaDto } from './dto/registrar-asistencia.dto';
import { RegistrarSalidaDto } from './dto/registrar-salida.dto';
import { QueryAsistenciasDto } from './dto/query-asistencias.dto';
import { BulkAsistenciaDto } from './dto/bulk-asistencia.dto';

@Injectable()
export class AsistenciaService {
  constructor(private readonly prisma: PrismaService) {}

  // =============================================================
  // REGISTRAR ENTRADA
  // =============================================================

  async registrarEntrada(
    empresaId: string,
    dto: RegistrarAsistenciaDto,
    usuarioId: string,
  ) {
    // 1. Validar que el empleado existe y pertenece a la empresa
    const empleado = await this.prisma.empleado.findFirst({
      where: {
        id: dto.empleadoId,
        empresaId,
        deletedAt: null,
      },
    });

    if (!empleado) {
      throw new NotFoundException(
        'Empleado no encontrado en esta empresa',
      );
    }

    // 2. Verificar que no exista ya un registro para esta fecha
    const fechaDate = new Date(dto.fecha);
    fechaDate.setUTCHours(0, 0, 0, 0);

    const existente = await this.prisma.asistencia.findUnique({
      where: {
        empleadoId_fecha: {
          empleadoId: dto.empleadoId,
          fecha: fechaDate,
        },
      },
    });

    if (existente) {
      throw new ConflictException(
        'Ya existe un registro de asistencia para este empleado en esta fecha',
      );
    }

    // 3. Crear asistencia
    const asistencia = await this.prisma.asistencia.create({
      data: {
        empleadoId: dto.empleadoId,
        empresaId,
        sedeId: empleado.sedeId,
        fecha: fechaDate,
        horaEntrada: dto.horaEntrada ? new Date(dto.horaEntrada) : null,
        tipoAsistencia: dto.tipoAsistencia ?? TipoAsistencia.NORMAL,
        estado: dto.estado,
        observaciones: dto.observaciones,
        registradoPorId: usuarioId,
      },
      include: {
        empleado: {
          include: {
            usuario: {
              select: {
                id: true,
                email: true,
                persona: {
                  select: {
                    nombres: true,
                    apellidos: true,
                    dni: true,
                  },
                },
              },
            },
          },
        },
        sede: { select: { id: true, nombre: true } },
      },
    });

    return asistencia;
  }

  // =============================================================
  // REGISTRAR SALIDA
  // =============================================================

  async registrarSalida(
    empresaId: string,
    asistenciaId: string,
    dto: RegistrarSalidaDto,
    usuarioId: string,
  ) {
    // 1. Buscar la asistencia
    const asistencia = await this.prisma.asistencia.findFirst({
      where: {
        id: asistenciaId,
        empresaId,
      },
    });

    if (!asistencia) {
      throw new NotFoundException('Registro de asistencia no encontrado');
    }

    if (!asistencia.horaEntrada) {
      throw new BadRequestException(
        'No se puede registrar salida sin hora de entrada',
      );
    }

    const horaSalida = new Date(dto.horaSalida);
    const horaEntrada = new Date(asistencia.horaEntrada);

    if (horaSalida <= horaEntrada) {
      throw new BadRequestException(
        'La hora de salida debe ser posterior a la hora de entrada',
      );
    }

    // 2. Calcular horas trabajadas
    let diffMs = horaSalida.getTime() - horaEntrada.getTime();

    // Restar tiempo de almuerzo si se proporcionan ambas horas
    if (dto.horaAlmuerzoInicio && dto.horaAlmuerzoFin) {
      const almuerzoInicio = new Date(dto.horaAlmuerzoInicio);
      const almuerzoFin = new Date(dto.horaAlmuerzoFin);

      if (almuerzoFin <= almuerzoInicio) {
        throw new BadRequestException(
          'La hora de fin de almuerzo debe ser posterior a la hora de inicio',
        );
      }

      const almuerzoMs = almuerzoFin.getTime() - almuerzoInicio.getTime();
      diffMs -= almuerzoMs;
    }

    const horasTrabajadas = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;

    // 3. Calcular horas extra
    const config = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId },
    });

    const jornadaDefault = config?.horasJornadaDefault ?? 8.0;
    const horasExtra =
      horasTrabajadas > jornadaDefault
        ? Math.round((horasTrabajadas - jornadaDefault) * 100) / 100
        : 0;

    // 4. Actualizar asistencia
    const actualizada = await this.prisma.asistencia.update({
      where: { id: asistenciaId },
      data: {
        horaSalida,
        horaAlmuerzoInicio: dto.horaAlmuerzoInicio
          ? new Date(dto.horaAlmuerzoInicio)
          : undefined,
        horaAlmuerzoFin: dto.horaAlmuerzoFin
          ? new Date(dto.horaAlmuerzoFin)
          : undefined,
        horasTrabajadas,
        horasExtra,
        observaciones: dto.observaciones !== undefined
          ? dto.observaciones
          : undefined,
      },
      include: {
        empleado: {
          include: {
            usuario: {
              select: {
                id: true,
                email: true,
                persona: {
                  select: {
                    nombres: true,
                    apellidos: true,
                    dni: true,
                  },
                },
              },
            },
          },
        },
        sede: { select: { id: true, nombre: true } },
      },
    });

    return actualizada;
  }

  // =============================================================
  // LISTAR ASISTENCIAS (PAGINADO + FILTROS)
  // =============================================================

  async findAll(empresaId: string, query: QueryAsistenciasDto) {
    const {
      empleadoId,
      sedeId,
      fechaDesde,
      fechaHasta,
      estado,
      page = 1,
      limit = 50,
    } = query;

    const where: Prisma.AsistenciaWhereInput = {
      empresaId,
    };

    if (empleadoId) {
      where.empleadoId = empleadoId;
    }

    if (sedeId) {
      where.sedeId = sedeId;
    }

    if (estado) {
      where.estado = estado;
    }

    if (fechaDesde || fechaHasta) {
      where.fecha = {};
      if (fechaDesde) {
        const desde = new Date(fechaDesde);
        desde.setUTCHours(0, 0, 0, 0);
        where.fecha.gte = desde;
      }
      if (fechaHasta) {
        const hasta = new Date(fechaHasta);
        hasta.setUTCHours(23, 59, 59, 999);
        where.fecha.lte = hasta;
      }
    }

    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.asistencia.findMany({
        where,
        include: {
          empleado: {
            include: {
              usuario: {
                select: {
                  id: true,
                  email: true,
                  persona: {
                    select: {
                      nombres: true,
                      apellidos: true,
                      dni: true,
                    },
                  },
                },
              },
            },
          },
          sede: { select: { id: true, nombre: true } },
        },
        orderBy: { fecha: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.asistencia.count({ where }),
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
  // RESUMEN MENSUAL
  // =============================================================

  async getResumenMensual(
    empresaId: string,
    empleadoId: string,
    mes: number,
    anio: number,
  ) {
    // Validar que el empleado pertenece a la empresa
    const empleado = await this.prisma.empleado.findFirst({
      where: {
        id: empleadoId,
        empresaId,
        deletedAt: null,
      },
      include: {
        usuario: {
          select: {
            id: true,
            email: true,
            persona: {
              select: {
                nombres: true,
                apellidos: true,
                dni: true,
              },
            },
          },
        },
      },
    });

    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado en esta empresa');
    }

    // Rango de fechas del mes
    const fechaInicio = new Date(Date.UTC(anio, mes - 1, 1));
    const fechaFin = new Date(Date.UTC(anio, mes, 0, 23, 59, 59, 999));

    const asistencias = await this.prisma.asistencia.findMany({
      where: {
        empresaId,
        empleadoId,
        fecha: {
          gte: fechaInicio,
          lte: fechaFin,
        },
      },
      orderBy: { fecha: 'asc' },
    });

    // Calcular totales
    let diasPresente = 0;
    let diasTardanza = 0;
    let diasFalta = 0;
    let diasJustificado = 0;
    let diasVacacion = 0;
    let diasLicencia = 0;
    let diasDescanso = 0;
    let diasFeriado = 0;
    let totalHorasTrabajadas = 0;
    let totalHorasExtra = 0;

    for (const a of asistencias) {
      switch (a.estado) {
        case 'PRESENTE':
          diasPresente++;
          break;
        case 'TARDANZA':
          diasTardanza++;
          break;
        case 'FALTA':
          diasFalta++;
          break;
        case 'JUSTIFICADO':
          diasJustificado++;
          break;
        case 'VACACION':
          diasVacacion++;
          break;
        case 'LICENCIA':
          diasLicencia++;
          break;
        case 'DESCANSO':
          diasDescanso++;
          break;
        case 'FERIADO':
          diasFeriado++;
          break;
      }

      if (a.horasTrabajadas) {
        totalHorasTrabajadas += Number(a.horasTrabajadas);
      }
      if (a.horasExtra) {
        totalHorasExtra += Number(a.horasExtra);
      }
    }

    return {
      empleado,
      mes,
      anio,
      totalRegistros: asistencias.length,
      resumen: {
        diasPresente,
        diasTardanza,
        diasFalta,
        diasJustificado,
        diasVacacion,
        diasLicencia,
        diasDescanso,
        diasFeriado,
        totalHorasTrabajadas: Math.round(totalHorasTrabajadas * 100) / 100,
        totalHorasExtra: Math.round(totalHorasExtra * 100) / 100,
      },
      detalle: asistencias,
    };
  }

  // =============================================================
  // REGISTRO MASIVO (BULK)
  // =============================================================

  async registrarBulk(
    empresaId: string,
    dto: BulkAsistenciaDto,
    usuarioId: string,
  ) {
    // Validar que la sede pertenece a la empresa
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId },
    });

    if (!sede) {
      throw new NotFoundException('La sede no pertenece a esta empresa');
    }

    const fechaDate = new Date(dto.fecha);
    fechaDate.setUTCHours(0, 0, 0, 0);

    // Validar que todos los empleados existen en la empresa
    const empleadoIds = dto.registros.map((r) => r.empleadoId);
    const empleados = await this.prisma.empleado.findMany({
      where: {
        id: { in: empleadoIds },
        empresaId,
        deletedAt: null,
      },
      select: { id: true },
    });

    const empleadoIdsValidos = new Set(empleados.map((e) => e.id));
    const invalidos = empleadoIds.filter((id) => !empleadoIdsValidos.has(id));

    if (invalidos.length > 0) {
      throw new BadRequestException(
        `Los siguientes empleados no fueron encontrados: ${invalidos.join(', ')}`,
      );
    }

    // Crear registros con upsert para evitar duplicados
    const resultados = await this.prisma.$transaction(
      dto.registros.map((registro) =>
        this.prisma.asistencia.upsert({
          where: {
            empleadoId_fecha: {
              empleadoId: registro.empleadoId,
              fecha: fechaDate,
            },
          },
          update: {
            estado: registro.estado,
            observaciones: registro.observaciones,
            sedeId: dto.sedeId,
          },
          create: {
            empleadoId: registro.empleadoId,
            empresaId,
            sedeId: dto.sedeId,
            fecha: fechaDate,
            estado: registro.estado,
            observaciones: registro.observaciones,
            registradoPorId: usuarioId,
          },
        }),
      ),
    );

    return {
      totalProcesados: resultados.length,
      fecha: dto.fecha,
      sedeId: dto.sedeId,
    };
  }
}
