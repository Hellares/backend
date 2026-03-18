import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { TipoNotificacion } from '@prisma/client';

@Injectable()
export class PreguntaProductoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
  ) {}

  async listarPreguntas(productoId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.preguntaProducto.findMany({
        where: { productoId },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          pregunta: true,
          respuesta: true,
          creadoEn: true,
          respondidoEn: true,
          usuario: {
            select: {
              persona: { select: { nombres: true } },
            },
          },
        },
      }),
      this.prisma.preguntaProducto.count({ where: { productoId } }),
    ]);

    return {
      data: data.map((p) => ({
        id: p.id,
        pregunta: p.pregunta,
        respuesta: p.respuesta,
        nombreUsuario: p.usuario?.persona?.nombres ?? 'Usuario',
        creadoEn: p.creadoEn,
        respondidoEn: p.respondidoEn,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async hacerPregunta(productoId: string, usuarioId: string, pregunta: string) {
    // Verificar que el producto existe y es visible
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, isActive: true, visibleMarketplace: true },
      select: { id: true, empresaId: true, nombre: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const nuevaPregunta = await this.prisma.preguntaProducto.create({
      data: {
        productoId,
        empresaId: producto.empresaId,
        usuarioId,
        pregunta,
      },
      select: {
        id: true,
        pregunta: true,
        creadoEn: true,
      },
    });

    // Notificar a admins de la empresa
    const admins = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId: producto.empresaId,
        estado: 'ACTIVO',
        rol: { in: ['EMPRESA_ADMIN', 'SUPER_ADMIN'] },
      },
      select: { usuarioId: true },
    });

    const adminIds = admins.map((a) => a.usuarioId);
    if (adminIds.length > 0) {
      this.notificacionService.enviarAUsuarios(
        adminIds,
        `Nueva pregunta sobre ${producto.nombre}`,
        pregunta.length > 100 ? pregunta.substring(0, 100) + '...' : pregunta,
        {
          tipo: 'SISTEMA',
          empresaId: producto.empresaId,
          data: { productoId, action: 'PREGUNTA_PRODUCTO' },
        },
      ).catch(() => {});
    }

    return nuevaPregunta;
  }

  async responderPregunta(
    empresaId: string,
    productoId: string,
    preguntaId: string,
    usuarioId: string,
    respuesta: string,
  ) {
    const pregunta = await this.prisma.preguntaProducto.findFirst({
      where: { id: preguntaId, productoId, empresaId },
      select: { id: true, respuesta: true, usuarioId: true, pregunta: true },
    });

    if (!pregunta) throw new NotFoundException('Pregunta no encontrada');
    if (pregunta.respuesta) throw new BadRequestException('Esta pregunta ya fue respondida');

    const actualizada = await this.prisma.preguntaProducto.update({
      where: { id: preguntaId },
      data: {
        respuesta,
        respondidoPor: usuarioId,
        respondidoEn: new Date(),
      },
      select: {
        id: true,
        pregunta: true,
        respuesta: true,
        respondidoEn: true,
      },
    });

    // Notificar al usuario que preguntó
    this.notificacionService.enviarAUsuario(
      pregunta.usuarioId,
      'Respondieron tu pregunta',
      respuesta.length > 100 ? respuesta.substring(0, 100) + '...' : respuesta,
      {
        tipo: TipoNotificacion.SISTEMA,
        data: { productoId, action: 'RESPUESTA_PRODUCTO' },
      },
    ).catch(() => {});

    return actualizada;
  }

  async listarPreguntasEmpresa(
    empresaId: string,
    filtro: 'pendientes' | 'respondidas' | 'todas' = 'todas',
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { empresaId };

    if (filtro === 'pendientes') where.respuesta = null;
    else if (filtro === 'respondidas') where.respuesta = { not: null };

    const [data, total, pendientes] = await Promise.all([
      this.prisma.preguntaProducto.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          pregunta: true,
          respuesta: true,
          creadoEn: true,
          respondidoEn: true,
          producto: {
            select: { id: true, nombre: true },
          },
          usuario: {
            select: {
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      }),
      this.prisma.preguntaProducto.count({ where }),
      this.prisma.preguntaProducto.count({
        where: { empresaId, respuesta: null },
      }),
    ]);

    return {
      data: data.map((p) => ({
        id: p.id,
        pregunta: p.pregunta,
        respuesta: p.respuesta,
        productoId: p.producto.id,
        productoNombre: p.producto.nombre,
        nombreUsuario: p.usuario?.persona
          ? `${p.usuario.persona.nombres ?? ''} ${p.usuario.persona.apellidos ?? ''}`.trim()
          : 'Usuario',
        creadoEn: p.creadoEn,
        respondidoEn: p.respondidoEn,
      })),
      total,
      pendientes,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
