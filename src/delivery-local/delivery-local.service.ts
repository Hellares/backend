import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoDeliveryLocal,
  EstadoOfertaDelivery,
  EstadoRepartidorSyncronize,
  EstadoVenta,
  Prisma,
  Rol,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { EvolutionApiService } from '../whatsapp/evolution-api.service';
import {
  ActualizarDireccionDeliveryDto,
  CancelarDeliveryDto,
  CompartirUbicacionDto,
  SolicitarDeliveryDto,
} from './dto/delivery-local.dto';
import {
  EnlaceMapsError,
  esEnlaceAcortado,
  resolverEnlaceAcortado,
} from './enlace-maps.util';
import * as fs from 'fs';
import * as path from 'path';

interface UbigeoFila {
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
}

/** Los nombres del catálogo traen tildes: `localeCompare` los ordena bien. */
const porNombre = (a: { nombre: string }, b: { nombre: string }) =>
  a.nombre.localeCompare(b.nombre, 'es');

/**
 * Delivery local F1 — repartidores propios de la empresa.
 *
 * Regla de plata: el PRODUCTO se paga completo ANTES (gate duro
 * PAGADA_COMPLETA — el repartidor jamás lleva el valor del producto en la
 * calle); el repartidor cobra SOLO su tarifa de delivery al entregar. En F1
 * la tarifa es informativa (sin caja/tesorería — liquidación en F3).
 *
 * Máquina de estados: SOLICITADO → TOMADO → EN_CAMINO → ENTREGADO
 * (CANCELADO desde cualquier estado no terminal, solo staff). La toma es
 * ATÓMICA: dos repartidores no pueden quedarse con el mismo pedido.
 */
@Injectable()
export class DeliveryLocalService {
  private readonly logger = new Logger(DeliveryLocalService.name);

  /** Roles que gestionan deliveries (solicitar/cancelar/ver todo). */
  private static readonly ROLES_STAFF: Rol[] = [
    Rol.SUPER_ADMIN,
    Rol.EMPRESA_ADMIN,
    Rol.SEDE_ADMIN,
    Rol.CAJERO,
    Rol.VENDEDOR,
    Rol.OPERADOR,
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificaciones: NotificacionService,
    private readonly evolution: EvolutionApiService,
  ) {}

  // ── Guards de rol (patrón IaConfigService: EmpresaUsuarioRol activo) ──

  private async rolesEnEmpresa(
    empresaId: string,
    userId: string,
  ): Promise<Rol[]> {
    if (!empresaId || !userId) {
      // Gotcha Prisma: un where con undefined matchea filas arbitrarias.
      throw new BadRequestException('empresaId y usuario son obligatorios');
    }
    const filas = await this.prisma.empresaUsuarioRol.findMany({
      where: { empresaId, usuarioId: userId, isActive: true, deletedAt: null },
      select: { rol: true },
    });
    return filas.map((f) => f.rol);
  }

  private async verificarStaff(empresaId: string, userId: string) {
    const roles = await this.rolesEnEmpresa(empresaId, userId);
    if (!roles.some((r) => DeliveryLocalService.ROLES_STAFF.includes(r))) {
      throw new ForbiddenException('No tienes permisos para gestionar deliveries');
    }
  }

  /** Repartidor de la empresa (o admin, para poder probar/cubrir turnos). */
  private async verificarRepartidor(empresaId: string, userId: string) {
    const roles = await this.rolesEnEmpresa(empresaId, userId);
    const permitidos: Rol[] = [
      Rol.REPARTIDOR,
      Rol.SUPER_ADMIN,
      Rol.EMPRESA_ADMIN,
      Rol.SEDE_ADMIN,
    ];
    if (!roles.some((r) => permitidos.includes(r))) {
      throw new ForbiddenException('Solo repartidores pueden hacer esta acción');
    }
  }

  // ── Flujo ──

  /**
   * Publica un delivery para una venta YA PAGADA AL 100%. El gate es duro:
   * sin PAGADA_COMPLETA no hay delivery (el repartidor no cobra producto).
   */
  async solicitar(userId: string, dto: SolicitarDeliveryDto) {
    await this.verificarStaff(dto.empresaId, userId);

    const venta = await this.prisma.venta.findFirst({
      where: { id: dto.ventaId, empresaId: dto.empresaId },
      select: {
        id: true,
        codigo: true,
        sedeId: true,
        estado: true,
        nombreCliente: true,
        telefonoCliente: true,
        deliveryLocal: { select: { id: true } },
      },
    });
    if (!venta) throw new NotFoundException('Venta no encontrada');
    if (venta.estado !== EstadoVenta.PAGADA_COMPLETA) {
      throw new BadRequestException(
        'VENTA_NO_PAGADA: el delivery local exige el producto pagado al 100% ' +
          '(el repartidor solo cobra la tarifa de envío)',
      );
    }
    if (venta.deliveryLocal) {
      throw new ConflictException('La venta ya tiene un delivery solicitado');
    }

    // Tarifa: la del DTO gana; si no, la default de la sede; si no, 0.
    let costo = dto.costoDelivery;
    if (costo == null) {
      const sede = await this.prisma.sede.findUnique({
        where: { id: venta.sedeId },
        select: { tarifaDeliveryLocal: true },
      });
      costo = sede?.tarifaDeliveryLocal ? Number(sede.tarifaDeliveryLocal) : 0;
    }

    const delivery = await this.prisma.deliveryLocal.create({
      data: {
        empresaId: dto.empresaId,
        sedeId: venta.sedeId,
        ventaId: venta.id,
        destinatarioNombre: dto.destinatarioNombre ?? venta.nombreCliente,
        destinatarioCelular:
          dto.destinatarioCelular ?? venta.telefonoCliente ?? null,
        direccion: dto.direccion,
        referencia: dto.referencia ?? null,
        distrito: dto.distrito ?? null,
        // Pin del mapa (si el staff lo fijó): destino exacto para el
        // NAVEGAR del repartidor y el 📍 del tracking del cliente.
        coordenadas:
          dto.destinoLat != null && dto.destinoLon != null
            ? { lat: dto.destinoLat, lon: dto.destinoLon }
            : undefined,
        // En subasta el costo definitivo lo fija la oferta aceptada; hasta
        // entonces queda en 0 y el ancla vive en `costoSugerido`.
        costoDelivery: dto.modoOferta ? 0 : costo,
        modoOferta: dto.modoOferta ?? false,
        costoSugerido: dto.modoOferta ? (dto.costoSugerido ?? null) : null,
        // Interno: lo lleva un empleado — NO se publica al pool.
        esInterno: dto.esInterno ?? false,
        encargadoInterno: dto.esInterno ? (dto.encargadoInterno ?? null) : null,
      },
    });

    // Push a los repartidores de la empresa — best-effort, jamás rompe la
    // solicitud. Los INTERNOS no se publican: nadie del pool debe verlos.
    if (!dto.esInterno) {
      void this.avisarRepartidores(
        dto.empresaId,
        dto.modoOferta
          ? `${venta.codigo} para ${dto.distrito ?? dto.direccion} — ` +
              'PROPÓN TU PRECIO' +
              (dto.costoSugerido != null
                ? ` (sugerido S/ ${dto.costoSugerido.toFixed(2)})`
                : '')
          : `${venta.codigo} para entregar en ${dto.distrito ?? dto.direccion}` +
              (costo > 0 ? ` — tarifa S/ ${costo.toFixed(2)}` : ''),
      );
    }

    // Geocoder propio: la dirección confirmada con pin alimenta la búsqueda
    // local del picker — fire-and-forget, jamás rompe la solicitud.
    if (dto.destinoLat != null && dto.destinoLon != null) {
      void this.registrarDireccionFrecuente({
        empresaId: dto.empresaId,
        texto: dto.direccion,
        referencia: dto.referencia,
        distrito: dto.distrito,
        lat: dto.destinoLat,
        lon: dto.destinoLon,
        telefono: dto.destinatarioCelular ?? venta.telefonoCliente,
      });
    }

    return delivery;
  }

  // ── Delivery INTERNO: transiciones del STAFF (sin pool, sin PIN) ──

  /**
   * El empleado sale con el pedido (staff marca). SOLICITADO → EN_CAMINO
   * directo (no hay TOMADO: no existe repartidor del pool). Sin PIN — es
   * personal de confianza. El cliente recibe WhatsApp con su tracking.
   */
  async marcarEnCaminoInterno(
    empresaId: string,
    deliveryId: string,
    userId: string,
  ) {
    await this.verificarStaff(empresaId, userId);
    const r = await this.prisma.deliveryLocal.updateMany({
      where: {
        id: deliveryId,
        empresaId,
        esInterno: true,
        estado: EstadoDeliveryLocal.SOLICITADO,
      },
      data: { estado: EstadoDeliveryLocal.EN_CAMINO, enCaminoEn: new Date() },
    });
    if (r.count === 0) {
      throw new ConflictException(
        'El delivery no es interno o ya no está por salir',
      );
    }
    const delivery = await this.cargar(deliveryId);
    const costo = Number(delivery.costoDelivery);
    void this.avisarCliente(
      delivery,
      `🛵 ¡Tu pedido ${delivery.venta?.codigo ?? ''} va en camino a tu dirección!` +
        (costo > 0
          ? ` Al recibirlo, paga S/ ${costo.toFixed(2)} del delivery a quien te lo entrega.`
          : '') +
        `\n📍 Sigue tu pedido aquí: ${this.urlTracking(delivery.trackingToken)}`,
    );
    return delivery;
  }

  /** El empleado entregó (staff marca). EN_CAMINO → ENTREGADO, sin PIN. */
  async marcarEntregadoInterno(
    empresaId: string,
    deliveryId: string,
    userId: string,
  ) {
    await this.verificarStaff(empresaId, userId);
    const r = await this.prisma.deliveryLocal.updateMany({
      where: {
        id: deliveryId,
        empresaId,
        esInterno: true,
        estado: EstadoDeliveryLocal.EN_CAMINO,
      },
      data: { estado: EstadoDeliveryLocal.ENTREGADO, entregadoEn: new Date() },
    });
    if (r.count === 0) {
      throw new ConflictException(
        'El delivery no es interno o no está en camino',
      );
    }
    const delivery = await this.cargar(deliveryId);
    void this.avisarCliente(
      delivery,
      `✅ ¡Pedido ${delivery.venta?.codigo ?? ''} entregado! Gracias por tu compra 🙌`,
    );
    return delivery;
  }

  /**
   * Edita la DIRECCIÓN de entrega (staff): dirección equivocada o el
   * cliente pidió otro punto. Válido mientras el delivery no esté
   * ENTREGADO/CANCELADO; si ya fue tomado o va en camino, el repartidor
   * recibe push con la dirección nueva. Sin pin nuevo, el anterior se
   * descarta (apuntaba al lugar viejo — navegar ahí sería peor que nada).
   */
  async actualizarDireccion(
    userId: string,
    deliveryId: string,
    dto: ActualizarDireccionDeliveryDto,
  ) {
    await this.verificarStaff(dto.empresaId, userId);

    const delivery = await this.prisma.deliveryLocal.findFirst({
      where: { id: deliveryId, empresaId: dto.empresaId },
      select: {
        id: true,
        estado: true,
        repartidorId: true,
        destinatarioCelular: true,
      },
    });
    if (!delivery) throw new NotFoundException('Delivery no encontrado');
    if (
      delivery.estado === EstadoDeliveryLocal.ENTREGADO ||
      delivery.estado === EstadoDeliveryLocal.CANCELADO
    ) {
      throw new BadRequestException(
        `No se puede editar la dirección de un delivery ${delivery.estado}`,
      );
    }

    const tienePin = dto.destinoLat != null && dto.destinoLon != null;
    await this.prisma.deliveryLocal.update({
      where: { id: deliveryId },
      data: {
        direccion: dto.direccion,
        referencia: dto.referencia ?? null,
        distrito: dto.distrito ?? null,
        coordenadas: tienePin
          ? { lat: dto.destinoLat, lon: dto.destinoLon }
          : Prisma.JsonNull,
      },
    });

    // La dirección corregida también alimenta el geocoder propio.
    if (tienePin) {
      void this.registrarDireccionFrecuente({
        empresaId: dto.empresaId,
        texto: dto.direccion,
        referencia: dto.referencia,
        distrito: dto.distrito,
        lat: dto.destinoLat!,
        lon: dto.destinoLon!,
        telefono: delivery.destinatarioCelular,
      });
    }

    // Repartidor ya asignado: avisarle YA (podría estar yendo al punto viejo).
    if (
      delivery.repartidorId &&
      (delivery.estado === EstadoDeliveryLocal.TOMADO ||
        delivery.estado === EstadoDeliveryLocal.EN_CAMINO)
    ) {
      void this.notificaciones
        .enviarAUsuarios(
          [delivery.repartidorId],
          '📍 Dirección de entrega ACTUALIZADA',
          `${dto.direccion}${dto.distrito ? ` — ${dto.distrito}` : ''}. Revisa el pedido antes de seguir.`,
          { tipo: 'SISTEMA', empresaId: dto.empresaId },
        )
        .catch((e) =>
          this.logger.warn(`Aviso cambio dirección: ${(e as Error).message}`),
        );
    }

    return this.cargar(deliveryId);
  }

  /**
   * Comparte la ubicación de entrega por WhatsApp a CUALQUIER celular (el
   * empleado que reparte, un familiar del cliente…) — sale de la instancia
   * de WhatsApp de la empresa, sin salir del app. Con pin manda SOLO la
   * ubicación NATIVA (tocable, abre el mapa) con dirección/ref/zona en el
   * address; sin pin (o si sendLocation falla), un texto con los datos.
   */
  async compartirUbicacion(
    userId: string,
    deliveryId: string,
    dto: CompartirUbicacionDto,
  ) {
    await this.verificarStaff(dto.empresaId, userId);

    let celular = dto.celular.replace(/\D/g, '');
    if (celular.length < 9) {
      throw new BadRequestException('Celular inválido (mínimo 9 dígitos)');
    }
    // WhatsApp exige código de país: 9 dígitos peruanos → 51XXXXXXXXX
    // (sin él, Evolution responde jid exists:false).
    if (celular.length === 9 && celular.startsWith('9')) {
      celular = `51${celular}`;
    }

    const delivery = await this.prisma.deliveryLocal.findFirst({
      where: { id: deliveryId, empresaId: dto.empresaId },
      select: {
        direccion: true,
        referencia: true,
        distrito: true,
        coordenadas: true,
        venta: { select: { codigo: true } },
      },
    });
    if (!delivery) throw new NotFoundException('Delivery no encontrado');

    const iw = await this.prisma.integracionWhatsapp.findUnique({
      where: { empresaId: dto.empresaId },
      select: { instanceName: true, estado: true, habilitado: true },
    });
    if (!iw?.habilitado || String(iw.estado) !== 'CONECTADO') {
      throw new BadRequestException(
        'El WhatsApp de la empresa no está conectado — conéctalo en Integraciones',
      );
    }

    const coords = delivery.coordenadas as { lat?: number; lon?: number } | null;
    const lat = coords?.lat != null ? Number(coords.lat) : null;
    const lon = coords?.lon != null ? Number(coords.lon) : null;
    const codigo = delivery.venta?.codigo ?? '';

    // UN SOLO mensaje: el pin nativo carga título, dirección, ref y zona
    // en address — dos mensajes seguidos a un número frío arriesgan baneo.
    // El texto queda solo como fallback (sin coords o sendLocation caído).
    const direccionCompleta =
      `${delivery.direccion}` +
      (delivery.referencia ? ` — Ref: ${delivery.referencia}` : '') +
      (delivery.distrito ? ` — ${delivery.distrito}` : '');

    let pinEnviado = false;
    if (lat != null && lon != null) {
      try {
        await this.evolution.sendLocation({
          instanceName: iw.instanceName,
          number: celular,
          latitude: lat,
          longitude: lon,
          name: `Entrega ${codigo}`.trim(),
          address: direccionCompleta,
        });
        pinEnviado = true;
      } catch (e: any) {
        const msg = String(e?.message ?? '');
        if (msg.includes('exists":false')) {
          throw new BadRequestException(
            `El número ${dto.celular} no tiene WhatsApp — verifícalo`,
          );
        }
        this.logger.warn(`sendLocation falló (fallback a texto): ${msg}`);
      }
    }

    if (!pinEnviado) {
      const texto =
        `📍 *Entrega ${codigo}*\n` +
        `${delivery.direccion}` +
        (delivery.referencia ? `\nRef: ${delivery.referencia}` : '') +
        (delivery.distrito ? `\nZona: ${delivery.distrito}` : '') +
        (lat != null && lon != null
          ? `\nMapa: https://maps.google.com/?q=${lat},${lon}`
          : '');

      try {
        await this.evolution.sendText({
          instanceName: iw.instanceName,
          number: celular,
          text: texto,
          linkPreview: false,
        });
      } catch (e: any) {
        const msg = String(e?.message ?? '');
        if (msg.includes('exists":false')) {
          throw new BadRequestException(
            `El número ${dto.celular} no tiene WhatsApp — verifícalo`,
          );
        }
        this.logger.warn(`compartirUbicacion sendText: ${msg}`);
        throw new BadRequestException('No se pudo enviar el WhatsApp');
      }
    }

    return { ok: true };
  }

  // ── Geocoder propio (Fase 1): direcciones confirmadas ──

  /** Normaliza para búsqueda: minúsculas, sin tildes, espacios colapsados. */
  private normalizarDireccion(texto: string): string {
    return texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Registra/refuerza una dirección confirmada. Upsert por texto
   * normalizado: repetirla incrementa `usos` (rankea mejor en la búsqueda)
   * y refresca pin/teléfono. Silencioso ante cualquier error.
   */
  private async registrarDireccionFrecuente(p: {
    empresaId: string;
    texto: string;
    referencia?: string | null;
    distrito?: string | null;
    lat: number;
    lon: number;
    telefono?: string | null;
  }) {
    try {
      const textoNormalizado = this.normalizarDireccion(p.texto);
      if (textoNormalizado.length < 5) return;
      await this.prisma.direccionFrecuente.upsert({
        where: {
          empresaId_textoNormalizado: {
            empresaId: p.empresaId,
            textoNormalizado,
          },
        },
        create: {
          empresaId: p.empresaId,
          texto: p.texto.trim(),
          textoNormalizado,
          referencia: p.referencia ?? null,
          distrito: p.distrito ?? null,
          lat: p.lat,
          lon: p.lon,
          telefonoCliente: p.telefono ?? null,
        },
        update: {
          usos: { increment: 1 },
          ultimoUsoEn: new Date(),
          lat: p.lat,
          lon: p.lon,
          ...(p.referencia ? { referencia: p.referencia } : {}),
          ...(p.distrito ? { distrito: p.distrito } : {}),
          ...(p.telefono ? { telefonoCliente: p.telefono } : {}),
        },
      });
    } catch (e: any) {
      this.logger.warn(`registrarDireccionFrecuente: ${e?.message}`);
    }
  }

  /**
   * Fase 2: geocodificación con Google como FALLBACK cuando la base propia
   * no matchea. La llamada sale del BACKEND con key restringida por IP del
   * VPS — nunca viaja en el APK. El botón del picker dispara UNA llamada
   * por búsqueda (sin autocomplete): 10K gratis/mes + cuota diaria dura en
   * Google Cloud. Lo que el usuario confirme aterriza en DireccionFrecuente
   * (dato propio, almacenable sin límite).
   */
  /**
   * Resuelve un enlace ACORTADO de Google Maps a coordenadas.
   *
   * Lo consume la app cuando el cliente comparte su ubicación por WhatsApp
   * y el enlace viene como `maps.app.goo.gl/...`: ahí las coordenadas no
   * están en la URL, solo aparecen al seguir la redirección.
   */
  async resolverEnlaceUbicacion(url: string) {
    const limpia = (url ?? '').trim();
    if (!esEnlaceAcortado(limpia)) {
      throw new BadRequestException(
        'El enlace no es un acortador de Google Maps',
      );
    }
    try {
      const { lat, lon } = await resolverEnlaceAcortado(limpia);
      return { lat, lon };
    } catch (e: any) {
      if (e instanceof EnlaceMapsError) {
        this.logger.warn(`Resolver enlace Maps: ${e.message}`);
        throw new BadRequestException(e.message);
      }
      this.logger.warn(`Resolver enlace Maps error: ${e?.message}`);
      throw new BadRequestException('No se pudo resolver el enlace');
    }
  }

  // ── Subasta de ofertas (estilo inDrive) ──

  /** Ventana de vida de una oferta. Vieja = el repartidor ya puede estar ocupado. */
  private static readonly OFERTA_MINUTOS = 10;

  /** Filtro reusable: PENDIENTE **y** todavía no vencida. */
  private static ofertaVigente() {
    return {
      estado: EstadoOfertaDelivery.PENDIENTE,
      expiraEn: { gt: new Date() },
    };
  }

  /**
   * El repartidor propone su precio. Re-ofertar PISA la anterior (upsert por
   * el único `deliveryId+repartidorId`) y renueva el vencimiento.
   */
  async ofertar(
    usuarioId: string,
    deliveryId: string,
    monto: number,
    comentario?: string,
  ) {
    if (!(monto > 0)) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    const delivery = await this.prisma.deliveryLocal.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        empresaId: true,
        estado: true,
        modoOferta: true,
        esInterno: true,
        distrito: true,
        direccion: true,
      },
    });
    if (!delivery) throw new NotFoundException('Delivery no encontrado');
    if (delivery.esInterno) {
      throw new ForbiddenException('Este pedido lo lleva la empresa');
    }
    if (!delivery.modoOferta) {
      throw new BadRequestException(
        'Este pedido no admite ofertas: tiene tarifa fija, tómalo directo',
      );
    }
    if (delivery.estado !== EstadoDeliveryLocal.SOLICITADO) {
      throw new ConflictException('El pedido ya no está disponible');
    }

    // Mismas puertas que para tomar: aprobado, con celular verificado, la
    // empresa con opt-in y el destino dentro de sus zonas.
    const rep = await this.verificarFreelance(usuarioId);
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: delivery.empresaId },
      select: { aceptaRepartidoresExternos: true },
    });
    if (!empresa?.aceptaRepartidoresExternos) {
      throw new ForbiddenException(
        'Esta empresa no trabaja con repartidores externos',
      );
    }
    if (
      !DeliveryLocalService.zonaCoincide(
        rep.zonas,
        delivery.distrito,
        delivery.direccion,
      )
    ) {
      throw new ForbiddenException('Este pedido está fuera de tus zonas');
    }

    const expiraEn = new Date(
      Date.now() + DeliveryLocalService.OFERTA_MINUTOS * 60_000,
    );
    const oferta = await this.prisma.ofertaDelivery.upsert({
      where: {
        deliveryId_repartidorId: { deliveryId, repartidorId: usuarioId },
      },
      create: {
        deliveryId,
        repartidorId: usuarioId,
        monto,
        comentario: comentario ?? null,
        expiraEn,
      },
      update: {
        monto,
        comentario: comentario ?? null,
        // Re-ofertar revive una RECHAZADA/RETIRADA anterior.
        estado: EstadoOfertaDelivery.PENDIENTE,
        expiraEn,
        resueltoEn: null,
      },
    });

    void this.avisarStaff(
      delivery.empresaId,
      '💸 Nueva oferta de reparto',
      `${rep.nombreCompleto} ofertó S/ ${monto.toFixed(2)} para ${
        delivery.distrito ?? delivery.direccion
      }. Vence en ${DeliveryLocalService.OFERTA_MINUTOS} min.`,
    );

    return oferta;
  }

  /** El repartidor se baja de la subasta. */
  async retirarOferta(usuarioId: string, deliveryId: string) {
    const r = await this.prisma.ofertaDelivery.updateMany({
      where: {
        deliveryId,
        repartidorId: usuarioId,
        estado: EstadoOfertaDelivery.PENDIENTE,
      },
      data: {
        estado: EstadoOfertaDelivery.RETIRADA,
        resueltoEn: new Date(),
      },
    });
    if (r.count === 0) {
      throw new NotFoundException('No tienes una oferta activa en ese pedido');
    }
    return { retirada: true };
  }

  /** Ofertas VIGENTES de un pedido (staff), de la más barata a la más cara. */
  async ofertasDe(empresaId: string, usuarioId: string, deliveryId: string) {
    await this.verificarStaff(empresaId, usuarioId);
    const ofertas = await this.prisma.ofertaDelivery.findMany({
      where: { deliveryId, ...DeliveryLocalService.ofertaVigente() },
      orderBy: { monto: 'asc' },
    });
    if (ofertas.length === 0) return [];

    // El nombre y las entregas completadas viven en el perfil freelance —
    // el staff necesita ambos para decidir, no solo el precio.
    const perfiles = await this.prisma.repartidorSyncronize.findMany({
      where: { usuarioId: { in: ofertas.map((o) => o.repartidorId) } },
      select: {
        usuarioId: true,
        nombreCompleto: true,
        entregasCompletadas: true,
      },
    });
    const porUsuario = new Map(perfiles.map((p) => [p.usuarioId, p]));
    return ofertas.map((o) => ({
      ...o,
      repartidorNombre: porUsuario.get(o.repartidorId)?.nombreCompleto ?? null,
      entregasCompletadas:
        porUsuario.get(o.repartidorId)?.entregasCompletadas ?? 0,
    }));
  }

  /**
   * La empresa elige una oferta: asigna el pedido, fija el costo acordado y
   * cierra la subasta. El resto de las ofertas quedan RECHAZADAS.
   *
   * La asignación va condicionada a SOLICITADO + sin repartidor, igual que
   * `tomar`: si alguien lo tomó en el medio, esto no pisa nada.
   */
  async aceptarOferta(empresaId: string, usuarioId: string, ofertaId: string) {
    await this.verificarStaff(empresaId, usuarioId);

    const oferta = await this.prisma.ofertaDelivery.findUnique({
      where: { id: ofertaId },
      include: { delivery: { select: { id: true, empresaId: true } } },
    });
    if (!oferta || oferta.delivery.empresaId !== empresaId) {
      throw new NotFoundException('Oferta no encontrada');
    }
    if (oferta.estado !== EstadoOfertaDelivery.PENDIENTE) {
      throw new ConflictException('Esa oferta ya no está vigente');
    }
    // El vencimiento no lo marca ningún job: se revalida acá.
    if (oferta.expiraEn.getTime() <= Date.now()) {
      throw new ConflictException(
        'Esa oferta venció — pídele al repartidor que la renueve',
      );
    }

    const asignado = await this.prisma.deliveryLocal.updateMany({
      where: {
        id: oferta.deliveryId,
        estado: EstadoDeliveryLocal.SOLICITADO,
        repartidorId: null,
      },
      data: {
        estado: EstadoDeliveryLocal.TOMADO,
        repartidorId: oferta.repartidorId,
        costoDelivery: oferta.monto,
        modoOferta: false,
        tomadoEn: new Date(),
      },
    });
    if (asignado.count === 0) {
      throw new ConflictException('El pedido ya no está disponible');
    }

    const ahora = new Date();
    await this.prisma.$transaction([
      this.prisma.ofertaDelivery.update({
        where: { id: ofertaId },
        data: { estado: EstadoOfertaDelivery.ACEPTADA, resueltoEn: ahora },
      }),
      this.prisma.ofertaDelivery.updateMany({
        where: {
          deliveryId: oferta.deliveryId,
          id: { not: ofertaId },
          estado: EstadoOfertaDelivery.PENDIENTE,
        },
        data: { estado: EstadoOfertaDelivery.RECHAZADA, resueltoEn: ahora },
      }),
    ]);

    const delivery = await this.cargar(oferta.deliveryId);
    void this.notificaciones
      .enviarAUsuarios(
        [oferta.repartidorId],
        '✅ Te asignaron el pedido',
        `Aceptaron tu oferta de S/ ${Number(oferta.monto).toFixed(2)} — ` +
          `${delivery.direccion}. Pasa a recogerlo.`,
        { tipo: 'SISTEMA', empresaId },
      )
      .catch((e) =>
        this.logger.warn(`Aviso de oferta aceptada: ${(e as Error).message}`),
      );
    void this.avisarCliente(
      delivery,
      `🛵 ¡Tu pedido ${delivery.venta?.codigo ?? ''} ya tiene repartidor asignado! ` +
        'Te aviso cuando esté en camino.\n' +
        `Sigue tu pedido aquí: ${this.urlTracking(delivery.trackingToken)}`,
    );
    return delivery;
  }

  /** Staff con permiso de delivery, para avisos de la subasta. */
  private async avisarStaff(empresaId: string, titulo: string, cuerpo: string) {
    try {
      const staff = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId,
          rol: { in: [Rol.EMPRESA_ADMIN, Rol.SEDE_ADMIN, Rol.VENDEDOR] },
          isActive: true,
          deletedAt: null,
        },
        select: { usuarioId: true },
      });
      if (staff.length === 0) return;
      await this.notificaciones.enviarAUsuarios(
        [...new Set(staff.map((x) => x.usuarioId))],
        titulo,
        cuerpo,
        { tipo: 'SISTEMA', empresaId, data: { tipo: 'OFERTA_DELIVERY' } },
      );
    } catch (e) {
      this.logger.warn(`avisarStaff: ${(e as Error).message}`);
    }
  }

  // ── Catálogo de ubigeo (selector de zonas del repartidor) ──

  private _ubigeoCache: UbigeoFila[] | null = null;

  /**
   * Catálogo estático de 1892 distritos. Se lee del disco una sola vez.
   *
   * ⚠️ El archivo llega a `dist/` porque está listado en los `assets` de
   * `nest-cli.json`. Si se mueve o renombra, actualizar ahí también o en
   * produccion explota con ENOENT.
   */
  private get ubigeo(): UbigeoFila[] {
    if (!this._ubigeoCache) {
      const ruta = path.join(__dirname, 'ubigeos-peru.json');
      this._ubigeoCache = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
    }
    return this._ubigeoCache!;
  }

  /**
   * Los tres niveles salen del MISMO archivo por prefijo del código: 2
   * dígitos = departamento, 4 = provincia, 6 = distrito. Por eso no hace
   * falta ninguna tabla de jerarquía.
   */
  ubigeoDepartamentos() {
    const m = new Map<string, string>();
    for (const f of this.ubigeo) m.set(f.ubigeo.slice(0, 2), f.departamento);
    return [...m].map(([codigo, nombre]) => ({ codigo, nombre })).sort(porNombre);
  }

  ubigeoProvincias(departamento?: string) {
    const pref = (departamento ?? '').trim();
    if (!/^\d{2}$/.test(pref)) {
      throw new BadRequestException('departamento debe ser el código de 2 dígitos');
    }
    const m = new Map<string, string>();
    for (const f of this.ubigeo) {
      if (f.ubigeo.startsWith(pref)) m.set(f.ubigeo.slice(0, 4), f.provincia);
    }
    return [...m].map(([codigo, nombre]) => ({ codigo, nombre })).sort(porNombre);
  }

  ubigeoDistritos(provincia?: string) {
    const pref = (provincia ?? '').trim();
    if (!/^\d{4}$/.test(pref)) {
      throw new BadRequestException('provincia debe ser el código de 4 dígitos');
    }
    return this.ubigeo
      .filter((f) => f.ubigeo.startsWith(pref))
      .map((f) => ({ codigo: f.ubigeo, nombre: f.distrito }))
      .sort(porNombre);
  }

  async geocodificarGoogle(q?: string) {
    const key = process.env.GOOGLE_GEOCODING_API_KEY;
    if (!key) {
      throw new BadRequestException(
        'Búsqueda con Google no configurada (falta GOOGLE_GEOCODING_API_KEY)',
      );
    }
    const query = (q ?? '').trim();
    if (query.length < 3) return { resultados: [] };

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', query);
    url.searchParams.set('key', key);
    url.searchParams.set('region', 'pe');
    url.searchParams.set('language', 'es');
    url.searchParams.set('components', 'country:PE');

    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body: any = await r.json();
      if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
        // OVER_QUERY_LIMIT / REQUEST_DENIED / etc: visible para diagnóstico.
        this.logger.warn(
          `Geocoding Google ${body.status}: ${body.error_message ?? ''}`,
        );
        throw new BadRequestException(`Google Geocoding: ${body.status}`);
      }
      const resultados = ((body.results ?? []) as any[])
        .slice(0, 5)
        .map((res) => ({
          nombre: String(res.formatted_address ?? ''),
          lat: Number(res.geometry?.location?.lat),
          lon: Number(res.geometry?.location?.lng),
        }))
        .filter(
          (x) => x.nombre && Number.isFinite(x.lat) && Number.isFinite(x.lon),
        );
      return { resultados };
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      this.logger.warn(`Geocoding Google error: ${e?.message}`);
      throw new BadRequestException('No se pudo consultar Google');
    }
  }

  /**
   * Búsqueda del picker: direcciones recientes del CLIENTE (por celular) +
   * coincidencias por trigram/ILIKE rankeadas por similitud y usos.
   */
  async buscarDirecciones(empresaId: string, q?: string, telefono?: string) {
    const qNorm = this.normalizarDireccion(q ?? '');
    const [delCliente, coincidencias] = await Promise.all([
      telefono?.trim()
        ? this.prisma.direccionFrecuente.findMany({
            where: { empresaId, telefonoCliente: telefono.trim() },
            orderBy: { ultimoUsoEn: 'desc' },
            take: 3,
          })
        : Promise.resolve([]),
      qNorm.length >= 3
        ? this.prisma.$queryRaw<any[]>`
            SELECT id, texto, referencia, distrito, lat, lon, usos
            FROM "DireccionFrecuente"
            WHERE "empresaId" = ${empresaId}
              AND ("textoNormalizado" ILIKE ${'%' + qNorm + '%'}
                   OR similarity("textoNormalizado", ${qNorm}) > 0.3)
            ORDER BY ("textoNormalizado" ILIKE ${'%' + qNorm + '%'}) DESC,
                     similarity("textoNormalizado", ${qNorm}) DESC,
                     usos DESC
            LIMIT 8`
        : Promise.resolve([]),
    ]);

    // Decimal serializa como string en JSON → convertir a número.
    const mapear = (d: any) => ({
      id: d.id,
      texto: d.texto,
      referencia: d.referencia ?? null,
      distrito: d.distrito ?? null,
      lat: Number(d.lat),
      lon: Number(d.lon),
      usos: Number(d.usos ?? 0),
    });
    return {
      delCliente: (delCliente as any[]).map(mapear),
      coincidencias: (coincidencias as any[]).map(mapear),
    };
  }

  /** Pool de deliveries SOLICITADOS (visibles para tomar). */
  async disponibles(empresaId: string, userId: string, sedeId?: string) {
    await this.verificarRepartidor(empresaId, userId);
    return this.prisma.deliveryLocal.findMany({
      where: {
        empresaId,
        estado: EstadoDeliveryLocal.SOLICITADO,
        esInterno: false, // los internos los lleva un empleado — no al pool
        ...(sedeId ? { sedeId } : {}),
      },
      include: { venta: { select: { codigo: true } } },
      orderBy: { creadoEn: 'asc' },
    });
  }

  /**
   * TOMAR un delivery — ATÓMICO: updateMany condicionado a SOLICITADO sin
   * repartidor; si otro lo ganó un milisegundo antes, count=0 y 409.
   */
  async tomar(empresaId: string, deliveryId: string, userId: string) {
    await this.verificarRepartidor(empresaId, userId);
    if (!deliveryId) throw new BadRequestException('deliveryId obligatorio');

    const r = await this.prisma.deliveryLocal.updateMany({
      where: {
        id: deliveryId,
        empresaId,
        estado: EstadoDeliveryLocal.SOLICITADO,
        repartidorId: null,
        esInterno: false, // interno = lo lleva un empleado, no se toma
      },
      data: {
        estado: EstadoDeliveryLocal.TOMADO,
        repartidorId: userId,
        tomadoEn: new Date(),
      },
    });
    if (r.count === 0) {
      throw new ConflictException(
        'DELIVERY_YA_TOMADO: otro repartidor lo tomó primero (o ya no está disponible)',
      );
    }

    const delivery = await this.cargar(deliveryId);
    void this.avisarCliente(
      delivery,
      `🛵 ¡Tu pedido ${delivery.venta?.codigo ?? ''} ya tiene repartidor asignado! ` +
        'Te aviso cuando esté en camino.\n' +
        `Sigue tu pedido aquí: ${this.urlTracking(delivery.trackingToken)}`,
    );
    return delivery;
  }

  /** El repartidor asignado sale hacia el destino. Aquí nace el PIN de
   *  entrega: viaja SOLO al cliente — el repartidor jamás lo ve. */
  async marcarEnCamino(empresaId: string, deliveryId: string, userId: string) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const delivery = await this.transicionDeRepartidor(
      empresaId,
      deliveryId,
      userId,
      [EstadoDeliveryLocal.TOMADO],
      EstadoDeliveryLocal.EN_CAMINO,
      { enCaminoEn: new Date(), pinEntrega: pin },
    );
    const costo = Number(delivery.costoDelivery);
    void this.avisarCliente(
      delivery,
      `🛵 ¡Tu pedido ${delivery.venta?.codigo ?? ''} va en camino a tu dirección!` +
        (costo > 0
          ? ` Al recibirlo, paga S/ ${costo.toFixed(2)} del delivery al repartidor.`
          : '') +
        `\n🔐 Tu código de entrega es *${pin}* — dáselo al repartidor SOLO al recibir tu pedido.` +
        `\n📍 Míralo EN VIVO en el mapa: ${this.urlTracking(delivery.trackingToken)}`,
    );
    return delivery;
  }

  /**
   * Entregado (el repartidor cobró su tarifa en la puerta). PRUEBA DE
   * ENTREGA: el PIN lo tiene SOLO el cliente — si el delivery tiene PIN
   * (todo EN_CAMINO nuevo lo tiene), es obligatorio y debe coincidir.
   * Además ENTREGADO solo se llega desde EN_CAMINO (sin atajos que
   * esquiven el PIN ni el GPS).
   */
  async marcarEntregado(
    empresaId: string,
    deliveryId: string,
    userId: string,
    pin?: string,
  ) {
    if (!deliveryId || !empresaId) {
      throw new BadRequestException('empresaId y deliveryId son obligatorios');
    }
    const previo = await this.prisma.deliveryLocal.findFirst({
      where: { id: deliveryId, empresaId },
      select: { pinEntrega: true },
    });
    if (!previo) throw new NotFoundException('Delivery no encontrado');
    if (previo.pinEntrega && previo.pinEntrega !== (pin ?? '').trim()) {
      throw new BadRequestException(
        'PIN_INCORRECTO: pídele al cliente su código de entrega (le llegó ' +
          'por WhatsApp y está en su página de seguimiento)',
      );
    }
    const delivery = await this.transicionDeRepartidor(
      empresaId,
      deliveryId,
      userId,
      [EstadoDeliveryLocal.EN_CAMINO],
      EstadoDeliveryLocal.ENTREGADO,
      { entregadoEn: new Date() },
    );
    // Historial del freelance (updateMany = no-op si es repartidor de
    // empresa). El contador sube su límite de entregas simultáneas.
    void this.prisma.repartidorSyncronize
      .updateMany({
        where: { usuarioId: userId },
        data: { entregasCompletadas: { increment: 1 } },
      })
      .catch(() => undefined);
    void this.avisarCliente(
      delivery,
      `✅ ¡Pedido ${delivery.venta?.codigo ?? ''} entregado! Gracias por tu compra 🙌`,
    );
    return delivery;
  }

  /** Cancelación por staff (no aplica a ENTREGADO). Avisa al repartidor si tenía. */
  async cancelar(userId: string, deliveryId: string, dto: CancelarDeliveryDto) {
    await this.verificarStaff(dto.empresaId, userId);
    if (!deliveryId) throw new BadRequestException('deliveryId obligatorio');

    const previo = await this.prisma.deliveryLocal.findFirst({
      where: { id: deliveryId, empresaId: dto.empresaId },
      select: { repartidorId: true },
    });
    const r = await this.prisma.deliveryLocal.updateMany({
      where: {
        id: deliveryId,
        empresaId: dto.empresaId,
        estado: {
          in: [
            EstadoDeliveryLocal.SOLICITADO,
            EstadoDeliveryLocal.TOMADO,
            EstadoDeliveryLocal.EN_CAMINO,
          ],
        },
      },
      data: {
        estado: EstadoDeliveryLocal.CANCELADO,
        canceladoEn: new Date(),
        motivoCancelacion: dto.motivo ?? null,
      },
    });
    if (r.count === 0) {
      throw new ConflictException('El delivery no existe o ya está cerrado');
    }
    if (previo?.repartidorId) {
      void this.notificaciones
        .enviarAUsuarios(
          [previo.repartidorId],
          '🚫 Delivery cancelado',
          dto.motivo ?? 'La empresa canceló la entrega',
          { tipo: 'SISTEMA', empresaId: dto.empresaId },
        )
        .catch((e) =>
          this.logger.warn(`Aviso cancelación: ${(e as Error).message}`),
        );
    }
    return this.cargar(deliveryId);
  }

  // ── Pool EXTERNO (repartidores freelance de Syncronize, R1) ──

  /** Freelance APROBADO y con celular VERIFICADO — o fuera. El doble
   *  candado vive AQUÍ (no solo en la UI): aprobar en el admin no basta
   *  si nunca demostró que el celular es suyo (OTP). */
  private async verificarFreelance(usuarioId: string) {
    if (!usuarioId) throw new BadRequestException('usuario obligatorio');
    const rep = await this.prisma.repartidorSyncronize.findUnique({
      where: { usuarioId },
    });
    if (!rep || rep.estado !== EstadoRepartidorSyncronize.APROBADO) {
      throw new ForbiddenException(
        'No eres repartidor aprobado de Syncronize',
      );
    }
    if (!rep.celularVerificado) {
      throw new ForbiddenException(
        'Verifica tu celular (código de WhatsApp) para empezar a tomar pedidos',
      );
    }
    return rep;
  }

  private static normalizarZona(z: string): string {
    return z
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }

  /**
   * Normaliza y deja el texto listo para buscar PALABRAS COMPLETAS: la
   * puntuación pasa a espacio y el resultado va envuelto en espacios, para
   * que `includes(' lima ')` no matchee dentro de "salimas".
   */
  private static tokenizarZona(texto: string): string {
    return ` ${DeliveryLocalService.normalizarZona(texto)
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()} `;
  }

  /**
   * ¿Alguna zona declarada por el repartidor aparece en el destino?
   *
   * Compara por CONTENCIÓN contra `distrito` + `direccion`, no por
   * igualdad. El motivo es real: el geocoder autocompleta el distrito con
   * el nivel más granular que encuentra (el barrio, "MIRAMAR") mientras el
   * repartidor declara el distrito o la provincia ("TRUJILLO"). Con
   * igualdad exacta ese pedido no lo veía NADIE, aunque la dirección
   * completa —"MIRAMAR, SALAVERRY, TRUJILLO"— contiene ambos niveles.
   */
  private static zonaCoincide(
    zonas: string[],
    distrito?: string | null,
    direccion?: string | null,
  ): boolean {
    const heno = DeliveryLocalService.tokenizarZona(
      [distrito, direccion].filter(Boolean).join(' '),
    );
    return zonas.some((z) => {
      const aguja = DeliveryLocalService.tokenizarZona(z).trim();
      return aguja.length > 0 && heno.includes(` ${aguja} `);
    });
  }

  /**
   * Pool del freelance: deliveries SOLICITADOS de empresas con OPT-IN,
   * en SUS zonas, y que no superen el tope de mercadería que cada
   * empresa confía a externos. Sin zonas declaradas → pool vacío.
   */
  async poolExterno(usuarioId: string) {
    const rep = await this.verificarFreelance(usuarioId);
    const zonas = rep.zonas;
    if (zonas.length === 0) return [];

    const empresas = await this.prisma.empresa.findMany({
      where: { aceptaRepartidoresExternos: true, isActive: true },
      select: { id: true, nombre: true, montoMaxDeliveryExterno: true },
    });
    if (empresas.length === 0) return [];

    const deliveries = await this.prisma.deliveryLocal.findMany({
      where: {
        empresaId: { in: empresas.map((e) => e.id) },
        estado: EstadoDeliveryLocal.SOLICITADO,
        esInterno: false, // los internos los lleva un empleado — no al pool
      },
      include: { venta: { select: { codigo: true, total: true } } },
      orderBy: { creadoEn: 'asc' },
    });

    // Ofertas vigentes propias, para marcar en el pool cuáles ya oferté.
    const propias = await this.prisma.ofertaDelivery.findMany({
      where: {
        repartidorId: usuarioId,
        deliveryId: { in: deliveries.map((d) => d.id) },
        ...DeliveryLocalService.ofertaVigente(),
      },
      select: { deliveryId: true, monto: true, expiraEn: true },
    });
    const mias = new Map(propias.map((o) => [o.deliveryId, o]));

    const topes = new Map(
      empresas.map((e) => [
        e.id,
        e.montoMaxDeliveryExterno != null
          ? Number(e.montoMaxDeliveryExterno)
          : null,
      ]),
    );
    const nombres = new Map(empresas.map((e) => [e.id, e.nombre]));

    return deliveries
      .filter((d) =>
        DeliveryLocalService.zonaCoincide(zonas, d.distrito, d.direccion),
      )
      .filter((d) => {
        const tope = topes.get(d.empresaId);
        if (tope == null) return true;
        const total = d.venta?.total != null ? Number(d.venta.total) : null;
        return total == null || total <= tope;
      })
      .map((d) => ({
        ...d,
        empresaNombre: nombres.get(d.empresaId) ?? null,
        // El repartidor tiene que saber si le toca ofertar o puede tomarlo
        // directo, y si ya ofertó (para no ofertar dos veces sin darse cuenta).
        miOferta:
          mias.get(d.id) != null
            ? {
                monto: mias.get(d.id)!.monto,
                expiraEn: mias.get(d.id)!.expiraEn,
              }
            : null,
      }));
  }

  /**
   * Toma de un freelance: además de la atomicidad, valida opt-in de la
   * empresa, zona, tope de mercadería y LÍMITE de entregas activas por
   * historial (<10 completadas → 1 a la vez; luego 3).
   */
  async tomarExterno(deliveryId: string, usuarioId: string) {
    const rep = await this.verificarFreelance(usuarioId);
    if (!deliveryId) throw new BadRequestException('deliveryId obligatorio');

    const delivery = await this.prisma.deliveryLocal.findUnique({
      where: { id: deliveryId },
      include: { venta: { select: { total: true } } },
    });
    if (!delivery) throw new NotFoundException('Delivery no encontrado');
    if (delivery.esInterno) {
      throw new ForbiddenException('Este delivery lo lleva la propia empresa');
    }
    // En subasta no se toma directo: el primero que aceptara el precio base
    // ganaría siempre y la subasta no ocurriría nunca.
    if (delivery.modoOferta) {
      throw new BadRequestException(
        'Este pedido se asigna por oferta: propón tu precio',
      );
    }

    const empresa = await this.prisma.empresa.findUnique({
      where: { id: delivery.empresaId },
      select: { aceptaRepartidoresExternos: true, montoMaxDeliveryExterno: true },
    });
    if (!empresa?.aceptaRepartidoresExternos) {
      throw new ForbiddenException(
        'Esta empresa no trabaja con repartidores externos',
      );
    }
    if (
      !DeliveryLocalService.zonaCoincide(
        rep.zonas,
        delivery.distrito,
        delivery.direccion,
      )
    ) {
      throw new ForbiddenException('Este pedido está fuera de tus zonas');
    }
    const tope =
      empresa.montoMaxDeliveryExterno != null
        ? Number(empresa.montoMaxDeliveryExterno)
        : null;
    const total =
      delivery.venta?.total != null ? Number(delivery.venta.total) : null;
    if (tope != null && total != null && total > tope) {
      throw new ForbiddenException(
        'El valor del pedido supera el tope para repartidores externos',
      );
    }
    const maxActivas = rep.entregasCompletadas < 10 ? 1 : 3;
    const activas = await this.prisma.deliveryLocal.count({
      where: {
        repartidorId: usuarioId,
        estado: {
          in: [EstadoDeliveryLocal.TOMADO, EstadoDeliveryLocal.EN_CAMINO],
        },
      },
    });
    if (activas >= maxActivas) {
      throw new ConflictException(
        `Ya tienes ${activas} entrega(s) activa(s) — completa antes de tomar otra`,
      );
    }

    const r = await this.prisma.deliveryLocal.updateMany({
      where: {
        id: deliveryId,
        estado: EstadoDeliveryLocal.SOLICITADO,
        repartidorId: null,
        esInterno: false,
      },
      data: {
        estado: EstadoDeliveryLocal.TOMADO,
        repartidorId: usuarioId,
        tomadoEn: new Date(),
      },
    });
    if (r.count === 0) {
      throw new ConflictException(
        'DELIVERY_YA_TOMADO: otro repartidor lo tomó primero (o ya no está disponible)',
      );
    }

    const cargado = await this.cargar(deliveryId);
    const nombreCorto = rep.nombreCompleto.split(' ')[0];
    void this.avisarCliente(
      cargado,
      `🛵 ¡Tu pedido ${cargado.venta?.codigo ?? ''} ya tiene repartidor ` +
        `asignado (${nombreCorto}, repartidor Syncronize)! Te aviso cuando ` +
        'esté en camino.\n' +
        `Sigue tu pedido aquí: ${this.urlTracking(cargado.trackingToken)}`,
    );
    return cargado;
  }

  /** Entregas del freelance (cruzan empresas — filtro solo por él). */
  async misEntregasFreelance(usuarioId: string) {
    await this.verificarFreelance(usuarioId);
    return this.prisma.deliveryLocal.findMany({
      where: { repartidorId: usuarioId },
      include: { venta: { select: { codigo: true } } },
      orderBy: { actualizadoEn: 'desc' },
      take: 50,
    });
  }

  /**
   * GPS en vivo: el repartidor asignado reporta su posición mientras va
   * EN_CAMINO. Escritura condicionada (dueño + estado) — cualquier otra
   * combinación simplemente no matchea (count 0, sin error: el teléfono
   * puede reportar un instante después de entregar y no es un fallo).
   */
  async reportarPosicion(
    empresaId: string,
    deliveryId: string,
    userId: string,
    lat: number,
    lon: number,
  ): Promise<{ ok: boolean }> {
    if (!empresaId || !deliveryId || !userId) {
      throw new BadRequestException('empresaId y deliveryId son obligatorios');
    }
    const r = await this.prisma.deliveryLocal.updateMany({
      where: {
        id: deliveryId,
        empresaId,
        repartidorId: userId,
        estado: EstadoDeliveryLocal.EN_CAMINO,
      },
      data: { ultimaPosicion: { lat, lon }, posicionEn: new Date() },
    });
    return { ok: r.count > 0 };
  }

  /** Entregas del repartidor autenticado (activas primero, últimas 50). */
  async misEntregas(empresaId: string, userId: string) {
    await this.verificarRepartidor(empresaId, userId);
    return this.prisma.deliveryLocal.findMany({
      where: { empresaId, repartidorId: userId },
      include: { venta: { select: { codigo: true } } },
      orderBy: { actualizadoEn: 'desc' },
      take: 50,
    });
  }

  /**
   * Seguimiento PÚBLICO por token (sin login) — el cliente recibe el link.
   * Devuelve solo lo que el cliente ya sabe: su pedido, estados y tarifa.
   */
  async tracking(token: string) {
    if (!token) throw new BadRequestException('token obligatorio');
    const d = await this.prisma.deliveryLocal.findUnique({
      where: { trackingToken: token },
      include: { venta: { select: { codigo: true } } },
    });
    if (!d) throw new NotFoundException('Seguimiento no encontrado');
    return {
      codigo: d.venta?.codigo ?? null,
      estado: d.estado,
      costoDelivery: d.costoDelivery,
      creadoEn: d.creadoEn,
      tomadoEn: d.tomadoEn,
      enCaminoEn: d.enCaminoEn,
      entregadoEn: d.entregadoEn,
      canceladoEn: d.canceladoEn,
      // Código de entrega: el cliente lo ve mientras espera (esta página
      // es SUYA — llega por el token secreto del WhatsApp).
      pinEntrega:
        d.estado === EstadoDeliveryLocal.EN_CAMINO ? d.pinEntrega : null,
      // Posición del repartidor SOLO mientras va en camino (privacidad:
      // fuera de la entrega activa jamás se expone dónde está).
      posicion:
        d.estado === EstadoDeliveryLocal.EN_CAMINO && d.ultimaPosicion
          ? { ...(d.ultimaPosicion as object), en: d.posicionEn }
          : null,
      // Coordenadas del destino (si el pedido las trae — F2 bot/WhatsApp).
      destino: d.coordenadas ?? null,
    };
  }

  // ── Helpers ──

  /** Link público de seguimiento (página web con timeline + mapa en vivo). */
  private urlTracking(token: string): string {
    const base = process.env.WEB_PUBLIC_URL ?? 'https://syncronize.net.pe';
    return `${base}/tracking/${token}`;
  }

  private cargar(deliveryId: string) {
    return this.prisma.deliveryLocal.findUniqueOrThrow({
      where: { id: deliveryId },
      include: { venta: { select: { codigo: true } } },
    });
  }

  /**
   * Transición hecha por el REPARTIDOR ASIGNADO — atómica: el where exige
   * repartidorId=userId y un estado de origen válido; otro usuario u otro
   * estado → count=0 → 409. (verificarRepartidor va implícito: si no está
   * asignado, el where no matchea.)
   */
  private async transicionDeRepartidor(
    empresaId: string,
    deliveryId: string,
    userId: string,
    desde: EstadoDeliveryLocal[],
    hacia: EstadoDeliveryLocal,
    marcas: Record<string, Date | string>,
  ) {
    if (!deliveryId || !userId || !empresaId) {
      throw new BadRequestException('empresaId, deliveryId y usuario son obligatorios');
    }
    const r = await this.prisma.deliveryLocal.updateMany({
      where: {
        id: deliveryId,
        empresaId,
        repartidorId: userId,
        estado: { in: desde },
      },
      data: { estado: hacia, ...marcas },
    });
    if (r.count === 0) {
      throw new ConflictException(
        'TRANSICION_INVALIDA: el delivery no está asignado a ti o su estado no lo permite',
      );
    }
    return this.cargar(deliveryId);
  }

  /** Push FCM a todos los repartidores activos de la empresa. Best-effort. */
  private async avisarRepartidores(empresaId: string, cuerpo: string) {
    try {
      const reps = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId,
          rol: Rol.REPARTIDOR,
          isActive: true,
          deletedAt: null,
        },
        select: { usuarioId: true },
      });
      if (reps.length === 0) {
        this.logger.warn(
          `Delivery publicado sin repartidores activos (empresa ${empresaId})`,
        );
        return;
      }
      await this.notificaciones.enviarAUsuarios(
        reps.map((x) => x.usuarioId),
        '🛵 Nuevo delivery disponible',
        cuerpo,
        {
          tipo: 'SISTEMA',
          empresaId,
          data: { tipo: 'DELIVERY_DISPONIBLE' },
        },
      );
    } catch (e) {
      this.logger.warn(`Aviso a repartidores: ${(e as Error).message}`);
    }
  }

  /**
   * WhatsApp al cliente en cada transición — reusa la instancia Evolution de
   * la empresa. Best-effort: sin WhatsApp conectado o sin celular, silencio.
   */
  private async avisarCliente(
    d: { empresaId: string; destinatarioCelular: string | null },
    texto: string,
  ) {
    if (!d.destinatarioCelular) return;
    try {
      const iw = await this.prisma.integracionWhatsapp.findUnique({
        where: { empresaId: d.empresaId },
        select: { instanceName: true, estado: true, habilitado: true },
      });
      if (!iw?.habilitado || String(iw.estado) !== 'CONECTADO') return;
      await this.evolution.sendText({
        instanceName: iw.instanceName,
        number: d.destinatarioCelular,
        text: texto,
      });
    } catch (e) {
      this.logger.warn(`WhatsApp al cliente: ${(e as Error).message}`);
    }
  }
}
