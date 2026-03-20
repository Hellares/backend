import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import {
  EstadoSolicitudCotizacion,
  Prisma,
  TipoNotificacion,
} from '@prisma/client';
import { CrearSolicitudDto, RechazarSolicitudDto } from './dto/solicitud-cotizacion.dto';

@Injectable()
export class SolicitudCotizacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
  ) {}

  // ─── CLIENTE ───

  async crear(usuarioId: string, dto: CrearSolicitudDto) {
    if (dto.items.length === 0) {
      throw new BadRequestException('Debe agregar al menos un item');
    }

    const comprador = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: { persona: true },
    });

    const codigo = await this._generarCodigo(dto.empresaId);

    const solicitud = await this.prisma.solicitudCotizacion.create({
      data: {
        codigo,
        solicitanteId: usuarioId,
        empresaId: dto.empresaId,
        nombreSolicitante: `${comprador.persona.nombres} ${comprador.persona.apellidos}`.trim(),
        emailSolicitante: comprador.email,
        telefonoSolicitante: comprador.persona.telefono,
        observaciones: dto.observaciones,
        items: {
          create: dto.items.map((item) => ({
            productoId: item.productoId ?? null,
            varianteId: item.varianteId ?? null,
            descripcion: item.descripcion,
            cantidad: item.cantidad ?? 1,
            imagenUrl: item.imagenUrl ?? null,
            esManual: item.esManual ?? !item.productoId,
            notasItem: item.notasItem ?? null,
          })),
        },
      },
      include: { items: true },
    });

    // Notificar a la empresa
    try {
      const admins = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId: dto.empresaId,
          rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'VENDEDOR'] },
          isActive: true,
        },
        select: { usuarioId: true },
      });

      const adminIds = [...new Set(admins.map((a) => a.usuarioId))];
      if (adminIds.length > 0) {
        await this.notificacionService.enviarAUsuarios(
          adminIds,
          'Nueva solicitud de cotización',
          `${solicitud.nombreSolicitante} solicita cotización de ${dto.items.length} item(s). Código: ${codigo}`,
          {
            tipo: TipoNotificacion.SISTEMA,
            empresaId: dto.empresaId,
          },
        );
      }
    } catch (_) {}

    return solicitud;
  }

  async misSolicitudes(usuarioId: string) {
    return this.prisma.solicitudCotizacion.findMany({
      where: { solicitanteId: usuarioId },
      include: {
        empresa: { select: { id: true, nombre: true, logo: true, subdominio: true } },
        items: { select: { id: true, descripcion: true, cantidad: true, imagenUrl: true, esManual: true } },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async miSolicitudDetalle(usuarioId: string, solicitudId: string) {
    const solicitud = await this.prisma.solicitudCotizacion.findFirst({
      where: { id: solicitudId, solicitanteId: usuarioId },
      include: {
        empresa: { select: { id: true, nombre: true, logo: true, subdominio: true } },
        items: true,
        cotizacion: {
          include: {
            detalles: true,
          },
        },
      },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');
    return solicitud;
  }

  async cancelar(usuarioId: string, solicitudId: string) {
    const solicitud = await this.prisma.solicitudCotizacion.findFirst({
      where: { id: solicitudId, solicitanteId: usuarioId },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');

    const cancelables: EstadoSolicitudCotizacion[] = [
      EstadoSolicitudCotizacion.PENDIENTE,
      EstadoSolicitudCotizacion.EN_REVISION,
    ];

    if (!cancelables.includes(solicitud.estado)) {
      throw new BadRequestException('Esta solicitud no se puede cancelar');
    }

    await this.prisma.solicitudCotizacion.update({
      where: { id: solicitudId },
      data: { estado: EstadoSolicitudCotizacion.CANCELADA },
    });

    return { message: 'Solicitud cancelada' };
  }

  // ─── EMPRESA ───

  async listarRecibidas(empresaId: string, filtros?: { estado?: EstadoSolicitudCotizacion; search?: string }) {
    const where: Prisma.SolicitudCotizacionWhereInput = { empresaId };

    if (filtros?.estado) where.estado = filtros.estado;
    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreSolicitante: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.solicitudCotizacion.findMany({
      where,
      include: {
        items: { select: { id: true, descripcion: true, cantidad: true, esManual: true, imagenUrl: true } },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async detalleRecibida(empresaId: string, solicitudId: string) {
    const solicitud = await this.prisma.solicitudCotizacion.findFirst({
      where: { id: solicitudId, empresaId },
      include: {
        items: true,
        solicitante: {
          select: {
            id: true,
            email: true,
            persona: { select: { nombres: true, apellidos: true, telefono: true, dni: true } },
          },
        },
      },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');

    // Marcar en revisión si está pendiente
    if (solicitud.estado === EstadoSolicitudCotizacion.PENDIENTE) {
      await this.prisma.solicitudCotizacion.update({
        where: { id: solicitudId },
        data: { estado: EstadoSolicitudCotizacion.EN_REVISION },
      });
    }

    return solicitud;
  }

  async rechazar(empresaId: string, solicitudId: string, dto: RechazarSolicitudDto) {
    const solicitud = await this.prisma.solicitudCotizacion.findFirst({
      where: { id: solicitudId, empresaId },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');

    await this.prisma.solicitudCotizacion.update({
      where: { id: solicitudId },
      data: {
        estado: EstadoSolicitudCotizacion.RECHAZADA,
        respuestaVendedor: dto.motivo,
      },
    });

    try {
      await this.notificacionService.enviarAUsuario(
        solicitud.solicitanteId,
        'Solicitud rechazada',
        `Tu solicitud #${solicitud.codigo} fue rechazada: ${dto.motivo}`,
        {
          tipo: TipoNotificacion.SISTEMA,
          empresaId,
          data: { solicitudId: solicitud.id },
          guardar: true,
        },
      );
    } catch (_) {}

    return { message: 'Solicitud rechazada' };
  }

  async cotizar(empresaId: string, solicitudId: string, cotizacionId: string) {
    const solicitud = await this.prisma.solicitudCotizacion.findFirst({
      where: { id: solicitudId, empresaId },
    });

    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');

    await this.prisma.solicitudCotizacion.update({
      where: { id: solicitudId },
      data: {
        estado: EstadoSolicitudCotizacion.COTIZADA,
        cotizacionId,
      },
    });

    try {
      await this.notificacionService.enviarAUsuario(
        solicitud.solicitanteId,
        'Tu solicitud fue cotizada',
        `El vendedor respondió a tu solicitud #${solicitud.codigo} con una cotización. Revísala en la app.`,
        {
          tipo: TipoNotificacion.SISTEMA,
          empresaId,
          data: { solicitudId: solicitud.id },
          guardar: true,
        },
      );
    } catch (_) {}

    return { message: 'Solicitud marcada como cotizada' };
  }

  // ─── HELPERS ───

  private async _generarCodigo(empresaId: string): Promise<string> {
    let config = await this.prisma.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await this.prisma.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    const updated = await this.prisma.configuracionCodigos.update({
      where: { empresaId },
      data: { ultimaSolicitudCotizacion: { increment: 1 } },
    });

    const numero = updated.ultimaSolicitudCotizacion
      .toString()
      .padStart(config.solicitudCotizacionLongitud, '0');

    return `${config.solicitudCotizacionCodigo}${config.solicitudCotizacionSeparador}${numero}`;
  }
}
