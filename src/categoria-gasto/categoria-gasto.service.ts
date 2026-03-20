import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoCategoriaGasto } from '@prisma/client';

@Injectable()
export class CategoriaGastoService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(empresaId: string, tipo?: string) {
    const where: any = { empresaId, isActive: true };
    if (tipo) {
      where.tipo = tipo as TipoCategoriaGasto;
    }

    return this.prisma.categoriaGasto.findMany({
      where,
      orderBy: { nombre: 'asc' },
    });
  }

  async crear(
    empresaId: string,
    data: { nombre: string; tipo: string; icono?: string; color?: string },
  ) {
    return this.prisma.categoriaGasto.create({
      data: {
        empresaId,
        nombre: data.nombre,
        tipo: data.tipo as TipoCategoriaGasto,
        icono: data.icono,
        color: data.color,
      },
    });
  }

  async actualizar(
    empresaId: string,
    id: string,
    data: { nombre?: string; tipo?: string; icono?: string; color?: string },
  ) {
    const categoria = await this.prisma.categoriaGasto.findFirst({
      where: { id, empresaId },
    });

    if (!categoria) {
      throw new NotFoundException('Categoria de gasto no encontrada');
    }

    return this.prisma.categoriaGasto.update({
      where: { id },
      data: {
        ...(data.nombre !== undefined && { nombre: data.nombre }),
        ...(data.tipo !== undefined && { tipo: data.tipo as TipoCategoriaGasto }),
        ...(data.icono !== undefined && { icono: data.icono }),
        ...(data.color !== undefined && { color: data.color }),
      },
    });
  }

  async eliminar(empresaId: string, id: string) {
    const categoria = await this.prisma.categoriaGasto.findFirst({
      where: { id, empresaId },
    });

    if (!categoria) {
      throw new NotFoundException('Categoria de gasto no encontrada');
    }

    return this.prisma.categoriaGasto.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
