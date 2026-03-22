import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoUbicacion } from '@prisma/client';

@Injectable()
export class UbicacionAlmacenService {
  constructor(private readonly prisma: PrismaService) {}

  async crear(empresaId: string, sedeId: string, dto: {
    codigo: string;
    nombre: string;
    tipo?: TipoUbicacion;
    parentId?: string;
    capacidadMaxima?: number;
    descripcion?: string;
  }) {
    // Validate unique code per sede
    const existing = await this.prisma.ubicacionAlmacen.findUnique({
      where: { empresaId_sedeId_codigo: { empresaId, sedeId, codigo: dto.codigo } },
    });
    if (existing) {
      throw new BadRequestException(`Ya existe una ubicación con código "${dto.codigo}" en esta sede`);
    }

    // Validate parent if provided
    if (dto.parentId) {
      const parent = await this.prisma.ubicacionAlmacen.findFirst({
        where: { id: dto.parentId, empresaId, sedeId },
      });
      if (!parent) throw new NotFoundException('Ubicación padre no encontrada');
    }

    return this.prisma.ubicacionAlmacen.create({
      data: {
        empresaId,
        sedeId,
        codigo: dto.codigo,
        nombre: dto.nombre,
        tipo: dto.tipo ?? 'ZONA',
        parentId: dto.parentId ?? null,
        capacidadMaxima: dto.capacidadMaxima ?? null,
        descripcion: dto.descripcion ?? null,
      },
      include: { parent: { select: { id: true, nombre: true, codigo: true } } },
    });
  }

  async listar(empresaId: string, sedeId: string, filtros?: { tipo?: TipoUbicacion; parentId?: string; search?: string }) {
    const where: any = { empresaId, sedeId, isActive: true };

    if (filtros?.tipo) where.tipo = filtros.tipo;
    if (filtros?.parentId) where.parentId = filtros.parentId;
    if (filtros?.parentId === 'root') where.parentId = null;
    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombre: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.ubicacionAlmacen.findMany({
      where,
      include: {
        parent: { select: { id: true, nombre: true, codigo: true } },
        children: { where: { isActive: true }, select: { id: true, codigo: true, nombre: true, tipo: true } },
        _count: { select: { children: { where: { isActive: true } } } },
      },
      orderBy: { codigo: 'asc' },
    });
  }

  async getArbol(empresaId: string, sedeId: string) {
    // Get all active locations for the sede, build a tree
    const all = await this.prisma.ubicacionAlmacen.findMany({
      where: { empresaId, sedeId, isActive: true },
      orderBy: { codigo: 'asc' },
    });

    // Build tree structure
    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const ub of all) {
      map.set(ub.id, { ...ub, children: [] });
    }

    for (const ub of all) {
      const node = map.get(ub.id)!;
      if (ub.parentId && map.has(ub.parentId)) {
        map.get(ub.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async getDetalle(empresaId: string, id: string) {
    const ubicacion = await this.prisma.ubicacionAlmacen.findFirst({
      where: { id, empresaId },
      include: {
        parent: { select: { id: true, nombre: true, codigo: true } },
        children: { where: { isActive: true }, orderBy: { codigo: 'asc' } },
        sede: { select: { id: true, nombre: true } },
      },
    });

    if (!ubicacion) throw new NotFoundException('Ubicación no encontrada');

    // Count products in this location
    const productosEnUbicacion = await this.prisma.productoStock.count({
      where: { empresaId, sedeId: ubicacion.sedeId, ubicacion: ubicacion.codigo },
    });

    return { ...ubicacion, productosEnUbicacion };
  }

  async actualizar(empresaId: string, id: string, dto: {
    nombre?: string;
    tipo?: TipoUbicacion;
    capacidadMaxima?: number;
    descripcion?: string;
  }) {
    const ubicacion = await this.prisma.ubicacionAlmacen.findFirst({
      where: { id, empresaId },
    });

    if (!ubicacion) throw new NotFoundException('Ubicación no encontrada');

    return this.prisma.ubicacionAlmacen.update({
      where: { id },
      data: {
        nombre: dto.nombre,
        tipo: dto.tipo,
        capacidadMaxima: dto.capacidadMaxima,
        descripcion: dto.descripcion,
      },
      include: { parent: { select: { id: true, nombre: true, codigo: true } } },
    });
  }

  async desactivar(empresaId: string, id: string) {
    const ubicacion = await this.prisma.ubicacionAlmacen.findFirst({
      where: { id, empresaId },
    });

    if (!ubicacion) throw new NotFoundException('Ubicación no encontrada');

    // Also deactivate children
    await this.prisma.ubicacionAlmacen.updateMany({
      where: { parentId: id },
      data: { isActive: false },
    });

    return this.prisma.ubicacionAlmacen.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async crearBulk(empresaId: string, sedeId: string, items: Array<{
    codigo: string;
    nombre: string;
    tipo?: TipoUbicacion;
    parentId?: string;
  }>) {
    const created = [];
    for (const item of items) {
      try {
        const ub = await this.crear(empresaId, sedeId, item);
        created.push(ub);
      } catch (_) {}
    }
    return created;
  }
}
