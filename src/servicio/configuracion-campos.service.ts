import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { CreateConfiguracionCampoDto } from './dto/create-configuracion-campo.dto';
import { UpdateConfiguracionCampoDto } from './dto/update-configuracion-campo.dto';
import { QueryConfiguracionCampoDto } from './dto/query-configuracion-campo.dto';

@Injectable()
export class ConfiguracionCamposService {
  constructor(
    private prisma: PrismaService,
    private planLimitsService: PlanLimitsService,
  ) {}

  async create(empresaId: string, dto: CreateConfiguracionCampoDto) {
    // Verificar límite del plan
    await this.planLimitsService.checkConfiguracionCamposLimit(empresaId);

    // Verificar unicidad [empresaId, plantillaId, nombre]
    const existing = await this.prisma.configuracionCamposServicio.findFirst({
      where: {
        empresaId,
        plantillaId: dto.plantillaId ?? null,
        nombre: dto.nombre,
      },
      select: { id: true, isActive: true },
    });

    if (existing?.isActive) {
      throw new BadRequestException(
        `Ya existe un campo con el nombre "${dto.nombre}"`,
      );
    }

    // Existía pero ELIMINADO: se revive con la definición nueva. El borrado
    // es lógico y el unique NO distingue activos, así que la fila muerta
    // dejaba el nombre bloqueado para siempre.
    if (existing) {
      return this.prisma.configuracionCamposServicio.update({
        where: { id: existing.id },
        data: { ...dto, empresaId, isActive: true },
      });
    }

    // Si no se proporciona orden, asignar el siguiente
    if (dto.orden === undefined) {
      const maxOrden = await this.prisma.configuracionCamposServicio.findFirst({
        where: { empresaId, isActive: true },
        orderBy: { orden: 'desc' },
        select: { orden: true },
      });
      dto.orden = (maxOrden?.orden ?? 0) + 1;
    }

    return this.prisma.configuracionCamposServicio.create({
      data: {
        empresaId,
        ...dto,
      },
    });
  }

  async findAll(empresaId: string, query: QueryConfiguracionCampoDto) {
    const where: any = {
      empresaId,
    };

    if (query.categoria) {
      where.categoria = query.categoria;
    }

    if (query.activo !== undefined) {
      where.isActive = query.activo;
    } else {
      where.isActive = true;
    }

    return this.prisma.configuracionCamposServicio.findMany({
      where,
      orderBy: { orden: 'asc' },
    });
  }

  async findOne(empresaId: string, id: string) {
    const campo = await this.prisma.configuracionCamposServicio.findFirst({
      where: { id, empresaId },
    });

    if (!campo) {
      throw new NotFoundException('Campo de configuración no encontrado');
    }

    return campo;
  }

  async update(empresaId: string, id: string, dto: UpdateConfiguracionCampoDto) {
    const current = await this.findOne(empresaId, id);

    // Si cambia el nombre, verificar unicidad dentro del mismo scope (plantillaId)
    if (dto.nombre) {
      const existing = await this.prisma.configuracionCamposServicio.findFirst({
        where: {
          empresaId,
          plantillaId: current.plantillaId ?? null,
          nombre: dto.nombre,
          id: { not: id },
        },
        select: { id: true, isActive: true },
      });

      if (existing?.isActive) {
        throw new BadRequestException(
          `Ya existe un campo con el nombre "${dto.nombre}"`,
        );
      }

      // El choque es contra un campo ELIMINADO, que solo estaba reservando
      // el nombre por el unique (empresaId, plantillaId, nombre) — que no
      // mira isActive. Se descarta esa definición muerta para liberarlo.
      // Nada apunta a estas filas por id: los valores capturados viven en
      // `datosPersonalizados` de cada orden, indexados por NOMBRE.
      if (existing) {
        await this.prisma.configuracionCamposServicio.delete({
          where: { id: existing.id },
        });
      }
    }

    return this.prisma.configuracionCamposServicio.update({
      where: { id },
      data: dto,
    });
  }

  async remove(empresaId: string, id: string) {
    await this.findOne(empresaId, id);

    return this.prisma.configuracionCamposServicio.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async reorder(empresaId: string, orderedIds: string[]) {
    // Validate all IDs belong to the empresa
    const campos = await this.prisma.configuracionCamposServicio.findMany({
      where: { id: { in: orderedIds }, empresaId },
    });
    if (campos.length !== orderedIds.length) {
      throw new BadRequestException('Algunos campos no pertenecen a esta empresa');
    }

    const updates = orderedIds.map((id, index) =>
      this.prisma.configuracionCamposServicio.update({
        where: { id },
        data: { orden: index + 1 },
      }),
    );

    await this.prisma.$transaction(updates);

    return this.findAll(empresaId, { activo: true });
  }
}
