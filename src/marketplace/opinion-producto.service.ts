import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OpinionProductoService {
  constructor(private readonly prisma: PrismaService) {}

  async listarOpiniones(productoId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [data, total, resumen] = await Promise.all([
      this.prisma.opinionProducto.findMany({
        where: { productoId },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          calificacion: true,
          comentario: true,
          imagenes: true,
          verificada: true,
          creadoEn: true,
          usuario: {
            select: {
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      }),
      this.prisma.opinionProducto.count({ where: { productoId } }),
      this.prisma.opinionProducto.groupBy({
        by: ['calificacion'],
        where: { productoId },
        _count: true,
      }),
    ]);

    // Calcular resumen
    const distribucion: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let suma = 0;
    for (const r of resumen) {
      distribucion[r.calificacion] = r._count;
      suma += r.calificacion * r._count;
    }
    const promedio = total > 0 ? Math.round((suma / total) * 10) / 10 : 0;

    return {
      data: data.map((o) => ({
        id: o.id,
        calificacion: o.calificacion,
        comentario: o.comentario,
        imagenes: o.imagenes,
        verificada: o.verificada,
        nombreUsuario: o.usuario?.persona
          ? `${o.usuario.persona.nombres ?? ''} ${o.usuario.persona.apellidos ?? ''}`.trim()
          : 'Usuario',
        creadoEn: o.creadoEn,
      })),
      resumen: {
        promedio,
        total,
        distribucion,
      },
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async crearOpinion(
    productoId: string,
    usuarioId: string,
    calificacion: number,
    comentario?: string,
    imagenes?: string[],
  ) {
    if (calificacion < 1 || calificacion > 5) {
      throw new BadRequestException('La calificación debe ser entre 1 y 5');
    }

    // Verificar producto
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, isActive: true, visibleMarketplace: true },
      select: { id: true, empresaId: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    // Verificar que no haya opinado antes
    const existente = await this.prisma.opinionProducto.findUnique({
      where: { productoId_usuarioId: { productoId, usuarioId } },
    });
    if (existente) throw new ConflictException('Ya dejaste una opinión para este producto');

    // Verificar compra (marcar como verificada)
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { personaId: true },
    });

    let verificada = false;
    if (usuario?.personaId) {
      const compra = await this.prisma.ventaDetalle.findFirst({
        where: {
          productoId,
          venta: {
            clienteId: {
              in: await this.prisma.empresaPersona
                .findMany({
                  where: { personaId: usuario.personaId, empresaId: producto.empresaId },
                  select: { id: true },
                })
                .then((eps) => eps.map((e) => e.id)),
            },
            estado: { in: ['PAGADA_COMPLETA', 'CONFIRMADA'] },
          },
        },
        select: { id: true },
      });
      verificada = !!compra;
    }

    return this.prisma.opinionProducto.create({
      data: {
        productoId,
        empresaId: producto.empresaId,
        usuarioId,
        calificacion,
        comentario: comentario?.trim() || null,
        imagenes: imagenes ?? [],
        verificada,
      },
      select: {
        id: true,
        calificacion: true,
        comentario: true,
        imagenes: true,
        verificada: true,
        creadoEn: true,
      },
    });
  }

  async listarOpinionesEmpresa(
    empresaId: string,
    filtro?: string,
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { empresaId };

    if (filtro && ['1', '2', '3', '4', '5'].includes(filtro)) {
      where.calificacion = parseInt(filtro);
    }

    const [data, total, promedioResult] = await Promise.all([
      this.prisma.opinionProducto.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          calificacion: true,
          comentario: true,
          imagenes: true,
          verificada: true,
          creadoEn: true,
          producto: { select: { id: true, nombre: true } },
          usuario: {
            select: {
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      }),
      this.prisma.opinionProducto.count({ where }),
      this.prisma.opinionProducto.aggregate({
        where: { empresaId },
        _avg: { calificacion: true },
        _count: true,
      }),
    ]);

    return {
      data: data.map((o) => ({
        id: o.id,
        calificacion: o.calificacion,
        comentario: o.comentario,
        imagenes: o.imagenes,
        verificada: o.verificada,
        productoId: o.producto.id,
        productoNombre: o.producto.nombre,
        nombreUsuario: o.usuario?.persona
          ? `${o.usuario.persona.nombres ?? ''} ${o.usuario.persona.apellidos ?? ''}`.trim()
          : 'Usuario',
        creadoEn: o.creadoEn,
      })),
      resumen: {
        promedio: Math.round((promedioResult._avg.calificacion ?? 0) * 10) / 10,
        total: promedioResult._count,
      },
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
