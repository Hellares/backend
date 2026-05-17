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
import { PrecioNivelService } from '../producto/precio-nivel.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { PrismaService } from '../prisma/prisma.service';
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
  Rol,
} from '@prisma/client';
import { FacturacionService } from '../sunat/facturacion.service';
import { validarDocumentoParaComprobante } from '../common/utils/documento-peru.util';

/**
 * DTO interno enriquecido por `aplicarPreciosBackendNivel` con el snapshot
 * de costo y motivo de liquidación. Persiste a VentaDetalle como
 * precioCostoSnapshot/margenSnapshot/motivoLiquidacionSnapshot.
 */
type DetalleConSnapshot = CreateVentaDetalleDto & {
  precioCostoSnapshot: number;
  motivoLiquidacionSnapshot: MotivoLiquidacion | null;
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
    private readonly precioNivelService: PrecioNivelService,
    private readonly realtimeInvalidation: RealtimeInvalidationService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(VentaService.name);
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
        result.push({ ...d, precioCostoSnapshot: 0, motivoLiquidacionSnapshot: null });
        continue;
      }
      try {
        const calc = await this.precioNivelService.calcularPrecioSegunCantidad(
          productoIdParaNivel,
          d.varianteId ?? null,
          sedeId,
          d.cantidad,
        );
        if (
          d.precioUnitario != null &&
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
        result.push({ ...d, precioCostoSnapshot: 0, motivoLiquidacionSnapshot: null });
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
        select: { id: true, nombre: true, isActive: true, deletedAt: true },
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
          gravada: true, exonerada: true, inafecta: true, igv: true, icbper: true, total: true,
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

  async create(empresaId: string, dto: CreateVentaDto, cajeroId?: string) {
    this.logger.info('Creando venta', { empresaId, sede: dto.sedeId });

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
          ? Math.round((dto.montoRecibido - total) * 100) / 100
          : null;

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
          emailCliente: dto.emailCliente,
          telefonoCliente: dto.telefonoCliente,
          direccionCliente: dto.direccionCliente,
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
        );
        const detallesCalculados = detallesEnforced.map((d, index) =>
          this.calcularDetalle(d, index),
        );

        // 2b. Guard: validar venta bajo costo (margen negativo).
        const perdidaTotal = await this.validarVentaBajoCosto(
          empresaId,
          detallesCalculados,
          dto.ventaBajoCostoAutorizadaPorId ?? null,
        );

        // 2c. Validar descuentos máximos por producto
        const detallesConDescuento = detallesCalculados.filter(d => d.descuento > 0 && d.productoId);
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
        const descuentoGlobal = Math.round((dto.descuentoGlobal || 0) * 100) / 100;
        const descuentoVenta = descuentoItems + descuentoGlobal;
        const totalVenta = Math.round((totalSinDescuentoGlobal - descuentoGlobal) * 100) / 100;

        const esCredito = dto.esCredito ?? false;

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
        const estaPagada = !esCredito && montoRecibido >= totalVenta;
        const montoCredito = esCredito
          ? Math.round((totalVenta - montoPagadoInmediato) * 100) / 100
          : 0;

        const montoCambio =
          montoRecibido > totalVenta
            ? Math.round((montoRecibido - totalVenta) * 100) / 100
            : 0;

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
            emailCliente: dto.emailCliente,
            telefonoCliente: dto.telefonoCliente,
            direccionCliente: dto.direccionCliente,
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
              })),
            },
          },
          include: this.getInclude(),
        });

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
                stockDanado: number;
                stockEnGarantia: number;
              }>
            >(
              `SELECT id, "stockActual", "stockReservado", "stockReservadoVenta",
                      "stockReservadoCombo", "stockDanado", "stockEnGarantia"
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

            // 4d. Aplicar updates + movimientos en batch.
            const movimientosData: Array<any> = [];
            for (const u of pendingUpdates) {
              await tx.productoStock.update({
                where: { id: u.productoStockId },
                data: { stockActual: u.nuevoStock },
              });
              movimientosData.push({
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
              });
            }

            if (movimientosData.length > 0) {
              await tx.movimientoStock.createMany({ data: movimientosData });
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
          // Tomar cualquier item para calcular cuántos combos representa.
          const primerItem = items[0];
          const compMatch = componentes.find(c =>
            (c.componenteProductoId && c.componenteProductoId === primerItem.productoId) ||
            (c.componenteVarianteId && c.componenteVarianteId === primerItem.varianteId),
          );
          if (!compMatch || compMatch.cantidad <= 0) continue;
          const cantidadCombos = Number(primerItem.cantidad) / compMatch.cantidad;
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
              monto: Math.min(montoRecibido, totalVenta),
            },
          });
        }

        // 5b. Generar cuotas si es venta a crédito con cuotas
        if (esCredito && dto.numeroCuotas && dto.numeroCuotas > 0 && montoCredito > 0) {
          const porcentajeInteres = dto.porcentajeInteres ?? 0;
          const cuotasData = this.generarCuotas(
            venta.id,
            montoCredito,
            dto.numeroCuotas,
            dto.plazoCredito ?? 30,
            porcentajeInteres,
          );
          await tx.cuotaVenta.createMany({ data: cuotasData });

          // Store interest snapshot on venta
          if (porcentajeInteres > 0) {
            const montoInteresTotal = Math.round(montoCredito * (porcentajeInteres / 100) * 100) / 100;
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
        const tipoComprobante = dto.tipoComprobante || 'TICKET';

        if (tipoComprobante !== 'TICKET') {
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
            : [{
                comprobanteId: comprobante.id,
                metodoPago: dto.metodoPago || 'EFECTIVO',
                monto: new Prisma.Decimal(
                  (esCredito ? 0 : Math.min(montoRecibido || totalVenta, totalVenta)).toFixed(2),
                ),
                estado: esCredito ? 'PENDIENTE' : 'COMPLETADO',
              }];

          await tx.pagoComprobante.createMany({ data: pagosComprobanteData });

          this.logger.log(`Comprobante ${codigoGenerado} generado para venta POS ${venta.codigo}`);
          comprobanteIdGenerado = comprobante.id;
        }
        } // fin if tipoComprobante !== 'TICKET'

        // 7. Registrar movimientos en caja — UNO POR PAGO REAL (multi-medio).
        // Cada PagoVenta no-CREDITO genera su propio MovimientoCaja con su método.
        // Así el cierre Z agrupa correctamente sin necesidad de tocar el groupBy.
        if (montoPagadoInmediato > 0) {
          const pagosParaCaja = (dto.pagos && dto.pagos.length > 0)
            ? dto.pagos
                .filter((p) => p.metodoPago !== 'CREDITO')
                .map((p) => ({ metodoPago: p.metodoPago, monto: p.monto }))
            : [{
                metodoPago: dto.metodoPago || 'EFECTIVO',
                monto: Math.min(montoPagadoInmediato, totalVenta),
              }];

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
                  descripcion: `Venta POS ${codigoVenta}`,
                  ventaId: venta.id,
                },
                tx,
              );
            } catch (e: any) {
              this.logger.warn(`Error registrando movimiento caja (${p.metodoPago}) venta POS ${codigoVenta}: ${e?.message ?? e}`);
            }
          }
        }

        this.logger.log(`Venta POS creada y cobrada: ${venta.codigo}`);
        return { venta, comprobanteIdGenerado };
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

    return result.venta;
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

    // Cotización = atención presencial → requiere caja abierta del cajero
    if (cajeroId) {
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

      // 3. Generar código de venta
      const { codigoVenta } =
        await this.configuracionCodigos.generarCodigoVenta(
          empresaId,
          cotizacion.sedeId,
          tx,
        );

      // 3b. Filtrar detalles excluidos y ajustar cantidades
      const excluirIds = new Set(dto.excluirDetalleIds ?? []);
      const ajustes = dto.ajustarCantidades ?? {};
      const hayModificaciones = excluirIds.size > 0 || Object.keys(ajustes).length > 0;

      // Filtrar excluidos y aplicar ajustes de cantidad
      const detallesVenta = cotizacion.detalles
        .filter((d) => !excluirIds.has(d.id))
        .map((d) => {
          if (ajustes[d.id] !== undefined) {
            const nuevaCantidad = ajustes[d.id];
            const precioUnit = Number(d.precioUnitario);
            const descUnit = Number(d.descuento) / Number(d.cantidad);
            const nuevoDescuento = descUnit * nuevaCantidad;
            const nuevoSubtotal = (precioUnit * nuevaCantidad) - nuevoDescuento;
            const porcentajeIGV = Number(d.porcentajeIGV) / 100;
            const nuevoIgv = Math.round(nuevoSubtotal * porcentajeIGV * 100) / 100;
            const nuevoTotal = nuevoSubtotal + nuevoIgv;
            return {
              ...d,
              cantidad: new Prisma.Decimal(nuevaCantidad),
              descuento: new Prisma.Decimal(nuevoDescuento.toFixed(2)),
              subtotal: new Prisma.Decimal(nuevoSubtotal.toFixed(2)),
              igv: new Prisma.Decimal(nuevoIgv.toFixed(2)),
              total: new Prisma.Decimal(nuevoTotal.toFixed(2)),
            };
          }
          return d;
        });

      if (detallesVenta.length === 0) {
        throw new BadRequestException(
          'No quedan items para crear la venta',
        );
      }

      // Recalcular totales si hubo modificaciones
      let subtotalVenta: number;
      let descuentoVenta: number;
      let impuestosVenta: number;
      let totalVenta: number;

      // 3c. Procesar items adicionales agregados por el cajero
      const itemsAdicionales = (dto.itemsAdicionales ?? []).map((item) => {
        const cantidad = item.cantidad;
        const precioUnitario = item.precioUnitario;
        const descuento = item.descuento ?? 0;
        const porcentajeIGV = item.porcentajeIGV ?? 18;
        const tipoAfectacion = item.tipoAfectacion || (porcentajeIGV > 0 ? '10' : '10');
        const icbperMonto = item.icbper ?? 0;
        const subtotal = (cantidad * precioUnitario) - descuento;
        const igv = Math.round(subtotal * (porcentajeIGV / 100) * 100) / 100;
        const total = subtotal + igv + icbperMonto;
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
          icbper: new Prisma.Decimal(Math.round(icbperMonto * 100) / 100),
          subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
          total: new Prisma.Decimal(total.toFixed(2)),
          orden: 0,
          // Guardar valores numéricos para stock
          _cantidad: cantidad,
          _subtotal: subtotal,
          _descuento: descuento,
          _igv: igv,
          _total: total,
        };
      });

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

      const montoCambio =
        dto.montoRecibido && dto.montoRecibido > totalVenta
          ? Math.round((dto.montoRecibido - totalVenta) * 100) / 100
          : null;

      // Determinar estado de la venta
      const esCredito = dto.esCredito ?? false;
      const estaPagada = !esCredito && dto.montoRecibido && dto.montoRecibido >= totalVenta;

      // 4. Crear venta con datos de la cotización
      const venta = await tx.venta.create({
        data: {
          empresaId,
          sedeId: cotizacion.sedeId,
          clienteId: cotizacion.clienteId,
          clienteEmpresaId: cotizacion.clienteEmpresaId,
          vendedorId: cotizacion.vendedorId,
          cajeroId: cajeroId || null,
          canalVenta: 'COTIZACION',
          cotizacionId: cotizacion.id,
          codigo: codigoVenta,
          nombreCliente: cotizacion.nombreCliente,
          documentoCliente: cotizacion.documentoCliente,
          emailCliente: cotizacion.emailCliente,
          telefonoCliente: cotizacion.telefonoCliente,
          direccionCliente: cotizacion.direccionCliente,
          moneda: cotizacion.moneda,
          tipoCambio: cotizacion.tipoCambio,
          subtotal: new Prisma.Decimal(subtotalVenta.toFixed(2)),
          descuento: new Prisma.Decimal(descuentoVenta.toFixed(2)),
          impuestos: new Prisma.Decimal(impuestosVenta.toFixed(2)),
          total: new Prisma.Decimal(totalVenta.toFixed(2)),
          metodoPago: this.resolverMetodoPagoVenta(dto.pagos, dto.metodoPago),
          montoRecibido: dto.montoRecibido,
          montoCambio,
          esCredito,
          plazoCredito: dto.plazoCredito,
          fechaVencimientoPago: dto.fechaVencimientoPago
            ? new Date(dto.fechaVencimientoPago)
            : null,
          observaciones: dto.observaciones ?? cotizacion.observaciones,
          // Venta POS: CONFIRMADA (con stock descontado) o PAGADA_COMPLETA
          estado: estaPagada ? EstadoVenta.PAGADA_COMPLETA : EstadoVenta.CONFIRMADA,
          detalles: {
            create: [
              ...detallesVenta.map((d) => ({
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
            stockDanado: number;
            stockEnGarantia: number;
          }>
        >`SELECT id, "stockActual", "stockReservado", "stockReservadoVenta",
                "stockReservadoCombo", "stockDanado", "stockEnGarantia"
         FROM "ProductoStock" WHERE id = ${productoStock.id} FOR UPDATE`;

        if (!stockLocked) continue;

        const cantidad = Number(detalle.cantidad);
        const stockAnterior = stockLocked.stockActual;
        const stockDisponible =
          stockAnterior -
          stockLocked.stockReservado -
          stockLocked.stockReservadoVenta -
          stockLocked.stockReservadoCombo -
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

        await tx.movimientoStock.create({
          data: {
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
          },
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
        const primerItem = items[0];
        const compMatch = componentes.find(c =>
          (c.componenteProductoId && c.componenteProductoId === primerItem.productoId) ||
          (c.componenteVarianteId && c.componenteVarianteId === primerItem.varianteId),
        );
        if (!compMatch || compMatch.cantidad <= 0) continue;
        const cantidadCombos = Number(primerItem.cantidad) / compMatch.cantidad;
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
            monto: Math.min(dto.montoRecibido, totalVenta),
          },
        });
      }

      // 7. Crear comprobante electrónico (solo BOLETA o FACTURA, no TICKET)
      let comprobanteIdGenerado: string | null = null;
      const tipoComprobante = dto.tipoComprobante || 'BOLETA';
      const esComprobanteElectronico = tipoComprobante === 'BOLETA' || tipoComprobante === 'FACTURA';

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
            clienteId: cotizacion.clienteId,
            clienteEmpresaId: cotizacion.clienteEmpresaId,
            tipoComprobante: tipoComprobante as any,
            serie,
            correlativo: correlativo.padStart(8, '0'),
            codigoGenerado,
            tipoDocumento: dto.tipoDocumentoCliente || (tipoComprobante === 'FACTURA' ? '6' : '1'),
            numeroDocumento: cotizacion.documentoCliente,
            nombreCliente: cotizacion.nombreCliente || 'CLIENTE VARIOS',
            direccionCliente: cotizacion.direccionCliente,
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
        const montoPagoLegacy = esCredito
          ? 0
          : Math.min(dto.montoRecibido || totalVenta, totalVenta);

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
          : [{
              comprobanteId: comprobante.id,
              metodoPago: dto.metodoPago || 'EFECTIVO',
              monto: new Prisma.Decimal(montoPagoLegacy.toFixed(2)),
              estado: esCredito ? 'PENDIENTE' : 'COMPLETADO',
            }];

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
          ? dto.pagos
              .filter((p) => p.metodoPago !== 'CREDITO')
              .map((p) => ({ metodoPago: p.metodoPago, monto: p.monto }))
          : [{
              metodoPago: dto.metodoPago || 'EFECTIVO',
              monto: Math.min(montoPagadoInmediato, totalVenta),
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

    return this.prisma.venta.findMany({
      where,
      include: this.getListInclude(),
      orderBy: { creadoEn: 'desc' },
    });
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

    return venta;
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

        // Crear MovimientoStock
        await tx.movimientoStock.create({
          data: {
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
          },
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
  async procesarPago(
    id: string,
    empresaId: string,
    dto: ProcesarPagoDto,
    usuarioId?: string,
  ) {
    this.logger.info('Procesando pago', { id, empresaId });

    return this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id, empresaId },
        include: { pagos: true },
      });

      // Verificar caja según canal de la venta original (POS/COTIZACION requieren caja)
      if (usuarioId && venta && venta.canalVenta !== 'ONLINE') {
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

      // Crear pago
      const pago = await tx.pagoVenta.create({
        data: {
          ventaId: id,
          metodoPago: dto.metodoPago,
          monto: dto.monto,
          referencia: dto.referencia,
        },
      });

      // Asignar pago a cuotas (auto-cascada)
      const ventaCuotas = await tx.cuotaVenta.findMany({
        where: { ventaId: id, estado: { in: ['PENDIENTE', 'PAGADA_PARCIAL', 'VENCIDA'] } },
        orderBy: { numero: 'asc' },
      });

      // Track total breakdown
      let totalMoraAplicada = 0;
      let totalInteresAplicado = 0;
      let totalPrincipalAplicado = 0;

      if (ventaCuotas.length > 0) {
        let remaining = dto.monto;
        for (const cuota of ventaCuotas) {
          if (remaining <= 0) break;

          const mora = Number(cuota.montoMora ?? 0);
          const saldoInteres = Math.round((Number(cuota.montoInteres ?? 0) - Number(cuota.montoPagadoInteres ?? 0)) * 100) / 100;
          const saldoPrincipal = Math.round((Number(cuota.montoPrincipal ?? 0) - Number(cuota.montoPagadoPrincipal ?? 0)) * 100) / 100;
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
          const nuevoSaldo = Math.round((Number(cuota.monto) - nuevoMontoPagado) * 100) / 100;
          const nuevaMora = Math.round((mora - moraAplicada) * 100) / 100;
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

          remaining = Math.round((remaining - aplicar) * 100) / 100;
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
          ? Math.round((totalPagado - targetTotal) * 100) / 100
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
              monto: dto.monto,
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
  }

  /**
   * Anular venta → reversar stock
   */
  async anular(id: string, empresaId: string, usuarioId: string, dto?: { autorizadoPorId: string; motivo: string }) {
    this.logger.info('Anulando venta', { id, empresaId });

    const result = await this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id, empresaId },
        include: {
          detalles: true,
          // Necesario para reversar caja: 1 EGRESO por cada PagoVenta original.
          pagos: { select: { metodoPago: true, monto: true } },
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

        await tx.movimientoStock.create({
          data: {
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
          },
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

      // Registrar EGRESOS espejo en caja: uno por cada PagoVenta cobrado.
      // Multi-medio: la devolución reversa cada método con su monto exacto.
      const pagosACobrar = (venta.pagos ?? []).filter(
        (p) => p.metodoPago !== 'CREDITO',
      );
      const montoRecibido = Number(venta.montoRecibido ?? 0);

      const reversos = pagosACobrar.length > 0
        ? pagosACobrar.map((p) => ({
            metodoPago: p.metodoPago as string,
            monto: Number(p.monto),
          }))
        : (montoRecibido > 0
            ? [{
                metodoPago: (venta.metodoPago ?? 'EFECTIVO') as string,
                monto: montoRecibido,
              }]
            : []);

      for (const r of reversos) {
        try {
          await this.cajaService.registrarMovimientoSiHayCaja(
            empresaId,
            venta.sedeId,
            usuarioId,
            {
              tipo: 'EGRESO',
              categoria: 'DEVOLUCION',
              metodoPago: r.metodoPago as any,
              monto: r.monto,
              descripcion: `Anulación venta ${venta.codigo}`,
              ventaId: venta.id,
            },
            tx,
          );
        } catch (e: any) {
          this.logger.warn(`Error registrando egreso caja (${r.metodoPago}) por anulación ${venta.codigo}: ${e?.message ?? e}`);
        }
      }

      this.logger.log(`Venta anulada: ${venta.codigo}`);
      return updatedVenta;
    });

    // Invalidar cache de productos después de restaurar stock
    await this.invalidateProductCache(empresaId);

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
  ) {
    const montoInteresTotal = Math.round(montoCredito * (porcentajeInteres / 100) * 100) / 100;
    const totalConInteres = montoCredito + montoInteresTotal;

    const intervaloDias = Math.floor(plazoDias / numeroCuotas);
    const montoCuota = Math.floor((totalConInteres / numeroCuotas) * 100) / 100;
    const resto = Math.round((totalConInteres - montoCuota * numeroCuotas) * 100) / 100;

    // Distribute interest proportionally
    const interesPorCuota = numeroCuotas > 0 ? Math.floor((montoInteresTotal / numeroCuotas) * 100) / 100 : 0;
    const restoInteres = Math.round((montoInteresTotal - interesPorCuota * numeroCuotas) * 100) / 100;

    return Array.from({ length: numeroCuotas }, (_, i) => {
      const numero = i + 1;
      const esUltima = numero === numeroCuotas;
      const monto = esUltima ? montoCuota + resto : montoCuota;
      const interesEstaCuota = esUltima ? interesPorCuota + restoInteres : interesPorCuota;
      const principalEstaCuota = Math.round((monto - interesEstaCuota) * 100) / 100;

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
        estado: 'PENDIENTE' as const,
      };
    });
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
          perdidaTotal: Math.round(perdidaTotal * 100) / 100,
          lineas: requierenAutorizacion.map((d) => ({
            descripcion: d.descripcion,
            productoId: d.productoId,
            varianteId: d.varianteId,
            cantidad: d.cantidad,
            precioUnitario: d.precioUnitario,
            precioCosto: d.precioCostoSnapshot,
            margenUnitario: Math.round(d.margenSnapshot * 100) / 100,
            perdidaLinea: Math.round(d.margenSnapshot * d.cantidad * 100) / 100,
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

    return Math.round(perdidaTotal * 100) / 100;
  }

  private calcularDetalle(dto: CreateVentaDetalleDto | DetalleConSnapshot, index: number) {
    const cantidad = dto.cantidad;
    const precioUnitario = dto.precioUnitario;
    const descuento = dto.descuento ?? 0;
    const porcentajeIGV = dto.porcentajeIGV ?? 18;
    const incluyeIgv = dto.precioIncluyeIgv ?? false;

    const subtotalBruto = cantidad * precioUnitario;
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
    const descuentoUnitario = cantidad > 0 ? descuento / cantidad : 0;
    const ingresoNetoUnitario = precioUnitario - descuentoUnitario;
    const margenSnapshot = ingresoNetoUnitario - precioCostoSnapshot;

    return {
      productoId: dto.productoId || null,
      varianteId: dto.varianteId || null,
      servicioId: dto.servicioId || null,
      comboId: dto.comboId || null,
      descripcion: dto.descripcion,
      cantidad,
      precioUnitario,
      descuento,
      porcentajeIGV,
      tipoAfectacion,
      icbper: Math.round(icbperMonto * 100) / 100,
      igv: Math.round(igv * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round(totalConIcbper * 100) / 100,
      orden: index,
      origenComboId: dto.origenComboId || null,
      origenComboNombre: dto.origenComboNombre || null,
      // Snapshot de margen para reportería de liquidaciones / pérdidas.
      precioCostoSnapshot: Math.round(precioCostoSnapshot * 100) / 100,
      margenSnapshot: Math.round(margenSnapshot * 100) / 100,
      motivoLiquidacionSnapshot,
    };
  }

  /**
   * Generar comprobante electrónico (boleta/factura) para una venta tipo TICKET
   */
  async generarComprobante(ventaId: string, empresaId: string, dto: { tipoComprobante: 'BOLETA' | 'FACTURA'; tipoDocumentoCliente?: string }) {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      include: {
        ...this.getInclude(),
      },
    });

    if (!venta) throw new NotFoundException('Venta no encontrada');
    if (venta.comprobante) throw new BadRequestException('Esta venta ya tiene un comprobante electrónico generado');

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
          tipoDocumento: dto.tipoDocumentoCliente || (dto.tipoComprobante === 'FACTURA' ? '6' : '1'),
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
      gravada: Math.round(gravada * 100) / 100,
      exonerada: Math.round(exonerada * 100) / 100,
      inafecta: Math.round(inafecta * 100) / 100,
      igv: Math.round(igvTotal * 100) / 100,
      icbper: Math.round(icbperTotal * 100) / 100,
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
        fechaVenta: true,
        esCredito: true,
        cotizacionId: true,
        // Cotización origen
        cotizacion: {
          select: { id: true, codigo: true, estado: true, total: true, fechaEmision: true },
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
    for (const pago of venta.pagos || []) {
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

    nodos.push(ventaNodo);

    return {
      ventaId: venta.id,
      ventaCodigo: venta.codigo,
      totalDocumentos: this.contarNodos(nodos),
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
