import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EstadoDeliveryLocal, EstadoVenta, Rol } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { EvolutionApiService } from '../whatsapp/evolution-api.service';
import {
  CancelarDeliveryDto,
  SolicitarDeliveryDto,
} from './dto/delivery-local.dto';

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
        costoDelivery: costo,
      },
    });

    // Push a los repartidores de la empresa — best-effort, jamás rompe la solicitud.
    void this.avisarRepartidores(
      dto.empresaId,
      `${venta.codigo} para entregar en ${dto.distrito ?? dto.direccion}` +
        (costo > 0 ? ` — tarifa S/ ${costo.toFixed(2)}` : ''),
    );

    return delivery;
  }

  /** Pool de deliveries SOLICITADOS (visibles para tomar). */
  async disponibles(empresaId: string, userId: string, sedeId?: string) {
    await this.verificarRepartidor(empresaId, userId);
    return this.prisma.deliveryLocal.findMany({
      where: {
        empresaId,
        estado: EstadoDeliveryLocal.SOLICITADO,
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
        'Te aviso cuando esté en camino.',
    );
    return delivery;
  }

  /** El repartidor asignado sale hacia el destino. */
  async marcarEnCamino(empresaId: string, deliveryId: string, userId: string) {
    const delivery = await this.transicionDeRepartidor(
      empresaId,
      deliveryId,
      userId,
      [EstadoDeliveryLocal.TOMADO],
      EstadoDeliveryLocal.EN_CAMINO,
      { enCaminoEn: new Date() },
    );
    const costo = Number(delivery.costoDelivery);
    void this.avisarCliente(
      delivery,
      `🛵 ¡Tu pedido ${delivery.venta?.codigo ?? ''} va en camino a tu dirección!` +
        (costo > 0
          ? ` Al recibirlo, paga S/ ${costo.toFixed(2)} del delivery al repartidor.`
          : ''),
    );
    return delivery;
  }

  /** Entregado (el repartidor cobró su tarifa en la puerta). */
  async marcarEntregado(empresaId: string, deliveryId: string, userId: string) {
    const delivery = await this.transicionDeRepartidor(
      empresaId,
      deliveryId,
      userId,
      [EstadoDeliveryLocal.TOMADO, EstadoDeliveryLocal.EN_CAMINO],
      EstadoDeliveryLocal.ENTREGADO,
      { entregadoEn: new Date() },
    );
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
    };
  }

  // ── Helpers ──

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
    marcas: Record<string, Date>,
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
