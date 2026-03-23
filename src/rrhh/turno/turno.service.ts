import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateTurnoDto } from './dto/create-turno.dto';
import { UpdateTurnoDto } from './dto/update-turno.dto';
import { QueryTurnosDto } from './dto/query-turnos.dto';

@Injectable()
export class TurnoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crear un nuevo turno
   */
  async create(empresaId: string, dto: CreateTurnoDto) {
    // Validar nombre \u00fanico dentro de la empresa
    const existe = await this.prisma.turno.findUnique({
      where: {
        empresaId_nombre: {
          empresaId,
          nombre: dto.nombre,
        },
      },
    });

    if (existe) {
      throw new ConflictException(
        `Ya existe un turno con el nombre "${dto.nombre}"`,
      );
    }

    // Si se marca como default, quitar default de los dem\u00e1s
    if (dto.isDefault) {
      await this.prisma.turno.updateMany({
        where: { empresaId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const turno = await this.prisma.turno.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        horaInicio: dto.horaInicio,
        horaFin: dto.horaFin,
        duracionAlmuerzoMin: dto.duracionAlmuerzoMin ?? 60,
        horasEfectivas: dto.horasEfectivas,
        color: dto.color,
        isDefault: dto.isDefault ?? false,
      },
    });

    return turno;
  }

  /**
   * Listar turnos con filtros
   */
  async findAll(empresaId: string, query: QueryTurnosDto) {
    const where: Prisma.TurnoWhereInput = { empresaId };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.search) {
      where.nombre = {
        contains: query.search,
        mode: 'insensitive',
      };
    }

    const turnos = await this.prisma.turno.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { nombre: 'asc' }],
    });

    return turnos;
  }

  /**
   * Obtener turno por ID
   */
  async findOne(empresaId: string, id: string) {
    const turno = await this.prisma.turno.findFirst({
      where: { id, empresaId },
    });

    if (!turno) {
      throw new NotFoundException('Turno no encontrado');
    }

    return turno;
  }

  /**
   * Actualizar turno
   */
  async update(empresaId: string, id: string, dto: UpdateTurnoDto) {
    const turno = await this.prisma.turno.findFirst({
      where: { id, empresaId },
    });

    if (!turno) {
      throw new NotFoundException('Turno no encontrado');
    }

    // Validar nombre \u00fanico si cambi\u00f3
    if (dto.nombre && dto.nombre !== turno.nombre) {
      const existe = await this.prisma.turno.findUnique({
        where: {
          empresaId_nombre: {
            empresaId,
            nombre: dto.nombre,
          },
        },
      });

      if (existe) {
        throw new ConflictException(
          `Ya existe un turno con el nombre "${dto.nombre}"`,
        );
      }
    }

    // Si se marca como default, quitar default de los dem\u00e1s
    if (dto.isDefault === true) {
      await this.prisma.turno.updateMany({
        where: { empresaId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const turnoActualizado = await this.prisma.turno.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        horaInicio: dto.horaInicio,
        horaFin: dto.horaFin,
        duracionAlmuerzoMin: dto.duracionAlmuerzoMin,
        horasEfectivas: dto.horasEfectivas,
        color: dto.color,
        isDefault: dto.isDefault,
        isActive: dto.isActive,
      },
    });

    return turnoActualizado;
  }

  /**
   * Soft delete: desactivar turno
   */
  async remove(empresaId: string, id: string) {
    const turno = await this.prisma.turno.findFirst({
      where: { id, empresaId },
    });

    if (!turno) {
      throw new NotFoundException('Turno no encontrado');
    }

    const turnoDesactivado = await this.prisma.turno.update({
      where: { id },
      data: { isActive: false },
    });

    return turnoDesactivado;
  }
}
