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
  /**
   * Horas efectivas de un turno = (horaFin \u2212 horaInicio) \u2212 almuerzo, en horas.
   * Soporta turno nocturno (horaFin < horaInicio \u2192 cruza medianoche).
   */
  private calcularHorasEfectivas(
    horaInicio: string,
    horaFin: string,
    almuerzoMin: number,
  ): number {
    const aMin = (h: string) => {
      const [hh, mm] = h.split(':').map((n) => parseInt(n, 10));
      return hh * 60 + mm;
    };
    let diff = aMin(horaFin) - aMin(horaInicio);
    if (diff < 0) diff += 24 * 60; // cruza medianoche
    const efectivas = (diff - (almuerzoMin ?? 0)) / 60;
    return Math.max(0, Math.round(efectivas * 100) / 100);
  }

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
        horasEfectivas:
          dto.horasEfectivas ??
          this.calcularHorasEfectivas(
            dto.horaInicio,
            dto.horaFin,
            dto.duracionAlmuerzoMin ?? 60,
          ),
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

    // Recalcular horas efectivas si cambian los horarios y no se envió un
    // valor explícito.
    const horariosCambiaron =
      dto.horaInicio !== undefined ||
      dto.horaFin !== undefined ||
      dto.duracionAlmuerzoMin !== undefined;
    const horasEfectivas =
      dto.horasEfectivas ??
      (horariosCambiaron
        ? this.calcularHorasEfectivas(
            dto.horaInicio ?? turno.horaInicio,
            dto.horaFin ?? turno.horaFin,
            dto.duracionAlmuerzoMin ?? turno.duracionAlmuerzoMin,
          )
        : undefined);

    const turnoActualizado = await this.prisma.turno.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        horaInicio: dto.horaInicio,
        horaFin: dto.horaFin,
        duracionAlmuerzoMin: dto.duracionAlmuerzoMin,
        horasEfectivas,
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
