import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { CrearCampanaDto } from './dto/crear-campana.dto';
import { TipoCampana, EstadoCampana } from '@prisma/client';

@Injectable()
export class PromocionService {
  private readonly logger = new Logger(PromocionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
  ) {}

  /**
   * Obtener IDs de usuarios clientes de una empresa
   */
  private async getClienteUsuarioIds(empresaId: string): Promise<string[]> {
    const clientes = await this.prisma.empresaPersona.findMany({
      where: {
        empresaId,
        rol: 'CLIENTE',
        isActive: true,
        deletedAt: null,
        persona: {
          usuario: { isNot: null },
        },
      },
      select: {
        persona: {
          select: {
            usuario: {
              select: { id: true },
            },
          },
        },
      },
    });

    return clientes
      .map((c) => c.persona.usuario?.id)
      .filter((id): id is string => !!id);
  }

  /**
   * Crear y enviar campaña manual de promoción
   */
  async crearCampana(
    empresaId: string,
    usuarioId: string,
    dto: CrearCampanaDto,
  ) {
    const usuarioIds = await this.getClienteUsuarioIds(empresaId);

    // Crear registro de campaña
    const campana = await this.prisma.campanaPromocion.create({
      data: {
        empresaId,
        titulo: dto.titulo,
        mensaje: dto.mensaje,
        tipo: TipoCampana.MANUAL,
        estado: usuarioIds.length > 0 ? EstadoCampana.ENVIADA : EstadoCampana.FALLIDA,
        totalDestinatarios: usuarioIds.length,
        totalEnviados: usuarioIds.length,
        productosIds: dto.productosIds ?? [],
        creadoPor: usuarioId,
      },
    });

    // Enviar notificaciones push
    if (usuarioIds.length > 0) {
      try {
        await this.notificacionService.enviarAUsuarios(
          usuarioIds,
          dto.titulo,
          dto.mensaje,
          {
            tipo: 'PROMOCION',
            empresaId,
            data: {
              tipo: 'PROMOCION',
              campanaId: campana.id,
              ...(dto.productosIds?.length
                ? { productoId: dto.productosIds[0] }
                : {}),
            },
          },
        );

        this.logger.log(
          `Campaña ${campana.id} enviada a ${usuarioIds.length} clientes`,
        );
      } catch (error: any) {
        this.logger.error(`Error enviando campaña ${campana.id}: ${error.message}`);
        await this.prisma.campanaPromocion.update({
          where: { id: campana.id },
          data: { estado: EstadoCampana.FALLIDA },
        });
      }
    }

    return campana;
  }

  /**
   * Enviar notificación automática cuando se activa una oferta
   */
  async notificarOfertaAutomatica(
    empresaId: string,
    usuarioId: string,
    producto: { id: string; nombre: string; precioOferta?: number },
  ) {
    const usuarioIds = await this.getClienteUsuarioIds(empresaId);
    if (usuarioIds.length === 0) return;

    const titulo = '¡Nueva oferta disponible!';
    const mensaje = producto.precioOferta
      ? `${producto.nombre} ahora a S/ ${producto.precioOferta}`
      : `${producto.nombre} está en oferta`;

    // Registrar campaña automática
    const campana = await this.prisma.campanaPromocion.create({
      data: {
        empresaId,
        titulo,
        mensaje,
        tipo: TipoCampana.AUTOMATICA,
        estado: EstadoCampana.ENVIADA,
        totalDestinatarios: usuarioIds.length,
        totalEnviados: usuarioIds.length,
        productosIds: [producto.id],
        creadoPor: usuarioId,
      },
    });

    try {
      await this.notificacionService.enviarAUsuarios(
        usuarioIds,
        titulo,
        mensaje,
        {
          tipo: 'PROMOCION',
          empresaId,
          data: {
            tipo: 'PROMOCION',
            campanaId: campana.id,
            productoId: producto.id,
          },
        },
      );
    } catch (error: any) {
      this.logger.error(`Error en notificación automática: ${error.message}`);
      await this.prisma.campanaPromocion.update({
        where: { id: campana.id },
        data: { estado: EstadoCampana.FALLIDA },
      });
    }
  }

  /**
   * Listar campañas de la empresa con paginación
   */
  async listarCampanas(
    empresaId: string,
    page = 1,
    limit = 20,
  ) {
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.campanaPromocion.findMany({
        where: { empresaId },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
        include: {
          usuario: {
            select: {
              email: true,
              persona: {
                select: { nombres: true },
              },
            },
          },
        },
      }),
      this.prisma.campanaPromocion.count({
        where: { empresaId },
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Obtener productos en oferta de la empresa para seleccionar en campaña
   */
  async getProductosEnOferta(empresaId: string) {
    const stocks = await this.prisma.productoStock.findMany({
      where: {
        empresaId,
        enOferta: true,
        precioConfigurado: true,
        producto: { isActive: true },
      },
      include: {
        producto: {
          select: {
            id: true,
            nombre: true,
          },
        },
        sede: {
          select: { id: true, nombre: true },
        },
      },
      orderBy: { producto: { nombre: 'asc' } },
    });

    return stocks.map((s) => ({
      productoStockId: s.id,
      productoId: s.producto.id,
      nombre: s.producto.nombre,
      precio: s.precio ? Number(s.precio) : null,
      precioOferta: s.precioOferta ? Number(s.precioOferta) : null,
      fechaInicioOferta: s.fechaInicioOferta,
      fechaFinOferta: s.fechaFinOferta,
      sede: s.sede.nombre,
    }));
  }
}
