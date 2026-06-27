import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EstadoEmpleado, Prisma } from '@prisma/client';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';
import { QueryEmpleadosDto } from './dto/query-empleados.dto';

@Injectable()
export class EmpleadoService {
  constructor(private readonly prisma: PrismaService) {}

  // =============================================================
  // CREAR EMPLEADO
  // =============================================================

  async create(empresaId: string, dto: CreateEmpleadoDto) {
    // 1. Validar que el usuario exista en esta empresa
    const empresaUsuario = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        empresaId,
        usuarioId: dto.usuarioId,
      },
    });

    if (!empresaUsuario) {
      throw new NotFoundException(
        'El usuario no pertenece a esta empresa',
      );
    }

    // 2. Verificar que no exista ya un empleado para este usuario en esta empresa
    const existente = await this.prisma.empleado.findUnique({
      where: {
        empresaId_usuarioId: {
          empresaId,
          usuarioId: dto.usuarioId,
        },
      },
    });

    if (existente) {
      throw new ConflictException(
        'Ya existe un registro de empleado para este usuario en esta empresa',
      );
    }

    // 3. Validar sede pertenece a la empresa
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId },
    });

    if (!sede) {
      throw new NotFoundException('La sede no pertenece a esta empresa');
    }

    // 4. Validar horarioPlantilla si se proporciona
    if (dto.horarioPlantillaId) {
      const horario = await this.prisma.horarioPlantilla.findFirst({
        where: { id: dto.horarioPlantillaId, empresaId, isActive: true },
      });

      if (!horario) {
        throw new NotFoundException('La plantilla de horario no existe o no está activa');
      }
    }

    // 5. Generar código y crear empleado en una transacción
    const empleado = await this.prisma.$transaction(async (tx) => {
      const codigo = await this._generarCodigoEmpleado(tx, empresaId);

      return tx.empleado.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          usuarioId: dto.usuarioId,
          codigo,
          cargo: dto.cargo,
          departamento: dto.departamento,
          fechaIngreso: new Date(dto.fechaIngreso),
          tipoContrato: dto.tipoContrato,
          salarioBase: dto.salarioBase,
          regimenPension: dto.regimenPension,
          aportaEssalud: dto.aportaEssalud,
          moneda: dto.moneda ?? 'PEN',
          banco: dto.banco,
          numeroCuenta: dto.numeroCuenta,
          cci: dto.cci,
          horarioPlantillaId: dto.horarioPlantillaId,
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
                  telefono: true,
                },
              },
            },
          },
          sede: { select: { id: true, nombre: true } },
          horarioPlantilla: { select: { id: true, nombre: true } },
        },
      });
    });

    return empleado;
  }

  // =============================================================
  // LISTAR EMPLEADOS (PAGINADO + FILTROS)
  // =============================================================

  async findAll(empresaId: string, query: QueryEmpleadosDto) {
    const { sedeId, estado, departamento, tipoContrato, search, page = 1, limit = 20 } = query;

    const where: Prisma.EmpleadoWhereInput = {
      empresaId,
      isActive: true,
      deletedAt: null,
    };

    if (sedeId) {
      where.sedeId = sedeId;
    }

    if (estado) {
      where.estado = estado;
    }

    if (departamento) {
      where.departamento = { contains: departamento, mode: 'insensitive' };
    }

    if (tipoContrato) {
      where.tipoContrato = tipoContrato;
    }

    if (search) {
      where.usuario = {
        persona: {
          OR: [
            { nombres: { contains: search, mode: 'insensitive' } },
            { apellidos: { contains: search, mode: 'insensitive' } },
            { dni: { contains: search, mode: 'insensitive' } },
          ],
        },
      };
    }

    const skip = (page - 1) * limit;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.empleado.findMany({
        where,
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
          sede: { select: { id: true, nombre: true } },
          horarioPlantilla: { select: { id: true, nombre: true } },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.empleado.count({ where }),
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
  // OBTENER EMPLEADO POR ID
  // =============================================================

  async findOne(empresaId: string, id: string) {
    const empleado = await this.prisma.empleado.findFirst({
      where: {
        id,
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
                telefono: true,
                direccion: true,
              },
            },
          },
        },
        sede: { select: { id: true, nombre: true } },
        horarioPlantilla: {
          select: {
            id: true,
            nombre: true,
            dias: {
              select: {
                id: true,
                diaSemana: true,
                esDescanso: true,
                horaInicioOverride: true,
                horaFinOverride: true,
                turno: {
                  select: {
                    id: true,
                    nombre: true,
                    horaInicio: true,
                    horaFin: true,
                    duracionAlmuerzoMin: true,
                    horasEfectivas: true,
                    color: true,
                  },
                },
              },
              orderBy: { diaSemana: 'asc' },
            },
          },
        },
      },
    });

    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado');
    }

    return empleado;
  }

  // =============================================================
  // ACTUALIZAR EMPLEADO
  // =============================================================

  async update(empresaId: string, id: string, dto: UpdateEmpleadoDto) {
    const empleado = await this.prisma.empleado.findFirst({
      where: { id, empresaId, deletedAt: null },
    });

    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado');
    }

    // Validar sede si se cambia
    if (dto.sedeId) {
      const sede = await this.prisma.sede.findFirst({
        where: { id: dto.sedeId, empresaId },
      });

      if (!sede) {
        throw new NotFoundException('La sede no pertenece a esta empresa');
      }
    }

    // Validar horarioPlantilla si se cambia
    if (dto.horarioPlantillaId) {
      const horario = await this.prisma.horarioPlantilla.findFirst({
        where: { id: dto.horarioPlantillaId, empresaId, isActive: true },
      });

      if (!horario) {
        throw new NotFoundException('La plantilla de horario no existe o no está activa');
      }
    }

    // Si estado = CESADO y no se proporcionó fechaCese, usar fecha actual
    const data: Prisma.EmpleadoUpdateInput = {};

    if (dto.sedeId !== undefined) data.sede = { connect: { id: dto.sedeId } };
    if (dto.cargo !== undefined) data.cargo = dto.cargo;
    if (dto.departamento !== undefined) data.departamento = dto.departamento;
    if (dto.fechaIngreso !== undefined) data.fechaIngreso = new Date(dto.fechaIngreso);
    if (dto.tipoContrato !== undefined) data.tipoContrato = dto.tipoContrato;
    if (dto.salarioBase !== undefined) data.salarioBase = dto.salarioBase;
    if (dto.regimenPension !== undefined)
      data.regimenPension = dto.regimenPension;
    if (dto.aportaEssalud !== undefined)
      data.aportaEssalud = dto.aportaEssalud;
    if (dto.moneda !== undefined) data.moneda = dto.moneda;
    if (dto.banco !== undefined) data.banco = dto.banco;
    if (dto.numeroCuenta !== undefined) data.numeroCuenta = dto.numeroCuenta;
    if (dto.cci !== undefined) data.cci = dto.cci;
    if (dto.horarioPlantillaId !== undefined) {
      data.horarioPlantilla = dto.horarioPlantillaId
        ? { connect: { id: dto.horarioPlantillaId } }
        : { disconnect: true };
    }
    if (dto.estado !== undefined) data.estado = dto.estado;

    if (dto.estado === EstadoEmpleado.CESADO) {
      data.fechaCese = dto.fechaCese ? new Date(dto.fechaCese) : new Date();
    } else if (dto.fechaCese !== undefined) {
      data.fechaCese = dto.fechaCese ? new Date(dto.fechaCese) : null;
    }

    // Si se cesa al empleado, desactivar su acceso en la empresa
    if (dto.estado === EstadoEmpleado.CESADO) {
      return this.prisma.$transaction(async (tx) => {
        // Desactivar todos los roles del usuario en esta empresa
        await tx.empresaUsuarioRol.updateMany({
          where: { usuarioId: empleado.usuarioId, empresaId },
          data: { isActive: false, estado: 'INACTIVO' },
        });

        // Desactivar roles en sedes de esta empresa
        await tx.usuarioSedeRol.updateMany({
          where: {
            usuarioId: empleado.usuarioId,
            sede: { empresaId },
          },
          data: { isActive: false },
        });

        return tx.empleado.update({
          where: { id },
          data,
          include: {
            usuario: {
              select: {
                id: true,
                email: true,
                persona: {
                  select: { nombres: true, apellidos: true, dni: true },
                },
              },
            },
            sede: { select: { id: true, nombre: true } },
            horarioPlantilla: { select: { id: true, nombre: true } },
          },
        });
      });
    }

    return this.prisma.empleado.update({
      where: { id },
      data,
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
        sede: { select: { id: true, nombre: true } },
        horarioPlantilla: { select: { id: true, nombre: true } },
      },
    });
  }

  // =============================================================
  // ELIMINAR EMPLEADO (SOFT DELETE)
  // =============================================================

  async remove(empresaId: string, id: string) {
    const empleado = await this.prisma.empleado.findFirst({
      where: { id, empresaId, deletedAt: null },
    });

    if (!empleado) {
      throw new NotFoundException('Empleado no encontrado');
    }

    return this.prisma.$transaction(async (tx) => {
      // Desactivar acceso del usuario en la empresa
      await tx.empresaUsuarioRol.updateMany({
        where: { usuarioId: empleado.usuarioId, empresaId },
        data: { isActive: false, estado: 'INACTIVO' },
      });

      // Desactivar roles en sedes de esta empresa
      await tx.usuarioSedeRol.updateMany({
        where: {
          usuarioId: empleado.usuarioId,
          sede: { empresaId },
        },
        data: { isActive: false },
      });

      // Soft delete del empleado
      return tx.empleado.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          estado: EstadoEmpleado.CESADO,
          fechaCese: empleado.fechaCese ?? new Date(),
        },
      });
    });
  }

  // =============================================================
  // GENERACION DE CODIGO AUTO-INCREMENTAL
  // =============================================================

  private async _generarCodigoEmpleado(tx: any, empresaId: string): Promise<string> {
    const config = await tx.configuracionCodigos.upsert({
      where: { empresaId },
      update: { ultimoEmpleado: { increment: 1 } },
      create: { empresaId, ultimoEmpleado: 1 },
    });

    const numero = String(config.ultimoEmpleado).padStart(config.empleadoLongitud, '0');
    return `${config.empleadoCodigo}${config.empleadoSeparador}${numero}`;
  }
}
