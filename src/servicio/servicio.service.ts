import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { QueryServicioDto, OrdenServicio } from './dto/query-servicio.dto';

@Injectable()
export class ServicioService {
  constructor(
    private prisma: PrismaService,
    private planLimitsService: PlanLimitsService,
    private configuracionCodigosService: ConfiguracionCodigosService,
  ) {}

  async create(dto: CreateServicioDto) {
    await this.planLimitsService.checkServiciosLimit(dto.empresaId);

    const { codigoEmpresa, codigoSistema } =
      await this.configuracionCodigosService.generarCodigoServicio(
        dto.empresaId,
        dto.sedeId,
      );

    return this.prisma.servicio.create({
      data: {
        ...dto,
        codigoEmpresa,
        codigoSistema,
      },
      include: {
        empresaCategoria: true,
        sede: true,
        unidadMedida: true,
      },
    });
  }

  async findAll(empresaId: string, query: QueryServicioDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      empresaId,
      isActive: true,
      deletedAt: null,
    };

    if (query.search) {
      where.OR = [
        { nombre: { contains: query.search, mode: 'insensitive' } },
        { codigoEmpresa: { contains: query.search, mode: 'insensitive' } },
        { descripcion: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.sedeId) {
      where.sedeId = query.sedeId;
    }

    if (query.empresaCategoriaId) {
      where.empresaCategoriaId = query.empresaCategoriaId;
    }

    if (query.tipoServicio) {
      where.tipoServicio = query.tipoServicio;
    }

    let orderBy: any = { creadoEn: 'desc' };
    if (query.orden) {
      switch (query.orden) {
        case OrdenServicio.NOMBRE_ASC:
          orderBy = { nombre: 'asc' };
          break;
        case OrdenServicio.NOMBRE_DESC:
          orderBy = { nombre: 'desc' };
          break;
        case OrdenServicio.PRECIO_ASC:
          orderBy = { precio: 'asc' };
          break;
        case OrdenServicio.PRECIO_DESC:
          orderBy = { precio: 'desc' };
          break;
        case OrdenServicio.RECIENTES:
          orderBy = { creadoEn: 'desc' };
          break;
        case OrdenServicio.ANTIGUOS:
          orderBy = { creadoEn: 'asc' };
          break;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.servicio.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          empresaCategoria: true,
          sede: true,
          unidadMedida: true,
          plantillaServicio: true,
        },
      }),
      this.prisma.servicio.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      pageSize: limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrevious: page > 1,
    };
  }

  async findOne(empresaId: string, id: string) {
    const servicio = await this.prisma.servicio.findFirst({
      where: { id, empresaId, deletedAt: null },
      include: {
        empresaCategoria: true,
        sede: true,
        unidadMedida: true,
      },
    });

    if (!servicio) {
      throw new NotFoundException('Servicio no encontrado');
    }

    return servicio;
  }

  async update(empresaId: string, id: string, dto: UpdateServicioDto) {
    await this.findOne(empresaId, id);

    return this.prisma.servicio.update({
      where: { id },
      data: dto,
      include: {
        empresaCategoria: true,
        sede: true,
        unidadMedida: true,
      },
    });
  }

  async remove(empresaId: string, id: string) {
    await this.findOne(empresaId, id);

    return this.prisma.servicio.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }
}
