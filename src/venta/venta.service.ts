import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { CajaService } from '../caja/caja.service';
import { ProductoComboService } from '../producto/producto-combo.service';
import {
  PrecioNivelService,
  VipPrecioContexto,
} from '../producto/precio-nivel.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { IntegracionYapeService } from '../integracion-yape/integracion-yape.service';
import { CaracteristicaEmpresaService } from '../caracteristica-empresa/caracteristica-empresa.service';
import { CaracteristicaPremium } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';
import { CacheService } from '../redis/cache.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import { CreateVentaDesdeCotizacionDto } from './dto/create-venta-desde-cotizacion.dto';
import { CrearYCobrarVentaDto } from './dto/crear-y-cobrar-venta.dto';
import { UpdateVentaDto } from './dto/update-venta.dto';
import { ProcesarPagoDto } from './dto/procesar-pago.dto';
import { CreateVentaDetalleDto } from './dto/create-venta-detalle.dto';
import {
  EstadoVenta,
  EstadoCotizacion,
  TipoMovimientoStock,
  MetodoPagoVenta,
  MotivoLiquidacion,
  Prisma,
  ReservaCotizacionEstado,
  Rol,
  TipoCalculoDescuento,
} from '@prisma/client';
import { FacturacionService } from '../sunat/facturacion.service';
import { OrdenServicioService } from '../servicio/orden-servicio.service';
import { validarDocumentoParaComprobante } from '../common/utils/documento-peru.util';
import { round2 } from '../common/utils/money.util';

/**
 * DTO interno enriquecido por `aplicarPreciosBackendNivel` con el snapshot
 * de costo y motivo de liquidación. Persiste a VentaDetalle como
 * precioCostoSnapshot/margenSnapshot/motivoLiquidacionSnapshot.
 */
type DetalleConSnapshot = CreateVentaDetalleDto & {
  precioCostoSnapshot: number;
  motivoLiquidacionSnapshot: MotivoLiquidacion | null;
  nivelAplicadoSnapshot: string | null;
  /** ID de la política VIP que fijó el precio de esta línea (null si no aplicó). */
  vipPoliticaId?: string | null;
  /** Precio base antes del precio especial VIP (para el historial de uso). */
  precioBaseVip?: number | null;
};

/**
 * Resolver de precio especial VIP de un cliente, construido una sola vez por
 * cobro. `resolver(productoId, varianteId)` devuelve TODAS las intenciones de
 * precio aplicables a la línea (el cliente puede estar en varias políticas);
 * el cálculo de precio elige el menor entre ellas (gana el menor). Lista vacía
 * si ninguna aplica.
 */
type ResolverVip = {
  resolver: (
    productoId: string | null,
    varianteId: string | null,
  ) => VipPrecioContexto[];
  politicasById: Map<
    string,
    { id: string; nombre: string; tipoCalculo: string; valorDescuento: unknown }
  >;
};

@Injectable()
export class VentaService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly configuracionCodigos: ConfiguracionCodigosService,
    @Inject(forwardRef(() => CajaService)) private readonly cajaService: CajaService,
    private readonly comboService: ProductoComboService,
    private readonly facturacionService: FacturacionService,
    private readonly ordenServicioService: OrdenServicioService,
    private readonly precioNivelService: PrecioNivelService,
    private readonly realtimeInvalidation: RealtimeInvalidationService,
    private readonly integracionYape: IntegracionYapeService,
    loggerService: AppLoggerService,
    private readonly caracteristicaEmpresa: CaracteristicaEmpresaService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(VentaService.name);
  }

  /**
   * Genera un cobro en api-yape para una venta YA creada (estado CONFIRMADA,
   * pendiente de pago). Devuelve el monto que el cliente debe pagar (payAmount).
   * Si la integración no está habilitada o api-yape no responde, devuelve
   * { habilitado: false } → la app cae al cobro MANUAL (con el screenshot del Yape).
   * NO marca la venta pagada: eso lo hace el webhook al confirmarse el pago.
   */
  async cobroYape(empresaId: string, ventaId: string, monto?: number) {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      select: {
        id: true,
        total: true,
        sedeId: true,
        estado: true,
        pagos: { select: { monto: true } },
      },
    });
    if (!venta) throw new NotFoundException('Venta no encontrada');

    // GATE PREMIUM: Yape/QR es una característica premium. Si la empresa no la
    // tiene habilitada (no activada por el super admin / trial vencido), NO se
    // ofrece ni el cobro api-yape ni el QR → el app cae a pago normal.
    const yapeHabilitado = await this.caracteristicaEmpresa.estaHabilitada(
      empresaId,
      CaracteristicaPremium.YAPE_QR,
    );
    if (!yapeHabilitado) {
      return { habilitado: false as const, qrYapeUrl: null, qrPlinUrl: null };
    }

    // QR de cobro (imagen estática del comercio) para mostrar en la hoja. Va en
    // ambos paths: incluso si api-yape no genera cobro (modo manual), el cliente
    // puede pagar escaneando el QR y el cajero confirma a mano.
    const cfgQr = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId },
      select: { qrYapeUrl: true, qrPlinUrl: true },
    });
    const qr = {
      qrYapeUrl: cfgQr?.qrYapeUrl ?? null,
      qrPlinUrl: cfgQr?.qrPlinUrl ?? null,
    };

    // Cobramos el PENDIENTE (total − pagos ya registrados), no el total. Para un
    // pago 100% Yape la venta nace sin pagos → pendiente = total. Para un pago
    // MIXTO (ej. efectivo + Yape) el efectivo ya se registró al crear la venta
    // → pendiente = solo la porción Yape, que es lo que api-yape debe validar.
    const pagado = venta.pagos.reduce((s, p) => s + Number(p.monto), 0);
    const pendiente = round2(Number(venta.total) - pagado);
    if (pendiente <= 0) {
      return { habilitado: false as const, ...qr };
    }

    // PAGOS DIVIDIDOS: si se pide un `monto` (tramo, ej. 500 de 1500), se crea
    // un charge por ese monto (cap al pendiente); cada tramo es un charge/QR
    // independiente que el cliente escanea por separado. Sin `monto` → cobra el
    // pendiente completo (pago único, comportamiento de siempre).
    const montoCobro =
      monto && monto > 0 ? Math.min(round2(monto), pendiente) : pendiente;

    const cobro = await this.integracionYape.crearCobro({
      empresaId,
      ventaId,
      monto: montoCobro,
    });
    if (!cobro) {
      return { habilitado: false as const, ...qr };
    }
    return {
      habilitado: true as const,
      payAmount: cobro.payAmount,
      chargeId: cobro.chargeId,
      ...qr,
    };
  }

  /**
   * Recalcula `precioUnitario` desde el backend usando los niveles de precio
   * configurados (PrecioNivel) en lugar de confiar en el valor enviado por el
   * cliente. Esto cierra el vector de manipulación: un cliente comprometido
   * podría enviar precios alterados, pero el backend siempre forzará el
   * precio correcto según producto/variante/cantidad/sede.
   *
   * Notas:
   * - Aplica a items con `productoId`, `varianteId` o `comboId` (los combos
   *   son `Producto`, así que su comboId sirve como productoId para niveles).
   * - Items que solo son `servicioId` o que no tienen producto se dejan tal
   *   cual (sin precio de niveles).
   * - El descuento manual del cajero va en el campo `descuento` aparte —
   *   no se afecta este recálculo.
   * - Si el cálculo falla (ej. producto sin precio configurado en sede),
   *   se respeta el del cliente como fallback y se logea warning.
   */
  private async aplicarPreciosBackendNivel(
    detalles: CreateVentaDetalleDto[],
    sedeId: string,
    vipResolver?: ResolverVip | null,
  ): Promise<DetalleConSnapshot[]> {
    const result: DetalleConSnapshot[] = [];

    /// Divergencias entre el precio que el cliente envió y el que el backend
    /// calcula. Si después del loop hay alguna, abortamos la venta con 409
    /// para que el cajero refresque y reintente. Esto cierra la discrepancia
    /// silenciosa de caja: antes el backend "corregía" el precio en el
    /// fondo y la diferencia salía a flote recién en el cierre de caja.
    const divergencias: Array<{
      descripcion: string;
      productoId?: string;
      varianteId?: string;
      comboId?: string;
      cantidad: number;
      precioCliente: number;
      precioServer: number;
      nivelAplicado: string | null;
    }> = [];

    for (const d of detalles) {
      const productoIdParaNivel = d.productoId ?? d.comboId ?? null;
      if (!productoIdParaNivel && !d.varianteId) {
        // Servicio puro o item sin producto — no aplica niveles ni snapshot.
        result.push({ ...d, precioCostoSnapshot: 0, motivoLiquidacionSnapshot: null, nivelAplicadoSnapshot: null });
        continue;
      }
      // Precio especial VIP: solo para líneas de producto/variante reales
      // (no combos ni componentes de combo, que tienen su propio deal). Puede
      // haber VARIAS políticas aplicables; el cálculo elige el menor precio.
      const vipCtxs =
        vipResolver && !d.origenComboId && !d.comboId
          ? vipResolver.resolver(d.productoId ?? null, d.varianteId ?? null)
          : [];
      try {
        const calc = await this.precioNivelService.calcularPrecioSegunCantidad(
          productoIdParaNivel,
          d.varianteId ?? null,
          sedeId,
          d.cantidad,
          // Componentes de combo: sin niveles por mayor (el combo es su
          // propio deal). Evita divergencia 409 al editar cantidades.
          { ignorarNiveles: !!d.origenComboId, vips: vipCtxs },
        );
        // Precio VIP FAVORABLE: si el backend aplicó un precio especial de
        // cliente que es ≤ al que envió el cliente, NO se rebota con 409. El
        // cliente puede no haberlo previsto (ej. alcance por categoría, que el
        // app no resuelve localmente); el backend aplica el precio VIP (más
        // barato) y la venta procede. No es manipulación: el cliente envió
        // IGUAL o MÁS. La manipulación (enviar menos que el precio real en
        // líneas sin VIP) sigue cubierta por el guard.
        const vipFavorable =
          calc.vipAplicado === true &&
          d.precioUnitario != null &&
          calc.precioUnitario <= d.precioUnitario + 0.01;
        if (
          d.precioUnitario != null &&
          !vipFavorable &&
          Math.abs(d.precioUnitario - calc.precioUnitario) > 0.01
        ) {
          divergencias.push({
            descripcion: d.descripcion,
            productoId: d.productoId,
            varianteId: d.varianteId,
            comboId: d.comboId,
            cantidad: d.cantidad,
            precioCliente: d.precioUnitario,
            precioServer: calc.precioUnitario,
            nivelAplicado: calc.nivelAplicado ?? null,
          });
        }
        result.push({
          ...d,
          precioUnitario: calc.precioUnitario,
          precioCostoSnapshot: calc.precioCosto ?? 0,
          motivoLiquidacionSnapshot:
            (calc.motivoLiquidacion as MotivoLiquidacion | null) ?? null,
          // Etiqueta del precio aplicado; null si fue precio base.
          // Componentes de combo expandido (origenComboId) van con precio
          // regular + descuento prorrateado del combo, NO con un nivel real:
          // su ahorro se traza por `descuento`/`origenComboId`, no por nivel.
          nivelAplicadoSnapshot:
            !d.origenComboId &&
            calc.nivelAplicado &&
            calc.nivelAplicado !== 'Precio base'
              ? calc.nivelAplicado
              : null,
          // Trazabilidad VIP para el historial de uso (solo si el precio VIP ganó).
          vipPoliticaId: calc.vipAplicado ? calc.vipPoliticaId ?? null : null,
          precioBaseVip: calc.vipAplicado ? calc.precioBase : null,
        });
      } catch (err) {
        // Producto sin precio configurado en sede, etc. — caso edge donde el
        // cliente envía un precio "razonable" y el backend no puede recalcular.
        // Mantener fallback para no bloquear ventas legítimas.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `No se pudo recalcular precio para "${d.descripcion}": ${msg}. ` +
            `Usando precio del cliente como fallback.`,
        );
        result.push({ ...d, precioCostoSnapshot: 0, motivoLiquidacionSnapshot: null, nivelAplicadoSnapshot: null });
      }
    }

    if (divergencias.length > 0) {
      // 409 Conflict: el cliente está fuera de sincronía con el catálogo.
      // El body estructurado permite al Flutter mostrar un dialog con la
      // lista de productos afectados y los precios viejo vs nuevo.
      throw new ConflictException({
        code: 'PRECIO_DESACTUALIZADO',
        message: divergencias.length === 1
          ? `El precio de "${divergencias[0].descripcion}" cambió de S/ ` +
            `${divergencias[0].precioCliente.toFixed(2)} a S/ ` +
            `${divergencias[0].precioServer.toFixed(2)}. Refrescá el carrito y volvé a intentar.`
          : `${divergencias.length} productos tienen precios desactualizados. ` +
            `Refrescá el carrito y volvé a intentar.`,
        divergencias,
      });
    }

    return result;
  }

  /**
   * Construye el resolver de precio especial VIP para el cliente de la venta.
   * Carga las políticas activas+vigentes asignadas al cliente (B2C o B2B) y
   * devuelve una función que, por línea, resuelve la política aplicable (mayor
   * prioridad) según su alcance (todos / productos / categorías).
   *
   * Devuelve null si no hay cliente o no tiene políticas VIP → costo cero para
   * ventas normales (no se ejecutan queries extra).
   */
  private async _buildResolverVip(
    empresaId: string,
    clienteId: string | null | undefined,
    clienteEmpresaId: string | null | undefined,
    detalles: CreateVentaDetalleDto[],
  ): Promise<ResolverVip | null> {
    if (!clienteId && !clienteEmpresaId) return null;

    const now = new Date();
    const asignaciones = await this.prisma.clientePoliticaDescuento.findMany({
      where: {
        empresaId,
        isActive: true,
        deletedAt: null,
        ...(clienteId ? { clienteId } : { clienteEmpresaId }),
        politica: {
          isActive: true,
          deletedAt: null,
          AND: [
            { OR: [{ fechaInicio: null }, { fechaInicio: { lte: now } }] },
            { OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] },
          ],
        },
      },
      include: {
        politica: {
          include: {
            productosAplicables: {
              select: { productoId: true, descuentoOverride: true },
            },
            categoriasAplicables: {
              select: { categoriaId: true, descuentoOverride: true },
            },
          },
        },
      },
    });
    if (!asignaciones.length) return null;

    const politicas = asignaciones.map((a) => a.politica);

    // Resolver categorías solo si alguna política usa alcance por categoría.
    const usaCategorias = politicas.some(
      (p) => !p.aplicarATodos && p.categoriasAplicables.length > 0,
    );
    const categoriaPorProducto = new Map<string, string | null>();
    const categoriaPorVariante = new Map<string, string | null>();
    if (usaCategorias) {
      const productoIds = new Set<string>();
      const varianteIds = new Set<string>();
      for (const d of detalles) {
        if (d.productoId && !d.comboId) productoIds.add(d.productoId);
        if (d.varianteId) varianteIds.add(d.varianteId);
      }
      if (productoIds.size) {
        const prods = await this.prisma.producto.findMany({
          where: { id: { in: [...productoIds] }, empresaId },
          select: { id: true, empresaCategoriaId: true },
        });
        prods.forEach((p) =>
          categoriaPorProducto.set(p.id, p.empresaCategoriaId ?? null),
        );
      }
      if (varianteIds.size) {
        const vars = await this.prisma.productoVariante.findMany({
          where: { id: { in: [...varianteIds] }, empresaId },
          select: {
            id: true,
            producto: { select: { empresaCategoriaId: true } },
          },
        });
        vars.forEach((v) =>
          categoriaPorVariante.set(v.id, v.producto?.empresaCategoriaId ?? null),
        );
      }
    }

    const resolver = (
      productoId: string | null,
      varianteId: string | null,
    ): VipPrecioContexto[] => {
      const categoria = varianteId
        ? categoriaPorVariante.get(varianteId) ?? null
        : productoId
          ? categoriaPorProducto.get(productoId) ?? null
          : null;

      const aplicables = politicas.filter((p) => {
        if (p.aplicarATodos) return true;
        if (
          productoId &&
          p.productosAplicables.some((x) => x.productoId === productoId)
        ) {
          return true;
        }
        if (
          categoria &&
          p.categoriasAplicables.some((x) => x.categoriaId === categoria)
        ) {
          return true;
        }
        return false;
      });
      // TODAS las aplicables (el cliente puede estar en varias políticas). El
      // cálculo de precio elige el menor entre ellas (gana el menor).
      return aplicables.map((g) => {
        // Override de descuento por producto/categoría (modos PORCENTAJE/MONTO_FIJO).
        let valor = Number(g.valorDescuento);
        const ovProd = productoId
          ? g.productosAplicables.find(
              (x) => x.productoId === productoId && x.descuentoOverride != null,
            )
          : null;
        const ovCat =
          !ovProd && categoria
            ? g.categoriasAplicables.find(
                (x) =>
                  x.categoriaId === categoria && x.descuentoOverride != null,
              )
            : null;
        if (ovProd?.descuentoOverride != null) {
          valor = Number(ovProd.descuentoOverride);
        } else if (ovCat?.descuentoOverride != null) {
          valor = Number(ovCat.descuentoOverride);
        }

        return {
          politicaId: g.id,
          etiqueta: `VIP: ${g.nombre}`,
          modo: g.tipoCalculo as VipPrecioContexto['modo'],
          valor,
          markupSobreCosto:
            g.markupSobreCosto != null ? Number(g.markupSobreCosto) : 0,
          estrategiaMayor: g.estrategiaMayor as 'PRIMER_NIVEL' | 'MEJOR_NIVEL',
          descuentoMaximo:
            g.descuentoMaximo != null ? Number(g.descuentoMaximo) : null,
        };
      });
    };

    const politicasById = new Map(
      politicas.map((p) => [
        p.id,
        {
          id: p.id,
          nombre: p.nombre,
          tipoCalculo: p.tipoCalculo as string,
          valorDescuento: p.valorDescuento,
        },
      ]),
    );

    return { resolver, politicasById };
  }

  /**
   * Defensa multi-tenant: valida que todos los IDs externos del DTO
   * (sedeId, vendedorId, clienteId, clienteEmpresaId, productoId,
   * varianteId, comboId, origenComboId) pertenezcan a `empresaId`.
   *
   * Las queries de lectura ya filtran por `empresaId` (clientes, productos,
   * etc.), pero el flujo de creación de venta confía en los IDs del DTO al
   * persistir. Sin esta validación un cliente comprometido podría:
   * - Crear venta en sede de otra empresa.
   * - Asignar venta a un vendedor de otra empresa.
   * - Vender productos de otra empresa (ID inyectado en detalles).
   *
   * Se hacen 5 queries batch (paralelas) — costo bajo. Falla early con
   * BadRequest si cualquier ID no pertenece.
   */
  private async _validarPertenenciaTenant(
    empresaId: string,
    dto: { sedeId: string; vendedorId?: string; clienteId?: string; clienteEmpresaId?: string; detalles: any[] },
    canalVenta: string,
  ): Promise<void> {
    // 1. Sede pertenece a la empresa.
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId, deletedAt: null },
      select: { id: true },
    });
    if (!sede) {
      throw new BadRequestException('La sede no pertenece a la empresa');
    }

    // 2. Vendedor (si está set) tiene rol activo en la empresa.
    if (dto.vendedorId) {
      const vendedor = await this.prisma.empresaUsuarioRol.findFirst({
        where: { usuarioId: dto.vendedorId, empresaId, isActive: true },
        select: { id: true },
      });
      if (!vendedor) {
        throw new BadRequestException('El vendedor no pertenece a la empresa');
      }
    }

    // 3. Cliente persona (EmpresaPersona) — solo si NO es genérico/ONLINE.
    // El genérico se resuelve internamente con clienteId que ya pertenece al tenant.
    if (dto.clienteId && canalVenta !== 'ONLINE') {
      const cliente = await this.prisma.empresaPersona.findFirst({
        where: { id: dto.clienteId, empresaId },
        select: { id: true },
      });
      if (!cliente) {
        throw new BadRequestException('El cliente no pertenece a la empresa');
      }
    }

    // 4. Cliente empresa B2B (ClienteEmpresa).
    if (dto.clienteEmpresaId) {
      const clienteEmp = await this.prisma.clienteEmpresa.findFirst({
        where: { id: dto.clienteEmpresaId, empresaId },
        select: { id: true },
      });
      if (!clienteEmp) {
        throw new BadRequestException('El cliente B2B no pertenece a la empresa');
      }
    }

    // 5. Productos / combos / variantes / origenCombos en una sola query batch.
    // Producto y combo viven en la misma tabla (esCombo distingue), origenComboId
    // referencia a un Producto-combo, así que todos van al mismo set.
    const productoIds = new Set<string>();
    const varianteIds = new Set<string>();
    for (const d of dto.detalles ?? []) {
      if (d.productoId) productoIds.add(d.productoId);
      if (d.comboId) productoIds.add(d.comboId);
      if (d.origenComboId) productoIds.add(d.origenComboId);
      if (d.varianteId) varianteIds.add(d.varianteId);
    }

    if (productoIds.size > 0) {
      const productos = await this.prisma.producto.findMany({
        where: { id: { in: [...productoIds] }, empresaId },
        select: {
          id: true,
          nombre: true,
          isActive: true,
          deletedAt: true,
          esInsumo: true,
        },
      });

      // Detectar IDs faltantes (no pertenecen a la empresa o no existen).
      if (productos.length !== productoIds.size) {
        throw new BadRequestException(
          'Algún producto/combo del detalle no pertenece a la empresa o no existe',
        );
      }

      // Detectar productos eliminados (en papelera).
      const eliminados = productos.filter((p) => p.deletedAt !== null);
      if (eliminados.length > 0) {
        throw new BadRequestException(
          `Producto(s) eliminado(s) en el detalle: ${eliminados
            .map((p) => `"${p.nombre}"`)
            .join(', ')}. Restáuralos desde Productos eliminados antes de vender.`,
        );
      }

      // Detectar productos inactivos (no disponibles para venta).
      const inactivos = productos.filter((p) => !p.isActive);
      if (inactivos.length > 0) {
        throw new BadRequestException(
          `Producto(s) no disponible(s) para venta: ${inactivos
            .map((p) => `"${p.nombre}"`)
            .join(', ')}. Activálos desde el detalle del producto.`,
        );
      }

      // Detectar insumos / materia prima — no se venden directo al cliente.
      const insumos = productos.filter((p) => p.esInsumo);
      if (insumos.length > 0) {
        throw new BadRequestException(
          `Producto(s) marcado(s) como insumo no se pueden vender directamente: ${insumos
            .map((p) => `"${p.nombre}"`)
            .join(', ')}. Si querés venderlos al cliente, desmarcá "Es insumo" en el detalle del producto.`,
        );
      }
    }

    if (varianteIds.size > 0) {
      // ProductoVariante también tiene isActive + deletedAt; aplicamos las
      // mismas reglas. Si el producto padre está inactivo/eliminado, ya falló
      // arriba (se incluye en productoIds vía el detalle del frontend).
      const variantes = await this.prisma.productoVariante.findMany({
        where: { id: { in: [...varianteIds] }, empresaId },
        select: { id: true, nombre: true, isActive: true, deletedAt: true },
      });
      if (variantes.length !== varianteIds.size) {
        throw new BadRequestException(
          'Alguna variante del detalle no pertenece a la empresa o no existe',
        );
      }
      const elimVar = variantes.filter((v) => v.deletedAt !== null);
      if (elimVar.length > 0) {
        throw new BadRequestException(
          `Variante(s) eliminada(s) en el detalle: ${elimVar
            .map((v) => `"${v.nombre}"`)
            .join(', ')}.`,
        );
      }
      const inactVar = variantes.filter((v) => !v.isActive);
      if (inactVar.length > 0) {
        throw new BadRequestException(
          `Variante(s) no disponible(s): ${inactVar
            .map((v) => `"${v.nombre}"`)
            .join(', ')}.`,
        );
      }
    }
  }

  // Include reutilizable para queries
  private getInclude() {
    return {
      detalles: {
        include: {
          producto: {
            select: { id: true, nombre: true, codigoEmpresa: true },
          },
          variante: { select: { id: true, nombre: true, sku: true } },
          servicio: {
            select: { id: true, nombre: true, codigoEmpresa: true },
          },
          // Cobro de orden de servicio: el ticket muestra el desglose
          // (costo total del servicio, adelantos previos con su método y
          // saldo cobrado en esta venta).
          ordenServicio: {
            select: {
              id: true,
              codigo: true,
              costoTotal: true,
              adelanto: true,
              descuento: true,
              metodoPagoAdelanto: true,
            },
          },
        },
        orderBy: { orden: 'asc' as const },
      },
      pagos: { orderBy: { fechaPago: 'desc' as const } },
      cuotas: {
        orderBy: { numero: 'asc' as const },
        include: {
          pagos: { select: { id: true, monto: true, metodoPago: true, fechaPago: true } },
        },
      },
      sede: { select: { id: true, nombre: true } },
      cliente: {
        select: {
          id: true,
          persona: { select: { nombres: true, apellidos: true, dni: true } },
        },
      },
      vendedor: {
        select: {
          id: true,
          aliasTicket: true,
          persona: { select: { nombres: true, apellidos: true } },
        },
      },
      cajero: {
        select: {
          id: true,
          aliasTicket: true,
          persona: { select: { nombres: true, apellidos: true } },
        },
      },
      cotizacion: { select: { id: true, codigo: true } },
      comprobante: {
        select: {
          id: true, sedeId: true, tipoComprobante: true, codigoGenerado: true, serie: true, correlativo: true,
          estado: true, sunatStatus: true, sunatHash: true,
          gravada: true, exonerada: true, inafecta: true, gratuitas: true, igv: true, icbper: true, total: true,
          sunatXmlUrl: true, sunatPdfUrl: true, sunatCdrUrl: true,
          cadenaQR: true, enlaceProveedor: true,
          enviadoAProveedor: true, errorProveedor: true, intentosEnvio: true,
          anulado: true,
          notasRelacionadas: {
            select: {
              id: true, tipoComprobante: true, codigoGenerado: true,
              estado: true, sunatStatus: true, sunatHash: true,
              total: true, motivoNota: true, tipoNotaCredito: true, tipoNotaDebito: true,
              cadenaQR: true, anulado: true,
              fechaEmision: true,
              enlaceProveedor: true, sunatPdfUrl: true,
            },
            orderBy: { creadoEn: 'desc' as const },
          },
        },
      },
    };
  }

  /**
   * Completa el snapshot de contacto de la venta desde la Persona del
   * cliente cuando el caller no lo mandó. Caso real (VTA-SED-00000686):
   * el cobro de VR manda nombre+documento del cliente seleccionado pero
   * NO su teléfono → el detalle de la venta no podía mostrarlo aunque el
   * cliente sí lo tenía registrado. Aplica a teléfono, email y dirección;
   * lo que el caller mande explícito siempre gana.
   */
  private async completarContactoCliente(
    clienteId: string | null | undefined,
    actual: {
      telefono?: string | null;
      email?: string | null;
      direccion?: string | null;
    },
  ): Promise<{ telefono: string | null; email: string | null; direccion: string | null }> {
    const base = {
      telefono: actual.telefono ?? null,
      email: actual.email ?? null,
      direccion: actual.direccion ?? null,
    };
    if (!clienteId || (base.telefono && base.email && base.direccion)) {
      return base;
    }
    const ep = await this.prisma.empresaPersona.findUnique({
      where: { id: clienteId },
      select: {
        persona: { select: { telefono: true, email: true, direccion: true } },
      },
    });
    const p = ep?.persona;
    if (!p) return base;
    return {
      telefono: base.telefono ?? p.telefono ?? null,
      email: base.email ?? p.email ?? null,
      direccion: base.direccion ?? p.direccion ?? null,
    };
  }

  private getListInclude() {
    return {
      sede: { select: { id: true, nombre: true } },
      cliente: {
        select: {
          id: true,
          persona: { select: { nombres: true, apellidos: true } },
        },
      },
      vendedor: {
        select: {
          id: true,
          aliasTicket: true,
          persona: { select: { nombres: true, apellidos: true } },
        },
      },
      cotizacion: { select: { id: true, codigo: true } },
      // Comprobante liviano para la columna de la lista (web muestra
      // serie-número + estado SUNAT; la card de Flutter lo ignora).
      comprobante: {
        select: { tipoComprobante: true, codigoGenerado: true, sunatStatus: true },
      },
      // Órdenes de servicio cobradas por la venta (badge "OS-XXXXX" en la
      // card). Solo trae filas para líneas con ordenServicioId — para
      // ventas normales devuelve []. findAll lo aplana a `ordenesServicio`
      // y NO expone `detalles` (el cliente no espera detalles parciales).
      detalles: {
        where: { ordenServicioId: { not: null } },
        select: { ordenServicio: { select: { id: true, codigo: true } } },
      },
      _count: { select: { detalles: true, pagos: true } },
    };
  }

  /**
   * Crear venta (estado BORRADOR)
   */
  /**
   * Valida bancarización (Ley 28194) en modo multi-medio.
   *
   * Reglas:
   *  - Por cada pago bancarizable (YAPE/PLIN/TARJETA/TRANSFERENCIA) se exige
   *    `referencia`. Para TARJETA/TRANSFERENCIA además `banco`.
   *  - Si total >= umbral y la suma de pagos bancarizables NO cubre el umbral,
   *    el efectivo excede lo legal: se exige `aceptaRiesgoBancarizacion=true`
   *    (cajero confirma la advertencia, cliente asume el riesgo de no deducir IGV).
   *
   * Compat: si no llega `pagos[]` se sintetiza uno virtual desde
   * `metodoPago` + `montoRecibido` (sin banco/referencia).
   */
  private validarBancarizacion(dto: {
    total: number;
    moneda?: string;
    esCredito?: boolean;
    pagos?: Array<{ metodoPago: string; monto: number; referencia?: string | null; banco?: string | null }>;
    metodoPago?: string | null;
    montoRecibido?: number | null;
    aceptaRiesgoBancarizacion?: boolean;
  }): void {
    if (dto.esCredito) return;

    const moneda = dto.moneda || 'PEN';
    const umbral = moneda === 'USD' ? 500 : 2000;
    if (dto.total < umbral) return;

    const pagos = (dto.pagos && dto.pagos.length > 0)
      ? dto.pagos
      : (dto.metodoPago && (dto.montoRecibido ?? 0) > 0)
        ? [{
            metodoPago: dto.metodoPago,
            monto: dto.montoRecibido!,
            referencia: null,
            banco: null,
          }]
        : [];

    if (pagos.length === 0) return;

    for (const p of pagos) {
      const m = p.metodoPago;
      const necesitaRef = ['YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA'].includes(m);
      const necesitaBanco = ['TARJETA', 'TRANSFERENCIA'].includes(m);
      if (necesitaRef && !p.referencia?.toString().trim()) {
        throw new BadRequestException(
          `Bancarización: el pago de ${m} (S/ ${Number(p.monto).toFixed(2)}) requiere N° de operación.`,
        );
      }
      if (necesitaBanco && !p.banco?.toString().trim()) {
        throw new BadRequestException(
          `Bancarización: el pago de ${m} (S/ ${Number(p.monto).toFixed(2)}) requiere banco/entidad financiera.`,
        );
      }
    }

    const totalBancarizado = pagos
      .filter(p => p.metodoPago !== 'EFECTIVO' && p.metodoPago !== 'CREDITO')
      .reduce((s, p) => s + Number(p.monto), 0);
    const totalEfectivo = pagos
      .filter(p => p.metodoPago === 'EFECTIVO')
      .reduce((s, p) => s + Number(p.monto), 0);

    if (totalBancarizado >= umbral) return;

    if (totalEfectivo > 0 && !dto.aceptaRiesgoBancarizacion) {
      throw new BadRequestException(
        `Ley 28194: venta de ${moneda} ${dto.total.toFixed(2)} con pago en efectivo de ${moneda} ${totalEfectivo.toFixed(2)} ` +
        `(parte bancarizada ${moneda} ${totalBancarizado.toFixed(2)} no cubre el límite de ${umbral}). ` +
        `Requiere confirmación del cajero — el cliente perderá derecho a deducir IGV/sustento de gasto.`,
      );
    }
  }

  /**
   * Deriva `Venta.metodoPago` desde la lista de pagos.
   *  - Sin pagos → fallback (compat con flujos legacy que solo mandan `metodoPago`).
   *  - 1 método único → ese método.
   *  - 2+ métodos distintos → 'MIXTO' (etiqueta UX; reportería usa PagoVenta).
   */
  private resolverMetodoPagoVenta(
    pagos: Array<{ metodoPago: string }> | undefined,
    fallback?: string | null,
  ): MetodoPagoVenta | undefined {
    if (!pagos || pagos.length === 0) {
      return (fallback as MetodoPagoVenta | undefined) ?? undefined;
    }
    const unicos = new Set(pagos.map((p) => p.metodoPago));
    if (unicos.size === 1) return pagos[0].metodoPago as MetodoPagoVenta;
    return 'MIXTO' as MetodoPagoVenta;
  }

  /**
   * Construye los montos por método de pago a registrar en caja (1 MovimientoCaja
   * por método) a partir de los pagos de la venta.
   *
   * Regla de oro: **el vuelto SIEMPRE se entrega en efectivo**, nunca en un medio
   * digital. Por eso el efectivo neto que queda en la caja es lo recibido menos el
   * cambio devuelto; los medios digitales (YAPE/PLIN/TARJETA/...) se registran a
   * valor nominal porque jamás son fuente de vuelto.
   *
   * Reemplaza el antiguo "clamp acumulativo" que recortaba el excedente por orden
   * del array y terminaba restando el vuelto al medio digital (corría el desglose
   * +vuelto en efectivo / −vuelto en digital → diferencia fantasma al cerrar caja).
   *
   * Robusto frente a:
   *  - Múltiples líneas de efectivo (reparte el vuelto en orden hasta agotarlo).
   *  - Vuelto declarado sin línea de efectivo (no toca los digitales).
   *  - Excedente residual sobre el total (lo absorbe el efectivo, nunca el digital).
   */
  private construirPagosParaCaja(
    pagos: Array<{ metodoPago: string; monto: number }>,
    totalACobrar: number,
    vuelto: number,
  ): Array<{ metodoPago: string; monto: number }> {
    let vueltoRestante = Math.max(0, round2(vuelto));

    const resultado = pagos
      .filter((p) => p.metodoPago !== 'CREDITO')
      .map((p) => {
        let monto = p.monto;
        // El vuelto sale del efectivo: descontamos lo que se devolvió.
        if (p.metodoPago === 'EFECTIVO' && vueltoRestante > 0) {
          const descuenta = Math.min(monto, vueltoRestante);
          monto = round2(monto - descuenta);
          vueltoRestante = round2(vueltoRestante - descuenta);
        }
        return { metodoPago: p.metodoPago, monto };
      });

    // Safety: si tras netear el vuelto el efectivo aún excede lo cobrado hoy
    // (overpago no capturado como vuelto), recortamos del EFECTIVO — nunca del
    // digital, que siempre se paga exacto.
    let exceso = round2(resultado.reduce((s, p) => s + p.monto, 0) - totalACobrar);
    for (let i = resultado.length - 1; i >= 0 && exceso > 0; i--) {
      if (resultado[i].metodoPago !== 'EFECTIVO') continue;
      const recorta = Math.min(resultado[i].monto, exceso);
      resultado[i].monto = round2(resultado[i].monto - recorta);
      exceso = round2(exceso - recorta);
    }

    return resultado.filter((p) => p.monto > 0);
  }

  async create(empresaId: string, dto: CreateVentaDto, cajeroId?: string) {
    this.logger.info('Creando venta', { empresaId, sede: dto.sedeId });

    // El cobro de órdenes de servicio solo está soportado en el flujo POS
    // crearYCobrar (valida saldo, marca ENTREGADO y registra en caja en una
    // sola transacción). Este flujo crea ventas que se cobran después.
    if (dto.detalles?.some((d) => (d as any).ordenServicioId)) {
      throw new BadRequestException(
        'Las órdenes de servicio se cobran desde Venta Rápida (crear y cobrar), no en este flujo',
      );
    }

    // Si la empresa exige caja para vender (flag `requiereCajaParaVender`),
    // bloquear si el cajero no tiene caja abierta en la sede destino.
    // Cada cajero gestiona su propia caja. Si el flag está OFF, no valida.
    if (cajeroId) {
      await this.cajaService.validarCajaParaVender(
        empresaId,
        dto.sedeId,
        cajeroId,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const { codigoVenta } =
        await this.configuracionCodigos.generarCodigoVenta(
          empresaId,
          dto.sedeId,
          tx,
        );

      // Forzar precios del backend (defensa contra manipulación cliente).
      const detallesEnforced = await this.aplicarPreciosBackendNivel(
        dto.detalles,
        dto.sedeId,
      );
      const detallesCalculados = detallesEnforced.map((d, index) =>
        this.calcularDetalle(d, index),
      );

      // Guard: validar venta bajo costo. Lanza 422 si hay líneas sin
      // liquidación + sin autorización GERENTE/ADMIN.
      const perdidaTotal = await this.validarVentaBajoCosto(
        empresaId,
        detallesCalculados,
        dto.ventaBajoCostoAutorizadaPorId ?? null,
      );

      const subtotal = detallesCalculados.reduce(
        (sum, d) => sum + d.subtotal,
        0,
      );
      const totalDescuento = detallesCalculados.reduce(
        (sum, d) => sum + d.descuento,
        0,
      );
      const totalImpuestos = detallesCalculados.reduce(
        (sum, d) => sum + d.igv,
        0,
      );
      const total = detallesCalculados.reduce((sum, d) => sum + d.total, 0);

      this.validarBancarizacion({
        total,
        moneda: dto.moneda,
        esCredito: dto.esCredito,
        pagos: dto.pagos,
        metodoPago: dto.metodoPago,
        montoRecibido: dto.montoRecibido,
        aceptaRiesgoBancarizacion: dto.aceptaRiesgoBancarizacion,
      });

      const montoCambio =
        dto.montoRecibido && dto.montoRecibido > total
          ? round2(dto.montoRecibido - total)
          : null;

      const contacto = await this.completarContactoCliente(dto.clienteId, {
        telefono: dto.telefonoCliente,
        email: dto.emailCliente,
        direccion: dto.direccionCliente,
      });

      const venta = await tx.venta.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          clienteId: dto.clienteId,
          clienteEmpresaId: dto.clienteEmpresaId,
          vendedorId: dto.vendedorId,
          canalVenta: dto.canalVenta ?? 'POS',
          codigo: codigoVenta,
          nombreCliente: dto.nombreCliente,
          documentoCliente: dto.documentoCliente,
          emailCliente: contacto.email,
          telefonoCliente: contacto.telefono,
          direccionCliente: contacto.direccion,
          moneda: dto.moneda ?? 'PEN',
          tipoCambio: dto.tipoCambio,
          subtotal,
          descuento: totalDescuento,
          impuestos: totalImpuestos,
          total,
          metodoPago: this.resolverMetodoPagoVenta(dto.pagos, dto.metodoPago),
          montoRecibido: dto.montoRecibido,
          montoCambio,
          bancarizacionAdvertida: dto.aceptaRiesgoBancarizacion ?? false,
          conEnvio: dto.conEnvio ?? false,
          esCredito: dto.esCredito ?? false,
          plazoCredito: dto.plazoCredito,
          fechaVencimientoPago: dto.fechaVencimientoPago
            ? new Date(dto.fechaVencimientoPago)
            : null,
          observaciones: dto.observaciones,
          perdidaTotalLineas: perdidaTotal,
          ventaBajoCostoAutorizadaPorId:
            perdidaTotal != null ? dto.ventaBajoCostoAutorizadaPorId ?? null : null,
          ventaBajoCostoAutorizadaEn:
            perdidaTotal != null && dto.ventaBajoCostoAutorizadaPorId ? new Date() : null,
          detalles: {
            create: detallesCalculados.map((d) => ({
              productoId: d.productoId,
              varianteId: d.varianteId,
              servicioId: d.servicioId,
              comboId: d.comboId,
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              descuento: d.descuento,
              tipoAfectacion: d.tipoAfectacion,
              porcentajeIGV: d.porcentajeIGV,
              igv: d.igv,
              icbper: d.icbper,
              subtotal: d.subtotal,
              total: d.total,
              orden: d.orden,
              origenComboId: d.origenComboId,
              origenComboNombre: d.origenComboNombre,
              precioCostoSnapshot: d.precioCostoSnapshot,
              margenSnapshot: d.margenSnapshot,
              motivoLiquidacionSnapshot: d.motivoLiquidacionSnapshot,
              nivelAplicadoSnapshot: d.nivelAplicadoSnapshot,
            })),
          },
        },
        include: this.getInclude(),
      });

      this.logger.log(`Venta creada: ${venta.codigo}`);
      return venta;
    });
  }

  /**
   * Crear y cobrar venta en un solo paso (POS directo)
   * Crea la venta, descuenta stock, registra pago(s), genera comprobante y registra movimiento en caja.
   */
  async crearYCobrar(
    empresaId: string,
    dto: CrearYCobrarVentaDto,
    cajeroId: string,
    opts?: { diferirComprobante?: boolean },
  ) {
    const canalVenta = dto.canalVenta ?? 'POS';
    this.logger.info('Creando y cobrando venta', { empresaId, sede: dto.sedeId, canal: canalVenta });

    // Validar caja abierta según canal (POS y COTIZACION requieren caja, ONLINE no)
    if (canalVenta !== 'ONLINE') {
      const cajaActiva = await this.prisma.caja.findFirst({
        where: { empresaId, sedeId: dto.sedeId, usuarioId: cajeroId, estado: 'ABIERTA' },
      });
      if (!cajaActiva) {
        throw new BadRequestException(
          'Debe abrir una caja antes de realizar ventas. Vaya a Caja → Abrir Caja.',
        );
      }
    }

    // Defensa multi-tenant: validar que TODOS los IDs del DTO pertenezcan
    // a la empresa del header `x-tenant-id`. El cliente comprometido podría
    // inyectar IDs de otro tenant; las queries de lectura ya filtran por
    // empresaId pero las inserciones de detalle confían en los IDs del DTO.
    await this._validarPertenenciaTenant(empresaId, dto, canalVenta);

    // Resolver de precio especial VIP del cliente (solo lecturas; fuera de la tx).
    // null si el cliente no tiene políticas VIP → sin overhead en ventas normales.
    const vipResolver = await this._buildResolverVip(
      empresaId,
      dto.clienteId,
      dto.clienteEmpresaId,
      dto.detalles,
    );

    const result = await this.prisma.$transaction(
      async (tx) => {
        // 1. Generar código
        const { codigoVenta } =
          await this.configuracionCodigos.generarCodigoVenta(
            empresaId,
            dto.sedeId,
            tx,
          );

        // 2. Forzar precios del backend (defensa contra manipulación cliente)
        //    y luego calcular detalles.
        const detallesEnforced = await this.aplicarPreciosBackendNivel(
          dto.detalles,
          dto.sedeId,
          vipResolver,
        );
        const detallesCalculados = detallesEnforced.map((d, index) =>
          this.calcularDetalle(d, index),
        );

        // 2a-bis. Órdenes de servicio en el carrito: validar y bloquear
        // (FOR UPDATE). Verifica estado cobrable, saldo vigente (409
        // SALDO_ORDEN_DESACTUALIZADO) y doble cobro (409 ORDEN_YA_COBRADA).
        const ordenesACobrar =
          await this.ordenServicioService.validarYBloquearCobroVenta(
            tx,
            empresaId,
            detallesCalculados,
          );

        // 2b. Guard: validar venta bajo costo (margen negativo).
        const perdidaTotal = await this.validarVentaBajoCosto(
          empresaId,
          detallesCalculados,
          dto.ventaBajoCostoAutorizadaPorId ?? null,
        );

        // 2c. Validar descuentos máximos por producto.
        // Las líneas de combo (origenComboId) se EXIMEN: su descuento es el
        // ahorro prorrateado del combo (+ descuento manual ya autorizado vía
        // APLICAR_DESCUENTO en el cliente), un deal intencional del bundle —
        // no debe chocar con el descuentoMaximo del producto componente.
        const detallesConDescuento = detallesCalculados.filter(
          (d) => d.descuento > 0 && d.productoId && !d.origenComboId,
        );
        if (detallesConDescuento.length > 0) {
          const productoIds = [...new Set(detallesConDescuento.map(d => d.productoId!))];
          const productosConLimite = await tx.producto.findMany({
            where: { id: { in: productoIds }, descuentoMaximo: { not: null }, esCombo: false },
            select: { id: true, descuentoMaximo: true },
          });
          const limiteMap = new Map(productosConLimite.map(p => [p.id, Number(p.descuentoMaximo)]));

          for (const detalle of detallesConDescuento) {
            const limite = limiteMap.get(detalle.productoId!);
            if (limite != null && limite > 0) {
              const subtotalBruto = detalle.cantidad * detalle.precioUnitario;
              const porcentaje = subtotalBruto > 0 ? (detalle.descuento / subtotalBruto) * 100 : 0;
              if (porcentaje > limite) {
                throw new BadRequestException(
                  `Descuento de "${detalle.descripcion}" (${porcentaje.toFixed(1)}%) excede el máximo permitido (${limite}%)`,
                );
              }
            }
          }
        }

        const subtotalVenta = detallesCalculados.reduce((sum, d) => sum + d.subtotal, 0);
        const descuentoItems = detallesCalculados.reduce((sum, d) => sum + d.descuento, 0);
        const impuestosVenta = detallesCalculados.reduce((sum, d) => sum + d.igv, 0);
        const totalSinDescuentoGlobal = detallesCalculados.reduce((sum, d) => sum + d.total, 0);

        // Descuento global: se resta del total final
        const descuentoGlobal = round2(dto.descuentoGlobal || 0);
        const descuentoVenta = descuentoItems + descuentoGlobal;
        const totalVenta = round2(totalSinDescuentoGlobal - descuentoGlobal);

        // Adelantos ya pagados de las órdenes de servicio cobradas: el
        // comprobante/venta sale por el TOTAL del servicio (la línea es el
        // costo neto), pero HOY solo se cobra el saldo. El adelanto entra
        // como PagoVenta/PagoComprobante "aplicado" (su dinero ya pasó por
        // caja al recibirse) y todo lo que depende de lo cobrado hoy
        // (pagada-completa, vuelto, bancarización, caja) usa el neto.
        const adelantoOrdenes = round2(
          ordenesACobrar.reduce((s, o) => s + Number(o.adelanto ?? 0), 0),
        );
        const totalACobrarHoy = round2(totalVenta - adelantoOrdenes);

        // Defensa: con descuentoGlobal un caller podría dejar el neto a
        // cobrar en negativo (la validación por orden garantiza saldo > 0,
        // pero no contempla el descuento global). Sin este guard, la venta
        // saldría PAGADA_COMPLETA sin pagos y con PagoComprobante negativo.
        if (totalACobrarHoy < 0) {
          throw new BadRequestException(
            `Los adelantos aplicados (S/ ${adelantoOrdenes.toFixed(2)}) superan el total a cobrar ` +
              `(S/ ${totalVenta.toFixed(2)}). Reducí el descuento global o ajustá la orden.`,
          );
        }

        const esCredito = dto.esCredito ?? false;

        // Bancarización: la Ley 28194 aplica al monto de la OPERACIÓN (el
        // comprobante sale por totalVenta), no a lo cobrado hoy. Con
        // adelanto, el saldo podría caer bajo el umbral aunque la operación
        // facturada lo supere — se valida contra el total.
        this.validarBancarizacion({
          total: totalVenta,
          moneda: dto.moneda,
          esCredito,
          pagos: dto.pagos,
          metodoPago: dto.metodoPago,
          montoRecibido: dto.montoRecibido,
          aceptaRiesgoBancarizacion: dto.aceptaRiesgoBancarizacion,
        });

        // For hybrid sales: calculate immediate payment total from pagos array
        const montoPagadoInmediato = esCredito && dto.pagos && dto.pagos.length > 0
          ? dto.pagos.reduce((s, p) => s + p.monto, 0)
          : (dto.montoRecibido ?? 0);
        const montoRecibido = dto.montoRecibido ?? montoPagadoInmediato;
        const montoCredito = esCredito
          ? round2(totalACobrarHoy - montoPagadoInmediato)
          : 0;
        // Pagada al crear: contado con monto suficiente, O crédito cuya operación
        // queda 100% cubierta al momento (adelanto >= total → sin saldo financiado,
        // 0 cuotas). Ese "crédito" es en realidad un contado → PAGADA_COMPLETA, no
        // se queda colgado en CONFIRMADA con saldo 0.
        const estaPagada = esCredito
          ? montoCredito <= 0
          : montoRecibido >= totalACobrarHoy;

        const montoCambio =
          montoRecibido > totalACobrarHoy
            ? round2(montoRecibido - totalACobrarHoy)
            : 0;

        const contacto = await this.completarContactoCliente(dto.clienteId, {
          telefono: dto.telefonoCliente,
          email: dto.emailCliente,
          direccion: dto.direccionCliente,
        });

        // 3. Crear venta con estado final
        const venta = await tx.venta.create({
          data: {
            empresaId,
            sedeId: dto.sedeId,
            clienteId: dto.clienteId,
            clienteEmpresaId: dto.clienteEmpresaId,
            vendedorId: dto.vendedorId,
            cajeroId,
            canalVenta,
            codigo: codigoVenta,
            nombreCliente: dto.nombreCliente,
            documentoCliente: dto.documentoCliente,
            emailCliente: contacto.email,
            telefonoCliente: contacto.telefono,
            direccionCliente: contacto.direccion,
            moneda: dto.moneda ?? 'PEN',
            tipoCambio: dto.tipoCambio,
            subtotal: subtotalVenta,
            descuento: descuentoVenta,
            impuestos: impuestosVenta,
            total: totalVenta,
            metodoPago: this.resolverMetodoPagoVenta(dto.pagos, dto.metodoPago),
            montoRecibido: montoRecibido || null,
            montoCambio: montoCambio || null,
            bancarizacionAdvertida: dto.aceptaRiesgoBancarizacion ?? false,
            conEnvio: dto.conEnvio ?? false,
            esCredito,
            plazoCredito: dto.plazoCredito,
            numeroCuotas: dto.numeroCuotas ?? null,
            montoCreditoInicial: montoCredito > 0 ? montoCredito : null,
            fechaVencimientoPago: dto.fechaVencimientoPago
              ? new Date(dto.fechaVencimientoPago)
              : null,
            observaciones: dto.observaciones,
            descuentoGlobal: descuentoGlobal > 0 ? descuentoGlobal : null,
            descuentoGlobalPorcentaje: dto.descuentoGlobalPorcentaje ?? null,
            descuentoAutorizadoPorId: descuentoGlobal > 0 ? dto.descuentoAutorizadoPorId : null,
            descuentoAutorizadoEn: descuentoGlobal > 0 ? new Date() : null,
            perdidaTotalLineas: perdidaTotal,
            ventaBajoCostoAutorizadaPorId:
              perdidaTotal != null ? dto.ventaBajoCostoAutorizadaPorId ?? null : null,
            ventaBajoCostoAutorizadaEn:
              perdidaTotal != null && dto.ventaBajoCostoAutorizadaPorId ? new Date() : null,
            estado: estaPagada
              ? EstadoVenta.PAGADA_COMPLETA
              : EstadoVenta.CONFIRMADA,
            // Comprobante DIFERIDO (flujo Yape pendiente): guardamos la
            // intención fiscal; el comprobante se emite al confirmarse el pago
            // (finalizarVentaYape). En ventas normales estos campos van null.
            tipoComprobanteDiferido:
              opts?.diferirComprobante && (dto.tipoComprobante || 'TICKET') !== 'TICKET'
                ? dto.tipoComprobante
                : null,
            sedeFacturacionIdDiferido: opts?.diferirComprobante
              ? dto.sedeFacturacionId ?? null
              : null,
            tipoDocumentoClienteDiferido: opts?.diferirComprobante
              ? dto.tipoDocumentoCliente ?? null
              : null,
            cobroDiferido: opts?.diferirComprobante ?? false,
            detalles: {
              create: detallesCalculados.map((d) => ({
                productoId: d.productoId,
                varianteId: d.varianteId,
                servicioId: d.servicioId,
                comboId: d.comboId,
                ordenServicioId: d.ordenServicioId,
                descripcion: d.descripcion,
                cantidad: d.cantidad,
                precioUnitario: d.precioUnitario,
                descuento: d.descuento,
                tipoAfectacion: d.tipoAfectacion,
                porcentajeIGV: d.porcentajeIGV,
                igv: d.igv,
                icbper: d.icbper,
                subtotal: d.subtotal,
                total: d.total,
                orden: d.orden,
                origenComboId: d.origenComboId,
                origenComboNombre: d.origenComboNombre,
                precioCostoSnapshot: d.precioCostoSnapshot,
                margenSnapshot: d.margenSnapshot,
                motivoLiquidacionSnapshot: d.motivoLiquidacionSnapshot,
                nivelAplicadoSnapshot: d.nivelAplicadoSnapshot,
              })),
            },
          },
          include: this.getInclude(),
        });

        // 3b. Historial de uso de precio especial VIP (auditoría + reportería).
        // Solo se registran las líneas donde el precio VIP efectivamente ganó.
        const vipLineas = detallesCalculados.filter((d) => d.vipPoliticaId);
        if (vipLineas.length && vipResolver) {
          await tx.descuentoUsoHistorial.createMany({
            data: vipLineas.map((d) => {
              const pol = vipResolver.politicasById.get(d.vipPoliticaId!);
              const precioOriginal = round2(d.precioBaseVip ?? d.precioUnitario);
              const precioFinal = round2(d.precioUnitario);
              return {
                politicaId: d.vipPoliticaId!,
                usuarioId: null,
                empresaId,
                clienteId: dto.clienteId ?? null,
                clienteEmpresaId: dto.clienteEmpresaId ?? null,
                ventaId: venta.id,
                productoId: d.productoId ?? null,
                varianteId: d.varianteId ?? null,
                cantidad: Math.round(d.cantidad),
                precioOriginal,
                descuentoAplicado: round2(
                  Math.max(precioOriginal - precioFinal, 0),
                ),
                precioFinal,
                tipoCalculo: (pol?.tipoCalculo ??
                  'PORCENTAJE') as TipoCalculoDescuento,
                valorDescuento: pol ? Number(pol.valorDescuento) : 0,
                sedeId: dto.sedeId,
                cajeroId,
              };
            }),
          });
        }

        // 4. Descontar stock (optimizado: batch queries en vez de N loops)
        const detallesConProducto = detallesCalculados.filter(
          (d) => d.productoId || d.varianteId,
        );

        if (detallesConProducto.length > 0) {
          // 4a. Buscar todos los ProductoStock en un solo query
          // Para variantes: buscar por varianteId (productoId es null en ProductoStock)
          // Para productos simples: buscar por productoId (varianteId es null)
          const stockRecords = await tx.productoStock.findMany({
            where: {
              sedeId: dto.sedeId,
              OR: detallesConProducto.map((d) => d.varianteId
                ? { varianteId: d.varianteId }
                : { productoId: d.productoId, varianteId: null }
              ),
            },
          });

          // Mapear stock: variantes por "_varianteId", productos por "productoId_"
          const stockMap = new Map<string, typeof stockRecords[0]>();
          for (const s of stockRecords) {
            const key = s.varianteId
              ? `_${s.varianteId}`
              : `${s.productoId || ''}_`;
            stockMap.set(key, s);
          }

          // Recopilar IDs para lock batch
          const stockIds = stockRecords.map((s) => s.id);

          if (stockIds.length > 0) {
            // 4b. Lock batch: un solo SELECT FOR UPDATE con todos los IDs
            const lockedRows = await tx.$queryRawUnsafe<
              Array<{
                id: string;
                stockActual: number;
                stockReservado: number;
                stockReservadoVenta: number;
                stockReservadoCombo: number;
                stockReservadoCotizacion: number;
                stockDanado: number;
                stockEnGarantia: number;
              }>
            >(
              `SELECT id, "stockActual", "stockReservado", "stockReservadoVenta",
                      "stockReservadoCombo", "stockReservadoCotizacion",
                      "stockDanado", "stockEnGarantia"
               FROM "ProductoStock" WHERE id = ANY($1) FOR UPDATE`,
              stockIds,
            );

            const lockedMap = new Map<string, typeof lockedRows[0]>();
            for (const row of lockedRows) {
              lockedMap.set(row.id, row);
            }

            // 4c. Validar stock — agrupar divergencias antes de cualquier
            // update. Si hay 3 productos sin stock, mostramos los 3 al
            // cajero (no solo el primero como antes con BadRequestException).
            type StockDivergencia = {
              productoId: string | null;
              varianteId: string | null;
              comboId: string | null;
              descripcion: string;
              cantidadSolicitada: number;
              stockDisponible: number;
            };
            const stockDivergencias: StockDivergencia[] = [];
            type PendingUpdate = {
              productoStockId: string;
              stockAnterior: number;
              nuevoStock: number;
              cantidad: number;
              descripcion: string;
              precioCostoSnapshot: number;
            };
            const pendingUpdates: PendingUpdate[] = [];

            for (const detalle of detallesConProducto) {
              // Para variantes: buscar por "_varianteId" (productoId es null en stock)
              const key = detalle.varianteId
                ? `_${detalle.varianteId}`
                : `${detalle.productoId || ''}_`;
              const productoStock = stockMap.get(key);
              if (!productoStock) {
                this.logger.warn(`No existe stock para "${detalle.descripcion}" en sede ${dto.sedeId}`);
                continue;
              }

              const locked = lockedMap.get(productoStock.id);
              if (!locked) continue;

              const cantidad = Number(detalle.cantidad);
              const stockAnterior = locked.stockActual;
              const stockDisponible =
                stockAnterior -
                locked.stockReservado -
                locked.stockReservadoVenta -
                locked.stockReservadoCombo -
                locked.stockReservadoCotizacion -
                locked.stockDanado -
                locked.stockEnGarantia;

              if (cantidad > stockDisponible) {
                stockDivergencias.push({
                  productoId: detalle.productoId ?? null,
                  varianteId: detalle.varianteId ?? null,
                  comboId: detalle.comboId ?? null,
                  descripcion: detalle.descripcion,
                  cantidadSolicitada: cantidad,
                  stockDisponible,
                });
                continue;
              }

              pendingUpdates.push({
                productoStockId: productoStock.id,
                stockAnterior,
                nuevoStock: stockAnterior - cantidad,
                cantidad,
                descripcion: detalle.descripcion,
                precioCostoSnapshot: detalle.precioCostoSnapshot ?? 0,
              });
            }

            // Si alguno no tiene stock suficiente, abortar TODO con info
            // estructurada. El cliente atrapa el 409 STOCK_INSUFICIENTE
            // y muestra un dialog con los productos afectados + "Ajustar
            // al disponible" como acción rápida (mismo patrón que
            // PRECIO_DESACTUALIZADO).
            if (stockDivergencias.length > 0) {
              throw new ConflictException({
                code: 'STOCK_INSUFICIENTE',
                message: stockDivergencias.length === 1
                  ? `Stock insuficiente para "${stockDivergencias[0].descripcion}". ` +
                    `Disponible: ${stockDivergencias[0].stockDisponible}, ` +
                    `Requerido: ${stockDivergencias[0].cantidadSolicitada}.`
                  : `${stockDivergencias.length} productos con stock insuficiente. ` +
                    `Ajustá las cantidades y volvé a intentar.`,
                divergencias: stockDivergencias,
              });
            }

            // 4d. Aplicar updates + movimientos. Antes era un createMany
            // batch pero el helper de valoración necesita crear de a uno
            // (calcula valorMovimiento = |cantidad| × precioCostoSnapshot).
            // Para una venta POS son pocos items (<20), overhead despreciable.
            for (const u of pendingUpdates) {
              await tx.productoStock.update({
                where: { id: u.productoStockId },
                data: { stockActual: u.nuevoStock },
              });
              await crearMovimientoStockConValoracion(tx, {
                sedeId: dto.sedeId,
                empresaId,
                productoStockId: u.productoStockId,
                tipo: TipoMovimientoStock.SALIDA_VENTA,
                tipoDocumento: 'VENTA',
                numeroDocumento: codigoVenta,
                cantidadAnterior: u.stockAnterior,
                cantidad: -u.cantidad,
                cantidadNueva: u.nuevoStock,
                motivo: `Venta POS ${codigoVenta} - ${u.descripcion}`,
                ventaId: venta.id,
                usuarioId: cajeroId,
                precioCostoUnitario: u.precioCostoSnapshot,
              });
            }
          }
        }

        // 4e. Descontar stock de combos (items con comboId puro: legacy / B2B).
        const detallesConCombo = detallesCalculados.filter(d => d.comboId && !d.productoId && !d.varianteId);
        for (const detalle of detallesConCombo) {
          await this.comboService.descontarStockCombo(
            detalle.comboId!,
            dto.sedeId,
            dto.vendedorId || empresaId,
            Number(detalle.cantidad),
          );
        }

        // 4f. Consumir reservación cuando los items vienen de un combo
        // expandido (frontend Venta Rápida envía componentes con productoId
        // + origenComboId). El stockActual de cada componente ya se
        // descontó en el flujo 4d; aquí solo liberamos la reservación de
        // ComboReservacion + stockReservadoCombo. No-op si no había reserva.
        const detallesPorOrigenCombo = new Map<string, typeof detallesCalculados>();
        for (const d of detallesCalculados) {
          const oc = (d as any).origenComboId;
          if (!oc) continue;
          if (!detallesPorOrigenCombo.has(oc)) detallesPorOrigenCombo.set(oc, []);
          detallesPorOrigenCombo.get(oc)!.push(d);
        }
        for (const [origenComboId, items] of detallesPorOrigenCombo) {
          const componentes = await tx.productoCombo.findMany({
            where: { comboId: origenComboId },
            select: {
              cantidad: true,
              componenteProductoId: true,
              componenteVarianteId: true,
            },
          });
          // Buscar un item que SIGA siendo componente original del combo —
          // la receta pudo modificarse en el carrito (sustituir/quitar el
          // primer componente). Con cualquiera original inferimos cuántos
          // combos representa la venta. Si ninguno original quedó (combo
          // totalmente custom), no consumimos reservación.
          let itemMatch: (typeof items)[number] | undefined;
          let compMatch:
            | { cantidad: number; componenteProductoId: string | null; componenteVarianteId: string | null }
            | undefined;
          for (const it of items) {
            const c = componentes.find(c =>
              (c.componenteProductoId && c.componenteProductoId === it.productoId) ||
              (c.componenteVarianteId && c.componenteVarianteId === it.varianteId),
            );
            if (c && c.cantidad > 0) { itemMatch = it; compMatch = c; break; }
          }
          if (!itemMatch || !compMatch) continue;
          const cantidadCombos = Number(itemMatch.cantidad) / compMatch.cantidad;
          await this.comboService.consumirReservacionCombo(
            tx,
            origenComboId,
            dto.sedeId,
            cantidadCombos,
          );
        }

        // 5. Registrar pagos (batch con createMany)
        if (dto.pagos && dto.pagos.length > 0) {
          await tx.pagoVenta.createMany({
            data: dto.pagos.map((pago) => ({
              ventaId: venta.id,
              metodoPago: pago.metodoPago as any,
              monto: pago.monto,
              referencia: pago.referencia || null,
              banco: pago.banco || null,
              monedaOriginal: pago.monedaOriginal || null,
              montoOriginal: pago.montoOriginal || null,
              tipoCambio: pago.tipoCambio || null,
            })),
          });
        } else if (montoPagadoInmediato > 0) {
          await tx.pagoVenta.create({
            data: {
              ventaId: venta.id,
              metodoPago: dto.metodoPago || 'EFECTIVO',
              monto: Math.min(montoRecibido, totalACobrarHoy),
            },
          });
        }

        // 5a-bis. Adelantos de órdenes de servicio como pagos APLICADOS:
        // la venta queda saldada por el total del servicio. Su dinero ya
        // entró a caja al recibirse (ADELANTO_SERVICIO) — se identifican
        // por la referencia "Adelanto OS-..." y NO van a caja hoy.
        if (adelantoOrdenes > 0) {
          await tx.pagoVenta.createMany({
            data: ordenesACobrar
              .filter((o) => Number(o.adelanto ?? 0) > 0)
              .map((o) => ({
                ventaId: venta.id,
                metodoPago: OrdenServicioService.toMetodoPagoVenta(
                  o.metodoPagoAdelanto,
                ) as any,
                monto: Number(o.adelanto),
                referencia: `Adelanto ${o.codigo}`,
              })),
          });
        }

        // 5b. Generar cuotas si es venta a crédito con cuotas.
        // Las cuotas se generan sobre el TOTAL del documento (SUNAT exige que
        // sumen el total). El adelanto en efectivo (montoPagadoInmediato) se
        // aplica a las primeras cuotas → el saldo financiado = total − adelanto.
        if (esCredito && dto.numeroCuotas && dto.numeroCuotas > 0 && montoCredito > 0) {
          const porcentajeInteres = dto.porcentajeInteres ?? 0;
          const cuotasData = this.generarCuotas(
            venta.id,
            totalACobrarHoy,
            dto.numeroCuotas,
            dto.plazoCredito ?? 30,
            porcentajeInteres,
            new Date(),
            montoPagadoInmediato,
          );
          await tx.cuotaVenta.createMany({ data: cuotasData });

          // Store interest snapshot on venta
          if (porcentajeInteres > 0) {
            const montoInteresTotal = round2(montoCredito * (porcentajeInteres / 100));
            await tx.venta.update({
              where: { id: venta.id },
              data: {
                porcentajeInteres,
                montoInteres: montoInteresTotal,
                totalConInteres: montoCredito + montoInteresTotal,
              },
            });
          }
        }

        // 6. Generar comprobante electrónico (solo BOLETA/FACTURA, no TICKET)
        let comprobanteIdGenerado: string | null = null;
        let comprobanteGenerado: { id: string; codigoGenerado: string } | null = null;
        const tipoComprobante = dto.tipoComprobante || 'TICKET';

        // `diferirComprobante` (flujo Yape pendiente): NO se emite ahora; se
        // emitirá al confirmarse el pago. La intención quedó guardada en las
        // columnas *Diferido de la venta. EXCEPCIÓN: si la venta ya queda
        // pagada al crear (ej. orden 100% adelantada, saldo 0 → estaPagada),
        // no hay pago pendiente que esperar → se emite igual ahora.
        if (
          tipoComprobante !== 'TICKET' &&
          (!opts?.diferirComprobante || estaPagada)
        ) {
        // Validar documento del cliente para comprobante electrónico
        const validacionDoc = validarDocumentoParaComprobante(tipoComprobante, dto.documentoCliente);
        if (!validacionDoc.valido) {
          throw new BadRequestException(validacionDoc.error);
        }

        // Usar sede de facturación si se especificó (multi-RUC), sino la sede operativa
        const sedeIdFacturacion = dto.sedeFacturacionId || dto.sedeId;
        const [sedeLocked] = await tx.$queryRaw<
          Array<{
            id: string;
            serieFactura: string;
            serieBoleta: string;
            ultimoNumeroFactura: number;
            ultimoNumeroBoleta: number;
          }>
        >`SELECT id, "serieFactura", "serieBoleta", "ultimoNumeroFactura", "ultimoNumeroBoleta"
          FROM "Sede" WHERE id = ${sedeIdFacturacion} FOR UPDATE`;

        if (sedeLocked) {
          const serie = tipoComprobante === 'FACTURA'
            ? sedeLocked.serieFactura
            : sedeLocked.serieBoleta;

          // Increment atómico para evitar race conditions en concurrencia
          const campoContador = tipoComprobante === 'FACTURA' ? 'ultimoNumeroFactura' : 'ultimoNumeroBoleta';
          const sedeActualizada = await tx.sede.update({
            where: { id: sedeLocked.id },
            data: { [campoContador]: { increment: 1 } },
            select: { [campoContador]: true },
          });
          const nuevoCorrelativo: number = (sedeActualizada as any)[campoContador];

          const correlativo = String(nuevoCorrelativo);

          const codigoGenerado = `${serie}-${correlativo.padStart(8, '0')}`;

          // Calcular totales tributarios por tipo de afectación
          const tributario = this.calcularTotalesTributarios(detallesCalculados);

          const comprobante = await tx.comprobanteElectronico.create({
            data: {
              ventaId: venta.id,
              empresaId,
              sedeId: dto.sedeFacturacionId || dto.sedeId,
              clienteId: dto.clienteId,
              clienteEmpresaId: dto.clienteEmpresaId,
              tipoComprobante: tipoComprobante as any,
              serie,
              correlativo: correlativo.padStart(8, '0'),
              codigoGenerado,
              tipoDocumento: dto.tipoDocumentoCliente || (tipoComprobante === 'FACTURA' ? '6' : '1'),
              numeroDocumento: dto.documentoCliente,
              nombreCliente: dto.nombreCliente || 'CLIENTE VARIOS',
              direccionCliente: dto.direccionCliente,
              emailCliente: dto.emailCliente,
              moneda: dto.moneda || 'PEN',
              gravada: new Prisma.Decimal(tributario.gravada.toFixed(2)),
              exonerada: new Prisma.Decimal(tributario.exonerada.toFixed(2)),
              inafecta: new Prisma.Decimal(tributario.inafecta.toFixed(2)),
              igv: new Prisma.Decimal(tributario.igv.toFixed(2)),
              totalIgv: new Prisma.Decimal(tributario.igv.toFixed(2)),
              icbper: new Prisma.Decimal(tributario.icbper.toFixed(2)),
              total: new Prisma.Decimal(totalVenta.toFixed(2)),
              estado: 'REGISTRADO' as any,
              detalles: {
                create: detallesCalculados.map((d) => {
                  const subtotalItem = d.subtotal;
                  const igvItem = d.igv;
                  const totalItem = d.total;
                  const cant = d.cantidad || 1;
                  const valorUnit = cant > 0 ? subtotalItem / cant : 0;
                  const precioUnit = cant > 0 ? totalItem / cant : 0;
                  return {
                    descripcion: d.descripcion,
                    cantidad: d.cantidad,
                    tipoAfectacion: d.tipoAfectacion,
                    porcentajeIGV: new Prisma.Decimal(Number(d.porcentajeIGV ?? 18)),
                    valorUnitario: new Prisma.Decimal(valorUnit.toFixed(2)),
                    precioUnitario: new Prisma.Decimal(precioUnit.toFixed(2)),
                    valorVenta: new Prisma.Decimal(subtotalItem.toFixed(2)),
                    igv: new Prisma.Decimal(igvItem.toFixed(2)),
                    icbper: new Prisma.Decimal((d.icbper || 0).toFixed(2)),
                    subtotal: new Prisma.Decimal(subtotalItem.toFixed(2)),
                    total: new Prisma.Decimal(totalItem.toFixed(2)),
                    ...(d.productoId ? { producto: { connect: { id: d.productoId } } } : {}),
                  };
                }),
              },
            },
          });

          // Multi-medio: 1 PagoComprobante por cada PagoVenta no-CREDITO.
          // Si la venta es a crédito puro o no hay pagos[], crear UN registro
          // marcador (PENDIENTE para crédito, COMPLETADO para legacy).
          // Adelantos de órdenes aplicados al comprobante: completan el
          // total (total = adelantos + cobrado hoy).
          const pagosAdelantoComprobante = ordenesACobrar
            .filter((o) => Number(o.adelanto ?? 0) > 0)
            .map((o) => ({
              comprobanteId: comprobante.id,
              metodoPago: OrdenServicioService.toMetodoPagoVenta(
                o.metodoPagoAdelanto,
              ) as string,
              monto: new Prisma.Decimal(Number(o.adelanto).toFixed(2)),
              referencia: `Adelanto ${o.codigo}`,
              estado: 'COMPLETADO',
            }));

          const pagosComprobanteData = (!esCredito && dto.pagos && dto.pagos.length > 0)
            ? dto.pagos
                .filter((p) => p.metodoPago !== 'CREDITO')
                .map((p) => ({
                  comprobanteId: comprobante.id,
                  metodoPago: p.metodoPago,
                  monto: new Prisma.Decimal(Number(p.monto).toFixed(2)),
                  referencia: p.referencia || null,
                  estado: 'COMPLETADO',
                }))
            : (!esCredito &&
                totalACobrarHoy <= 0 &&
                pagosAdelantoComprobante.length > 0)
              // Orden 100% adelantada: el comprobante queda saldado por los
              // adelantos — sin marker de S/ 0.00 que ensucie los pagos.
              ? []
              : [{
                  comprobanteId: comprobante.id,
                  metodoPago: dto.metodoPago || 'EFECTIVO',
                  monto: new Prisma.Decimal(
                    (esCredito ? 0 : Math.min(montoRecibido || totalACobrarHoy, totalACobrarHoy)).toFixed(2),
                  ),
                  estado: esCredito ? 'PENDIENTE' : 'COMPLETADO',
                }];

          await tx.pagoComprobante.createMany({
            data: [...pagosComprobanteData, ...pagosAdelantoComprobante],
          });

          this.logger.log(`Comprobante ${codigoGenerado} generado para venta POS ${venta.codigo}`);
          comprobanteIdGenerado = comprobante.id;
          comprobanteGenerado = { id: comprobante.id, codigoGenerado };
        }
        } // fin if tipoComprobante !== 'TICKET'

        // 6b. Órdenes de servicio cobradas → FINALIZADO + historial +
        // componentes EN_USO + vínculo al comprobante (misma transacción).
        // En el flujo Yape DIFERIDO (aún sin pagar) NO se marcan acá: la orden
        // queda LISTO_ENTREGA (protegida del doble-cobro por el VentaDetalle) y
        // se marca FINALIZADA recién al confirmarse el pago. Si se cancela, el
        // borrado del VentaDetalle la libera sin necesidad de revertir estado.
        let ordenesCobradas: any[] = [];
        if (
          ordenesACobrar.length > 0 &&
          (!opts?.diferirComprobante || estaPagada)
        ) {
          ordenesCobradas =
            await this.ordenServicioService.marcarOrdenesCobradasPorVenta(tx, {
              ordenes: ordenesACobrar,
              ventaCodigo: codigoVenta,
              comprobante: comprobanteGenerado,
              usuarioId: cajeroId,
            });
          this.logger.log(
            `Venta POS ${codigoVenta} cobró ${ordenesCobradas.length} orden(es) de servicio: ` +
              ordenesCobradas.map((o) => o.codigo).join(', '),
          );
        }

        // 7. Registrar movimientos en caja — UNO POR PAGO REAL (multi-medio).
        // Cada PagoVenta no-CREDITO genera su propio MovimientoCaja con su método.
        // Así el cierre Z agrupa correctamente sin necesidad de tocar el groupBy.
        if (montoPagadoInmediato > 0) {
          // OJO: la caja registra solo lo cobrado HOY (totalACobrarHoy =
          // total − adelantos de órdenes; el adelanto ya tuvo su propio
          // movimiento ADELANTO_SERVICIO al recibirse).
          const pagosParaCaja = (dto.pagos && dto.pagos.length > 0)
            ? this.construirPagosParaCaja(dto.pagos, totalACobrarHoy, montoCambio)
            : [{
                metodoPago: dto.metodoPago || 'EFECTIVO',
                monto: Math.min(montoPagadoInmediato, totalACobrarHoy),
              }];

          // Si la venta cobra órdenes de servicio, referenciarlas en la
          // descripción del movimiento (legible en Mi Caja / cierre) y
          // vincular la FK para el badge "OS-XXXXX" (solo si es UNA orden;
          // con varias, la descripción las lista todas).
          // Solo ASCII (sin "—"): la descripción puede terminar impresa en
          // tickets térmicos cuyo code page no la soporta.
          const descripcionCaja = ordenesCobradas.length > 0
            ? `Venta POS ${codigoVenta} - Servicio ${ordenesCobradas
                .map((o) => o.codigo)
                .join(', ')}`
            : `Venta POS ${codigoVenta}`;
          const ordenServicioIdCaja =
            ordenesCobradas.length === 1 ? ordenesCobradas[0].id : undefined;

          for (const p of pagosParaCaja) {
            try {
              await this.cajaService.registrarMovimientoSiHayCaja(
                empresaId,
                dto.sedeId,
                cajeroId,
                {
                  tipo: 'INGRESO' as any,
                  categoria: 'VENTA' as any,
                  metodoPago: p.metodoPago as any,
                  monto: p.monto,
                  descripcion: descripcionCaja,
                  ventaId: venta.id,
                  ordenServicioId: ordenServicioIdCaja,
                },
                tx,
              );
            } catch (e: any) {
              this.logger.warn(`Error registrando movimiento caja (${p.metodoPago}) venta POS ${codigoVenta}: ${e?.message ?? e}`);
            }
          }
        }

        this.logger.log(`Venta POS creada y cobrada: ${venta.codigo}`);
        return { venta, comprobanteIdGenerado, ordenesCobradas };
      },
      { timeout: Math.max(30000, dto.detalles.length * 1000 + 15000) },
    );

    await this.invalidateProductCache(empresaId);

    // Notificar realtime — los cajeros de la empresa ven el stock
    // actualizado en sus cards en <3s. Enviamos un solo evento por
    // sede afectada para no spamear el topic (típicamente todos los
    // items vienen de la misma sede de venta).
    try {
      const productosNotificados = new Set<string>();
      for (const detalle of result.venta.detalles ?? []) {
        // El campo `productoId` puede venir como string en el response.
        const productoId = (detalle as any).productoId as string | null;
        const varianteId = (detalle as any).varianteId as string | null;
        const key = `${productoId ?? ''}::${varianteId ?? ''}`;
        if (productosNotificados.has(key)) continue;
        productosNotificados.add(key);
        this.realtimeInvalidation.notifyStockCambiado({
          empresaId,
          productoId,
          varianteId,
          sedeId: dto.sedeId,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Realtime notify falló (no crítico): ${err?.message ?? err}`);
    }

    // Fire-after-commit: enviar comprobante a Nubefact (no bloquea la venta)
    if (result.comprobanteIdGenerado) {
      this.facturacionService.enviarComprobante(result.comprobanteIdGenerado, empresaId)
        .catch(err => this.logger.warn(`Envío fallido para comprobante ${result.comprobanteIdGenerado}: ${err?.message}`));
    }

    // Fire-after-commit: push al cliente + aviso mantenimiento de las
    // órdenes de servicio cobradas (no bloquea la venta)
    if (result.ordenesCobradas?.length > 0) {
      this.ordenServicioService
        .procesarPostCobroOrdenes(empresaId, result.ordenesCobradas)
        .catch((err) =>
          this.logger.warn(
            `Post-cobro órdenes falló (no crítico): ${err?.message ?? err}`,
          ),
        );
    }

    return result.venta;
  }

  /**
   * Crea una venta Yape/Plin con REGISTRO DIFERIDO: nace CONFIRMADA con el stock
   * descontado pero SIN comprobante (se emite al confirmarse el pago) y SIN
   * caja/pago. Si se cancela/expira sin pagar → se BORRA (devuelve stock), no
   * deja venta ANULADA ni boleta. Reusa `crearYCobrar` con `diferirComprobante`.
   *
   * Soporta productos, variantes y ÓRDENES DE SERVICIO. NO soporta combos (sus
   * reservas propias complican el borrado) → esos carritos van por el cobro
   * estándar inmediato.
   */
  async crearVentaYapeDiferida(
    empresaId: string,
    dto: CrearYCobrarVentaDto,
    cajeroId: string,
  ) {
    const tieneCombo = dto.detalles?.some(
      (d) => (d as any).comboId || (d as any).origenComboId,
    );
    if (tieneCombo) {
      throw new BadRequestException(
        'El cobro Yape diferido no soporta combos. Usá el cobro estándar.',
      );
    }
    return this.crearYCobrar(empresaId, dto, cajeroId, {
      diferirComprobante: true,
    });
  }

  /**
   * Emite el comprobante electrónico (BOLETA/FACTURA) de una venta dentro de la
   * transacción `tx`: bloquea la sede (FOR UPDATE), incrementa el correlativo,
   * crea el ComprobanteElectronico con sus detalles y los PagoComprobante.
   *
   * Extraído de `crearYCobrar` (sin cambio de comportamiento) para poder
   * reutilizarlo al EMITIR EL COMPROBANTE EN EL MOMENTO DEL PAGO (flujo Yape
   * diferido), no al crear la venta. Por eso `pagos`/`metodoPagoFallback` se
   * reciben como parámetro (al crear = dto.pagos; al finalizar Yape = el pago
   * Yape confirmado). Devuelve null si la sede no tiene serie configurada.
   */
  private async _emitirComprobante(
    tx: any,
    p: {
      empresaId: string;
      ventaId: string;
      ventaCodigo: string;
      tipoComprobante: string;
      detallesCalculados: any[];
      cliente: {
        documentoCliente?: string | null;
        clienteId?: string | null;
        clienteEmpresaId?: string | null;
        tipoDocumentoCliente?: string | null;
        nombreCliente?: string | null;
        direccionCliente?: string | null;
        emailCliente?: string | null;
      };
      sedeFacturacionId?: string | null;
      sedeId: string;
      moneda?: string | null;
      pagos?: Array<{ metodoPago: string; monto: number; referencia?: string | null }>;
      metodoPagoFallback?: string | null;
      ordenesACobrar: any[];
      esCredito: boolean;
      totalVenta: number;
      totalACobrarHoy: number;
      montoRecibido: number;
    },
  ): Promise<{ comprobanteId: string; codigoGenerado: string } | null> {
    // Validar documento del cliente para comprobante electrónico
    const validacionDoc = validarDocumentoParaComprobante(
      p.tipoComprobante,
      p.cliente.documentoCliente ?? undefined,
    );
    if (!validacionDoc.valido) {
      throw new BadRequestException(validacionDoc.error);
    }

    // Usar sede de facturación si se especificó (multi-RUC), sino la sede operativa
    const sedeIdFacturacion = p.sedeFacturacionId || p.sedeId;
    const [sedeLocked] = await tx.$queryRaw<
      Array<{
        id: string;
        serieFactura: string;
        serieBoleta: string;
        ultimoNumeroFactura: number;
        ultimoNumeroBoleta: number;
      }>
    >`SELECT id, "serieFactura", "serieBoleta", "ultimoNumeroFactura", "ultimoNumeroBoleta"
        FROM "Sede" WHERE id = ${sedeIdFacturacion} FOR UPDATE`;

    if (!sedeLocked) return null;

    const serie =
      p.tipoComprobante === 'FACTURA'
        ? sedeLocked.serieFactura
        : sedeLocked.serieBoleta;

    // Increment atómico para evitar race conditions en concurrencia
    const campoContador =
      p.tipoComprobante === 'FACTURA'
        ? 'ultimoNumeroFactura'
        : 'ultimoNumeroBoleta';
    const sedeActualizada = await tx.sede.update({
      where: { id: sedeLocked.id },
      data: { [campoContador]: { increment: 1 } },
      select: { [campoContador]: true },
    });
    const nuevoCorrelativo: number = (sedeActualizada as any)[campoContador];

    const correlativo = String(nuevoCorrelativo);
    const codigoGenerado = `${serie}-${correlativo.padStart(8, '0')}`;

    // Calcular totales tributarios por tipo de afectación
    const tributario = this.calcularTotalesTributarios(p.detallesCalculados);

    const comprobante = await tx.comprobanteElectronico.create({
      data: {
        ventaId: p.ventaId,
        empresaId: p.empresaId,
        sedeId: p.sedeFacturacionId || p.sedeId,
        clienteId: p.cliente.clienteId,
        clienteEmpresaId: p.cliente.clienteEmpresaId,
        tipoComprobante: p.tipoComprobante as any,
        serie,
        correlativo: correlativo.padStart(8, '0'),
        codigoGenerado,
        tipoDocumento:
          p.cliente.tipoDocumentoCliente ||
          (p.tipoComprobante === 'FACTURA' ? '6' : '1'),
        numeroDocumento: p.cliente.documentoCliente,
        nombreCliente: p.cliente.nombreCliente || 'CLIENTE VARIOS',
        direccionCliente: p.cliente.direccionCliente,
        emailCliente: p.cliente.emailCliente,
        moneda: p.moneda || 'PEN',
        gravada: new Prisma.Decimal(tributario.gravada.toFixed(2)),
        exonerada: new Prisma.Decimal(tributario.exonerada.toFixed(2)),
        inafecta: new Prisma.Decimal(tributario.inafecta.toFixed(2)),
        igv: new Prisma.Decimal(tributario.igv.toFixed(2)),
        totalIgv: new Prisma.Decimal(tributario.igv.toFixed(2)),
        icbper: new Prisma.Decimal(tributario.icbper.toFixed(2)),
        total: new Prisma.Decimal(p.totalVenta.toFixed(2)),
        estado: 'REGISTRADO' as any,
        detalles: {
          create: p.detallesCalculados.map((d) => {
            const subtotalItem = d.subtotal;
            const igvItem = d.igv;
            const totalItem = d.total;
            const cant = d.cantidad || 1;
            const valorUnit = cant > 0 ? subtotalItem / cant : 0;
            const precioUnit = cant > 0 ? totalItem / cant : 0;
            return {
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              tipoAfectacion: d.tipoAfectacion,
              porcentajeIGV: new Prisma.Decimal(Number(d.porcentajeIGV ?? 18)),
              valorUnitario: new Prisma.Decimal(valorUnit.toFixed(2)),
              precioUnitario: new Prisma.Decimal(precioUnit.toFixed(2)),
              valorVenta: new Prisma.Decimal(subtotalItem.toFixed(2)),
              igv: new Prisma.Decimal(igvItem.toFixed(2)),
              icbper: new Prisma.Decimal((d.icbper || 0).toFixed(2)),
              subtotal: new Prisma.Decimal(subtotalItem.toFixed(2)),
              total: new Prisma.Decimal(totalItem.toFixed(2)),
              ...(d.productoId
                ? { producto: { connect: { id: d.productoId } } }
                : {}),
            };
          }),
        },
      },
    });

    // Multi-medio: 1 PagoComprobante por cada PagoVenta no-CREDITO.
    // Si la venta es a crédito puro o no hay pagos[], crear UN registro
    // marcador (PENDIENTE para crédito, COMPLETADO para legacy).
    // Adelantos de órdenes aplicados al comprobante: completan el
    // total (total = adelantos + cobrado hoy).
    const pagosAdelantoComprobante = p.ordenesACobrar
      .filter((o) => Number(o.adelanto ?? 0) > 0)
      .map((o) => ({
        comprobanteId: comprobante.id,
        metodoPago: OrdenServicioService.toMetodoPagoVenta(
          o.metodoPagoAdelanto,
        ) as string,
        monto: new Prisma.Decimal(Number(o.adelanto).toFixed(2)),
        referencia: `Adelanto ${o.codigo}`,
        estado: 'COMPLETADO',
      }));

    const pagosComprobanteData =
      !p.esCredito && p.pagos && p.pagos.length > 0
        ? p.pagos
            .filter((pago) => pago.metodoPago !== 'CREDITO')
            .map((pago) => ({
              comprobanteId: comprobante.id,
              metodoPago: pago.metodoPago,
              monto: new Prisma.Decimal(Number(pago.monto).toFixed(2)),
              referencia: pago.referencia || null,
              estado: 'COMPLETADO',
            }))
        : !p.esCredito &&
            p.totalACobrarHoy <= 0 &&
            pagosAdelantoComprobante.length > 0
          ? []
          : [
              {
                comprobanteId: comprobante.id,
                metodoPago: p.metodoPagoFallback || 'EFECTIVO',
                monto: new Prisma.Decimal(
                  (p.esCredito
                    ? 0
                    : Math.min(
                        p.montoRecibido || p.totalACobrarHoy,
                        p.totalACobrarHoy,
                      )
                  ).toFixed(2),
                ),
                estado: p.esCredito ? 'PENDIENTE' : 'COMPLETADO',
              },
            ];

    await tx.pagoComprobante.createMany({
      data: [...pagosComprobanteData, ...pagosAdelantoComprobante],
    });

    this.logger.log(
      `Comprobante ${codigoGenerado} generado para venta POS ${p.ventaCodigo}`,
    );
    return { comprobanteId: comprobante.id, codigoGenerado };
  }

  /**
   * Crear venta desde cotización aprobada
   */
  async crearDesdeCotizacion(
    empresaId: string,
    cotizacionId: string,
    dto: CreateVentaDesdeCotizacionDto,
    cajeroId?: string,
  ) {
    this.logger.info('Creando venta desde cotizacion', {
      empresaId,
      cotizacionId,
    });

    // Cotización = atención presencial → requiere caja abierta del cajero,
    // PERO solo si hay cobro nuevo en esta conversión. Una cotización ya
    // pagada por completo (adelantos digitales acumulados, dinero en la
    // Caja Central/Tesorería) solo emite el comprobante y descuenta el
    // stock reservado — sin movimientos en la caja del cajero.
    const hayCobroNuevo =
      (dto.pagos?.length ?? 0) > 0 || (dto.montoRecibido ?? 0) > 0;
    if (cajeroId && hayCobroNuevo) {
      const cajaActiva = await this.prisma.caja.findFirst({
        where: { empresaId, usuarioId: cajeroId, estado: 'ABIERTA' },
      });
      if (!cajaActiva) {
        throw new BadRequestException(
          'Debe abrir una caja antes de cobrar cotizaciones. Vaya a Caja → Abrir Caja.',
        );
      }
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
      // 1. Validar cotización
      const cotizacion = await tx.cotizacion.findFirst({
        where: { id: cotizacionId, empresaId },
        include: {
          detalles: { orderBy: { orden: 'asc' } },
        },
      });

      if (!cotizacion) {
        throw new NotFoundException('Cotizacion no encontrada');
      }

      if (
        cotizacion.estado !== EstadoCotizacion.APROBADA &&
        cotizacion.estado !== EstadoCotizacion.PENDIENTE
      ) {
        throw new BadRequestException(
          'La cotizacion debe estar en estado PENDIENTE o APROBADA para convertirla a venta',
        );
      }

      // 1b. Si está en PENDIENTE, aprobar automáticamente dentro de la transacción
      if (cotizacion.estado === EstadoCotizacion.PENDIENTE) {
        await tx.cotizacion.update({
          where: { id: cotizacion.id },
          data: { estado: EstadoCotizacion.APROBADA },
        });
      }

      // 2. Protección contra duplicados
      if (cotizacion.ventaId) {
        throw new BadRequestException(
          'Esta cotización ya fue convertida a venta',
        );
      }

      // 2b. Cliente efectivo: el cajero puede cambiar el cliente al cobrar
      // (ej. cotización a CLIENTES VARIOS que al pagar pide FACTURA con RUC).
      // Sin override, la venta hereda el cliente de la cotización.
      const hayClienteOverride =
        !!dto.clienteId ||
        !!dto.clienteEmpresaId ||
        dto.nombreCliente !== undefined ||
        dto.documentoCliente !== undefined;
      const clienteVenta = {
        clienteId: cotizacion.clienteId,
        clienteEmpresaId: cotizacion.clienteEmpresaId,
        nombreCliente: cotizacion.nombreCliente,
        documentoCliente: cotizacion.documentoCliente,
        direccionCliente: cotizacion.direccionCliente,
      };
      if (hayClienteOverride) {
        if (dto.clienteId) {
          const cli = await tx.empresaPersona.findFirst({
            where: { id: dto.clienteId, empresaId },
            select: { id: true },
          });
          if (!cli) {
            throw new BadRequestException(
              'El cliente no pertenece a la empresa',
            );
          }
        }
        if (dto.clienteEmpresaId) {
          const ce = await tx.clienteEmpresa.findFirst({
            where: { id: dto.clienteEmpresaId, empresaId },
            select: { id: true },
          });
          if (!ce) {
            throw new BadRequestException(
              'El cliente B2B no pertenece a la empresa',
            );
          }
        }
        clienteVenta.clienteId = dto.clienteId ?? null;
        clienteVenta.clienteEmpresaId = dto.clienteEmpresaId ?? null;
        clienteVenta.nombreCliente = dto.nombreCliente ?? null;
        clienteVenta.documentoCliente = dto.documentoCliente ?? null;
        clienteVenta.direccionCliente = dto.direccionCliente ?? null;
      }

      // 3. Generar código de venta
      const { codigoVenta } =
        await this.configuracionCodigos.generarCodigoVenta(
          empresaId,
          cotizacion.sedeId,
          tx,
        );

      // 3b. Filtrar detalles excluidos, ajustar cantidades y aplicar
      //     descuentos por línea del cajero (cola POS).
      const excluirIds = new Set(dto.excluirDetalleIds ?? []);
      const ajustes = dto.ajustarCantidades ?? {};
      const ajustesDescuento = dto.ajustarDescuentos ?? {};
      const hayModificaciones =
        excluirIds.size > 0 ||
        Object.keys(ajustes).length > 0 ||
        Object.keys(ajustesDescuento).length > 0;

      // 2c. Resolver las RESERVAS de stock de la cotización ANTES de
      // descontar stock: los detalles INCLUIDOS consumen su reserva (pasa
      // a la venta → CONVERTIDA) y los EXCLUIDOS la liberan (LIBERADA,
      // vuelve al disponible). Sin esto: (a) la propia reserva bloqueaba
      // la conversión ("stock insuficiente" contra sí misma, porque el
      // guard resta stockReservadoCotizacion), y (b) las reservas quedaban
      // ACTIVAS para siempre tras la venta (stock fantasma).
      for (const det of cotizacion.detalles) {
        if (
          det.reservaEstado !== ReservaCotizacionEstado.ACTIVA ||
          !det.productoStockId ||
          !det.cantidadReservada
        ) {
          continue;
        }
        await tx.productoStock.update({
          where: { id: det.productoStockId },
          data: {
            stockReservadoCotizacion: { decrement: det.cantidadReservada },
          },
        });
        await tx.cotizacionDetalle.update({
          where: { id: det.id },
          data: {
            reservaEstado: excluirIds.has(det.id)
              ? ReservaCotizacionEstado.LIBERADA
              : ReservaCotizacionEstado.CONVERTIDA,
          },
        });
      }

      // Filtrar excluidos y aplicar ajustes de cantidad/descuento
      const detallesVenta = cotizacion.detalles
        .filter((d) => !excluirIds.has(d.id))
        .map((d) => {
          const tieneAjusteCant = ajustes[d.id] !== undefined;
          const tieneAjusteDesc = ajustesDescuento[d.id] !== undefined;
          if (!tieneAjusteCant && !tieneAjusteDesc) return d;

          const nuevaCantidad = tieneAjusteCant ? ajustes[d.id] : Number(d.cantidad);
          const precioUnit = Number(d.precioUnitario);
          // Descuento de la línea: el indicado por el cajero (monto total de
          // la línea) o el original prorrateado a la nueva cantidad.
          const descUnit = Number(d.descuento) / Number(d.cantidad);
          const nuevoDescuento = tieneAjusteDesc
            ? round2(Math.max(0, ajustesDescuento[d.id]))
            : descUnit * nuevaCantidad;
          const brutoLinea = precioUnit * nuevaCantidad;
          if (nuevoDescuento > brutoLinea) {
            throw new BadRequestException(
              `El descuento de "${d.descripcion}" (S/ ${nuevoDescuento.toFixed(2)}) supera el importe de la línea (S/ ${brutoLinea.toFixed(2)})`,
            );
          }
          const nuevoSubtotal = brutoLinea - nuevoDescuento;
          const porcentajeIGV = Number(d.porcentajeIGV) / 100;
          const nuevoIgv = round2(nuevoSubtotal * porcentajeIGV);
          const nuevoTotal = nuevoSubtotal + nuevoIgv;
          return {
            ...d,
            cantidad: new Prisma.Decimal(nuevaCantidad),
            descuento: new Prisma.Decimal(nuevoDescuento.toFixed(2)),
            subtotal: new Prisma.Decimal(nuevoSubtotal.toFixed(2)),
            igv: new Prisma.Decimal(nuevoIgv.toFixed(2)),
            total: new Prisma.Decimal(nuevoTotal.toFixed(2)),
          };
        });

      if (detallesVenta.length === 0) {
        throw new BadRequestException(
          'No quedan items para crear la venta',
        );
      }

      // Hidratar snapshot de costo + motivo liquidacion para cada linea
      // (cotizacion + adicionales). Sin esto el reporte de liquidaciones
      // los ignora y el guard no se dispara.
      const snapshotsCotizacion = await this._hidratarSnapshotsCotizacion(
        detallesVenta,
        cotizacion.sedeId,
      );

      // Recalcular totales si hubo modificaciones
      let subtotalVenta: number;
      let descuentoVenta: number;
      let impuestosVenta: number;
      let totalVenta: number;

      // 3c. Procesar items adicionales agregados por el cajero
      const snapshotsAdicionales = await this._hidratarSnapshotsAdicionales(
        dto.itemsAdicionales ?? [],
        cotizacion.sedeId,
      );
      const itemsAdicionales = (dto.itemsAdicionales ?? []).map((item, idx) => {
        const cantidad = item.cantidad;
        const precioUnitario = item.precioUnitario;
        const descuento = item.descuento ?? 0;
        const porcentajeIGV = item.porcentajeIGV ?? 18;
        const tipoAfectacion = item.tipoAfectacion || (porcentajeIGV > 0 ? '10' : '10');
        const icbperMonto = item.icbper ?? 0;
        const subtotal = (cantidad * precioUnitario) - descuento;
        const igv = round2(subtotal * (porcentajeIGV / 100));
        const total = subtotal + igv + icbperMonto;
        const snap = snapshotsAdicionales[idx];
        const descuentoUnit = cantidad > 0 ? descuento / cantidad : 0;
        const margenUnit = (precioUnitario - descuentoUnit) - snap.precioCostoSnapshot;
        return {
          productoId: item.productoId || null,
          varianteId: item.varianteId || null,
          servicioId: item.servicioId || null,
          descripcion: item.descripcion,
          cantidad: new Prisma.Decimal(cantidad),
          precioUnitario: new Prisma.Decimal(precioUnitario),
          descuento: new Prisma.Decimal(descuento),
          tipoAfectacion,
          porcentajeIGV: new Prisma.Decimal(porcentajeIGV),
          igv: new Prisma.Decimal(igv.toFixed(2)),
          icbper: new Prisma.Decimal(round2(icbperMonto)),
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          total: new Prisma.Decimal(total.toFixed(2)),
          orden: 0,
          precioCostoSnapshot: new Prisma.Decimal(snap.precioCostoSnapshot.toFixed(2)),
          margenSnapshot: new Prisma.Decimal((round2(margenUnit)).toFixed(2)),
          motivoLiquidacionSnapshot: snap.motivoLiquidacionSnapshot,
          nivelAplicadoSnapshot: snap.nivelAplicadoSnapshot,
          // Guardar valores numéricos para stock + guard
          _cantidad: cantidad,
          _subtotal: subtotal,
          _descuento: descuento,
          _igv: igv,
          _total: total,
          _precioCosto: snap.precioCostoSnapshot,
          _margen: margenUnit,
          _motivoLiq: snap.motivoLiquidacionSnapshot,
          _precioUnitario: precioUnitario,
        };
      });

      // 3d. Guard venta bajo costo combinado (cotizacion + adicionales).
      const lineasParaGuard = [
        ...detallesVenta.map((d, i) => ({
          descripcion: d.descripcion,
          productoId: d.productoId,
          varianteId: d.varianteId,
          cantidad: Number(d.cantidad),
          precioUnitario: Number(d.precioUnitario),
          descuento: Number(d.descuento),
          precioCostoSnapshot: snapshotsCotizacion[i].precioCostoSnapshot,
          margenSnapshot: snapshotsCotizacion[i].margenSnapshot,
          motivoLiquidacionSnapshot: snapshotsCotizacion[i].motivoLiquidacionSnapshot,
        })),
        ...itemsAdicionales.map((d) => ({
          descripcion: d.descripcion,
          productoId: d.productoId,
          varianteId: d.varianteId,
          cantidad: d._cantidad,
          precioUnitario: d._precioUnitario,
          descuento: d._descuento,
          precioCostoSnapshot: d._precioCosto,
          margenSnapshot: d._margen,
          motivoLiquidacionSnapshot: d._motivoLiq,
        })),
      ];
      const perdidaTotalCot = await this.validarVentaBajoCosto(
        empresaId,
        lineasParaGuard,
        dto.ventaBajoCostoAutorizadaPorId ?? null,
      );

      const hayItems = hayModificaciones || itemsAdicionales.length > 0;

      if (hayItems) {
        const cotSubtotal = detallesVenta.reduce((sum, d) => sum + Number(d.subtotal || 0), 0);
        const cotDescuento = detallesVenta.reduce((sum, d) => sum + Number(d.descuento || 0), 0);
        const cotImpuestos = detallesVenta.reduce((sum, d) => sum + Number(d.igv || 0), 0);
        const cotTotal = detallesVenta.reduce((sum, d) => sum + Number(d.total || 0), 0);

        const addSubtotal = itemsAdicionales.reduce((sum, i) => sum + i._subtotal, 0);
        const addDescuento = itemsAdicionales.reduce((sum, i) => sum + i._descuento, 0);
        const addImpuestos = itemsAdicionales.reduce((sum, i) => sum + i._igv, 0);
        const addTotal = itemsAdicionales.reduce((sum, i) => sum + i._total, 0);

        subtotalVenta = cotSubtotal + addSubtotal;
        descuentoVenta = cotDescuento + addDescuento;
        impuestosVenta = cotImpuestos + addImpuestos;
        totalVenta = cotTotal + addTotal;
      } else {
        subtotalVenta = Number(cotizacion.subtotal);
        descuentoVenta = Number(cotizacion.descuento);
        impuestosVenta = Number(cotizacion.impuestos);
        totalVenta = Number(cotizacion.total);
      }

      // Descuento GLOBAL del cajero (cola POS): se resta del total final,
      // mismo criterio que crearYCobrar. La defensa de neto negativo (con
      // el adelanto de la cotización aplicado) va más abajo.
      const descuentoGlobalCot = round2(dto.descuentoGlobal || 0);
      if (descuentoGlobalCot > 0) {
        if (descuentoGlobalCot >= totalVenta) {
          throw new BadRequestException(
            `El descuento global (S/ ${descuentoGlobalCot.toFixed(2)}) no puede igualar o superar el total (S/ ${totalVenta.toFixed(2)})`,
          );
        }
        descuentoVenta = round2(descuentoVenta + descuentoGlobalCot);
        totalVenta = round2(totalVenta - descuentoGlobalCot);
      }

      // Adelanto previo de la cotización (categoria ADELANTO_COTIZACION).
      // Si existe, se aplica como pago previo de la venta — el cliente
      // solo debe cubrir el saldo restante hoy. NO se duplica en caja:
      // el MovimientoCaja del adelanto sigue existiendo en su caja del
      // día original (que probablemente ya cerró). Acá solo se vincula
      // a la venta nueva y se registra como PagoVenta adicional.
      const adelantoAplicado = Number(cotizacion.adelantoMonto ?? 0);
      // Defensa: el descuento global no puede dejar el total por debajo del
      // adelanto ya pagado (la venta saldría "pagada de más").
      if (descuentoGlobalCot > 0 && adelantoAplicado > totalVenta) {
        throw new BadRequestException(
          `El adelanto ya pagado (S/ ${adelantoAplicado.toFixed(2)}) supera el total con descuento (S/ ${totalVenta.toFixed(2)}). Reducí el descuento global.`,
        );
      }
      const totalAPagarHoy = Math.max(0, totalVenta - adelantoAplicado);

      const montoCambio =
        dto.montoRecibido && dto.montoRecibido > totalAPagarHoy
          ? round2(dto.montoRecibido - totalAPagarHoy)
          : null;

      // Determinar estado de la venta. Considera adelanto + pagos del día.
      const esCredito = dto.esCredito ?? false;
      const totalPagadoEnEstaTx = !esCredito
        ? ((dto.pagos && dto.pagos.length > 0)
            ? dto.pagos
                .filter((p) => p.metodoPago !== 'CREDITO')
                .reduce((s, p) => s + Number(p.monto), 0)
            : Number(dto.montoRecibido ?? 0))
        : 0;
      const estaPagada =
        !esCredito &&
        (adelantoAplicado + totalPagadoEnEstaTx) >= totalVenta - 0.005;

      const contactoCotizacion = await this.completarContactoCliente(
        clienteVenta.clienteId,
        {
          telefono: cotizacion.telefonoCliente,
          email: cotizacion.emailCliente,
          direccion: clienteVenta.direccionCliente,
        },
      );

      // 4. Crear venta con datos de la cotización
      const venta = await tx.venta.create({
        data: {
          empresaId,
          sedeId: cotizacion.sedeId,
          clienteId: clienteVenta.clienteId,
          clienteEmpresaId: clienteVenta.clienteEmpresaId,
          vendedorId: cotizacion.vendedorId,
          cajeroId: cajeroId || null,
          canalVenta: 'COTIZACION',
          cotizacionId: cotizacion.id,
          codigo: codigoVenta,
          nombreCliente: clienteVenta.nombreCliente,
          documentoCliente: clienteVenta.documentoCliente,
          emailCliente: contactoCotizacion.email,
          telefonoCliente: contactoCotizacion.telefono,
          direccionCliente: contactoCotizacion.direccion,
          moneda: cotizacion.moneda,
          tipoCambio: cotizacion.tipoCambio,
          subtotal: new Prisma.Decimal(subtotalVenta.toFixed(2)),
          descuento: new Prisma.Decimal(descuentoVenta.toFixed(2)),
          impuestos: new Prisma.Decimal(impuestosVenta.toFixed(2)),
          total: new Prisma.Decimal(totalVenta.toFixed(2)),
          descuentoGlobal:
            descuentoGlobalCot > 0
              ? new Prisma.Decimal(descuentoGlobalCot.toFixed(2))
              : null,
          descuentoGlobalPorcentaje:
            descuentoGlobalCot > 0 ? dto.descuentoGlobalPorcentaje ?? null : null,
          // El autorizador aplica a CUALQUIER descuento del cajero (global
          // o por línea), no solo al global.
          descuentoAutorizadoPorId:
            descuentoGlobalCot > 0 || Object.keys(ajustesDescuento).length > 0
              ? dto.descuentoAutorizadoPorId ?? null
              : null,
          descuentoAutorizadoEn:
            (descuentoGlobalCot > 0 ||
              Object.keys(ajustesDescuento).length > 0) &&
            dto.descuentoAutorizadoPorId
              ? new Date()
              : null,
          metodoPago: this.resolverMetodoPagoVenta(dto.pagos, dto.metodoPago),
          montoRecibido: dto.montoRecibido,
          montoCambio,
          esCredito,
          plazoCredito: dto.plazoCredito,
          fechaVencimientoPago: dto.fechaVencimientoPago
            ? new Date(dto.fechaVencimientoPago)
            : null,
          observaciones: dto.observaciones ?? cotizacion.observaciones,
          perdidaTotalLineas: perdidaTotalCot,
          ventaBajoCostoAutorizadaPorId:
            perdidaTotalCot != null ? dto.ventaBajoCostoAutorizadaPorId ?? null : null,
          ventaBajoCostoAutorizadaEn:
            perdidaTotalCot != null && dto.ventaBajoCostoAutorizadaPorId
              ? new Date()
              : null,
          // Venta POS: CONFIRMADA (con stock descontado) o PAGADA_COMPLETA
          estado: estaPagada ? EstadoVenta.PAGADA_COMPLETA : EstadoVenta.CONFIRMADA,
          detalles: {
            create: [
              ...detallesVenta.map((d, i) => ({
                productoId: d.productoId,
                varianteId: d.varianteId,
                servicioId: d.servicioId,
                descripcion: d.descripcion,
                cantidad: d.cantidad,
                precioUnitario: d.precioUnitario,
                descuento: d.descuento,
                tipoAfectacion: d.tipoAfectacion,
                porcentajeIGV: d.porcentajeIGV,
                igv: d.igv,
                icbper: d.icbper,
                subtotal: d.subtotal,
                total: d.total,
                orden: d.orden,
                precioCostoSnapshot: new Prisma.Decimal(
                  snapshotsCotizacion[i].precioCostoSnapshot.toFixed(2),
                ),
                margenSnapshot: new Prisma.Decimal(
                  snapshotsCotizacion[i].margenSnapshot.toFixed(2),
                ),
                motivoLiquidacionSnapshot:
                  snapshotsCotizacion[i].motivoLiquidacionSnapshot,
                nivelAplicadoSnapshot:
                  snapshotsCotizacion[i].nivelAplicadoSnapshot,
              })),
              ...itemsAdicionales.map((d, i) => ({
                productoId: d.productoId,
                varianteId: d.varianteId,
                servicioId: d.servicioId,
                descripcion: d.descripcion,
                cantidad: d.cantidad,
                precioUnitario: d.precioUnitario,
                descuento: d.descuento,
                tipoAfectacion: d.tipoAfectacion,
                porcentajeIGV: d.porcentajeIGV,
                igv: d.igv,
                icbper: d.icbper,
                subtotal: d.subtotal,
                total: d.total,
                orden: detallesVenta.length + i,
                precioCostoSnapshot: d.precioCostoSnapshot,
                margenSnapshot: d.margenSnapshot,
                motivoLiquidacionSnapshot: d.motivoLiquidacionSnapshot,
                nivelAplicadoSnapshot: d.nivelAplicadoSnapshot,
              })),
            ],
          },
        },
        include: this.getInclude(),
      });

      // 5. Descontar stock de productos (venta POS = confirmación inmediata)
      const todosLosDetalles = [...detallesVenta, ...itemsAdicionales];
      for (const detalle of todosLosDetalles) {
        if (!detalle.productoId && !detalle.varianteId) {
          continue; // Servicios no afectan stock
        }

        const productoStock = await tx.productoStock.findFirst({
          where: {
            sedeId: cotizacion.sedeId,
            ...(detalle.varianteId
              ? { varianteId: detalle.varianteId }
              : { productoId: detalle.productoId, varianteId: null }),
          },
        });

        if (!productoStock) {
          this.logger.warn(`No existe stock para "${detalle.descripcion}" en sede ${cotizacion.sedeId}`);
          continue;
        }

        // Lock para concurrencia — lectura con todos los campos de reserva
        const [stockLocked] = await tx.$queryRaw<
          Array<{
            id: string;
            stockActual: number;
            stockReservado: number;
            stockReservadoVenta: number;
            stockReservadoCombo: number;
            stockReservadoCotizacion: number;
            stockDanado: number;
            stockEnGarantia: number;
          }>
        >`SELECT id, "stockActual", "stockReservado", "stockReservadoVenta",
                "stockReservadoCombo", "stockReservadoCotizacion",
                "stockDanado", "stockEnGarantia"
         FROM "ProductoStock" WHERE id = ${productoStock.id} FOR UPDATE`;

        if (!stockLocked) continue;

        const cantidad = Number(detalle.cantidad);
        const stockAnterior = stockLocked.stockActual;
        const stockDisponible =
          stockAnterior -
          stockLocked.stockReservado -
          stockLocked.stockReservadoVenta -
          stockLocked.stockReservadoCombo -
          stockLocked.stockReservadoCotizacion -
          stockLocked.stockDanado -
          stockLocked.stockEnGarantia;

        if (cantidad > stockDisponible) {
          throw new BadRequestException(
            `Stock insuficiente para "${detalle.descripcion}". Disponible: ${stockDisponible}, Requerido: ${cantidad}`,
          );
        }

        const nuevoStock = stockAnterior - cantidad;

        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: { stockActual: nuevoStock },
        });

        await crearMovimientoStockConValoracion(tx, {
          sedeId: cotizacion.sedeId,
          empresaId,
          productoStockId: productoStock.id,
          tipo: TipoMovimientoStock.SALIDA_VENTA,
          tipoDocumento: 'VENTA',
          numeroDocumento: codigoVenta,
          cantidadAnterior: stockAnterior,
          cantidad: -cantidad,
          cantidadNueva: nuevoStock,
          motivo: `Venta POS ${codigoVenta} - ${detalle.descripcion}`,
          ventaId: venta.id,
          usuarioId: cotizacion.vendedorId,
          precioCostoUnitario: (detalle as any).precioCostoSnapshot ?? undefined,
        });
      }

      // 5b. Descontar stock de combos (items con comboId puro)
      const detallesCombo = todosLosDetalles.filter(d => (d as any).comboId && !d.productoId && !d.varianteId);
      for (const detalle of detallesCombo) {
        await this.comboService.descontarStockCombo(
          (detalle as any).comboId,
          cotizacion.sedeId,
          cotizacion.vendedorId || empresaId,
          Number(detalle.cantidad),
        );
      }

      // 5c. Consumir reservación para items expandidos de combo (origenComboId).
      const detallesPorOrigenCombo = new Map<string, any[]>();
      for (const d of todosLosDetalles as any[]) {
        const oc = d.origenComboId;
        if (!oc) continue;
        if (!detallesPorOrigenCombo.has(oc)) detallesPorOrigenCombo.set(oc, []);
        detallesPorOrigenCombo.get(oc)!.push(d);
      }
      for (const [origenComboId, items] of detallesPorOrigenCombo) {
        const componentes = await tx.productoCombo.findMany({
          where: { comboId: origenComboId },
          select: {
            cantidad: true,
            componenteProductoId: true,
            componenteVarianteId: true,
          },
        });
        // Buscar un item que siga siendo componente original (la receta
        // pudo modificarse en el carrito). Con cualquiera inferimos cuántos
        // combos representa la venta.
        let itemMatch: any;
        let compMatch:
          | { cantidad: number; componenteProductoId: string | null; componenteVarianteId: string | null }
          | undefined;
        for (const it of items) {
          const c = componentes.find(c =>
            (c.componenteProductoId && c.componenteProductoId === it.productoId) ||
            (c.componenteVarianteId && c.componenteVarianteId === it.varianteId),
          );
          if (c && c.cantidad > 0) { itemMatch = it; compMatch = c; break; }
        }
        if (!itemMatch || !compMatch) continue;
        const cantidadCombos = Number(itemMatch.cantidad) / compMatch.cantidad;
        await this.comboService.consumirReservacionCombo(
          tx,
          origenComboId,
          cotizacion.sedeId,
          cantidadCombos,
        );
      }

      // 6. Registrar pagos (múltiples o único legacy)
      if (dto.pagos && dto.pagos.length > 0 && !esCredito) {
        for (const pago of dto.pagos) {
          await tx.pagoVenta.create({
            data: {
              ventaId: venta.id,
              metodoPago: pago.metodoPago as any,
              monto: pago.monto,
              referencia: pago.referencia || null,
              banco: (pago as any).banco || null,
              monedaOriginal: (pago as any).monedaOriginal || null,
              montoOriginal: (pago as any).montoOriginal || null,
              tipoCambio: (pago as any).tipoCambio || null,
            },
          });
        }
      } else if (dto.montoRecibido && dto.montoRecibido > 0 && !esCredito) {
        // Fallback: pago único (compatibilidad). El DTO de cotización no
        // expone banco/bancarización Fase 2 — cotización→venta queda como gap
        // a cubrir si el caso lo necesita.
        await tx.pagoVenta.create({
          data: {
            ventaId: venta.id,
            metodoPago: dto.metodoPago || 'EFECTIVO',
            monto: Math.min(dto.montoRecibido, totalAPagarHoy),
          },
        });
      }

      // 6b. Si la cotización tenía adelanto, registrarlo como PagoVenta
      // adicional heredando metodoPago + fechaPago del MovimientoCaja
      // original (que ya existe en su caja del día — probablemente cerrada
      // — desde el momento de la cotización). Vinculamos ese movimiento
      // a la venta nueva manteniendo la traza con la cotización.
      let movAdelantoData: { metodoPago: any; fechaMovimiento: Date } | null =
        null;
      if (adelantoAplicado > 0 && cotizacion.movimientoCajaId) {
        const movAdelanto = await tx.movimientoCaja.findUnique({
          where: { id: cotizacion.movimientoCajaId },
          select: { metodoPago: true, fechaMovimiento: true },
        });
        if (movAdelanto) {
          movAdelantoData = movAdelanto;
          await tx.pagoVenta.create({
            data: {
              ventaId: venta.id,
              metodoPago: movAdelanto.metodoPago,
              monto: new Prisma.Decimal(adelantoAplicado.toFixed(2)),
              fechaPago: movAdelanto.fechaMovimiento,
              referencia: `Adelanto cotización ${cotizacion.codigo}`,
            },
          });
          await tx.movimientoCaja.update({
            where: { id: cotizacion.movimientoCajaId },
            data: { ventaId: venta.id },
          });
        }
      }

      // 7. Crear comprobante electrónico (solo BOLETA o FACTURA, no TICKET)
      let comprobanteIdGenerado: string | null = null;
      const tipoComprobante = dto.tipoComprobante || 'BOLETA';
      const esComprobanteElectronico = tipoComprobante === 'BOLETA' || tipoComprobante === 'FACTURA';

      // FACTURA exige RUC válido del cliente efectivo. Solo FACTURA: la
      // boleta sin documento siempre estuvo permitida en este flujo.
      if (tipoComprobante === 'FACTURA') {
        const validacionDoc = validarDocumentoParaComprobante(
          'FACTURA',
          clienteVenta.documentoCliente,
        );
        if (!validacionDoc.valido) {
          throw new BadRequestException(validacionDoc.error);
        }
      }

      let sedeLocked: any = null;
      if (esComprobanteElectronico) {
      // ConfiguracionFacturacion = datos tributarios globales (IGV, credenciales SUNAT)
      const configFacturacion = await tx.configuracionFacturacion.findUnique({
        where: { empresaId },
      });

      // Sede = punto de emisión (series y correlativos) — FOR UPDATE para concurrencia
      [sedeLocked] = await tx.$queryRaw<
        Array<{
          id: string;
          serieFactura: string;
          serieBoleta: string;
          ultimoNumeroFactura: number;
          ultimoNumeroBoleta: number;
        }>
      >`SELECT id, "serieFactura", "serieBoleta", "ultimoNumeroFactura", "ultimoNumeroBoleta"
        FROM "Sede" WHERE id = ${cotizacion.sedeId} FOR UPDATE`;

      if (!sedeLocked) {
        this.logger.warn(`Sede ${cotizacion.sedeId} no encontrada, comprobante no generado`);
      }

      if (sedeLocked) {
        const serie = tipoComprobante === 'FACTURA'
          ? sedeLocked.serieFactura
          : sedeLocked.serieBoleta;

        const campoContador = tipoComprobante === 'FACTURA' ? 'ultimoNumeroFactura' : 'ultimoNumeroBoleta';
        const sedeActualizada = await tx.sede.update({
          where: { id: sedeLocked.id },
          data: { [campoContador]: { increment: 1 } },
          select: { [campoContador]: true },
        });
        const nuevoCorrelativo: number = (sedeActualizada as any)[campoContador];

        const correlativo = String(nuevoCorrelativo);

        const codigoGenerado = `${serie}-${correlativo.padStart(8, '0')}`;

        // Calcular totales tributarios por tipo de afectación
        const todosDetallesComprobante = [...detallesVenta, ...itemsAdicionales];
        const tributario = this.calcularTotalesTributarios(
          todosDetallesComprobante.map((d: any) => ({
            tipoAfectacion: d.tipoAfectacion || '10',
            subtotal: Number(d.subtotal || 0),
            igv: Number(d.igv || 0),
            icbper: Number(d.icbper || 0),
          })),
        );

        const comprobante = await tx.comprobanteElectronico.create({
          data: {
            ventaId: venta.id,
            empresaId,
            sedeId: venta.sedeId,
            clienteId: clienteVenta.clienteId,
            clienteEmpresaId: clienteVenta.clienteEmpresaId,
            tipoComprobante: tipoComprobante as any,
            serie,
            correlativo: correlativo.padStart(8, '0'),
            codigoGenerado,
            tipoDocumento: dto.tipoDocumentoCliente || (tipoComprobante === 'FACTURA' ? '6' : '1'),
            numeroDocumento: clienteVenta.documentoCliente,
            nombreCliente: clienteVenta.nombreCliente || 'CLIENTE VARIOS',
            direccionCliente: clienteVenta.direccionCliente,
            emailCliente: cotizacion.emailCliente,
            moneda: cotizacion.moneda || 'PEN',
            gravada: new Prisma.Decimal(tributario.gravada.toFixed(2)),
            exonerada: new Prisma.Decimal(tributario.exonerada.toFixed(2)),
            inafecta: new Prisma.Decimal(tributario.inafecta.toFixed(2)),
            igv: new Prisma.Decimal(tributario.igv.toFixed(2)),
            totalIgv: new Prisma.Decimal(tributario.igv.toFixed(2)),
            icbper: new Prisma.Decimal(tributario.icbper.toFixed(2)),
            total: new Prisma.Decimal(totalVenta.toFixed(2)),
            estado: 'REGISTRADO' as any,
            detalles: {
              create: detallesVenta.map((d: any) => {
                const subtotalItem = Number(d.subtotal || 0);
                const igvItem = Number(d.igv || 0);
                const totalItem = Number(d.total || subtotalItem + igvItem);
                const cant = Number(d.cantidad || 1);
                const valorUnit = cant > 0 ? subtotalItem / cant : 0;
                const precioUnit = cant > 0 ? totalItem / cant : 0;
                return {
                  descripcion: d.descripcion,
                  cantidad: d.cantidad,
                  tipoAfectacion: d.tipoAfectacion || '10',
                  porcentajeIGV: new Prisma.Decimal(Number(d.porcentajeIGV ?? 18)),
                  valorUnitario: new Prisma.Decimal(valorUnit.toFixed(2)),
                  precioUnitario: new Prisma.Decimal(precioUnit.toFixed(2)),
                  valorVenta: new Prisma.Decimal(subtotalItem.toFixed(2)),
                  igv: new Prisma.Decimal(igvItem.toFixed(2)),
                  icbper: new Prisma.Decimal(Number(d.icbper || 0).toFixed(2)),
                  subtotal: new Prisma.Decimal(subtotalItem.toFixed(2)),
                  total: new Prisma.Decimal(totalItem.toFixed(2)),
                  ...(d.productoId ? { producto: { connect: { id: d.productoId } } } : {}),
                };
              }),
            },
          },
        });

        // Registrar pago del comprobante (registro tributario).
        // Multi-medio: 1 PagoComprobante por cada PagoVenta no-CREDITO.
        // El monto del día se calcula contra `totalAPagarHoy` (no contra
        // `totalVenta`) — el adelanto se agrega como una fila aparte.
        const montoPagoLegacy = esCredito
          ? 0
          : Math.min(dto.montoRecibido || totalAPagarHoy, totalAPagarHoy);

        const pagosComprobanteData: any[] = (!esCredito && dto.pagos && dto.pagos.length > 0)
          ? dto.pagos
              .filter((p) => p.metodoPago !== 'CREDITO')
              .map((p) => ({
                comprobanteId: comprobante.id,
                metodoPago: p.metodoPago,
                monto: new Prisma.Decimal(Number(p.monto).toFixed(2)),
                referencia: p.referencia || null,
                estado: 'COMPLETADO',
              }))
          : [{
              comprobanteId: comprobante.id,
              metodoPago: dto.metodoPago || 'EFECTIVO',
              monto: new Prisma.Decimal(montoPagoLegacy.toFixed(2)),
              estado: esCredito ? 'PENDIENTE' : 'COMPLETADO',
            }];

        // Si hubo adelanto, agregamos su registro tributario para que la
        // suma de pagos del comprobante cuadre con el total.
        if (adelantoAplicado > 0 && movAdelantoData) {
          pagosComprobanteData.push({
            comprobanteId: comprobante.id,
            metodoPago: movAdelantoData.metodoPago,
            monto: new Prisma.Decimal(adelantoAplicado.toFixed(2)),
            referencia: `Adelanto cotización ${cotizacion.codigo}`,
            estado: 'COMPLETADO',
          });
        }

        await tx.pagoComprobante.createMany({ data: pagosComprobanteData });

        this.logger.log(`Comprobante ${codigoGenerado} generado para venta ${venta.codigo}`);
        comprobanteIdGenerado = comprobante.id;
      }
      } // fin esComprobanteElectronico

      // 8. Cambiar estado de cotización a CONVERTIDA
      await tx.cotizacion.update({
        where: { id: cotizacion.id },
        data: {
          estado: EstadoCotizacion.CONVERTIDA,
          ventaId: venta.id,
        },
      });

      // 9. Registrar movimiento en caja (cotización = atención presencial)
      const montoPagadoInmediato = !esCredito
        ? (dto.pagos && dto.pagos.length > 0
            ? dto.pagos.reduce((s, p) => s + p.monto, 0)
            : (dto.montoRecibido ?? 0))
        : (dto.montoRecibido ?? 0);

      if (montoPagadoInmediato > 0 && cajeroId) {
        // Multi-medio: un MovimientoCaja por cada PagoVenta no-CREDITO.
        const pagosParaCaja = (dto.pagos && dto.pagos.length > 0)
          ? this.construirPagosParaCaja(dto.pagos, totalAPagarHoy, montoCambio ?? 0)
          : [{
              metodoPago: dto.metodoPago || 'EFECTIVO',
              monto: Math.min(montoPagadoInmediato, totalAPagarHoy),
            }];

        for (const p of pagosParaCaja) {
          try {
            await this.cajaService.registrarMovimientoSiHayCaja(
              empresaId,
              cotizacion.sedeId,
              cajeroId,
              {
                tipo: 'INGRESO' as any,
                categoria: 'VENTA' as any,
                metodoPago: p.metodoPago as any,
                monto: p.monto,
                descripcion: `Venta ${codigoVenta} (cotización ${cotizacion.codigo})`,
                ventaId: venta.id,
              },
              tx,
            );
          } catch (e: any) {
            this.logger.warn(`Error registrando movimiento caja (${p.metodoPago}) venta ${codigoVenta}: ${e?.message ?? e}`);
          }
        }
      }

      this.logger.log(
        `Venta ${venta.codigo} creada desde cotizacion ${cotizacion.codigo}`,
      );
      return { venta, comprobanteIdGenerado };
    },
    { timeout: 30000 },
    );

    await this.invalidateProductCache(empresaId);

    // Fire-after-commit: enviar comprobante a Nubefact
    if (result.comprobanteIdGenerado) {
      this.facturacionService.enviarComprobante(result.comprobanteIdGenerado, empresaId)
        .catch(err => this.logger.warn(`Envío fallido: ${err?.message}`));
    }

    return result.venta;
  }

  /**
   * Listar ventas con filtros
   */
  async findAll(
    empresaId: string,
    filtros?: {
      sedeId?: string;
      estado?: EstadoVenta;
      fechaDesde?: string;
      fechaHasta?: string;
      clienteId?: string;
      search?: string;
      userId?: string;
      userRole?: string;
      // Paginación por CURSOR + filtro por canal (patrón estándar de listas
      // transaccionales — ver cotizaciones). Compat: sin `limit` responde el
      // array completo de siempre (clientes viejos no mandan limit).
      canalVenta?: string;
      limit?: number;
      cursor?: string;
    },
  ) {
    const where: Prisma.VentaWhereInput = { empresaId };

    // Vendedor solo ve ventas originadas de sus cotizaciones
    if (filtros?.userRole === Rol.VENDEDOR && filtros?.userId) {
      where.vendedorId = filtros.userId;
    }
    // Cajero solo ve ventas que procesó
    if (filtros?.userRole === Rol.CAJERO && filtros?.userId) {
      where.cajeroId = filtros.userId;
    }

    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.estado) where.estado = filtros.estado;
    if (filtros?.clienteId) where.clienteId = filtros.clienteId;
    // Canal server-side: con paginación el filtro client-side dejaría
    // totales/conteos inconsistentes (solo vería las páginas cargadas).
    if (filtros?.canalVenta) {
      where.canalVenta = filtros.canalVenta as Prisma.EnumCanalVentaFilter['equals'];
    }

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fechaVenta = {};
      if (filtros.fechaDesde)
        where.fechaVenta.gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta)
        where.fechaVenta.lte = new Date(filtros.fechaHasta);
    }

    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreCliente: { contains: filtros.search, mode: 'insensitive' } },
        {
          documentoCliente: {
            contains: filtros.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    const paginado = filtros?.limit != null && filtros.limit > 0;
    const limit = paginado ? Math.min(filtros!.limit!, 100) : undefined;

    // Con paginación, el RESUMEN agregado se calcula sobre TODO el set
    // filtrado (no solo la página): el chip del total en el app sumaba
    // client-side y con páginas parciales quedaría corto. groupBy por
    // estado permite derivar: total sin ANULADA/BORRADOR, conteos, etc.
    const resumenPromise = paginado
      ? this.prisma.venta.groupBy({
          by: ['estado'],
          where,
          _count: { _all: true },
          _sum: { total: true },
        })
      : null;

    const [ventas, resumenRaw] = await Promise.all([
      this.prisma.venta.findMany({
        where,
        include: this.getListInclude(),
        // Tie-breaker por id: dos ventas con el mismo creadoEn no pueden
        // bailar entre páginas del cursor.
        orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
        ...(paginado
          ? {
              take: limit! + 1,
              ...(filtros?.cursor
                ? { cursor: { id: filtros.cursor }, skip: 1 }
                : {}),
            }
          : {}),
      }),
      resumenPromise,
    ]);

    const hasMore = paginado && ventas.length > limit!;
    const pagina = hasMore ? ventas.slice(0, limit!) : ventas;

    // Aplanar las órdenes de servicio cobradas a `ordenesServicio` y quitar
    // los `detalles` parciales del include liviano (ver getListInclude).
    const data = pagina.map(({ detalles, ...v }: any) => ({
      ...v,
      ordenesServicio: (detalles ?? [])
        .map((d: any) => d.ordenServicio)
        .filter(Boolean),
    }));

    if (!paginado) return data;

    return {
      data,
      hasMore,
      nextCursor: hasMore ? data[data.length - 1].id : null,
      resumen: (resumenRaw ?? []).map((r) => ({
        estado: r.estado,
        cantidad: r._count._all,
        total: Number(r._sum.total ?? 0),
      })),
    };
  }

  /**
   * Detalle completo de una venta
   */
  async findOne(id: string, empresaId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { id, empresaId },
      include: this.getInclude(),
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    // Fetch separado de devoluciones asociadas — solo el detalle las
    // necesita, no queremos inflar el getInclude() compartido. Limita
    // a devoluciones PROCESADAS (las pendientes/rechazadas no afectan
    // la presentación contable). Trae los items con FK a ventaDetalle
    // para que el frontend pueda matchear línea por línea.
    const devoluciones = await this.prisma.devolucion.findMany({
      where: {
        ventaId: id,
        estado: 'PROCESADA',
      },
      select: {
        id: true,
        codigo: true,
        tipoReembolso: true,
        estado: true,
        procesadoEn: true,
        creadoEn: true,
        items: {
          select: {
            id: true,
            ventaDetalleId: true,
            productoId: true,
            varianteId: true,
            cantidad: true,
            accion: true,
            estadoProducto: true,
            motivo: true,
            productoReemplazoId: true,
            varianteReemplazoId: true,
            precioReemplazo: true,
            diferenciaPrecio: true,
            productoReemplazo: { select: { id: true, nombre: true } },
            varianteReemplazo: { select: { id: true, nombre: true, sku: true } },
          },
        },
      },
      orderBy: { creadoEn: 'asc' },
    });

    // Datos del envío (ventas conEnvio) — fetch separado para no inflar
    // el getInclude() compartido con el listado.
    const envio = await this.prisma.ventaEnvio.findUnique({
      where: { ventaId: id },
    });

    return { ...venta, devoluciones, envio };
  }

  /**
   * Registra/actualiza los datos del ENVÍO de una venta (upsert) y marca
   * la venta como conEnvio. Prellenar en el cliente con el snapshot del
   * cliente de la venta; aquí todo es editable (el destinatario puede
   * ser otra persona).
   */
  async upsertEnvio(
    id: string,
    empresaId: string,
    dto: {
      destinatarioNombre: string;
      destinatarioDni?: string;
      destinatarioCelular?: string;
      agenciaNombre?: string;
      destinoDepartamento?: string;
      destinoProvincia?: string;
      agenciaDireccion?: string;
    },
  ) {
    const venta = await this.prisma.venta.findFirst({
      where: { id, empresaId },
      select: { id: true, conEnvio: true },
    });
    if (!venta) throw new NotFoundException('Venta no encontrada');

    const [, envio] = await this.prisma.$transaction([
      this.prisma.venta.update({
        where: { id },
        data: { conEnvio: true },
      }),
      this.prisma.ventaEnvio.upsert({
        where: { ventaId: id },
        create: {
          ventaId: id,
          empresaId,
          destinatarioNombre: dto.destinatarioNombre,
          destinatarioDni: dto.destinatarioDni,
          destinatarioCelular: dto.destinatarioCelular,
          agenciaNombre: dto.agenciaNombre,
          destinoDepartamento: dto.destinoDepartamento,
          destinoProvincia: dto.destinoProvincia,
          agenciaDireccion: dto.agenciaDireccion,
        },
        update: {
          destinatarioNombre: dto.destinatarioNombre,
          destinatarioDni: dto.destinatarioDni,
          destinatarioCelular: dto.destinatarioCelular,
          agenciaNombre: dto.agenciaNombre,
          destinoDepartamento: dto.destinoDepartamento,
          destinoProvincia: dto.destinoProvincia,
          agenciaDireccion: dto.agenciaDireccion,
        },
      }),
    ]);
    return envio;
  }

  /** Marca el rótulo de envío de la venta como impreso (idempotente). */
  async marcarRotuloEnvioImpreso(id: string, empresaId: string) {
    const envio = await this.prisma.ventaEnvio.findFirst({
      where: { ventaId: id, empresaId },
    });
    if (!envio) {
      throw new NotFoundException('La venta no tiene datos de envío');
    }
    return this.prisma.ventaEnvio.update({
      where: { id: envio.id },
      data: { rotuloImpresoEn: new Date() },
    });
  }

  /**
   * Buscar venta por codigo de venta o codigo de comprobante
   */
  async buscarPorCodigo(empresaId: string, codigo: string) {
    if (!codigo || codigo.trim().length < 3) {
      throw new BadRequestException('Ingresa al menos 3 caracteres');
    }

    const query = codigo.trim();

    // Buscar por codigo de venta
    const venta = await this.prisma.venta.findFirst({
      where: {
        empresaId,
        codigo: { contains: query, mode: 'insensitive' },
        estado: { not: EstadoVenta.ANULADA },
      },
      include: this.getInclude(),
    });

    if (venta) return venta;

    // Buscar por codigo de comprobante
    const comprobante = await this.prisma.comprobanteElectronico.findFirst({
      where: {
        empresaId,
        codigoGenerado: { contains: query, mode: 'insensitive' },
      },
      select: {
        total: true,
        clienteId: true,
        clienteEmpresaId: true,
        fechaEmision: true,
      },
    });

    if (comprobante) {
      // Buscar venta que coincida con los datos del comprobante
      const fechaEmision = comprobante.fechaEmision;
      const startOfDay = new Date(fechaEmision);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(fechaEmision);
      endOfDay.setHours(23, 59, 59, 999);

      const ventaMatch = await this.prisma.venta.findFirst({
        where: {
          empresaId,
          total: comprobante.total,
          estado: { not: EstadoVenta.ANULADA },
          ...(comprobante.clienteId && { clienteId: comprobante.clienteId }),
          fechaVenta: { gte: startOfDay, lte: endOfDay },
        },
        include: this.getInclude(),
      });

      return ventaMatch;
    }

    return null;
  }

  /**
   * Actualizar venta (solo BORRADOR)
   */
  async update(id: string, empresaId: string, dto: UpdateVentaDto) {
    const venta = await this.prisma.venta.findFirst({
      where: { id, empresaId },
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    if (venta.estado !== EstadoVenta.BORRADOR) {
      throw new BadRequestException(
        'Solo se pueden editar ventas en estado BORRADOR',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.detalles && dto.detalles.length > 0) {
        await tx.ventaDetalle.deleteMany({ where: { ventaId: id } });

        // Forzar precios del backend (defensa contra manipulación cliente).
        const detallesEnforced = await this.aplicarPreciosBackendNivel(
          dto.detalles,
          venta.sedeId,
        );
        const detallesCalculados = detallesEnforced.map((d, index) =>
          this.calcularDetalle(d, index),
        );

        // Guard venta bajo costo (mismo que create/crearYCobrar). Si la
        // edicion del borrador trae lineas con margen<0 sin liquidacion
        // ni autorizacion, rebota con 400 VENTA_BAJO_COSTO_NO_AUTORIZADA.
        const perdidaTotal = await this.validarVentaBajoCosto(
          empresaId,
          detallesCalculados,
          dto.ventaBajoCostoAutorizadaPorId ?? null,
        );

        await tx.ventaDetalle.createMany({
          data: detallesCalculados.map((d) => ({
            ventaId: id,
            productoId: d.productoId,
            varianteId: d.varianteId,
            servicioId: d.servicioId,
            comboId: d.comboId,
            descripcion: d.descripcion,
            cantidad: d.cantidad,
            precioUnitario: d.precioUnitario,
            descuento: d.descuento,
            tipoAfectacion: d.tipoAfectacion,
            porcentajeIGV: d.porcentajeIGV,
            igv: d.igv,
            icbper: d.icbper,
            subtotal: d.subtotal,
            total: d.total,
            orden: d.orden,
            origenComboId: d.origenComboId,
            origenComboNombre: d.origenComboNombre,
            precioCostoSnapshot: d.precioCostoSnapshot,
            margenSnapshot: d.margenSnapshot,
            motivoLiquidacionSnapshot: d.motivoLiquidacionSnapshot,
            nivelAplicadoSnapshot: d.nivelAplicadoSnapshot,
          })),
        });

        const subtotal = detallesCalculados.reduce(
          (sum, d) => sum + d.subtotal,
          0,
        );
        const totalDescuento = detallesCalculados.reduce(
          (sum, d) => sum + d.descuento,
          0,
        );
        const totalImpuestos = detallesCalculados.reduce(
          (sum, d) => sum + d.igv,
          0,
        );
        const total = detallesCalculados.reduce(
          (sum, d) => sum + d.total,
          0,
        );

        return tx.venta.update({
          where: { id },
          data: {
            ...this.buildUpdateData(dto),
            subtotal,
            descuento: totalDescuento,
            impuestos: totalImpuestos,
            total,
            perdidaTotalLineas: perdidaTotal,
            ventaBajoCostoAutorizadaPorId:
              perdidaTotal != null ? dto.ventaBajoCostoAutorizadaPorId ?? null : null,
            ventaBajoCostoAutorizadaEn:
              perdidaTotal != null && dto.ventaBajoCostoAutorizadaPorId
                ? new Date()
                : null,
          },
          include: this.getInclude(),
        });
      }

      return tx.venta.update({
        where: { id },
        data: this.buildUpdateData(dto),
        include: this.getInclude(),
      });
    });
  }

  /**
   * Confirmar venta → impacta stock
   */
  async confirmar(id: string, empresaId: string, usuarioId: string) {
    this.logger.info('Confirmando venta', { id, empresaId });

    const result = await this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id, empresaId },
        include: { detalles: true },
      });

      if (!venta) {
        throw new NotFoundException('Venta no encontrada');
      }

      if (venta.estado !== EstadoVenta.BORRADOR) {
        throw new BadRequestException(
          'Solo se puede confirmar una venta en estado BORRADOR',
        );
      }

      // Procesar stock para cada detalle con producto/variante
      for (const detalle of venta.detalles) {
        if (!detalle.productoId && !detalle.varianteId) {
          continue; // Servicios no afectan stock
        }

        // Buscar ProductoStock
        const productoStock = await tx.productoStock.findFirst({
          where: {
            sedeId: venta.sedeId,
            productoId: detalle.productoId ?? null,
            varianteId: detalle.varianteId ?? null,
          },
        });

        if (!productoStock) {
          throw new BadRequestException(
            `No existe stock para "${detalle.descripcion}" en esta sede`,
          );
        }

        // SELECT FOR UPDATE
        const [stockLocked] = await tx.$queryRaw<
          Array<{ id: string; stockActual: number; sedeId: string }>
        >`SELECT id, "stockActual", "sedeId"
          FROM "ProductoStock"
          WHERE id = ${productoStock.id}
          FOR UPDATE`;

        if (!stockLocked) {
          throw new NotFoundException(
            `ProductoStock no encontrado para "${detalle.descripcion}"`,
          );
        }

        const cantidad = Number(detalle.cantidad);
        const stockAnterior = stockLocked.stockActual;

        // Calcular stock disponible para venta
        const stockDisponible =
          stockAnterior -
          productoStock.stockReservado -
          productoStock.stockReservadoVenta -
          productoStock.stockReservadoCombo -
          productoStock.stockReservadoCotizacion -
          productoStock.stockDanado -
          productoStock.stockEnGarantia;

        if (cantidad > stockDisponible) {
          throw new BadRequestException(
            `Stock insuficiente para "${detalle.descripcion}". ` +
              `Disponible: ${stockDisponible}, Solicitado: ${cantidad}`,
          );
        }

        const nuevoStock = stockAnterior - cantidad;

        // Decrementar stock
        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: { stockActual: nuevoStock },
        });

        // Crear MovimientoStock (valorado al snapshot de costo del detalle)
        await crearMovimientoStockConValoracion(tx, {
          sedeId: venta.sedeId,
          empresaId,
          productoStockId: productoStock.id,
          tipo: TipoMovimientoStock.SALIDA_VENTA,
          tipoDocumento: 'VENTA',
          numeroDocumento: venta.codigo,
          cantidadAnterior: stockAnterior,
          cantidad: -cantidad,
          cantidadNueva: nuevoStock,
          motivo: `Venta ${venta.codigo} - ${detalle.descripcion}`,
          ventaId: venta.id,
          usuarioId,
          precioCostoUnitario:
            (detalle as any).precioCostoSnapshot ?? undefined,
        });
      }

      // Actualizar estado
      const updatedVenta = await tx.venta.update({
        where: { id },
        data: { estado: EstadoVenta.CONFIRMADA },
        include: this.getInclude(),
      });

      this.logger.log(`Venta confirmada: ${venta.codigo}`);
      return updatedVenta;
    });

    // Invalidar cache de productos después de descontar stock
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * Registrar pago
   */
  /**
   * Mora vigente de una cuota al momento del pago, neta de lo ya pagado.
   * Misma fórmula que el cron de cobranza (cuentas-por-cobrar-tasks):
   * monto × %diario × días vencidos efectivos, con tope %máximo — menos
   * `montoPagadoMora`. Sin esto, pagar entre corridas del cron usaba una
   * mora desactualizada (días de menos) y la cuota podía cerrarse como
   * PAGADA debiendo mora real.
   * Si la empresa no tiene mora habilitada se respeta el `montoMora`
   * almacenado (cargo histórico de cuando estuvo habilitada).
   */
  private static moraVigente(
    cuota: {
      monto: unknown;
      montoMora: unknown;
      montoPagadoMora: unknown;
      fechaVencimiento: Date;
    },
    config: {
      moraHabilitada: boolean;
      porcentajeMoraDiario: unknown;
      moraMaximaPorcentaje: unknown;
      diasGraciaMora: number | null;
    } | null,
    ahora: Date,
  ): number {
    if (!config?.moraHabilitada) return Number(cuota.montoMora ?? 0);

    const diasVencido = Math.floor(
      (ahora.getTime() - cuota.fechaVencimiento.getTime()) / 86_400_000,
    );
    const diasEfectivos = Math.max(diasVencido - (config.diasGraciaMora ?? 0), 0);
    if (diasEfectivos <= 0) return 0;

    const montoCuota = Number(cuota.monto);
    const pctDiario = Number(config.porcentajeMoraDiario ?? 0.05);
    const pctMax = Number(config.moraMaximaPorcentaje ?? 30);
    const acumulada = Math.min(
      montoCuota * (pctDiario / 100) * diasEfectivos,
      montoCuota * (pctMax / 100),
    );
    const neta =
      round2(acumulada - Number(cuota.montoPagadoMora ?? 0));
    return Math.max(neta, 0);
  }

  async procesarPago(
    id: string,
    empresaId: string,
    dto: ProcesarPagoDto,
    usuarioId?: string,
    opts?: { skipCajaValidacion?: boolean },
  ) {
    this.logger.info('Procesando pago', { id, empresaId });

    // Comprobante diferido (flujo Yape): si esta venta emite su comprobante al
    // pagar, capturamos el id para disparar el envío a Nubefact tras el commit.
    let comprobanteDiferidoId: string | null = null;
    // Órdenes de servicio marcadas FINALIZADAS en el pago diferido (para los
    // efectos post-commit: push al cliente + aviso de mantenimiento).
    let ordenesDiferidasParaPost: any[] = [];

    const ventaPagada = await this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id, empresaId },
        include: { pagos: true, detalles: true },
      });

      // Idempotente: si la venta YA está pagada completa, no agregamos otro pago
      // (evita sobre-pago). Caso real: el webhook Yape ya cerró la venta pero la
      // hoja siguió abierta por un FCM lento, y el cajero presionó "Marcar pagado
      // manual". Devolvemos la venta tal cual → la hoja cierra como pagada. Va
      // ANTES de la validación de caja: cerrar una venta ya pagada no debe exigir
      // caja abierta. (PAGADA_PARCIAL sí sigue: ahí faltan pagos por registrar.)
      if (venta && venta.estado === EstadoVenta.PAGADA_COMPLETA) {
        this.logger.warn(
          `Pago ignorado: la venta ${venta.codigo} ya está pagada completamente`,
        );
        return tx.venta.findFirst({
          where: { id },
          include: this.getInclude(),
        });
      }

      // Verificar caja según canal de la venta original (POS/COTIZACION requieren caja).
      // skipCajaValidacion = true en el webhook Yape: ahí `usuarioId` es el cajero
      // que creó la venta (para registrar el INGRESO en SU caja), pero NO debe
      // fallar si su caja ya cerró — el registro es best-effort vía
      // registrarMovimientoSiHayCaja (no lanza si no hay caja abierta).
      if (
        usuarioId &&
        !opts?.skipCajaValidacion &&
        venta &&
        venta.canalVenta !== 'ONLINE'
      ) {
        const cajaActiva = await tx.caja.findFirst({
          where: { empresaId, usuarioId, estado: 'ABIERTA' },
        });
        if (!cajaActiva) {
          throw new BadRequestException(
            'Debe abrir una caja antes de procesar pagos. Vaya a Caja → Abrir Caja.',
          );
        }
      }

      if (!venta) {
        throw new NotFoundException('Venta no encontrada');
      }

      if (venta.estado === EstadoVenta.ANULADA) {
        throw new BadRequestException(
          'No se puede registrar pago en una venta anulada',
        );
      }

      if (venta.estado === EstadoVenta.BORRADOR) {
        throw new BadRequestException(
          'La venta debe estar confirmada antes de registrar pagos',
        );
      }

      // Ley 28194 también al cobrar DESPUÉS de crear: la validación de
      // creación se salta ventas a crédito y borradores cobrados luego.
      // Acá no se exige banco (los APKs no lo mandan en este flujo): solo
      // referencia para digitales y confirmación expresa para efectivo.
      const totalLey = Number(venta.totalConInteres ?? venta.total);
      const monedaLey = venta.moneda || 'PEN';
      const umbralLey = monedaLey === 'USD' ? 500 : 2000;
      if (totalLey >= umbralLey) {
        const metodo = dto.metodoPago as string;
        if (
          ['YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA'].includes(metodo) &&
          !dto.referencia?.trim()
        ) {
          throw new BadRequestException(
            `Bancarización: el pago de ${metodo} (S/ ${dto.monto.toFixed(2)}) requiere N° de operación.`,
          );
        }
        if (metodo === 'EFECTIVO' && !dto.aceptaRiesgoBancarizacion) {
          throw new BadRequestException(
            `Ley 28194: la venta ${venta.codigo} (${monedaLey} ${totalLey.toFixed(2)}) supera el límite de bancarización (${umbralLey}). ` +
              `Cobrar en efectivo requiere confirmación del cajero — el cliente perderá derecho a deducir IGV/sustento de gasto.`,
          );
        }
      }

      // Crear pago
      const pago = await tx.pagoVenta.create({
        data: {
          ventaId: id,
          metodoPago: dto.metodoPago,
          monto: dto.monto,
          referencia: dto.referencia,
          banco: (dto as any).banco ?? null,
        },
      });

      // Asignar pago a cuotas (auto-cascada)
      const ventaCuotas = await tx.cuotaVenta.findMany({
        where: { ventaId: id, estado: { in: ['PENDIENTE', 'PAGADA_PARCIAL', 'VENCIDA'] } },
        orderBy: { numero: 'asc' },
      });

      // Config de mora de la empresa: la mora se recalcula AL MOMENTO del
      // pago (cuota.montoMora la actualiza un cron a lo sumo diario, puede
      // estar desactualizada por días).
      const configMora =
        ventaCuotas.length > 0
          ? await tx.configuracionEmpresa.findFirst({
              where: { empresaId },
              select: {
                moraHabilitada: true,
                porcentajeMoraDiario: true,
                moraMaximaPorcentaje: true,
                diasGraciaMora: true,
              },
            })
          : null;
      const ahora = new Date();

      // Track total breakdown
      let totalMoraAplicada = 0;
      let totalInteresAplicado = 0;
      let totalPrincipalAplicado = 0;

      if (ventaCuotas.length > 0) {
        let remaining = dto.monto;
        for (const cuota of ventaCuotas) {
          if (remaining <= 0) break;

          const mora = VentaService.moraVigente(cuota, configMora, ahora);
          const saldoInteres = round2(Number(cuota.montoInteres ?? 0) - Number(cuota.montoPagadoInteres ?? 0));
          const saldoPrincipal = round2(Number(cuota.montoPrincipal ?? 0) - Number(cuota.montoPagadoPrincipal ?? 0));
          const saldoTotal = mora + Math.max(saldoInteres, 0) + Math.max(saldoPrincipal, 0);
          const aplicar = Math.min(remaining, saldoTotal);

          // Priority: mora -> interes -> principal
          const moraAplicada = Math.min(aplicar, mora);
          let sobrante = aplicar - moraAplicada;
          const interesAplicado = Math.min(sobrante, Math.max(saldoInteres, 0));
          sobrante -= interesAplicado;
          const principalAplicado = Math.min(sobrante, Math.max(saldoPrincipal, 0));

          totalMoraAplicada += moraAplicada;
          totalInteresAplicado += interesAplicado;
          totalPrincipalAplicado += principalAplicado;

          const nuevoMontoPagadoPrincipal = Number(cuota.montoPagadoPrincipal ?? 0) + principalAplicado;
          const nuevoMontoPagadoInteres = Number(cuota.montoPagadoInteres ?? 0) + interesAplicado;
          const nuevoMontoPagadoMora = Number(cuota.montoPagadoMora ?? 0) + moraAplicada;
          const nuevoMontoPagado = nuevoMontoPagadoPrincipal + nuevoMontoPagadoInteres;
          const nuevoSaldo = round2(Number(cuota.monto) - nuevoMontoPagado);
          const nuevaMora = round2(mora - moraAplicada);
          const cuotaPagada = nuevoSaldo <= 0 && nuevaMora <= 0;

          await tx.cuotaVenta.update({
            where: { id: cuota.id },
            data: {
              montoPagado: nuevoMontoPagado,
              montoPagadoPrincipal: nuevoMontoPagadoPrincipal,
              montoPagadoInteres: nuevoMontoPagadoInteres,
              montoPagadoMora: nuevoMontoPagadoMora,
              saldoPendiente: Math.max(nuevoSaldo, 0),
              estado: cuotaPagada ? 'PAGADA' : 'PAGADA_PARCIAL',
              montoMora: cuotaPagada ? 0 : nuevaMora,
              ...(cuotaPagada && { diasVencido: 0, fechaCalculoMora: null }),
            },
          });

          // Link payment to first cuota affected
          if (remaining === dto.monto) {
            await tx.pagoVenta.update({
              where: { id: pago.id },
              data: {
                cuotaVentaId: cuota.id,
                montoPrincipal: totalPrincipalAplicado,
                montoInteres: totalInteresAplicado,
                montoMora: totalMoraAplicada,
              },
            });
          }

          remaining = round2(remaining - aplicar);
        }

        // Update pago breakdown (final totals, since loop may span multiple cuotas)
        if (ventaCuotas.length > 0) {
          await tx.pagoVenta.update({
            where: { id: pago.id },
            data: {
              montoPrincipal: totalPrincipalAplicado,
              montoInteres: totalInteresAplicado,
              montoMora: totalMoraAplicada,
            },
          });
        }
      }

      // Calcular total pagado
      const pagosExistentes = venta.pagos.reduce(
        (sum, p) => sum + Number(p.monto),
        0,
      );
      const totalPagado = pagosExistentes + dto.monto;
      const ventaTotal = Number(venta.total);
      const targetTotal = venta.totalConInteres ? Number(venta.totalConInteres) : ventaTotal;

      // Determinar nuevo estado
      let nuevoEstado = venta.estado;
      if (totalPagado >= targetTotal) {
        nuevoEstado = EstadoVenta.PAGADA_COMPLETA;
      } else if (totalPagado > 0) {
        nuevoEstado = EstadoVenta.PAGADA_PARCIAL;
      }

      const montoCambio =
        totalPagado > targetTotal
          ? round2(totalPagado - targetTotal)
          : 0;

      const updatedVenta = await tx.venta.update({
        where: { id },
        data: {
          estado: nuevoEstado,
          montoRecibido: totalPagado,
          montoCambio,
          metodoPago: dto.metodoPago,
        },
        include: this.getInclude(),
      });

      // ── Cobro DIFERIDO (flujo Yape pendiente) ──
      // La venta nació CONFIRMADA sin comprobante y, si tenía órdenes, SIN
      // marcarlas (la intención quedó en *Diferido). Al quedar PAGADA_COMPLETA,
      // recién aquí: (1) se emite el comprobante (si BOLETA/FACTURA) y (2) se
      // marcan las órdenes FINALIZADAS — con el pago ya confirmado. `cobroDiferido`
      // garantiza que NADA de esto se dispara en ventas normales. Idempotente:
      // el guard de PAGADA_COMPLETA al inicio del método evita re-ejecución.
      if (nuevoEstado === EstadoVenta.PAGADA_COMPLETA && venta.cobroDiferido) {
        // Órdenes de servicio de la venta (para el adelanto del comprobante y
        // para marcarlas FINALIZADAS).
        const ordenIds: string[] = venta.detalles
          .map((d: any) => d.ordenServicioId)
          .filter((x: any): x is string => !!x);
        const ordenesVenta = ordenIds.length
          ? await tx.ordenServicio.findMany({
              where: { id: { in: ordenIds } },
              select: {
                id: true,
                codigo: true,
                estado: true,
                estadoDiagnostico: true,
                adelanto: true,
                metodoPagoAdelanto: true,
              },
            })
          : [];

        // (1) Comprobante BOLETA/FACTURA: emitir si aún no existe.
        let compGenerado: { comprobanteId: string; codigoGenerado: string } | null = null;
        if (venta.tipoComprobanteDiferido) {
          const yaTiene = await tx.comprobanteElectronico.findFirst({
            where: { ventaId: id },
            select: { id: true },
          });
          if (!yaTiene) {
            // Detalles a números planos (de DB vienen como Decimal).
            const detallesNum = venta.detalles.map((d: any) => ({
              descripcion: d.descripcion,
              cantidad: Number(d.cantidad),
              tipoAfectacion: d.tipoAfectacion,
              porcentajeIGV: Number(d.porcentajeIGV ?? 18),
              subtotal: Number(d.subtotal),
              igv: Number(d.igv),
              total: Number(d.total),
              icbper: Number(d.icbper ?? 0),
              productoId: d.productoId,
            }));
            const pagosVenta = [...venta.pagos, pago].map((pp: any) => ({
              metodoPago: String(pp.metodoPago),
              monto: Number(pp.monto),
              referencia: pp.referencia ?? null,
            }));
            const comp = await this._emitirComprobante(tx, {
              empresaId,
              ventaId: id,
              ventaCodigo: venta.codigo,
              tipoComprobante: venta.tipoComprobanteDiferido,
              detallesCalculados: detallesNum,
              cliente: {
                documentoCliente: venta.documentoCliente,
                clienteId: venta.clienteId,
                clienteEmpresaId: venta.clienteEmpresaId,
                tipoDocumentoCliente: venta.tipoDocumentoClienteDiferido,
                nombreCliente: venta.nombreCliente,
                direccionCliente: venta.direccionCliente,
                emailCliente: venta.emailCliente,
              },
              sedeFacturacionId: venta.sedeFacturacionIdDiferido,
              sedeId: venta.sedeId,
              moneda: venta.moneda,
              pagos: pagosVenta,
              metodoPagoFallback: dto.metodoPago,
              // Adelanto de las órdenes → desglose de PagoComprobante.
              ordenesACobrar: ordenesVenta.map((o: any) => ({
                codigo: o.codigo,
                adelanto: Number(o.adelanto ?? 0),
                metodoPagoAdelanto: o.metodoPagoAdelanto,
              })),
              esCredito: false,
              totalVenta: ventaTotal,
              totalACobrarHoy: ventaTotal,
              montoRecibido: totalPagado,
            });
            if (comp) {
              comprobanteDiferidoId = comp.comprobanteId;
              compGenerado = comp;
            }
          }
        }

        // (2) Marcar las órdenes FINALIZADAS + vincular comprobante (recién al
        // pagar; al crear NO se marcaron). Si se hubiera cancelado, el borrado
        // del VentaDetalle ya las habría liberado sin reversa.
        if (ordenesVenta.length > 0) {
          ordenesDiferidasParaPost =
            await this.ordenServicioService.marcarOrdenesCobradasPorVenta(tx, {
              ordenes: ordenesVenta.map((o: any) => ({
                id: o.id,
                estado: o.estado,
                estadoDiagnostico: o.estadoDiagnostico,
              })),
              ventaCodigo: venta.codigo,
              comprobante: compGenerado
                ? { id: compGenerado.comprobanteId, codigoGenerado: compGenerado.codigoGenerado }
                : null,
              usuarioId: usuarioId ?? venta.cajeroId ?? 'SYSTEM',
            });
        }
      }

      // Registrar movimiento en caja activa (si hay)
      if (usuarioId) {
        try {
          await this.cajaService.registrarMovimientoSiHayCaja(
            empresaId,
            venta.sedeId,
            usuarioId,
            {
              tipo: 'INGRESO',
              categoria: 'VENTA',
              metodoPago: dto.metodoPago,
              // El vuelto sale del efectivo: registramos el neto que queda en caja.
              monto: dto.metodoPago === 'EFECTIVO'
                ? Math.max(0, round2(dto.monto - montoCambio))
                : dto.monto,
              descripcion: `Pago venta ${venta.codigo}`,
              ventaId: venta.id,
              metadata: totalMoraAplicada > 0 || totalInteresAplicado > 0 ? {
                principal: totalPrincipalAplicado,
                interes: totalInteresAplicado,
                mora: totalMoraAplicada,
              } : undefined,
            },
            tx,
          );
        } catch (e: any) {
          this.logger.warn(`Error registrando movimiento caja para venta ${venta.codigo}: ${e?.message ?? e}`);
        }
      }

      this.logger.log(
        `Pago registrado en venta ${venta.codigo}: ${dto.monto} (${dto.metodoPago})`,
      );
      return updatedVenta;
    });

    // Pago MANUAL Yape/Plin (cajero, con usuarioId): la notificación de Yape no
    // llegó y el cajero confirmó a mano. Liberamos el cobro pendiente en api-yape
    // para que su monto único deje de estar reservado (si no, la próxima venta
    // del mismo monto saldría con un céntimo menos hasta que expire el TTL).
    // El webhook automático pasa usuarioId=undefined → no entra aquí (y allá el
    // cobro ya quedó `matched`). Fire-and-forget: nunca bloquea ni rompe el pago.
    // Solo el path MANUAL libera el cobro (skipCajaValidacion=false). En el
    // webhook el cobro ya quedó `matched` en api-yape → cancelar sería no-op.
    if (
      usuarioId &&
      !opts?.skipCajaValidacion &&
      (dto.metodoPago === 'YAPE' || dto.metodoPago === 'PLIN')
    ) {
      this.integracionYape
        .cancelarCobro({ empresaId, ventaId: id })
        .catch(() => undefined);
    }

    // Fire-after-commit: enviar a Nubefact el comprobante recién emitido en el
    // flujo Yape diferido (no bloquea el pago).
    if (comprobanteDiferidoId) {
      this.facturacionService
        .enviarComprobante(comprobanteDiferidoId, empresaId)
        .catch((err) =>
          this.logger.warn(
            `Envío del comprobante diferido ${comprobanteDiferidoId} falló: ${err?.message}`,
          ),
        );
    }

    // Fire-after-commit: efectos post-cobro de las órdenes marcadas en el pago
    // diferido (push al cliente "servicio finalizado" + aviso mantenimiento).
    if (ordenesDiferidasParaPost.length > 0) {
      this.ordenServicioService
        .procesarPostCobroOrdenes(empresaId, ordenesDiferidasParaPost)
        .catch((err) =>
          this.logger.warn(
            `Post-cobro órdenes diferidas falló (no crítico): ${err?.message ?? err}`,
          ),
        );
    }

    return ventaPagada;
  }

  /**
   * Cancela el cobro Yape/Plin PENDIENTE de una venta (cajero pulsa "Cancelar"
   * en la hoja de cobro). Libera el monto único en api-yape y anula la venta
   * recién creada devolviendo el stock — pero SOLO si sigue pendiente sin pagos.
   *
   * Cierra la carrera con el webhook: si el pago llegó justo antes de cancelar,
   * NO se anula (devuelve `yaPagada: true`) para no perder una venta cobrada.
   * Es best-effort: nunca lanza al cajero (si algo falla, el cron TTL la limpia).
   */
  async cancelarCobroYapePendiente(
    ventaId: string,
    empresaId: string,
    usuarioId: string,
  ): Promise<{ anulada: boolean; yaPagada: boolean; devuelto?: number }> {
    // Liberar el monto único reservado en api-yape (best-effort).
    await this.integracionYape
      .cancelarCobro({ empresaId, ventaId })
      .catch(() => undefined);

    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      include: { pagos: { select: { monto: true } }, detalles: true },
    });
    if (!venta) return { anulada: false, yaPagada: false };

    const pagado = venta.pagos.reduce((s, p) => s + Number(p.monto), 0);

    // Venta YA COMPLETA (carrera: el webhook la pagó justo antes de cancelar).
    // No tocar — la hoja debe cerrar como pagada.
    if (venta.estado === EstadoVenta.PAGADA_COMPLETA) {
      return { anulada: false, yaPagada: true };
    }

    // PAGO PARCIAL (entró plata pero no cubre el total — ej. el cliente agotó su
    // límite Yape diario a mitad de los tramos y desiste): el cajero cancela →
    // se ANULA la venta + se reversa caja (la plata recibida sale como EGRESO).
    // NO se emite comprobante (la venta nunca se concretó). El cajero devuelve
    // el dinero al cliente; `devuelto` = lo que hay que reintegrar.
    if (pagado > 0) {
      await this.anular(ventaId, empresaId, usuarioId, {
        autorizadoPorId: usuarioId,
        motivo: 'Cobro Yape/Plin cancelado — pago parcial devuelto al cliente',
      });
      return { anulada: true, yaPagada: false, devuelto: pagado };
    }

    // Venta DIFERIDA pendiente sin pagos → BORRAR + devolver stock (no deja
    // venta ANULADA ni comprobante: nunca llegó a materializarse).
    if (venta.cobroDiferido && venta.estado === EstadoVenta.CONFIRMADA) {
      const r = await this.eliminarVentaYapeDiferidaPendiente(ventaId, empresaId);
      return { anulada: r.eliminada, yaPagada: r.yaPagada };
    }

    // Compat (venta NO diferida, ej. flujo viejo): anular como antes.
    try {
      await this.anular(ventaId, empresaId, usuarioId, undefined, {
        soloSiPendienteSinPagos: true,
      });
      await this.prisma.venta.update({
        where: { id: ventaId },
        data: {
          motivoAnulacion: 'Cobro Yape/Plin cancelado por el cajero',
          fechaAnulacion: new Date(),
        },
      });
      return { anulada: true, yaPagada: false };
    } catch (err) {
      const v = await this.prisma.venta.findFirst({
        where: { id: ventaId, empresaId },
        select: { estado: true },
      });
      const yaPagada =
        v?.estado === EstadoVenta.PAGADA_COMPLETA ||
        v?.estado === EstadoVenta.PAGADA_PARCIAL;
      this.logger.warn(
        `No se anuló el cobro Yape de la venta ${ventaId}: ${(err as Error).message} (estado=${v?.estado})`,
      );
      return { anulada: false, yaPagada };
    }
  }

  /**
   * Borra una venta Yape DIFERIDA pendiente (CONFIRMADA, `cobroDiferido`, sin
   * pagos) devolviendo el stock. Reutilizado por el cancel manual (hoja de
   * cobro) y por el cron TTL. Cierra la carrera con el webhook re-validando
   * dentro de la transacción. Devuelve `yaPagada` si el pago llegó justo antes.
   */
  async eliminarVentaYapeDiferidaPendiente(
    ventaId: string,
    empresaId: string,
  ): Promise<{ eliminada: boolean; yaPagada: boolean }> {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId, cobroDiferido: true },
      include: { pagos: { select: { monto: true } }, detalles: true },
    });
    if (!venta) return { eliminada: false, yaPagada: false };

    const pagado = venta.pagos.reduce((s, p) => s + Number(p.monto), 0);
    if (venta.estado !== EstadoVenta.CONFIRMADA || pagado > 0) {
      const yaPagada =
        venta.estado === EstadoVenta.PAGADA_COMPLETA ||
        venta.estado === EstadoVenta.PAGADA_PARCIAL;
      return { eliminada: false, yaPagada };
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        // Re-validar dentro de la tx (cierra carrera con el webhook que pudo
        // pagar entre el findFirst de arriba y este borrado).
        const fresca = await tx.venta.findFirst({
          where: { id: ventaId },
          select: { estado: true, pagos: { select: { id: true } } },
        });
        if (
          !fresca ||
          fresca.estado !== EstadoVenta.CONFIRMADA ||
          fresca.pagos.length > 0
        ) {
          throw new Error('La venta dejó de estar pendiente sin pagos');
        }
        await this._eliminarVentaDiferidaPendiente(tx, venta);
      });
      this.realtimeInvalidation.notifyStockCambiado({
        empresaId,
        sedeId: venta.sedeId,
      });
      await this.invalidateProductCache(empresaId).catch(() => undefined);
      return { eliminada: true, yaPagada: false };
    } catch (err) {
      const v = await this.prisma.venta.findFirst({
        where: { id: ventaId, empresaId },
        select: { estado: true },
      });
      const yaPagada =
        v?.estado === EstadoVenta.PAGADA_COMPLETA ||
        v?.estado === EstadoVenta.PAGADA_PARCIAL;
      this.logger.warn(
        `No se borró el cobro Yape diferido ${ventaId}: ${(err as Error).message} (estado=${v?.estado})`,
      );
      return { eliminada: false, yaPagada };
    }
  }

  /**
   * Borra una venta Yape DIFERIDA pendiente (CONFIRMADA, sin comprobante ni
   * pagos) devolviendo el stock al inventario. No deja venta ANULADA: la venta
   * nunca llegó a materializarse fiscalmente. Solo para `cobroDiferido` (el
   * flujo diferido excluye combos y órdenes de servicio). Debe llamarse dentro
   * de una transacción que ya validó estado=CONFIRMADA y pagos=0.
   */
  private async _eliminarVentaDiferidaPendiente(
    tx: any,
    venta: {
      id: string;
      sedeId: string;
      detalles: Array<{
        productoId: string | null;
        varianteId: string | null;
        cantidad: any;
      }>;
    },
  ): Promise<void> {
    // Devolver stock (increment atómico) por cada detalle de producto/variante.
    for (const d of venta.detalles) {
      if (!d.productoId && !d.varianteId) continue;
      // El stock de una VARIANTE vive con productoId=NULL → se consulta SOLO por
      // varianteId. Para producto simple, por productoId con varianteId=null.
      // (Mismo branch que crearYCobrar; un AND productoId+varianteId no matchea
      // la fila de variante y dejaría stock sin devolver.)
      const ps = await tx.productoStock.findFirst({
        where: d.varianteId
          ? { sedeId: venta.sedeId, varianteId: d.varianteId }
          : { sedeId: venta.sedeId, productoId: d.productoId, varianteId: null },
        select: { id: true },
      });
      if (!ps) continue;
      await tx.productoStock.update({
        where: { id: ps.id },
        data: { stockActual: { increment: Number(d.cantidad) } },
      });
    }
    // Borrar hijos (no hay onDelete cascade) y luego la venta. Una diferida sin
    // pagar no tiene pagos/comprobante/caja/cuotas.
    await tx.movimientoStock.deleteMany({ where: { ventaId: venta.id } });
    await tx.descuentoUsoHistorial.deleteMany({ where: { ventaId: venta.id } });
    await tx.ventaDetalle.deleteMany({ where: { ventaId: venta.id } });
    await tx.venta.delete({ where: { id: venta.id } });
  }

  /**
   * Anular venta → reversar stock
   */
  async anular(
    id: string,
    empresaId: string,
    usuarioId: string,
    dto?: { autorizadoPorId: string; motivo: string },
    opts?: { soloSiPendienteSinPagos?: boolean },
  ) {
    this.logger.info('Anulando venta', { id, empresaId });

    const result = await this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id, empresaId },
        include: {
          detalles: true,
          // Necesario para reversar caja: 1 EGRESO por cada PagoVenta original.
          // `referencia` identifica pagos "adelanto aplicado" de órdenes
          // (no entraron a caja con esta venta → no se reversan aquí).
          pagos: { select: { metodoPago: true, monto: true, referencia: true } },
        },
      });

      if (!venta) {
        throw new NotFoundException('Venta no encontrada');
      }

      if (venta.estado === EstadoVenta.ANULADA) {
        throw new BadRequestException('La venta ya esta anulada');
      }

      if (venta.estado === EstadoVenta.BORRADOR) {
        throw new BadRequestException(
          'No se puede anular una venta en BORRADOR, eliminela en su lugar',
        );
      }

      // Anulación automática por TTL (cron Yape): solo proceder si la venta
      // SIGUE pendiente sin pagos. Si entre la selección del cron y esta
      // transacción llegó el webhook y la pagó, abortamos para no revertir el
      // stock de una venta ya cobrada. La verificación es dentro de la misma
      // transacción → ve el commit del webhook (read-committed).
      if (opts?.soloSiPendienteSinPagos) {
        const pagado = venta.pagos.reduce(
          (s, p) => s + Number(p.monto),
          0,
        );
        if (venta.estado !== EstadoVenta.CONFIRMADA || pagado > 0) {
          throw new BadRequestException(
            'La venta dejó de estar pendiente sin pagos — no se anula',
          );
        }
      }

      // Reversar stock para cada detalle con producto/variante
      for (const detalle of venta.detalles) {
        if (!detalle.productoId && !detalle.varianteId) {
          continue;
        }

        const productoStock = await tx.productoStock.findFirst({
          where: {
            sedeId: venta.sedeId,
            productoId: detalle.productoId ?? null,
            varianteId: detalle.varianteId ?? null,
          },
        });

        if (!productoStock) continue;

        const cantidad = Number(detalle.cantidad);
        const stockAnterior = productoStock.stockActual;
        const nuevoStock = stockAnterior + cantidad;

        await tx.productoStock.update({
          where: { id: productoStock.id },
          data: { stockActual: nuevoStock },
        });

        // Anulación: revierte la salida con el mismo snapshot de costo
        // que tenía el detalle (lo que se descontó originalmente).
        await crearMovimientoStockConValoracion(tx, {
          sedeId: venta.sedeId,
          empresaId,
          productoStockId: productoStock.id,
          tipo: TipoMovimientoStock.AJUSTE_SALIDA_VENTA,
          tipoDocumento: 'VENTA',
          numeroDocumento: venta.codigo,
          cantidadAnterior: stockAnterior,
          cantidad: cantidad,
          cantidadNueva: nuevoStock,
          motivo: `Anulacion venta ${venta.codigo} - ${detalle.descripcion}`,
          ventaId: venta.id,
          usuarioId,
          precioCostoUnitario:
            (detalle as any).precioCostoSnapshot ?? undefined,
        });
      }

      // Si vino de cotización, revertir a APROBADA
      if (venta.cotizacionId) {
        await tx.cotizacion.update({
          where: { id: venta.cotizacionId },
          data: {
            estado: EstadoCotizacion.APROBADA,
            ventaId: null,
          },
        });
      }

      // Si la venta cobró órdenes de servicio, revertirlas a LISTO_ENTREGA
      // (re-cobrables) y liberar el candado @unique del detalle.
      const detallesConOrden = venta.detalles.filter(
        (d) => (d as any).ordenServicioId,
      );
      if (detallesConOrden.length > 0) {
        await this.ordenServicioService.revertirCobroPorVentaAnulada(
          tx,
          empresaId,
          detallesConOrden.map((d) => ({
            id: d.id,
            ordenServicioId: (d as any).ordenServicioId as string,
          })),
          usuarioId,
          venta.codigo,
        );
        this.logger.log(
          `Anulación ${venta.codigo}: ${detallesConOrden.length} orden(es) de servicio revertida(s) a LISTO_ENTREGA`,
        );
      }

      const updatedVenta = await tx.venta.update({
        where: { id },
        data: {
          estado: EstadoVenta.ANULADA,
          ...(dto && {
            motivoAnulacion: dto.motivo,
            anuladoPorId: usuarioId,
            autorizadoPorId: dto.autorizadoPorId,
            fechaAnulacion: new Date(),
          }),
        },
        include: this.getInclude(),
      });

      // Reverso de caja: el helper busca cada MovimientoCaja(INGRESO) original
      // de esta venta y crea su contrapartida EN LA MISMA caja si sigue abierta
      // (o, si está cerrada, marca original anulado + ajuste en caja actual de
      // quien anula). Esto evita el bug clásico de anular venta del cajero X
      // desde una caja del admin Y y que el INGRESO quede huérfano en X.
      //
      // Fallback: si la venta fue cobrada sin caja activa (no hay
      // MovimientoCaja), usamos los PagoVenta no-CREDITO como compensación
      // contra la caja del que anula.
      // Adelantos aplicados de órdenes: su dinero entró a caja con su
      // propio movimiento ADELANTO_SERVICIO (que sigue vigente — la orden
      // vuelve a LISTO_ENTREGA con su adelanto). El fallback no debe
      // reversarlos. ACOTADO a ventas con líneas de orden: el prefijo
      // "Adelanto " también matchearía "Adelanto cotización ..." y ese SÍ
      // debe compensarse al anular una venta de cotización.
      const tieneOrdenesServicio = venta.detalles.some(
        (d) => (d as any).ordenServicioId,
      );
      const pagosACobrar = (venta.pagos ?? []).filter(
        (p) =>
          p.metodoPago !== 'CREDITO' &&
          !(
            tieneOrdenesServicio &&
            (p as any).referencia?.startsWith('Adelanto ')
          ),
      );
      // El INGRESO original ya se registró NETO de vuelto (efectivo = recibido −
      // cambio). La contrapartida del fallback debe espejar eso, no el bruto del
      // PagoVenta, para que el EGRESO cuadre con lo que físicamente entró.
      const vueltoVenta = Number(venta.montoCambio ?? 0);
      const fallbackPagos = pagosACobrar.length > 0
        ? this.construirPagosParaCaja(
            pagosACobrar.map((p) => ({ metodoPago: p.metodoPago, monto: Number(p.monto) })),
            Number(venta.total),
            vueltoVenta,
          )
        : (Number(venta.montoRecibido ?? 0) > 0
            ? this.construirPagosParaCaja(
                [{ metodoPago: (venta.metodoPago ?? 'EFECTIVO'), monto: Number(venta.montoRecibido) }],
                Number(venta.total),
                vueltoVenta,
              )
            : []);

      try {
        const r = await this.cajaService.reversarMovimientosDeOrigen(
          empresaId,
          { ventaId: venta.id },
          usuarioId,
          dto?.motivo ?? `Anulación ${venta.codigo}`,
          fallbackPagos.length > 0 ? { sedeId: venta.sedeId, pagos: fallbackPagos as any } : null,
          tx,
        );
        this.logger.log(
          `Reverso caja venta ${venta.codigo}: ${r.reversadosEnCajaOriginal} en caja origen, ${r.compensadosEnTesoreria} compensados en Tesorería, ${r.sinCompensar} sin compensar`,
        );
      } catch (e: any) {
        this.logger.warn(`Error reversando caja para anulación ${venta.codigo}: ${e?.message ?? e}`);
      }

      this.logger.log(`Venta anulada: ${venta.codigo}`);
      return updatedVenta;
    });

    // Invalidar cache de productos después de restaurar stock
    await this.invalidateProductCache(empresaId);

    // Notificar realtime — los devices conectados ven el stock
    // actualizado tras la anulación. Emitimos un evento por
    // (productoId, varianteId) único de la venta para que cada device
    // pueda refrescar el detalle correcto si lo tiene abierto.
    try {
      const productosNotificados = new Set<string>();
      for (const detalle of result.detalles ?? []) {
        const productoId = (detalle as any).productoId as string | null;
        const varianteId = (detalle as any).varianteId as string | null;
        if (!productoId && !varianteId) continue;
        const key = `${productoId ?? ''}::${varianteId ?? ''}`;
        if (productosNotificados.has(key)) continue;
        productosNotificados.add(key);
        this.realtimeInvalidation.notifyStockCambiado({
          empresaId,
          productoId,
          varianteId,
          sedeId: result.sedeId,
        });
      }
      // Fallback: si por alguna razón no hubo detalles con producto
      // (ej. venta solo de servicios) emitir uno genérico por sede.
      if (productosNotificados.size === 0) {
        this.realtimeInvalidation.notifyStockCambiado({
          empresaId,
          sedeId: result.sedeId,
        });
      }
    } catch (err: any) {
      this.logger.warn(
        `Error notificando realtime anulación venta ${result.codigo}: ${err?.message ?? err}`,
      );
    }

    return result;
  }

  /**
   * Resumen de ventas para dashboard
   */
  async getResumen(empresaId: string, sedeId?: string) {
    const where: Prisma.VentaWhereInput = { empresaId };
    if (sedeId) where.sedeId = sedeId;

    const [totalVentas, ventasHoy, ventasPorEstado] = await Promise.all([
      this.prisma.venta.count({ where }),
      this.prisma.venta.count({
        where: {
          ...where,
          fechaVenta: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      this.prisma.venta.groupBy({
        by: ['estado'],
        where,
        _count: true,
        _sum: { total: true },
      }),
    ]);

    return {
      totalVentas,
      ventasHoy,
      porEstado: ventasPorEstado.map((g) => ({
        estado: g.estado,
        cantidad: g._count,
        total: g._sum.total ? Number(g._sum.total) : 0,
      })),
    };
  }

  // =====================================================
  // HELPERS PRIVADOS
  // =====================================================

  /**
   * Genera las cuotas para una venta a crédito
   */
  private generarCuotas(
    ventaId: string,
    montoCredito: number,
    numeroCuotas: number,
    plazoDias: number,
    porcentajeInteres: number = 0,
    fechaBase: Date = new Date(),
    adelantoInicial: number = 0,
  ) {
    const montoInteresTotal = round2(montoCredito * (porcentajeInteres / 100));
    const totalConInteres = montoCredito + montoInteresTotal;

    const intervaloDias = Math.floor(plazoDias / numeroCuotas);
    const montoCuota = Math.floor((totalConInteres / numeroCuotas) * 100) / 100;
    const resto = round2(totalConInteres - montoCuota * numeroCuotas);

    // Distribute interest proportionally
    const interesPorCuota = numeroCuotas > 0 ? Math.floor((montoInteresTotal / numeroCuotas) * 100) / 100 : 0;
    const restoInteres = round2(montoInteresTotal - interesPorCuota * numeroCuotas);

    const cuotas = Array.from({ length: numeroCuotas }, (_, i) => {
      const numero = i + 1;
      const esUltima = numero === numeroCuotas;
      const monto = esUltima ? montoCuota + resto : montoCuota;
      const interesEstaCuota = esUltima ? interesPorCuota + restoInteres : interesPorCuota;
      const principalEstaCuota = round2(monto - interesEstaCuota);

      const fechaVencimiento = new Date(fechaBase);
      fechaVencimiento.setDate(fechaVencimiento.getDate() + intervaloDias * numero);

      return {
        ventaId,
        numero,
        monto,
        montoPrincipal: principalEstaCuota,
        montoInteres: interesEstaCuota,
        montoPagado: 0,
        montoPagadoPrincipal: 0,
        montoPagadoInteres: 0,
        montoPagadoMora: 0,
        saldoPendiente: monto,
        fechaVencimiento,
        estado: 'PENDIENTE' as 'PENDIENTE' | 'PAGADA_PARCIAL' | 'PAGADA',
      };
    });

    // Las cuotas suman el TOTAL del documento (requisito SUNAT). Si hubo un
    // adelanto en efectivo, se aplica a las primeras cuotas en orden (cuota
    // inicial pagada) → el saldo real financiado = total − adelanto.
    let restante = round2(adelantoInicial);
    for (const c of cuotas) {
      if (restante <= 0.005) break;
      const aplica = Math.min(restante, c.saldoPendiente);
      c.montoPagado = round2(c.montoPagado + aplica);
      c.montoPagadoPrincipal = round2(c.montoPagadoPrincipal + aplica);
      c.saldoPendiente = round2(c.saldoPendiente - aplica);
      c.estado = c.saldoPendiente <= 0.005 ? 'PAGADA' : 'PAGADA_PARCIAL';
      restante = round2(restante - aplica);
    }

    return cuotas;
  }

  /**
   * Guard: si alguna línea tiene margen negativo (venta bajo costo) verifica
   * que esté autorizada — bien por liquidación activa del producto (motivo
   * snapshot en el detalle) o bien por un autorizador GERENTE/ADMIN
   * adjunto a la venta (ventaBajoCostoAutorizadaPorId).
   *
   * Devuelve la pérdida total agregada (suma de márgenes negativos x
   * cantidad) — la persistimos en `Venta.perdidaTotalLineas` para reporte.
   *
   * Si el autorizador NO tiene rol válido en la empresa, lanza Forbidden.
   * Si NO hay autorizador y NO hay liquidación, lanza
   * BadRequest con código VENTA_BAJO_COSTO_NO_AUTORIZADA + lista de líneas
   * para que el front muestre el dialog de autorización.
   */
  /**
   * Hidrata snapshot de costo + motivo liquidacion para detalles
   * provenientes de una Cotizacion. Reusa la query del PrecioNivelService
   * solo para extraer costo + motivoLiquidacion (el precio NO se recalcula
   * porque la cotizacion ya fijo el precio; respetar el precio cotizado
   * es parte del contrato comercial).
   */
  private async _hidratarSnapshotsCotizacion(
    detalles: Array<{
      productoId: string | null;
      varianteId: string | null;
      descripcion: string;
      cantidad: Prisma.Decimal;
      precioUnitario: Prisma.Decimal;
      descuento: Prisma.Decimal;
    }>,
    sedeId: string,
  ): Promise<Array<{
    precioCostoSnapshot: number;
    margenSnapshot: number;
    motivoLiquidacionSnapshot: MotivoLiquidacion | null;
    nivelAplicadoSnapshot: string | null;
  }>> {
    const result: Array<{
      precioCostoSnapshot: number;
      margenSnapshot: number;
      motivoLiquidacionSnapshot: MotivoLiquidacion | null;
      nivelAplicadoSnapshot: string | null;
    }> = [];
    for (const d of detalles) {
      if (!d.productoId && !d.varianteId) {
        result.push({ precioCostoSnapshot: 0, margenSnapshot: 0, motivoLiquidacionSnapshot: null, nivelAplicadoSnapshot: null });
        continue;
      }
      try {
        const calc = await this.precioNivelService.calcularPrecioSegunCantidad(
          d.productoId,
          d.varianteId,
          sedeId,
          Number(d.cantidad),
        );
        const precioUnit = Number(d.precioUnitario);
        const cantidadNum = Number(d.cantidad);
        const descuentoUnit = cantidadNum > 0 ? Number(d.descuento) / cantidadNum : 0;
        const costo = calc.precioCosto ?? 0;
        const margenUnit = (precioUnit - descuentoUnit) - costo;
        result.push({
          precioCostoSnapshot: costo,
          margenSnapshot: round2(margenUnit),
          motivoLiquidacionSnapshot:
            (calc.motivoLiquidacion as MotivoLiquidacion | null) ?? null,
          nivelAplicadoSnapshot:
            calc.nivelAplicado && calc.nivelAplicado !== 'Precio base'
              ? calc.nivelAplicado
              : null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `No se pudo hidratar snapshot para "${d.descripcion}" en cotizacion: ${msg}`,
        );
        result.push({ precioCostoSnapshot: 0, margenSnapshot: 0, motivoLiquidacionSnapshot: null, nivelAplicadoSnapshot: null });
      }
    }
    return result;
  }

  /**
   * Hidrata snapshot para itemsAdicionales que el cajero agrega durante
   * la conversion cotizacion→venta. Estos no estaban en la cotizacion,
   * asi que deben pasar por la misma logica de precio/costo/liquidacion.
   */
  private async _hidratarSnapshotsAdicionales(
    items: Array<{
      productoId?: string;
      varianteId?: string;
      cantidad: number;
    }>,
    sedeId: string,
  ): Promise<Array<{
    precioCostoSnapshot: number;
    motivoLiquidacionSnapshot: MotivoLiquidacion | null;
    nivelAplicadoSnapshot: string | null;
  }>> {
    const result: Array<{
      precioCostoSnapshot: number;
      motivoLiquidacionSnapshot: MotivoLiquidacion | null;
      nivelAplicadoSnapshot: string | null;
    }> = [];
    for (const item of items) {
      if (!item.productoId && !item.varianteId) {
        result.push({ precioCostoSnapshot: 0, motivoLiquidacionSnapshot: null, nivelAplicadoSnapshot: null });
        continue;
      }
      try {
        const calc = await this.precioNivelService.calcularPrecioSegunCantidad(
          item.productoId ?? null,
          item.varianteId ?? null,
          sedeId,
          item.cantidad,
        );
        result.push({
          precioCostoSnapshot: calc.precioCosto ?? 0,
          motivoLiquidacionSnapshot:
            (calc.motivoLiquidacion as MotivoLiquidacion | null) ?? null,
          nivelAplicadoSnapshot:
            calc.nivelAplicado && calc.nivelAplicado !== 'Precio base'
              ? calc.nivelAplicado
              : null,
        });
      } catch (err) {
        result.push({ precioCostoSnapshot: 0, motivoLiquidacionSnapshot: null, nivelAplicadoSnapshot: null });
      }
    }
    return result;
  }

  private async validarVentaBajoCosto(
    empresaId: string,
    detalles: Array<{
      descripcion: string;
      productoId: string | null;
      varianteId: string | null;
      cantidad: number;
      precioUnitario: number;
      descuento: number;
      precioCostoSnapshot: number;
      margenSnapshot: number;
      motivoLiquidacionSnapshot: MotivoLiquidacion | null;
    }>,
    autorizadoPorId: string | null,
  ): Promise<number | null> {
    const lineasBajoCosto = detalles.filter(
      (d) => d.precioCostoSnapshot > 0 && d.margenSnapshot < 0,
    );
    if (lineasBajoCosto.length === 0) return null;

    const perdidaTotal = lineasBajoCosto.reduce(
      (sum, d) => sum + d.margenSnapshot * d.cantidad,
      0,
    );

    // Bucket A: líneas en liquidación activa (snapshot ya copió el motivo).
    // Bucket B: el resto requiere autorización gerencial.
    const requierenAutorizacion = lineasBajoCosto.filter(
      (d) => !d.motivoLiquidacionSnapshot,
    );

    if (requierenAutorizacion.length > 0) {
      if (!autorizadoPorId) {
        throw new BadRequestException({
          code: 'VENTA_BAJO_COSTO_NO_AUTORIZADA',
          message:
            requierenAutorizacion.length === 1
              ? `"${requierenAutorizacion[0].descripcion}" se está vendiendo bajo costo y no está en liquidación. Se requiere autorización gerencial.`
              : `${requierenAutorizacion.length} productos se están vendiendo bajo costo sin liquidación. Se requiere autorización gerencial.`,
          perdidaTotal: round2(perdidaTotal),
          lineas: requierenAutorizacion.map((d) => ({
            descripcion: d.descripcion,
            productoId: d.productoId,
            varianteId: d.varianteId,
            cantidad: d.cantidad,
            precioUnitario: d.precioUnitario,
            precioCosto: d.precioCostoSnapshot,
            margenUnitario: round2(d.margenSnapshot),
            perdidaLinea: round2(d.margenSnapshot * d.cantidad),
          })),
        });
      }

      // Validar que el autorizador tiene rol válido en la empresa.
      // Reutilizamos la misma policy que liquidaciones: GERENTE_SEDE/ADMINISTRADOR
      // (sede) o SUPER_ADMIN/EMPRESA_ADMIN (empresa).
      const [empresaRol, sedeRol] = await Promise.all([
        this.prisma.empresaUsuarioRol.findFirst({
          where: {
            usuarioId: autorizadoPorId,
            empresaId,
            isActive: true,
            deletedAt: null,
            rol: { in: ['SUPER_ADMIN', 'EMPRESA_ADMIN'] },
          },
          select: { id: true },
        }),
        this.prisma.usuarioSedeRol.findFirst({
          where: {
            usuarioId: autorizadoPorId,
            sede: { empresaId },
            rol: { in: ['GERENTE_SEDE', 'ADMINISTRADOR'] },
            isActive: true,
          },
          select: { id: true },
        }),
      ]);
      if (!empresaRol && !sedeRol) {
        throw new BadRequestException(
          'El autorizador de la venta bajo costo no tiene rol GERENTE_SEDE/ADMINISTRADOR',
        );
      }
    }

    return round2(perdidaTotal);
  }

  private calcularDetalle(dto: CreateVentaDetalleDto | DetalleConSnapshot, index: number) {
    const cantidad = dto.cantidad;
    const precioUnitario = dto.precioUnitario;
    const descuento = dto.descuento ?? 0;
    const porcentajeIGV = dto.porcentajeIGV ?? 18;
    const incluyeIgv = dto.precioIncluyeIgv ?? false;

    const subtotalBruto = cantidad * precioUnitario;

    // Guard: el descuento de la línea no puede superar el precio (cantidad ×
    // precioUnitario). Si lo supera, la línea quedaría NEGATIVA → SUNAT rechaza
    // la boleta ("mto_precio_unitario must be at least 0"). Bloquea descuentos
    // manuales mal cargados (ej. descuento 3.40 sobre un ítem de 3.00).
    if (descuento > subtotalBruto + 0.001) {
      throw new BadRequestException(
        `El descuento de "${dto.descripcion}" (S/ ${descuento.toFixed(2)}) no puede ` +
          `superar el precio de la línea (S/ ${subtotalBruto.toFixed(2)}).`,
      );
    }

    let subtotal: number;
    let igv: number;
    let total: number;

    if (incluyeIgv) {
      // Precio ya incluye IGV → extraer base e IGV
      total = subtotalBruto - descuento;
      subtotal = total / (1 + porcentajeIGV / 100);
      igv = total - subtotal;
    } else {
      // Precio sin IGV → sumar IGV
      subtotal = subtotalBruto - descuento;
      igv = subtotal * (porcentajeIGV / 100);
      total = subtotal + igv;
    }

    // Tipo de afectación IGV (SUNAT Cat. 07)
    const tipoAfectacion = dto.tipoAfectacion || (porcentajeIGV > 0 ? '10' : '10');
    const icbperMonto = dto.icbper ?? 0;
    const totalConIcbper = total + icbperMonto;

    // Snapshot de costo y margen: el costo viene de aplicarPreciosBackendNivel
    // (cero si la línea no es producto o el cálculo falló). Margen = ingreso
    // neto de descuento por unidad, menos costo unitario.
    const precioCostoSnapshot =
      'precioCostoSnapshot' in dto ? dto.precioCostoSnapshot : 0;
    const motivoLiquidacionSnapshot =
      'motivoLiquidacionSnapshot' in dto ? dto.motivoLiquidacionSnapshot : null;
    const nivelAplicadoSnapshot =
      'nivelAplicadoSnapshot' in dto ? dto.nivelAplicadoSnapshot : null;
    const vipPoliticaId = 'vipPoliticaId' in dto ? dto.vipPoliticaId ?? null : null;
    const precioBaseVip = 'precioBaseVip' in dto ? dto.precioBaseVip ?? null : null;
    const descuentoUnitario = cantidad > 0 ? descuento / cantidad : 0;
    const ingresoNetoUnitario = precioUnitario - descuentoUnitario;
    const margenSnapshot = ingresoNetoUnitario - precioCostoSnapshot;

    return {
      productoId: dto.productoId || null,
      varianteId: dto.varianteId || null,
      servicioId: dto.servicioId || null,
      comboId: dto.comboId || null,
      ordenServicioId: dto.ordenServicioId || null,
      descripcion: dto.descripcion,
      cantidad,
      precioUnitario,
      descuento,
      porcentajeIGV,
      tipoAfectacion,
      icbper: round2(icbperMonto),
      igv: round2(igv),
      subtotal: round2(subtotal),
      total: round2(totalConIcbper),
      orden: index,
      origenComboId: dto.origenComboId || null,
      origenComboNombre: dto.origenComboNombre || null,
      // Snapshot de margen para reportería de liquidaciones / pérdidas.
      precioCostoSnapshot: round2(precioCostoSnapshot),
      margenSnapshot: round2(margenSnapshot),
      motivoLiquidacionSnapshot,
      nivelAplicadoSnapshot,
      // Passthrough VIP para el historial de uso (no se persiste en VentaDetalle).
      vipPoliticaId,
      precioBaseVip,
    };
  }

  /**
   * Generar comprobante electrónico (boleta/factura) para una venta tipo TICKET
   */
  async generarComprobante(ventaId: string, empresaId: string, dto: { tipoComprobante: 'BOLETA' | 'FACTURA'; tipoDocumentoCliente?: string; documentoCliente?: string }) {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      include: {
        ...this.getInclude(),
      },
    });

    if (!venta) throw new NotFoundException('Venta no encontrada');
    if (venta.comprobante) throw new BadRequestException('Esta venta ya tiene un comprobante electrónico generado');

    // Documento capturado AL EMITIR: las ventas online del marketplace llegan
    // sin DNI/RUC del comprador — el cajero lo ingresa en el diálogo y acá se
    // persiste en la venta para el comprobante y los reportes.
    const docNuevo = dto.documentoCliente?.trim();
    if (docNuevo) {
      await this.prisma.venta.update({
        where: { id: venta.id },
        data: { documentoCliente: docNuevo },
      });
      (venta as any).documentoCliente = docNuevo;
    }

    // Validar documento del cliente
    const validacionDoc = validarDocumentoParaComprobante(dto.tipoComprobante, venta.documentoCliente);
    if (!validacionDoc.valido) {
      throw new BadRequestException(validacionDoc.error);
    }

    const ventaResult = await this.prisma.$transaction(async (tx) => {
      // Lock sede para concurrencia de serie/correlativo
      const [sedeLocked] = await tx.$queryRaw<
        Array<{ id: string; serieFactura: string; serieBoleta: string; ultimoNumeroFactura: number; ultimoNumeroBoleta: number }>
      >`SELECT id, "serieFactura", "serieBoleta", "ultimoNumeroFactura", "ultimoNumeroBoleta"
        FROM "Sede" WHERE id = ${venta.sedeId} FOR UPDATE`;

      if (!sedeLocked) throw new BadRequestException('Sede no encontrada');

      const serie = dto.tipoComprobante === 'FACTURA' ? sedeLocked.serieFactura : sedeLocked.serieBoleta;
      const campoContador = dto.tipoComprobante === 'FACTURA' ? 'ultimoNumeroFactura' : 'ultimoNumeroBoleta';
      const sedeActualizada = await tx.sede.update({
        where: { id: sedeLocked.id },
        data: { [campoContador]: { increment: 1 } },
        select: { [campoContador]: true },
      });
      const nuevoCorrelativo: number = (sedeActualizada as any)[campoContador];
      const correlativo = String(nuevoCorrelativo);

      const codigoGenerado = `${serie}-${correlativo.padStart(8, '0')}`;
      const totalVenta = Number(venta.total);

      // Calcular totales tributarios por tipo de afectación
      const detallesParaTributario = venta.detalles.map((d: any) => ({
        tipoAfectacion: d.tipoAfectacion || '10',
        subtotal: Number(d.subtotal || 0),
        igv: Number(d.igv || 0),
        icbper: Number(d.icbper || 0),
      }));
      const tributario = this.calcularTotalesTributarios(detallesParaTributario);

      const comprobante = await tx.comprobanteElectronico.create({
        data: {
          ventaId: venta.id,
          empresaId,
          sedeId: venta.sedeId,
          clienteId: venta.clienteId,
          clienteEmpresaId: venta.clienteEmpresaId,
          tipoComprobante: dto.tipoComprobante as any,
          serie,
          correlativo: correlativo.padStart(8, '0'),
          codigoGenerado,
          // Tipo doc: explícito del dto → inferido por longitud (11=RUC) →
          // default por tipo de comprobante.
          tipoDocumento:
            dto.tipoDocumentoCliente ||
            (venta.documentoCliente?.length === 11
              ? '6'
              : dto.tipoComprobante === 'FACTURA'
                ? '6'
                : '1'),
          numeroDocumento: venta.documentoCliente,
          nombreCliente: venta.nombreCliente,
          direccionCliente: venta.direccionCliente,
          emailCliente: venta.emailCliente,
          moneda: venta.moneda,
          gravada: new Prisma.Decimal(tributario.gravada.toFixed(2)),
          exonerada: new Prisma.Decimal(tributario.exonerada.toFixed(2)),
          inafecta: new Prisma.Decimal(tributario.inafecta.toFixed(2)),
          igv: new Prisma.Decimal(tributario.igv.toFixed(2)),
          totalIgv: new Prisma.Decimal(tributario.igv.toFixed(2)),
          icbper: new Prisma.Decimal(tributario.icbper.toFixed(2)),
          total: new Prisma.Decimal(totalVenta.toFixed(2)),
          estado: 'REGISTRADO' as any,
          detalles: {
            create: venta.detalles.map((d: any) => {
              const subtotalItem = Number(d.subtotal || 0);
              const igvItem = Number(d.igv || 0);
              const totalItem = Number(d.total || subtotalItem + igvItem);
              const cant = Number(d.cantidad || 1);
              const valorUnit = cant > 0 ? subtotalItem / cant : 0;
              const precioUnit = cant > 0 ? totalItem / cant : 0;
              return {
                descripcion: d.descripcion,
                cantidad: d.cantidad,
                tipoAfectacion: d.tipoAfectacion || '10',
                porcentajeIGV: new Prisma.Decimal(Number(d.porcentajeIGV ?? 18)),
                valorUnitario: new Prisma.Decimal(valorUnit.toFixed(2)),
                precioUnitario: new Prisma.Decimal(precioUnit.toFixed(2)),
                valorVenta: new Prisma.Decimal(subtotalItem.toFixed(2)),
                igv: new Prisma.Decimal(igvItem.toFixed(2)),
                icbper: new Prisma.Decimal(Number(d.icbper || 0).toFixed(2)),
                subtotal: new Prisma.Decimal(subtotalItem.toFixed(2)),
                total: new Prisma.Decimal(totalItem.toFixed(2)),
                ...(d.productoId ? { producto: { connect: { id: d.productoId } } } : {}),
              };
            }),
          },
        },
      });

      // Registrar pagos del comprobante: 1 PagoComprobante por PagoVenta no-CREDITO.
      // Multi-medio: refleja la realidad del cobro en el registro tributario.
      const pagosVenta = (venta.pagos ?? []).filter(
        (p: any) => p.metodoPago !== 'CREDITO',
      );
      const pagosComprobanteData = pagosVenta.length > 0
        ? pagosVenta.map((p: any) => ({
            comprobanteId: comprobante.id,
            metodoPago: p.metodoPago,
            monto: new Prisma.Decimal(Number(p.monto).toFixed(2)),
            referencia: p.referencia || null,
            estado: 'COMPLETADO',
          }))
        : [{
            comprobanteId: comprobante.id,
            metodoPago: venta.metodoPago || 'EFECTIVO',
            monto: new Prisma.Decimal('0.00'),
            referencia: null,
            estado: venta.esCredito ? 'PENDIENTE' : 'COMPLETADO',
          }];

      await tx.pagoComprobante.createMany({ data: pagosComprobanteData });

      this.logger.log(`Comprobante ${codigoGenerado} generado para venta ${venta.codigo}`);

      // Retornar venta actualizada
      return tx.venta.findUnique({
        where: { id: ventaId },
        include: this.getInclude(),
      });
    }, { timeout: 15000 });

    // Fire-after-commit: enviar comprobante a Nubefact
    const comprobanteId = ventaResult?.comprobante?.id;
    if (comprobanteId) {
      this.facturacionService.enviarComprobante(comprobanteId, empresaId)
        .catch(err => this.logger.warn(`Envío fallido: ${err?.message}`));
    }

    return ventaResult;
  }

  /**
   * Calcula totales tributarios SUNAT desde detalles calculados
   */
  private calcularTotalesTributarios(detalles: Array<{ tipoAfectacion?: string; subtotal: number; igv: number; icbper?: number }>) {
    let gravada = 0, exonerada = 0, inafecta = 0, igvTotal = 0, icbperTotal = 0;

    for (const d of detalles) {
      const tipo = d.tipoAfectacion || '10';
      if (tipo === '10') {
        gravada += d.subtotal;
        igvTotal += d.igv;
      } else if (tipo === '20') {
        exonerada += d.subtotal;
      } else if (tipo === '30') {
        inafecta += d.subtotal;
      }
      icbperTotal += d.icbper ?? 0;
    }

    return {
      gravada: round2(gravada),
      exonerada: round2(exonerada),
      inafecta: round2(inafecta),
      igv: round2(igvTotal),
      icbper: round2(icbperTotal),
    };
  }

  /**
   * Invalidar cache de productos y estadísticas de la empresa
   */
  private async invalidateProductCache(empresaId: string): Promise<void> {
    try {
      const statsKey = this.cacheService.getEmpresaStatsKey(empresaId);
      await this.cacheService.invalidate(statsKey);
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Error al invalidar cache: ${errorMessage}`);
    }
  }

  private buildUpdateData(dto: UpdateVentaDto) {
    return {
      ...(dto.clienteId !== undefined && { clienteId: dto.clienteId }),
      ...(dto.clienteEmpresaId !== undefined && {
        clienteEmpresaId: dto.clienteEmpresaId,
      }),
      ...(dto.nombreCliente !== undefined && {
        nombreCliente: dto.nombreCliente,
      }),
      ...(dto.documentoCliente !== undefined && {
        documentoCliente: dto.documentoCliente,
      }),
      ...(dto.emailCliente !== undefined && {
        emailCliente: dto.emailCliente,
      }),
      ...(dto.telefonoCliente !== undefined && {
        telefonoCliente: dto.telefonoCliente,
      }),
      ...(dto.direccionCliente !== undefined && {
        direccionCliente: dto.direccionCliente,
      }),
      ...(dto.moneda !== undefined && { moneda: dto.moneda }),
      ...(dto.tipoCambio !== undefined && { tipoCambio: dto.tipoCambio }),
      ...(dto.metodoPago !== undefined && { metodoPago: dto.metodoPago }),
      ...(dto.montoRecibido !== undefined && {
        montoRecibido: dto.montoRecibido,
      }),
      ...(dto.esCredito !== undefined && { esCredito: dto.esCredito }),
      ...(dto.plazoCredito !== undefined && {
        plazoCredito: dto.plazoCredito,
      }),
      ...(dto.fechaVencimientoPago !== undefined && {
        fechaVencimientoPago: dto.fechaVencimientoPago
          ? new Date(dto.fechaVencimientoPago)
          : null,
      }),
      ...(dto.observaciones !== undefined && {
        observaciones: dto.observaciones,
      }),
    };
  }

  // ── Flujo de documentos ──

  /**
   * Autocompletado: busca documentos que coincidan parcialmente con el texto ingresado.
   * Busca en ventas, comprobantes, guías, cotizaciones, devoluciones.
   */
  async autocompleteDocumentos(empresaId: string, query: string) {
    if (!query?.trim() || query.trim().length < 2) return [];

    const q = query.trim();
    const limit = 10;

    const [ventas, comprobantes, guias, cotizaciones, devoluciones] = await Promise.all([
      this.prisma.venta.findMany({
        where: { empresaId, codigo: { contains: q, mode: 'insensitive' } },
        select: { id: true, codigo: true, estado: true, nombreCliente: true, total: true },
        take: limit,
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.comprobanteElectronico.findMany({
        where: { empresaId, codigoGenerado: { contains: q, mode: 'insensitive' } },
        select: { id: true, codigoGenerado: true, tipoComprobante: true, estado: true, total: true },
        take: limit,
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.guiaRemision.findMany({
        where: { empresaId, codigoGenerado: { contains: q, mode: 'insensitive' } },
        select: { id: true, codigoGenerado: true, tipo: true, estado: true, clienteDenominacion: true },
        take: limit,
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.cotizacion.findMany({
        where: { empresaId, codigo: { contains: q, mode: 'insensitive' } },
        select: { id: true, codigo: true, estado: true, total: true },
        take: limit,
        orderBy: { creadoEn: 'desc' },
      }),
      this.prisma.devolucion.findMany({
        where: { empresaId, codigo: { contains: q, mode: 'insensitive' } },
        select: { id: true, codigo: true, tipo: true, estado: true },
        take: limit,
        orderBy: { creadoEn: 'desc' },
      }),
    ]);

    const resultados: any[] = [];

    for (const v of ventas) {
      resultados.push({ codigo: v.codigo, tipo: 'VENTA', estado: v.estado, detalle: v.nombreCliente, monto: v.total });
    }
    for (const c of comprobantes) {
      resultados.push({ codigo: c.codigoGenerado, tipo: c.tipoComprobante, estado: c.estado, monto: c.total });
    }
    for (const g of guias) {
      resultados.push({ codigo: g.codigoGenerado, tipo: 'GUIA_REMISION', estado: g.estado, detalle: g.clienteDenominacion });
    }
    for (const c of cotizaciones) {
      resultados.push({ codigo: c.codigo, tipo: 'COTIZACION', estado: c.estado, monto: c.total });
    }
    for (const d of devoluciones) {
      resultados.push({ codigo: d.codigo, tipo: 'DEVOLUCION', estado: d.estado });
    }

    return resultados.slice(0, limit);
  }

  /**
   * Busca el flujo de documentos a partir de cualquier código de documento.
   * Busca en: Venta, Comprobante, Guía Remisión, Cotización, Devolución.
   * Todos resuelven a la venta raíz para construir el árbol.
   */
  async buscarFlujoDocumentos(empresaId: string, codigo: string) {
    if (!codigo?.trim()) {
      throw new BadRequestException('Ingrese un código de documento');
    }

    const codigoLimpio = codigo.trim().toUpperCase();
    let ventaId: string | null = null;

    // 1. Buscar en Venta
    const venta = await this.prisma.venta.findFirst({
      where: { empresaId, codigo: { equals: codigoLimpio, mode: 'insensitive' } },
      select: { id: true },
    });
    if (venta) ventaId = venta.id;

    // 2. Buscar en Comprobante Electrónico
    if (!ventaId) {
      const comprobante = await this.prisma.comprobanteElectronico.findFirst({
        where: { empresaId, codigoGenerado: { equals: codigoLimpio, mode: 'insensitive' } },
        select: { ventaId: true, comprobanteOrigenId: true },
      });
      if (comprobante) {
        if (comprobante.ventaId) {
          ventaId = comprobante.ventaId;
        } else if (comprobante.comprobanteOrigenId) {
          // Es una nota — buscar el comprobante padre
          const padre = await this.prisma.comprobanteElectronico.findUnique({
            where: { id: comprobante.comprobanteOrigenId },
            select: { ventaId: true },
          });
          if (padre?.ventaId) ventaId = padre.ventaId;
        }
      }
    }

    // 3. Buscar en Guía de Remisión
    if (!ventaId) {
      const guia = await this.prisma.guiaRemision.findFirst({
        where: { empresaId, codigoGenerado: { equals: codigoLimpio, mode: 'insensitive' } },
        select: { ventaId: true },
      });
      if (guia?.ventaId) ventaId = guia.ventaId;
    }

    // 4. Buscar en Cotización
    if (!ventaId) {
      const cotizacion = await this.prisma.cotizacion.findFirst({
        where: { empresaId, codigo: { equals: codigoLimpio, mode: 'insensitive' } },
        select: { ventaId: true },
      });
      if (cotizacion?.ventaId) ventaId = cotizacion.ventaId;
    }

    // 5. Buscar en Devolución
    if (!ventaId) {
      const devolucion = await this.prisma.devolucion.findFirst({
        where: { empresaId, codigo: { equals: codigoLimpio, mode: 'insensitive' } },
        select: { ventaId: true },
      });
      if (devolucion?.ventaId) ventaId = devolucion.ventaId;
    }

    if (!ventaId) {
      throw new NotFoundException(`No se encontró ningún documento con código "${codigo}"`);
    }

    return this.flujoDocumentos(ventaId, empresaId);
  }

  async flujoDocumentos(ventaId: string, empresaId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      select: {
        id: true,
        codigo: true,
        estado: true,
        nombreCliente: true,
        documentoCliente: true,
        total: true,
        moneda: true,
        montoCambio: true,
        fechaVenta: true,
        esCredito: true,
        cotizacionId: true,
        // Cotización origen
        cotizacion: {
          select: { id: true, codigo: true, estado: true, total: true, fechaEmision: true },
        },
        // Órdenes de servicio cobradas por esta venta (preceden a la venta
        // en el flujo, como la cotización). Sus adelantos se muestran como
        // hijos con los movimientos de caja reales.
        detalles: {
          where: { ordenServicioId: { not: null } },
          select: {
            ordenServicio: {
              select: {
                id: true,
                codigo: true,
                estado: true,
                costoTotal: true,
                adelanto: true,
                metodoPagoAdelanto: true,
                creadoEn: true,
              },
            },
          },
        },
        // Comprobante electrónico (factura/boleta)
        comprobante: {
          select: {
            id: true, tipoComprobante: true, codigoGenerado: true,
            estado: true, sunatStatus: true, total: true, fechaEmision: true,
            sunatPdfUrl: true, enlaceProveedor: true, anulado: true,
            // Notas de crédito/débito vinculadas
            notasRelacionadas: {
              select: {
                id: true, tipoComprobante: true, codigoGenerado: true,
                estado: true, sunatStatus: true, total: true, fechaEmision: true,
                motivoNota: true, tipoNotaCredito: true, tipoNotaDebito: true,
                sunatPdfUrl: true, enlaceProveedor: true, anulado: true,
              },
              orderBy: { creadoEn: 'asc' as const },
            },
          },
        },
        // Guías de remisión
        guiasRemision: {
          select: {
            id: true, codigoGenerado: true, tipo: true,
            estado: true, sunatStatus: true,
            motivoTraslado: true, fechaEmision: true,
            clienteDenominacion: true,
            sunatPdfUrl: true, enlaceProveedor: true,
          },
          orderBy: { creadoEn: 'asc' as const },
        },
        // Devoluciones
        devoluciones: {
          select: {
            id: true, codigo: true, tipo: true,
            estado: true, motivo: true,
            tipoReembolso: true, creadoEn: true,
          },
          orderBy: { creadoEn: 'asc' as const },
        },
        // Pagos
        pagos: {
          select: {
            id: true, metodoPago: true, monto: true,
            referencia: true, fechaPago: true,
          },
          orderBy: { fechaPago: 'asc' as const },
        },
        // Cuotas (si es crédito)
        cuotas: {
          select: {
            id: true, numero: true, monto: true, montoPagado: true,
            saldoPendiente: true, estado: true, fechaVencimiento: true,
          },
          orderBy: { numero: 'asc' as const },
        },
      },
    });

    if (!venta) throw new NotFoundException('Venta no encontrada');

    // Construir árbol de documentos
    const nodos: any[] = [];

    // 1. Cotización (si existe)
    if (venta.cotizacion) {
      nodos.push({
        tipo: 'COTIZACION',
        icono: 'request_quote',
        id: venta.cotizacion.id,
        codigo: venta.cotizacion.codigo,
        estado: venta.cotizacion.estado,
        fecha: venta.cotizacion.fechaEmision,
        monto: venta.cotizacion.total,
        moneda: venta.moneda,
        ruta: `/empresa/cotizaciones/${venta.cotizacion.id}`,
        hijos: [],
      });
    }

    // 1b. Órdenes de servicio cobradas por esta venta — preceden a la
    // venta (el servicio + sus adelantos existieron antes del cobro).
    // Los adelantos salen de los MovimientoCaja ADELANTO_SERVICIO reales
    // (cada abono con su método y fecha); fallback al campo de la orden
    // para adelantos previos a esa integración.
    //
    // Los nodos se acumulan aparte: si la venta cobró UNA sola orden, la
    // venta se anida como hijo de la orden (un solo árbol conectado:
    // servicio → adelantos → venta → comprobante/pagos). Con varias
    // órdenes quedan como raíces hermanas de la venta.
    const ordenNodos: any[] = [];
    const ordenesServicio = (venta.detalles ?? [])
      .map((d) => d.ordenServicio)
      .filter((o): o is NonNullable<typeof o> => !!o);

    if (ordenesServicio.length > 0) {
      const movsAdelanto = await this.prisma.movimientoCaja.findMany({
        where: {
          ordenServicioId: { in: ordenesServicio.map((o) => o.id) },
          categoria: 'ADELANTO_SERVICIO' as any,
          anulado: false,
        },
        select: {
          id: true,
          ordenServicioId: true,
          tipo: true,
          metodoPago: true,
          monto: true,
          fechaMovimiento: true,
        },
        orderBy: { fechaMovimiento: 'asc' },
      });

      for (const os of ordenesServicio) {
        const ordenNodo: any = {
          tipo: 'ORDEN_SERVICIO',
          icono: 'home_repair_service',
          id: os.id,
          codigo: os.codigo,
          estado: os.estado,
          fecha: os.creadoEn,
          monto: os.costoTotal,
          moneda: venta.moneda,
          detalle: 'Servicio cobrado en esta venta',
          ruta: `/empresa/ordenes/${os.id}`,
          hijos: [],
        };

        const movs = movsAdelanto.filter((m) => m.ordenServicioId === os.id);
        for (const m of movs) {
          const esCorreccion = m.tipo === 'EGRESO';
          ordenNodo.hijos.push({
            tipo: 'ADELANTO',
            icono: 'savings',
            id: m.id,
            codigo: `${esCorreccion ? 'Corrección adelanto' : 'Adelanto'} ${m.metodoPago}`,
            estado: 'COMPLETADO',
            fecha: m.fechaMovimiento,
            monto: esCorreccion ? -Number(m.monto) : Number(m.monto),
            moneda: venta.moneda,
            ruta: null,
            hijos: [],
          });
        }

        // Fallback: orden con adelanto registrado antes de la integración
        // adelanto→caja (sin MovimientoCaja vinculado).
        if (movs.length === 0 && Number(os.adelanto ?? 0) > 0) {
          ordenNodo.hijos.push({
            tipo: 'ADELANTO',
            icono: 'savings',
            id: `${os.id}-adelanto`,
            codigo: `Adelanto${os.metodoPagoAdelanto ? ` ${os.metodoPagoAdelanto}` : ''}`,
            estado: 'COMPLETADO',
            fecha: null,
            monto: Number(os.adelanto),
            moneda: venta.moneda,
            ruta: null,
            hijos: [],
          });
        }

        ordenNodos.push(ordenNodo);
      }
    }

    // 2. Venta (nodo principal)
    const ventaNodo: any = {
      tipo: 'VENTA',
      icono: 'shopping_cart',
      id: venta.id,
      codigo: venta.codigo,
      estado: venta.estado,
      fecha: venta.fechaVenta,
      monto: venta.total,
      moneda: venta.moneda,
      detalle: `${venta.nombreCliente}${venta.esCredito ? ' (Crédito)' : ''}`,
      ruta: `/empresa/ventas/${venta.id}`,
      hijos: [],
    };

    // 3. Comprobante electrónico
    if (venta.comprobante) {
      const comp = venta.comprobante;
      const comprobanteNodo: any = {
        tipo: comp.tipoComprobante,
        icono: comp.tipoComprobante === 'FACTURA' ? 'description' : 'receipt',
        id: comp.id,
        codigo: comp.codigoGenerado,
        estado: comp.anulado ? 'ANULADO' : comp.estado,
        sunatStatus: comp.sunatStatus,
        anulado: comp.anulado,
        fecha: comp.fechaEmision,
        monto: comp.total,
        moneda: venta.moneda,
        pdfUrl: comp.sunatPdfUrl,
        enlace: comp.enlaceProveedor,
        ruta: `/empresa/ventas/${venta.id}`,
        hijos: [],
      };

      // 3.1 Notas de crédito/débito
      for (const nota of comp.notasRelacionadas || []) {
        comprobanteNodo.hijos.push({
          tipo: nota.tipoComprobante,
          icono: nota.tipoComprobante === 'NOTA_CREDITO' ? 'remove_circle' : 'add_circle',
          id: nota.id,
          codigo: nota.codigoGenerado,
          estado: nota.anulado ? 'ANULADO' : nota.estado,
          sunatStatus: nota.sunatStatus,
          anulado: nota.anulado,
          fecha: nota.fechaEmision,
          monto: nota.total,
          moneda: venta.moneda,
          detalle: nota.motivoNota,
          pdfUrl: nota.sunatPdfUrl,
          enlace: nota.enlaceProveedor,
          ruta: `/empresa/ventas/${venta.id}`,
          hijos: [],
        });
      }

      ventaNodo.hijos.push(comprobanteNodo);
    }

    // 4. Guías de remisión
    for (const guia of venta.guiasRemision || []) {
      ventaNodo.hijos.push({
        tipo: 'GUIA_REMISION',
        icono: 'local_shipping',
        id: guia.id,
        codigo: guia.codigoGenerado,
        estado: guia.estado,
        sunatStatus: guia.sunatStatus,
        fecha: guia.fechaEmision,
        detalle: `${guia.tipo} — ${guia.clienteDenominacion}`,
        pdfUrl: guia.sunatPdfUrl,
        enlace: guia.enlaceProveedor,
        ruta: `/empresa/guias-remision/${guia.id}`,
        hijos: [],
      });
    }

    // 5. Pagos
    const montoCambio = venta.montoCambio ? Number(venta.montoCambio) : 0;
    for (const pago of venta.pagos || []) {
      // Pagos "adelanto aplicado" de órdenes de servicio: ya aparecen como
      // nodo ADELANTO bajo la orden (con su fecha real de caja) — no
      // duplicar como pago de la venta.
      if (
        ordenesServicio.length > 0 &&
        pago.referencia?.startsWith('Adelanto ')
      ) {
        continue;
      }
      const esEfectivo = pago.metodoPago === 'EFECTIVO';
      ventaNodo.hijos.push({
        tipo: 'PAGO',
        icono: 'payments',
        id: pago.id,
        codigo: `Pago ${pago.metodoPago}`,
        estado: 'COMPLETADO',
        fecha: pago.fechaPago,
        monto: pago.monto,
        moneda: venta.moneda,
        detalle: pago.referencia || null,
        ...(esEfectivo && montoCambio > 0 ? { vuelto: montoCambio } : {}),
        ruta: null,
        hijos: [],
      });
    }

    // 6. Cuotas (si es crédito)
    if (venta.esCredito && venta.cuotas?.length) {
      for (const cuota of venta.cuotas) {
        ventaNodo.hijos.push({
          tipo: 'CUOTA',
          icono: 'event',
          id: cuota.id,
          codigo: `Cuota ${cuota.numero}/${venta.cuotas.length}`,
          estado: cuota.estado,
          fecha: cuota.fechaVencimiento,
          monto: cuota.monto,
          moneda: venta.moneda,
          detalle: `Pagado: ${cuota.montoPagado} | Saldo: ${cuota.saldoPendiente}`,
          ruta: null,
          hijos: [],
        });
      }
    }

    // 7. Devoluciones
    for (const dev of venta.devoluciones || []) {
      ventaNodo.hijos.push({
        tipo: 'DEVOLUCION',
        icono: 'assignment_return',
        id: dev.id,
        codigo: dev.codigo,
        estado: dev.estado,
        fecha: dev.creadoEn,
        detalle: dev.motivo,
        ruta: `/empresa/devoluciones/${dev.id}`,
        hijos: [],
      });
    }

    // Cierre del árbol: con UNA orden de servicio, la venta cuelga de la
    // orden (historia conectada: servicio → adelantos → venta → docs).
    // Con varias órdenes (o ninguna), la venta va como raíz.
    if (ordenNodos.length === 1) {
      ordenNodos[0].hijos.push(ventaNodo);
      nodos.push(ordenNodos[0]);
    } else {
      nodos.push(...ordenNodos);
      nodos.push(ventaNodo);
    }

    // Totales financieros del flujo (autoritativos desde la venta).
    const total = Number(venta.total);
    const cobrado = venta.pagos.reduce((s, p) => s + Number(p.monto), 0);
    const saldo = Math.max(0, total - cobrado);
    // "Devuelto" = suma de Notas de Crédito vigentes (el impacto financiero de
    // las devoluciones se materializa en NC).
    const notasCredito = (venta.comprobante?.notasRelacionadas ?? [])
      .filter((n) => n.tipoComprobante === 'NOTA_CREDITO' && !n.anulado)
      .reduce((s, n) => s + Number(n.total), 0);

    return {
      ventaId: venta.id,
      ventaCodigo: venta.codigo,
      totalDocumentos: this.contarNodos(nodos),
      totales: {
        moneda: venta.moneda,
        total: round2(total),
        cobrado: round2(cobrado),
        saldo: round2(saldo),
        devuelto: round2(notasCredito),
        numDevoluciones: venta.devoluciones.length,
        esCredito: venta.esCredito,
      },
      nodos,
    };
  }

  private contarNodos(nodos: any[]): number {
    let count = nodos.length;
    for (const n of nodos) {
      if (n.hijos?.length) count += this.contarNodos(n.hijos);
    }
    return count;
  }
}
