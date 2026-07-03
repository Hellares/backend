import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { IntegracionYapeService } from '../integracion-yape/integracion-yape.service';
import { CaracteristicaEmpresaService } from '../caracteristica-empresa/caracteristica-empresa.service';
import { CotizacionService } from '../cotizacion/cotizacion.service';
import {
  CaracteristicaPremium,
  EntidadTipo,
  EstadoCotizacion,
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
    private readonly integracionYape: IntegracionYapeService,
    private readonly caracteristicaEmpresa: CaracteristicaEmpresaService,
    private readonly cotizacionService: CotizacionService,
  ) {}

  /** Reference del charge api-yape del adelanto (el webhook rutea por prefijo). */
  static referenciaYape(cotizacionId: string) {
    return `cotizacion:${cotizacionId}`;
  }

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

    // Calculate 7 days from now
    const fechaVencimiento = new Date();
    fechaVencimiento.setDate(fechaVencimiento.getDate() + 7);

    const solicitud = await this.prisma.solicitudCotizacion.create({
      data: {
        codigo,
        solicitanteId: usuarioId,
        empresaId: dto.empresaId,
        nombreSolicitante: `${comprador.persona.nombres} ${comprador.persona.apellidos}`.trim(),
        emailSolicitante: comprador.email,
        telefonoSolicitante: comprador.persona.telefono,
        observaciones: dto.observaciones,
        fechaVencimiento,
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

  /**
   * Resuelve la cotización formal de una solicitud verificando que pertenezca
   * al comprador. Base de los endpoints ver/aceptar/rechazar/pagar adelanto.
   */
  private async _cotizacionDelComprador(usuarioId: string, solicitudId: string) {
    const solicitud = await this.prisma.solicitudCotizacion.findFirst({
      where: { id: solicitudId, solicitanteId: usuarioId },
      select: { id: true, codigo: true, cotizacionId: true, empresaId: true },
    });
    if (!solicitud) throw new NotFoundException('Solicitud no encontrada');
    if (!solicitud.cotizacionId) {
      throw new BadRequestException('Esta solicitud aún no tiene cotización');
    }
    const cotizacion = await this.prisma.cotizacion.findUnique({
      where: { id: solicitud.cotizacionId },
      include: {
        detalles: { orderBy: { orden: 'asc' } },
        sede: { select: { id: true, nombre: true, direccion: true } },
        // Venta resultante (si ya se convirtió): el cliente ve el resumen
        // REAL de su compra (total y código), no el total cotizado.
        venta: { select: { id: true, codigo: true, total: true, estado: true } },
      },
    });
    if (!cotizacion) throw new NotFoundException('Cotización no encontrada');
    return { solicitud, cotizacion };
  }

  /**
   * Cotización formal vista por el COMPRADOR (vía su solicitud): items con
   * precios, totales, vigencia, adelanto requerido y estado. Cada detalle
   * lleva `imagenUrl` (thumbnail del producto o de la variante) para la
   * tabla de items del cliente.
   */
  async miCotizacion(usuarioId: string, solicitudId: string) {
    const { solicitud, cotizacion } = await this._cotizacionDelComprador(
      usuarioId,
      solicitudId,
    );

    // Imágenes por producto/variante (primera imagen activa, thumbnail).
    const productoIds = [
      ...new Set(
        cotizacion.detalles
          .filter((d) => !d.varianteId && d.productoId)
          .map((d) => d.productoId!),
      ),
    ];
    const varianteIds = [
      ...new Set(
        cotizacion.detalles.filter((d) => d.varianteId).map((d) => d.varianteId!),
      ),
    ];
    const imagenes = await this.prisma.archivo.findMany({
      where: {
        OR: [
          ...(productoIds.length
            ? [
                {
                  entidadTipo: EntidadTipo.PRODUCTO,
                  entidadId: { in: productoIds },
                },
              ]
            : []),
          ...(varianteIds.length
            ? [
                {
                  entidadTipo: EntidadTipo.PRODUCTO_VARIANTE,
                  entidadId: { in: varianteIds },
                },
              ]
            : []),
        ],
        tipoArchivo: 'IMAGEN',
        isActive: true,
        deletedAt: null,
      },
      select: { entidadId: true, url: true, urlThumbnail: true, orden: true },
      orderBy: { orden: 'asc' },
    });
    const imagenPorEntidad = new Map<string, string>();
    for (const img of imagenes) {
      if (img.entidadId && !imagenPorEntidad.has(img.entidadId)) {
        imagenPorEntidad.set(img.entidadId, img.urlThumbnail || img.url);
      }
    }

    return {
      ...cotizacion,
      detalles: cotizacion.detalles.map((d) => ({
        ...d,
        imagenUrl:
          (d.varianteId && imagenPorEntidad.get(d.varianteId)) ||
          (d.productoId && imagenPorEntidad.get(d.productoId)) ||
          null,
      })),
      solicitudCodigo: solicitud.codigo,
      tieneReservaActiva: cotizacion.detalles.some(
        (d) => d.reservaEstado === 'ACTIVA',
      ),
    };
  }

  /**
   * El cliente ACEPTA la cotización (sin adelanto): pasa a APROBADA y la
   * empresa la cobra en tienda/al entregar. Para separar con adelanto está
   * `cobroYapeAdelanto` (la aprobación ocurre al confirmarse el pago).
   */
  async aceptarCotizacion(usuarioId: string, solicitudId: string) {
    const { cotizacion } = await this._cotizacionDelComprador(usuarioId, solicitudId);

    if (cotizacion.estado === EstadoCotizacion.APROBADA) {
      return { message: 'La cotización ya estaba aceptada' };
    }
    if (cotizacion.estado !== EstadoCotizacion.PENDIENTE) {
      throw new BadRequestException(
        'Esta cotización ya no está disponible para aceptar',
      );
    }

    await this.prisma.cotizacion.update({
      where: { id: cotizacion.id },
      data: { estado: EstadoCotizacion.APROBADA },
    });

    await this._notificarStaff(
      cotizacion.empresaId,
      'Cotización aceptada',
      `El cliente aceptó la cotización ${cotizacion.codigo} por S/ ${Number(cotizacion.total).toFixed(2)}`,
      cotizacion.id,
    );

    return { message: 'Cotización aceptada' };
  }

  /**
   * El cliente RECHAZA la cotización: libera reservas si las hubiera.
   * Solo mientras no haya adelanto pagado (con dinero de por medio la
   * devolución la gestiona la empresa).
   */
  async rechazarCotizacion(usuarioId: string, solicitudId: string) {
    const { cotizacion } = await this._cotizacionDelComprador(usuarioId, solicitudId);

    const rechazables: EstadoCotizacion[] = [
      EstadoCotizacion.PENDIENTE,
      EstadoCotizacion.APROBADA,
    ];
    if (!rechazables.includes(cotizacion.estado)) {
      throw new BadRequestException('Esta cotización ya no se puede rechazar');
    }
    if (cotizacion.adelantoMonto && Number(cotizacion.adelantoMonto) > 0) {
      throw new BadRequestException(
        'Ya pagaste un adelanto por esta cotización — contacta a la empresa para gestionar la devolución',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.cotizacionService.liberarReservas(
        tx,
        cotizacion.id,
        'LIBERAR',
        usuarioId,
      );
      await tx.cotizacion.update({
        where: { id: cotizacion.id },
        data: { estado: EstadoCotizacion.RECHAZADA },
      });
    });

    await this._notificarStaff(
      cotizacion.empresaId,
      'Cotización rechazada',
      `El cliente rechazó la cotización ${cotizacion.codigo}`,
      cotizacion.id,
    );

    return { message: 'Cotización rechazada' };
  }

  /**
   * Inicia un pago de la cotización (TOTAL o PARCIAL) vía api-yape: crea un
   * charge con reference `cotizacion:<id>` por el monto elegido. Sin `monto`
   * usa el `adelantoRequerido` de la empresa (o el saldo completo si no
   * hay). El webhook confirma solo: ACUMULA el pago, reserva el stock
   * (primer pago) y aprueba la cotización.
   * Devuelve { habilitado:false } si la empresa no tiene Yape automático →
   * la app cae a coordinación manual.
   */
  async cobroYapeAdelanto(
    usuarioId: string,
    solicitudId: string,
    montoSolicitado?: number,
  ) {
    const { cotizacion } = await this._cotizacionDelComprador(usuarioId, solicitudId);

    const pagables: EstadoCotizacion[] = [
      EstadoCotizacion.PENDIENTE,
      EstadoCotizacion.APROBADA,
    ];
    if (!pagables.includes(cotizacion.estado)) {
      throw new BadRequestException('Esta cotización ya no está disponible');
    }

    const total = Number(cotizacion.total);
    const adelantoPagado = Number(cotizacion.adelantoMonto ?? 0);
    const saldo = Math.round((total - adelantoPagado) * 100) / 100;
    if (saldo <= 0.005) {
      throw new BadRequestException(
        'Esta cotización ya está pagada por completo',
      );
    }

    // Monto a cobrar: el elegido por el cliente (validado contra el saldo),
    // o el adelanto requerido por la empresa, o el saldo completo.
    const adelantoRequerido = Number(cotizacion.adelantoRequerido ?? 0);
    let adelanto: number;
    if (montoSolicitado != null && Number(montoSolicitado) > 0) {
      adelanto = Math.round(Number(montoSolicitado) * 100) / 100;
      if (adelanto > saldo + 0.005) {
        throw new BadRequestException(
          `El monto supera el saldo pendiente (S/ ${saldo.toFixed(2)})`,
        );
      }
      if (adelanto < 1) {
        throw new BadRequestException('El monto mínimo es S/ 1.00');
      }
    } else {
      adelanto =
        adelantoRequerido > 0 ? Math.min(adelantoRequerido, saldo) : saldo;
    }

    // QR estático del comercio.
    const cfgQr = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId: cotizacion.empresaId },
      select: { qrYapeUrl: true, qrPlinUrl: true },
    });
    const qr = {
      qrYapeUrl: cfgQr?.qrYapeUrl ?? null,
      qrPlinUrl: cfgQr?.qrPlinUrl ?? null,
    };

    // Gates: característica premium + integración habilitada + límite Yape.
    const yapeHabilitado = await this.caracteristicaEmpresa.estaHabilitada(
      cotizacion.empresaId,
      CaracteristicaPremium.YAPE_QR,
    );
    if (!yapeHabilitado) {
      return {
        habilitado: false as const,
        total,
        adelanto,
        adelantoPagado,
        saldo,
        ...qr,
      };
    }
    const cfgYape = await this.prisma.integracionYape.findUnique({
      where: { empresaId: cotizacion.empresaId },
      select: { habilitado: true, montoMaxPorTransaccion: true, celular: true },
    });
    if (!cfgYape?.habilitado || adelanto > Number(cfgYape.montoMaxPorTransaccion)) {
      return {
        habilitado: false as const,
        total,
        adelanto,
        adelantoPagado,
        saldo,
        ...qr,
      };
    }

    // Cancel-then-create: reabrir la hoja no acumula charges pendientes.
    const reference = SolicitudCotizacionService.referenciaYape(cotizacion.id);
    try {
      await this.integracionYape.cancelarCobro({
        empresaId: cotizacion.empresaId,
        ventaId: reference,
      });
    } catch (_) {}

    const cobro = await this.integracionYape.crearCobro({
      empresaId: cotizacion.empresaId,
      ventaId: reference,
      monto: adelanto,
    });
    if (!cobro) {
      return {
        habilitado: false as const,
        total,
        adelanto,
        adelantoPagado,
        saldo,
        ...qr,
      };
    }

    return {
      habilitado: true as const,
      payAmount: cobro.payAmount,
      chargeId: cobro.chargeId,
      total,
      adelanto,
      adelantoPagado,
      saldo,
      celular: cfgYape.celular ?? null,
      ...qr,
    };
  }

  /** Notificación best-effort al staff de la empresa. */
  private async _notificarStaff(
    empresaId: string,
    titulo: string,
    mensaje: string,
    cotizacionId: string,
  ) {
    try {
      const staff = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'VENDEDOR'] },
        },
        select: { usuarioId: true },
      });
      const ids = [...new Set(staff.map((s) => s.usuarioId))];
      if (ids.length > 0) {
        await this.notificacionService.enviarAUsuarios(ids, titulo, mensaje, {
          tipo: TipoNotificacion.SISTEMA,
          empresaId,
          data: { cotizacionId },
        });
      }
    } catch (_) {}
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

    // Al responder al cliente, la cotización queda ENVIADA para él: si
    // sigue en BORRADOR pasa a PENDIENTE — sin esto el cliente la veía
    // pero no podía aceptarla ni pagarla.
    await this.prisma.cotizacion.updateMany({
      where: {
        id: cotizacionId,
        empresaId,
        estado: EstadoCotizacion.BORRADOR,
      },
      data: { estado: EstadoCotizacion.PENDIENTE },
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

  // ─── PRE-POPULATE ───

  async getItemsPrevios(usuarioId: string, empresaId: string) {
    // Get the most recent completed solicitud for this user+empresa
    const ultimaSolicitud = await this.prisma.solicitudCotizacion.findFirst({
      where: {
        solicitanteId: usuarioId,
        empresaId,
        estado: { in: ['COTIZADA', 'VENCIDA', 'CANCELADA', 'RECHAZADA'] },
      },
      include: {
        items: {
          select: {
            productoId: true,
            varianteId: true,
            descripcion: true,
            cantidad: true,
            imagenUrl: true,
            esManual: true,
            notasItem: true,
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
    });

    return ultimaSolicitud?.items ?? [];
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
