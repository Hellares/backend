import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateModeloEquipoDto } from './dto/create-modelo-equipo.dto';
import { UpdateModeloEquipoDto } from './dto/update-modelo-equipo.dto';

@Injectable()
export class ModeloEquipoService {
  constructor(private prisma: PrismaService) {}

  async findAll(empresaId: string, query: { search?: string; tipoComponenteId?: string }) {
    const where: any = {
      isActive: true,
      OR: [{ empresaId }, { esGlobal: true }],
    };

    if (query.tipoComponenteId) {
      where.tipoComponenteId = query.tipoComponenteId;
    }

    if (query.search) {
      where.AND = [
        {
          OR: [
            { marca: { contains: query.search, mode: 'insensitive' } },
            { modelo: { contains: query.search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    return this.prisma.modeloEquipo.findMany({
      where,
      include: { tipoComponente: true },
      orderBy: [{ marca: 'asc' }, { modelo: 'asc' }],
    });
  }

  async findOne(empresaId: string, id: string) {
    const modelo = await this.prisma.modeloEquipo.findFirst({
      where: {
        id,
        OR: [{ empresaId }, { esGlobal: true }],
        isActive: true,
      },
      include: { tipoComponente: true },
    });

    if (!modelo) {
      throw new NotFoundException('Modelo de equipo no encontrado');
    }

    return modelo;
  }

  async create(empresaId: string, dto: CreateModeloEquipoDto) {
    // Check tipo exists
    const tipo = await this.prisma.tipoComponente.findFirst({
      where: {
        id: dto.tipoComponenteId,
        OR: [{ empresaId }, { esGlobal: true }],
      },
    });
    if (!tipo) {
      throw new NotFoundException('Tipo de componente no encontrado');
    }

    // Check unique marca+modelo per empresa
    const existing = await this.prisma.modeloEquipo.findFirst({
      where: { empresaId, marca: dto.marca, modelo: dto.modelo },
    });
    if (existing) {
      throw new ConflictException(`Ya existe el modelo "${dto.marca} ${dto.modelo}"`);
    }

    return this.prisma.modeloEquipo.create({
      data: { empresaId, ...dto },
      include: { tipoComponente: true },
    });
  }

  async update(empresaId: string, id: string, dto: UpdateModeloEquipoDto) {
    await this.findOne(empresaId, id);

    if (dto.marca || dto.modelo) {
      const current = await this.prisma.modeloEquipo.findUnique({ where: { id } });
      const marca = dto.marca || current!.marca;
      const modelo = dto.modelo || current!.modelo;
      const existing = await this.prisma.modeloEquipo.findFirst({
        where: { empresaId, marca, modelo, id: { not: id } },
      });
      if (existing) {
        throw new ConflictException(`Ya existe el modelo "${marca} ${modelo}"`);
      }
    }

    return this.prisma.modeloEquipo.update({
      where: { id },
      data: dto,
      include: { tipoComponente: true },
    });
  }

  async remove(empresaId: string, id: string) {
    await this.findOne(empresaId, id);
    return this.prisma.modeloEquipo.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
