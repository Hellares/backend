import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateHorarioPlantillaDto } from './dto/create-horario-plantilla.dto';
import { UpdateHorarioPlantillaDto } from './dto/update-horario-plantilla.dto';

@Injectable()
export class HorarioService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crear una nueva plantilla de horario con sus días
   */
  async create(empresaId: string, dto: CreateHorarioPlantillaDto) {
    // Verificar nombre único dentro de la empresa
    const existente = await this.prisma.horarioPlantilla.findUnique({
      where: {
        empresaId_nombre: { empresaId, nombre: dto.nombre },
      },
    });

    if (existente) {
      throw new ConflictException(
        `Ya existe una plantilla de horario con el nombre "${dto.nombre}"`,
      );
    }

    const plantilla = await this.prisma.horarioPlantilla.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        dias: {
          createMany: {
            data: dto.dias.map((dia) => ({
              diaSemana: dia.diaSemana,
              turnoId: dia.turnoId || null,
              esDescanso: dia.esDescanso ?? false,
              horaInicioOverride: dia.horaInicioOverride || null,
              horaFinOverride: dia.horaFinOverride || null,
            })),
          },
        },
      },
      include: {
        dias: {
          include: { turno: true },
          orderBy: { diaSemana: 'asc' },
        },
      },
    });

    return plantilla;
  }

  /**
   * Listar todas las plantillas de horario de la empresa
   */
  async findAll(empresaId: string) {
    return this.prisma.horarioPlantilla.findMany({
      // Solo activos: remove() hace soft-delete (isActive=false), los
      // eliminados no deben seguir apareciendo en la lista.
      where: { empresaId, isActive: true },
      include: {
        dias: {
          include: { turno: true },
          orderBy: { diaSemana: 'asc' },
        },
        _count: {
          select: { empleados: true },
        },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * Obtener una plantilla de horario por ID
   */
  async findOne(empresaId: string, id: string) {
    const plantilla = await this.prisma.horarioPlantilla.findFirst({
      where: { id, empresaId },
      include: {
        dias: {
          include: { turno: true },
          orderBy: { diaSemana: 'asc' },
        },
        _count: {
          select: { empleados: true },
        },
      },
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla de horario no encontrada');
    }

    return plantilla;
  }

  /**
   * Actualizar una plantilla de horario
   * Si se proporcionan días, reemplaza todos los existentes
   */
  async update(empresaId: string, id: string, dto: UpdateHorarioPlantillaDto) {
    // Verificar que existe
    const plantilla = await this.prisma.horarioPlantilla.findFirst({
      where: { id, empresaId },
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla de horario no encontrada');
    }

    // Verificar nombre único si se está cambiando
    if (dto.nombre && dto.nombre !== plantilla.nombre) {
      const existente = await this.prisma.horarioPlantilla.findUnique({
        where: {
          empresaId_nombre: { empresaId, nombre: dto.nombre },
        },
      });

      if (existente) {
        throw new ConflictException(
          `Ya existe una plantilla de horario con el nombre "${dto.nombre}"`,
        );
      }
    }

    // Si se proporcionan días, usar transacción para eliminar y recrear
    if (dto.dias) {
      return this.prisma.$transaction(async (tx) => {
        // Eliminar todos los días existentes
        await tx.horarioPlantillaDia.deleteMany({
          where: { horarioPlantillaId: id },
        });

        // Actualizar plantilla y crear nuevos días
        return tx.horarioPlantilla.update({
          where: { id },
          data: {
            nombre: dto.nombre,
            descripcion: dto.descripcion,
            isActive: dto.isActive,
            dias: {
              createMany: {
                data: dto.dias.map((dia) => ({
                  diaSemana: dia.diaSemana,
                  turnoId: dia.turnoId || null,
                  esDescanso: dia.esDescanso ?? false,
                  horaInicioOverride: dia.horaInicioOverride || null,
                  horaFinOverride: dia.horaFinOverride || null,
                })),
              },
            },
          },
          include: {
            dias: {
              include: { turno: true },
              orderBy: { diaSemana: 'asc' },
            },
          },
        });
      });
    }

    // Sin días: solo actualizar campos de la plantilla
    return this.prisma.horarioPlantilla.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        isActive: dto.isActive,
      },
      include: {
        dias: {
          include: { turno: true },
          orderBy: { diaSemana: 'asc' },
        },
      },
    });
  }

  /**
   * Soft delete: desactivar plantilla de horario
   */
  async remove(empresaId: string, id: string) {
    const plantilla = await this.prisma.horarioPlantilla.findFirst({
      where: { id, empresaId },
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla de horario no encontrada');
    }

    return this.prisma.horarioPlantilla.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
