import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateServicioComponenteDto } from './dto/create-servicio-componente.dto';

@Injectable()
export class ServicioComponenteService {
  constructor(private prisma: PrismaService) {}

  async create(empresaId: string, ordenServicioId: string, dto: CreateServicioComponenteDto) {
    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenServicioId, empresaId },
    });
    if (!orden) throw new NotFoundException('Orden de servicio no encontrada');

    const componente = await this.prisma.componente.findFirst({
      where: { id: dto.componenteId, empresaId, deletedAt: null, isActive: true },
    });
    if (!componente) throw new NotFoundException('Componente no encontrado o inactivo');

    return this.prisma.servicioComponente.create({
      data: { ordenServicioId, ...dto },
      include: { componente: { include: { tipoComponente: true } } },
    });
  }

  async findByOrden(empresaId: string, ordenServicioId: string) {
    // Validate orden belongs to empresa
    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenServicioId, empresaId },
    });
    if (!orden) throw new NotFoundException('Orden de servicio no encontrada');

    return this.prisma.servicioComponente.findMany({
      where: { ordenServicioId },
      include: {
        componente: {
          include: { tipoComponente: true },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async remove(empresaId: string, id: string) {
    const servicioComponente = await this.prisma.servicioComponente.findUnique({
      where: { id },
      include: { ordenServicio: { select: { empresaId: true } } },
    });

    if (!servicioComponente) {
      throw new NotFoundException('Componente de servicio no encontrado');
    }

    if (servicioComponente.ordenServicio.empresaId !== empresaId) {
      throw new BadRequestException('El componente no pertenece a esta empresa');
    }

    return this.prisma.servicioComponente.delete({
      where: { id },
    });
  }
}
