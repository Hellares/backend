import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  TipoIncidencia,
  EstadoIncidencia,
  EstadoAsistencia,
  TipoAsistencia,
  Prisma,
} from '@prisma/client';
import { CreateIncidenciaDto } from './dto/create-incidencia.dto';
import { RechazarIncidenciaDto } from './dto/rechazar-incidencia.dto';
import { QueryIncidenciasDto } from './dto/query-incidencias.dto';

@Injectable()
export class IncidenciaService {
  constructor(private readonly prisma: PrismaService) {}

  // =============================================================
  // CREAR INCIDENCIA
  // =============================================================

  async create(empresaId: string, dto: CreateIncidenciaDto) {
    // 1. Validar que el empleado pertenece a la empresa
    const empleado = await this.prisma.empleado.findFirst({
      where: {
        id: dto.empleadoId,
        empresaId,
        deletedAt: null,
        isActive: true,
      },
    });

    if (!empleado) {
      throw new NotFoundException(
        'El empleado no existe o no pertenece a esta empresa',
      );
    }

    // 2. Validar fechas
    const fechaInicio = new Date(dto.fechaInicio);
    const fechaFin = new Date(dto.fechaFin);

    if (fechaFin < fechaInicio) {
      throw new BadRequestException(
        'La fecha de fin no puede ser anterior a la fecha de inicio',
      );
    }

    // 3. Calcular días totales (calendario, incluyendo inicio y fin)
    const diasTotal = this._calcularDiasCalendario(fechaInicio, fechaFin);

    // 4. Verificar que no exista una incidencia aprobada que se superponga
    const incidenciaSolapada = await this.prisma.incidencia.findFirst({
      where: {
        empleadoId: dto.empleadoId,
        empresaId,
        estado: EstadoIncidencia.APROBADA,
        OR: [
          {
            fechaInicio: { lte: fechaFin },
            fechaFin: { gte: fechaInicio },
          },
        ],
      },
    });

    if (incidenciaSolapada) {
      throw new ConflictException(
        'Ya existe una incidencia aprobada que se superpone con las fechas indicadas',
      );
    }

    // 5. Crear la incidencia
    const incidencia = await this.prisma.incidencia.create({
      data: {
        empleadoId: dto.empleadoId,
        empresaId,
        tipo: dto.tipo,
        fechaInicio,
        fechaFin,
        diasTotal,
        motivo: dto.motivo,
        documentoAdjunto: dto.documentoAdjunto,
      },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            cargo: true,
            departamento: true,
            sedeId: true,
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
      },
    });

    return incidencia;
  }

  // =============================================================
  // LISTAR INCIDENCIAS (PAGINADO + FILTROS)
  // =============================================================

  async findAll(empresaId: string, query: QueryIncidenciasDto) {
    const { empleadoId, tipo, estado, page = 1, limit = 20 } = query;

    const where: Prisma.IncidenciaWhereInput = {
      empresaId,
    };

    if (empleadoId) {
      where.empleadoId = empleadoId;
    }

    if (tipo) {
      where.tipo = tipo;
    }

    if (estado) {
      where.estado = estado;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.incidencia.findMany({
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
          aprobadoPor: {
            select: {
              id: true,
              email: true,
              persona: {
                select: {
                  nombres: true,
                  apellidos: true,
                },
              },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.incidencia.count({ where }),
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
  // OBTENER INCIDENCIA POR ID
  // =============================================================

  async findOne(empresaId: string, id: string) {
    const incidencia = await this.prisma.incidencia.findFirst({
      where: {
        id,
        empresaId,
      },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            cargo: true,
            departamento: true,
            sedeId: true,
            sede: { select: { id: true, nombre: true } },
            usuario: {
              select: {
                id: true,
                email: true,
                persona: {
                  select: {
                    nombres: true,
                    apellidos: true,
                    dni: true,
                    telefono: true,
                  },
                },
              },
            },
          },
        },
        aprobadoPor: {
          select: {
            id: true,
            email: true,
            persona: {
              select: {
                nombres: true,
                apellidos: true,
              },
            },
          },
        },
      },
    });

    if (!incidencia) {
      throw new NotFoundException('Incidencia no encontrada');
    }

    return incidencia;
  }

  // =============================================================
  // APROBAR INCIDENCIA
  // =============================================================

  async aprobar(empresaId: string, incidenciaId: string, usuarioId: string) {
    // 1. Buscar la incidencia
    const incidencia = await this.prisma.incidencia.findFirst({
      where: {
        id: incidenciaId,
        empresaId,
      },
      include: {
        empleado: {
          select: {
            id: true,
            sedeId: true,
          },
        },
      },
    });

    if (!incidencia) {
      throw new NotFoundException('Incidencia no encontrada');
    }

    if (incidencia.estado !== EstadoIncidencia.PENDIENTE) {
      throw new BadRequestException(
        `No se puede aprobar una incidencia con estado ${incidencia.estado}`,
      );
    }

    // 2. Aprobar y crear registros de asistencia en una transacción
    const resultado = await this.prisma.$transaction(async (tx) => {
      // Actualizar estado de la incidencia
      const incidenciaActualizada = await tx.incidencia.update({
        where: { id: incidenciaId },
        data: {
          estado: EstadoIncidencia.APROBADA,
          aprobadoPorId: usuarioId,
          fechaAprobacion: new Date(),
        },
        include: {
          empleado: {
            select: {
              id: true,
              codigo: true,
              cargo: true,
              departamento: true,
              sedeId: true,
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
          aprobadoPor: {
            select: {
              id: true,
              email: true,
              persona: {
                select: {
                  nombres: true,
                  apellidos: true,
                },
              },
            },
          },
        },
      });

      // 3. Auto-crear registros de asistencia para cada día del rango
      const estadoAsistencia = this._mapTipoIncidenciaToEstadoAsistencia(incidencia.tipo);
      const registrosAsistencia = this._generarRegistrosAsistencia(
        incidencia.empleadoId,
        empresaId,
        incidencia.empleado.sedeId,
        incidencia.fechaInicio,
        incidencia.fechaFin,
        estadoAsistencia,
        usuarioId,
      );

      if (registrosAsistencia.length > 0) {
        // Usar createMany con skipDuplicates para evitar conflictos
        await tx.asistencia.createMany({
          data: registrosAsistencia,
          skipDuplicates: true,
        });

        // Actualizar registros existentes que no fueron creados por skipDuplicates
        for (const registro of registrosAsistencia) {
          await tx.asistencia.updateMany({
            where: {
              empleadoId: registro.empleadoId,
              fecha: registro.fecha,
              estado: { notIn: [estadoAsistencia] },
            },
            data: {
              estado: estadoAsistencia,
              observaciones: registro.observaciones,
            },
          });
        }
      }

      return incidenciaActualizada;
    });

    return resultado;
  }

  // =============================================================
  // RECHAZAR INCIDENCIA
  // =============================================================

  async rechazar(
    empresaId: string,
    incidenciaId: string,
    dto: RechazarIncidenciaDto,
    usuarioId: string,
  ) {
    const incidencia = await this.prisma.incidencia.findFirst({
      where: {
        id: incidenciaId,
        empresaId,
      },
    });

    if (!incidencia) {
      throw new NotFoundException('Incidencia no encontrada');
    }

    if (incidencia.estado !== EstadoIncidencia.PENDIENTE) {
      throw new BadRequestException(
        `No se puede rechazar una incidencia con estado ${incidencia.estado}`,
      );
    }

    return this.prisma.incidencia.update({
      where: { id: incidenciaId },
      data: {
        estado: EstadoIncidencia.RECHAZADA,
        motivoRechazo: dto.motivoRechazo,
        aprobadoPorId: usuarioId,
        fechaAprobacion: new Date(),
      },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            cargo: true,
            departamento: true,
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
        aprobadoPor: {
          select: {
            id: true,
            email: true,
            persona: {
              select: {
                nombres: true,
                apellidos: true,
              },
            },
          },
        },
      },
    });
  }

  // =============================================================
  // CANCELAR INCIDENCIA
  // =============================================================

  async cancelar(empresaId: string, incidenciaId: string) {
    const incidencia = await this.prisma.incidencia.findFirst({
      where: {
        id: incidenciaId,
        empresaId,
      },
    });

    if (!incidencia) {
      throw new NotFoundException('Incidencia no encontrada');
    }

    if (incidencia.estado !== EstadoIncidencia.PENDIENTE) {
      throw new BadRequestException(
        `Solo se pueden cancelar incidencias con estado PENDIENTE. Estado actual: ${incidencia.estado}`,
      );
    }

    return this.prisma.incidencia.update({
      where: { id: incidenciaId },
      data: {
        estado: EstadoIncidencia.CANCELADA,
      },
      include: {
        empleado: {
          select: {
            id: true,
            codigo: true,
            usuario: {
              select: {
                id: true,
                persona: {
                  select: {
                    nombres: true,
                    apellidos: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  // =============================================================
  // HELPERS PRIVADOS
  // =============================================================

  /**
   * Calcula los días calendario entre dos fechas (incluyendo ambas)
   */
  private _calcularDiasCalendario(fechaInicio: Date, fechaFin: Date): number {
    const inicio = new Date(fechaInicio);
    inicio.setHours(0, 0, 0, 0);
    const fin = new Date(fechaFin);
    fin.setHours(0, 0, 0, 0);

    const diffTime = fin.getTime() - inicio.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return diffDays + 1; // +1 para incluir ambos días
  }

  /**
   * Mapea TipoIncidencia a EstadoAsistencia para los registros automáticos
   */
  private _mapTipoIncidenciaToEstadoAsistencia(
    tipo: TipoIncidencia,
  ): EstadoAsistencia {
    const mapa: Record<TipoIncidencia, EstadoAsistencia> = {
      [TipoIncidencia.VACACION]: EstadoAsistencia.VACACION,
      [TipoIncidencia.LICENCIA_MEDICA]: EstadoAsistencia.LICENCIA,
      [TipoIncidencia.DESCANSO_MEDICO]: EstadoAsistencia.LICENCIA,
      [TipoIncidencia.LICENCIA_PATERNIDAD]: EstadoAsistencia.LICENCIA,
      [TipoIncidencia.LICENCIA_MATERNIDAD]: EstadoAsistencia.LICENCIA,
      [TipoIncidencia.PERMISO]: EstadoAsistencia.JUSTIFICADO,
      [TipoIncidencia.OTRO]: EstadoAsistencia.JUSTIFICADO,
    };

    return mapa[tipo];
  }

  /**
   * Genera los datos de registros de asistencia para cada día del rango
   */
  private _generarRegistrosAsistencia(
    empleadoId: string,
    empresaId: string,
    sedeId: string,
    fechaInicio: Date,
    fechaFin: Date,
    estado: EstadoAsistencia,
    registradoPorId: string,
  ) {
    const registros: {
      empleadoId: string;
      empresaId: string;
      sedeId: string;
      fecha: Date;
      estado: EstadoAsistencia;
      tipoAsistencia: TipoAsistencia;
      observaciones: string;
      registradoPorId: string;
    }[] = [];

    const inicio = new Date(fechaInicio);
    inicio.setHours(0, 0, 0, 0);
    const fin = new Date(fechaFin);
    fin.setHours(0, 0, 0, 0);

    const observacion = `Generado automáticamente por incidencia (${estado})`;

    const current = new Date(inicio);
    while (current <= fin) {
      registros.push({
        empleadoId,
        empresaId,
        sedeId,
        fecha: new Date(current),
        estado,
        tipoAsistencia: TipoAsistencia.NORMAL,
        observaciones: observacion,
        registradoPorId,
      });

      current.setDate(current.getDate() + 1);
    }

    return registros;
  }
}
