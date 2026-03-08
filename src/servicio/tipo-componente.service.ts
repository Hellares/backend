import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTipoComponenteDto } from './dto/create-tipo-componente.dto';

@Injectable()
export class TipoComponenteService {
  constructor(private prisma: PrismaService) {}

  async findAll(empresaId: string) {
    return this.prisma.tipoComponente.findMany({
      where: {
        isActive: true,
        OR: [{ empresaId }, { esGlobal: true }],
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async create(empresaId: string, dto: CreateTipoComponenteDto) {
    const existing = await this.prisma.tipoComponente.findUnique({
      where: { empresaId_nombre: { empresaId, nombre: dto.nombre } },
    });

    if (existing) {
      throw new ConflictException(
        `Ya existe un tipo de componente con el nombre "${dto.nombre}"`,
      );
    }

    return this.prisma.tipoComponente.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        categoria: dto.categoria,
        descripcion: dto.descripcion,
      },
    });
  }

  async findOne(empresaId: string, id: string) {
    const tipo = await this.prisma.tipoComponente.findFirst({
      where: {
        id,
        OR: [{ empresaId }, { esGlobal: true }],
        isActive: true,
      },
      include: { componentes: { where: { isActive: true }, take: 5 } },
    });
    if (!tipo) throw new NotFoundException('Tipo de componente no encontrado');
    return tipo;
  }

  async update(empresaId: string, id: string, dto: Partial<CreateTipoComponenteDto>) {
    await this.findOne(empresaId, id);

    if (dto.nombre) {
      const existing = await this.prisma.tipoComponente.findFirst({
        where: { empresaId, nombre: dto.nombre, id: { not: id } },
      });
      if (existing) {
        throw new ConflictException(`Ya existe un tipo de componente con el nombre "${dto.nombre}"`);
      }
    }

    return this.prisma.tipoComponente.update({
      where: { id },
      data: dto,
    });
  }

  async remove(empresaId: string, id: string) {
    await this.findOne(empresaId, id);
    return this.prisma.tipoComponente.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
