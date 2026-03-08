import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CreateComponenteDto } from './dto/create-componente.dto';

@Injectable()
export class ComponenteService {
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
  ) {}

  async findAll(
    empresaId: string,
    query: {
      tipoComponenteId?: string;
      marca?: string;
      modelo?: string;
      serie?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {
      empresaId,
      isActive: true,
      deletedAt: null,
    };

    if (query.tipoComponenteId) {
      where.tipoComponenteId = query.tipoComponenteId;
    }

    if (query.search) {
      where.OR = [
        { codigo: { contains: query.search, mode: 'insensitive' } },
        { marca: { contains: query.search, mode: 'insensitive' } },
        { modelo: { contains: query.search, mode: 'insensitive' } },
        { numeroSerie: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.marca) {
      where.marca = { contains: query.marca, mode: 'insensitive' };
    }

    if (query.modelo) {
      where.modelo = { contains: query.modelo, mode: 'insensitive' };
    }

    if (query.serie) {
      where.numeroSerie = { contains: query.serie, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.componente.findMany({
        where,
        include: { tipoComponente: true },
        skip,
        take: limit,
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.componente.count({ where }),
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
    const componente = await this.prisma.componente.findFirst({
      where: { id, empresaId, deletedAt: null },
      include: { tipoComponente: true },
    });

    if (!componente) {
      throw new NotFoundException('Componente no encontrado');
    }

    return componente;
  }

  async create(empresaId: string, dto: CreateComponenteDto) {
    // Verify tipoComponente exists and belongs to empresa or is global
    const tipo = await this.prisma.tipoComponente.findFirst({
      where: {
        id: dto.tipoComponenteId,
        OR: [{ empresaId }, { esGlobal: true }],
      },
    });

    if (!tipo) {
      throw new NotFoundException('Tipo de componente no encontrado');
    }

    // Check unique serial number within empresa
    if (dto.numeroSerie) {
      const existing = await this.prisma.componente.findFirst({
        where: { empresaId, numeroSerie: dto.numeroSerie },
      });
      if (existing) {
        throw new ConflictException(
          `Ya existe un componente con el número de serie "${dto.numeroSerie}"`,
        );
      }
    }

    // Generar código via servicio centralizado (atómico, con retry)
    const codigo = await this.configuracionCodigosService.generarCodigoComponente(empresaId);

    return this.prisma.componente.create({
      data: {
        empresaId,
        tipoComponenteId: dto.tipoComponenteId,
        codigo,
        marca: dto.marca,
        modelo: dto.modelo,
        numeroSerie: dto.numeroSerie,
        estado: dto.estado,
      },
      include: { tipoComponente: true },
    });
  }

  async update(empresaId: string, id: string, dto: Partial<CreateComponenteDto>) {
    const existing = await this.findOne(empresaId, id);

    // If changing tipoComponente, validate it exists and belongs to empresa or is global
    if (dto.tipoComponenteId && dto.tipoComponenteId !== existing.tipoComponenteId) {
      const tipo = await this.prisma.tipoComponente.findFirst({
        where: {
          id: dto.tipoComponenteId,
          OR: [{ empresaId }, { esGlobal: true }],
        },
      });
      if (!tipo) {
        throw new NotFoundException('Tipo de componente no encontrado');
      }
    }

    // If changing serial number, check uniqueness
    if (dto.numeroSerie && dto.numeroSerie !== existing.numeroSerie) {
      const duplicate = await this.prisma.componente.findFirst({
        where: { empresaId, numeroSerie: dto.numeroSerie, id: { not: id } },
      });
      if (duplicate) {
        throw new ConflictException(`Ya existe un componente con el número de serie "${dto.numeroSerie}"`);
      }
    }

    return this.prisma.componente.update({
      where: { id },
      data: dto,
      include: { tipoComponente: true },
    });
  }

  async remove(empresaId: string, id: string) {
    await this.findOne(empresaId, id);
    return this.prisma.componente.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
  }

  async findOrCreate(empresaId: string, dto: CreateComponenteDto) {
    // If numeroSerie is provided, check if component already exists
    if (dto.numeroSerie) {
      const existingBySerie = await this.prisma.componente.findFirst({
        where: {
          empresaId,
          numeroSerie: dto.numeroSerie,
          deletedAt: null,
        },
        include: { tipoComponente: true },
      });

      if (existingBySerie) {
        return existingBySerie;
      }

      // Serial provided but doesn't exist → create new
      return this.create(empresaId, dto);
    }

    // No serial number: look for existing by tipoComponenteId + marca (+ modelo if provided)
    if (dto.tipoComponenteId && dto.marca) {
      const where: any = {
        empresaId,
        tipoComponenteId: dto.tipoComponenteId,
        marca: { equals: dto.marca, mode: 'insensitive' },
        numeroSerie: null, // Only reuse components without serial (generic pieces)
        isActive: true,
        deletedAt: null,
      };

      // If modelo is provided, also match by modelo for more precision
      if (dto.modelo) {
        where.modelo = { equals: dto.modelo, mode: 'insensitive' };
      }

      const existing = await this.prisma.componente.findFirst({
        where,
        include: { tipoComponente: true },
      });

      if (existing) {
        return existing;
      }
    }

    // No match found → create new
    return this.create(empresaId, dto);
  }

  async getMarcas(empresaId: string, tipoComponenteId: string) {
    const componentes = await this.prisma.componente.findMany({
      where: {
        empresaId,
        tipoComponenteId,
        marca: { not: null },
        isActive: true,
        deletedAt: null,
      },
      select: { marca: true },
      distinct: ['marca'],
      orderBy: { marca: 'asc' },
    });

    return {
      marcas: componentes.map((c) => c.marca).filter(Boolean) as string[],
    };
  }

  async getModelos(
    empresaId: string,
    tipoComponenteId: string,
    marca: string,
  ) {
    const componentes = await this.prisma.componente.findMany({
      where: {
        empresaId,
        tipoComponenteId,
        marca: { equals: marca, mode: 'insensitive' },
        modelo: { not: null },
        isActive: true,
        deletedAt: null,
      },
      select: { modelo: true },
      distinct: ['modelo'],
      orderBy: { modelo: 'asc' },
    });

    return {
      modelos: componentes.map((c) => c.modelo).filter(Boolean) as string[],
    };
  }
}
