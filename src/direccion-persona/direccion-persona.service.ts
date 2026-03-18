import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DireccionPersonaService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(personaId: string) {
    return this.prisma.direccionPersona.findMany({
      where: { personaId, isActive: true, deletedAt: null },
      orderBy: [{ esPredeterminada: 'desc' }, { creadoEn: 'desc' }],
    });
  }

  async crear(personaId: string, data: any) {
    // Si es predeterminada, quitar la anterior
    if (data.esPredeterminada) {
      await this.prisma.direccionPersona.updateMany({
        where: { personaId, esPredeterminada: true },
        data: { esPredeterminada: false },
      });
    }

    // Si es la primera dirección, hacerla predeterminada
    const count = await this.prisma.direccionPersona.count({
      where: { personaId, isActive: true, deletedAt: null },
    });

    return this.prisma.direccionPersona.create({
      data: {
        personaId,
        tipo: data.tipo || 'ENVIO',
        etiqueta: data.etiqueta || null,
        direccion: data.direccion,
        referencia: data.referencia || null,
        distrito: data.distrito || null,
        provincia: data.provincia || null,
        departamento: data.departamento || null,
        coordenadas: data.coordenadas || null,
        esPredeterminada: data.esPredeterminada || count === 0,
      },
    });
  }

  async actualizar(personaId: string, id: string, data: any) {
    const direccion = await this.prisma.direccionPersona.findFirst({
      where: { id, personaId, deletedAt: null },
    });
    if (!direccion) throw new NotFoundException('Dirección no encontrada');

    if (data.esPredeterminada) {
      await this.prisma.direccionPersona.updateMany({
        where: { personaId, esPredeterminada: true },
        data: { esPredeterminada: false },
      });
    }

    return this.prisma.direccionPersona.update({
      where: { id },
      data: {
        ...(data.tipo && { tipo: data.tipo }),
        ...(data.etiqueta !== undefined && { etiqueta: data.etiqueta }),
        ...(data.direccion && { direccion: data.direccion }),
        ...(data.referencia !== undefined && { referencia: data.referencia }),
        ...(data.distrito !== undefined && { distrito: data.distrito }),
        ...(data.provincia !== undefined && { provincia: data.provincia }),
        ...(data.departamento !== undefined && { departamento: data.departamento }),
        ...(data.coordenadas !== undefined && { coordenadas: data.coordenadas }),
        ...(data.esPredeterminada !== undefined && { esPredeterminada: data.esPredeterminada }),
      },
    });
  }

  async eliminar(personaId: string, id: string) {
    const direccion = await this.prisma.direccionPersona.findFirst({
      where: { id, personaId, deletedAt: null },
    });
    if (!direccion) throw new NotFoundException('Dirección no encontrada');

    await this.prisma.direccionPersona.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });

    // Si era predeterminada, hacer la primera disponible como predeterminada
    if (direccion.esPredeterminada) {
      const primera = await this.prisma.direccionPersona.findFirst({
        where: { personaId, isActive: true, deletedAt: null },
        orderBy: { creadoEn: 'asc' },
      });
      if (primera) {
        await this.prisma.direccionPersona.update({
          where: { id: primera.id },
          data: { esPredeterminada: true },
        });
      }
    }

    return { deleted: true };
  }

  async marcarPredeterminada(personaId: string, id: string) {
    const direccion = await this.prisma.direccionPersona.findFirst({
      where: { id, personaId, isActive: true, deletedAt: null },
    });
    if (!direccion) throw new NotFoundException('Dirección no encontrada');

    await this.prisma.direccionPersona.updateMany({
      where: { personaId, esPredeterminada: true },
      data: { esPredeterminada: false },
    });

    return this.prisma.direccionPersona.update({
      where: { id },
      data: { esPredeterminada: true },
    });
  }

  async obtenerPredeterminada(personaId: string) {
    return this.prisma.direccionPersona.findFirst({
      where: { personaId, esPredeterminada: true, isActive: true, deletedAt: null },
    });
  }
}
