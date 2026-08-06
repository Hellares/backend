import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { round6 } from '../common/utils/money.util';

/**
 * Ficha 360 / Trazabilidad de un producto: consolida en una sola respuesta
 * de DÓNDE vino (compras, lotes, fabricación) y a DÓNDE fue (ventas, consumo
 * como insumo) un producto/variante, más su stock/costo por sede.
 *
 * Es 100% lectura/agregación (no escribe nada). Compone queries product-scoped
 * sobre los modelos existentes.
 */
@Injectable()
export class ProductoTrazabilidadService {
  constructor(private readonly prisma: PrismaService) {}

  private simboloUnidad(u: any): string | null {
    if (!u) return null;
    return (
      u.simboloLocal ??
      u.simboloPersonalizado ??
      u.unidadMaestra?.simbolo ??
      null
    );
  }

  async trazabilidad(
    empresaId: string,
    productoId: string,
    opts: { varianteId?: string } = {},
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: {
        id: true,
        nombre: true,
        codigoEmpresa: true,
        esInsumo: true,
        tieneVariantes: true,
        factorCompra: true,
        unidadMedida: {
          select: {
            simboloLocal: true,
            simboloPersonalizado: true,
            unidadMaestra: { select: { simbolo: true } },
          },
        },
        unidadCompra: {
          select: {
            simboloLocal: true,
            simboloPersonalizado: true,
            unidadMaestra: { select: { simbolo: true } },
          },
        },
        variantes: {
          where: { deletedAt: null },
          select: { id: true, nombre: true, sku: true },
        },
      },
    });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }

    const varianteId = opts.varianteId ?? null;
    const varianteIds = producto.variantes.map((v) => v.id);
    // Ids de variante a considerar: la pedida, o todas las del producto.
    const scopeVarianteIds = varianteId ? [varianteId] : varianteIds;

    // Filtro de "este producto o sus variantes" para detalles que guardan
    // productoId + varianteId (compra/venta detalle).
    const orProductoOVariante = varianteId
      ? [{ varianteId }]
      : [
          { productoId, varianteId: null },
          ...(varianteIds.length ? [{ varianteId: { in: varianteIds } }] : []),
        ];

    // Stock primero: necesitamos sus ids (y el mapa id→sede) para el kardex
    // consolidado y las fabricaciones.
    const stocks = await this._stockPorSede(
      productoId,
      scopeVarianteIds,
      varianteId,
    );
    const stockIds = stocks.map((s) => s.productoStockId);
    const sedePorStockId = new Map(
      stocks.map((s) => [s.productoStockId, s.sedeNombre]),
    );

    const [
      compras,
      lotes,
      ventas,
      fabricaciones,
      kardex,
      transferencias,
      devoluciones,
      proveedores,
      usadoEnRecetas,
      tieneReceta,
    ] = await Promise.all([
      this._compras(empresaId, orProductoOVariante),
      this._lotes(empresaId, productoId, scopeVarianteIds, varianteId),
      this._ventas(empresaId, orProductoOVariante),
      this._fabricaciones(stockIds),
      this._kardexConsolidado(stockIds, sedePorStockId),
      this._transferencias(empresaId, orProductoOVariante),
      this._devoluciones(empresaId, orProductoOVariante),
      this._proveedores(empresaId, orProductoOVariante),
      producto.esInsumo
        ? this._usadoComoInsumo(empresaId, productoId, scopeVarianteIds, varianteId)
        : Promise.resolve([]),
      this.prisma.productoComponente.count({ where: { productoId } }),
    ]);

    // Insumos consumidos: solo para productos fabricados. Agrupa los
    // PRODUCCION_SALIDA de los lotes PROD- de este producto por insumo.
    const insumosConsumidos =
      tieneReceta > 0 && fabricaciones.length
        ? await this._insumosConsumidos(
            fabricaciones.map((f) => f.numeroDocumento),
          )
        : [];

    const stockTotal = stocks.reduce((s, x) => s + x.stockActual, 0);
    const valorizado = +stocks
      .reduce((s, x) => s + x.stockActual * (x.precioCosto ?? 0), 0)
      .toFixed(2);

    return {
      producto: {
        id: producto.id,
        nombre: producto.nombre,
        codigoEmpresa: producto.codigoEmpresa,
        esInsumo: producto.esInsumo,
        tieneVariantes: producto.tieneVariantes,
        esFabricado: tieneReceta > 0,
        factorCompra:
          producto.factorCompra != null ? Number(producto.factorCompra) : null,
        unidadMedidaSimbolo: this.simboloUnidad(producto.unidadMedida),
        unidadCompraSimbolo: this.simboloUnidad(producto.unidadCompra),
      },
      varianteId,
      variantes: producto.variantes,
      stock: { porSede: stocks, stockTotal, valorizado },
      kardex,
      compras,
      proveedores,
      lotes,
      ventas,
      devoluciones,
      transferencias,
      fabricacion: {
        // Si el producto se fabrica: lotes PROD- producidos + insumos gastados.
        lotesFabricados: fabricaciones,
        insumosConsumidos,
        // Si el producto es insumo: en qué recetas se usa.
        usadoEnRecetas,
      },
    };
  }

  /** Stock por sede (producto base + variantes), con costo y valorización. */
  private async _stockPorSede(
    productoId: string,
    scopeVarianteIds: string[],
    varianteId: string | null,
  ) {
    const where: any = varianteId
      ? { varianteId }
      : {
          OR: [
            { productoId, varianteId: null },
            ...(scopeVarianteIds.length
              ? [{ varianteId: { in: scopeVarianteIds } }]
              : []),
          ],
        };
    const rows = await this.prisma.productoStock.findMany({
      where,
      select: {
        id: true,
        stockActual: true,
        precioCosto: true,
        varianteId: true,
        sede: { select: { id: true, nombre: true } },
        variante: { select: { id: true, nombre: true } },
      },
      orderBy: { sede: { nombre: 'asc' } },
    });
    return rows.map((r) => ({
      productoStockId: r.id,
      sedeId: r.sede?.id ?? null,
      sedeNombre: r.sede?.nombre ?? null,
      varianteId: r.varianteId,
      varianteNombre: r.variante?.nombre ?? null,
      stockActual: r.stockActual,
      precioCosto: r.precioCosto != null ? Number(r.precioCosto) : null,
    }));
  }

  /**
   * Historial LIGERO de compras de un producto/variante (para mostrar al comprar):
   * últimas compras CONFIRMADAS (fecha, proveedor, costo unitario) + agregado por
   * proveedor (veces, costo promedio, último costo, última fecha). Sin kardex ni
   * el 360 completo. Costo unitario efectivo = total/cantidad (incluye IGV).
   */
  async historialCompras(
    empresaId: string,
    productoId: string,
    opts: { varianteId?: string; limit?: number } = {},
  ) {
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { id: true, variantes: { where: { deletedAt: null }, select: { id: true } } },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');

    const varianteId = opts.varianteId ?? null;
    const varianteIds = producto.variantes.map((v) => v.id);
    const orProductoOVariante = varianteId
      ? [{ varianteId }]
      : [
          { productoId, varianteId: null },
          ...(varianteIds.length ? [{ varianteId: { in: varianteIds } }] : []),
        ];
    const limit = Math.min(opts.limit ?? 15, 50);

    const rows = await this.prisma.compraDetalle.findMany({
      where: { OR: orProductoOVariante, compra: { empresaId, estado: 'CONFIRMADA' } },
      orderBy: { compra: { fechaRecepcion: 'desc' } },
      select: {
        cantidad: true,
        precioUnitario: true,
        total: true,
        usaUnidadCompra: true,
        cantidadOriginal: true,
        unidadOriginalSimbolo: true,
        compra: {
          select: {
            id: true,
            codigo: true,
            fechaRecepcion: true,
            proveedorId: true,
            nombreProveedor: true,
            moneda: true,
          },
        },
      },
    });

    const costoUnit = (r: (typeof rows)[number]) =>
      r.cantidad > 0 ? Number(r.total) / r.cantidad : Number(r.precioUnitario);

    const compras = rows.slice(0, limit).map((r) => ({
      compraId: r.compra.id,
      codigo: r.compra.codigo,
      fecha: r.compra.fechaRecepcion,
      proveedorId: r.compra.proveedorId,
      proveedor: r.compra.nombreProveedor,
      moneda: r.compra.moneda,
      cantidad: r.cantidad,
      precioUnitario: Number(r.precioUnitario),
      total: Number(r.total),
      costoUnitario: round6(costoUnit(r)),
      usaUnidadCompra: r.usaUnidadCompra,
      cantidadOriginal: r.cantidadOriginal != null ? Number(r.cantidadOriginal) : null,
      unidadOriginalSimbolo: r.unidadOriginalSimbolo,
    }));

    // Agregado por proveedor (sobre TODAS las filas, no solo el slice).
    const map = new Map<string, any>();
    for (const r of rows) {
      const key = r.compra.proveedorId ?? r.compra.nombreProveedor;
      const cu = costoUnit(r);
      const e = map.get(key) ?? {
        proveedorId: r.compra.proveedorId,
        proveedor: r.compra.nombreProveedor,
        veces: 0,
        cantidadAcum: 0,
        sumaCostoXCant: 0,
        ultimaFecha: null as Date | null,
        ultimoCosto: null as number | null,
      };
      e.veces++;
      e.cantidadAcum += r.cantidad;
      e.sumaCostoXCant += cu * r.cantidad;
      if (!e.ultimaFecha || r.compra.fechaRecepcion > e.ultimaFecha) {
        e.ultimaFecha = r.compra.fechaRecepcion;
        e.ultimoCosto = round6(cu);
      }
      map.set(key, e);
    }
    const proveedores = Array.from(map.values())
      .map((e) => ({
        proveedorId: e.proveedorId,
        proveedor: e.proveedor,
        veces: e.veces,
        cantidadAcum: e.cantidadAcum,
        costoPromedio: e.cantidadAcum > 0 ? round6(e.sumaCostoXCant / e.cantidadAcum) : 0,
        ultimoCosto: e.ultimoCosto,
        ultimaFecha: e.ultimaFecha,
      }))
      .sort((a, b) => (b.ultimaFecha?.getTime() ?? 0) - (a.ultimaFecha?.getTime() ?? 0));

    // Mejor proveedor = menor costo promedio (al menos 1 compra).
    const mejorProveedor = proveedores.length
      ? [...proveedores].sort((a, b) => a.costoPromedio - b.costoPromedio)[0]
      : null;

    return {
      compras,
      proveedores,
      ultimoCosto: compras.length ? compras[0].costoUnitario : null,
      mejorProveedorId: mejorProveedor?.proveedorId ?? null,
    };
  }

  /** Últimas compras donde entró el producto/variante. */
  private async _compras(empresaId: string, orProductoOVariante: any[]) {
    const rows = await this.prisma.compraDetalle.findMany({
      where: {
        OR: orProductoOVariante,
        compra: { empresaId },
      },
      take: 20,
      orderBy: { compra: { fechaRecepcion: 'desc' } },
      select: {
        cantidad: true,
        precioUnitario: true,
        total: true,
        varianteId: true,
        compra: {
          select: {
            id: true,
            codigo: true,
            fechaRecepcion: true,
            nombreProveedor: true,
            estado: true,
            moneda: true,
          },
        },
        variante: { select: { nombre: true } },
      },
    });
    return rows.map((r) => ({
      compraId: r.compra.id,
      compraCodigo: r.compra.codigo,
      fecha: r.compra.fechaRecepcion,
      proveedor: r.compra.nombreProveedor,
      estado: r.compra.estado,
      moneda: r.compra.moneda,
      varianteNombre: r.variante?.nombre ?? null,
      cantidad: r.cantidad,
      precioUnitario: Number(r.precioUnitario),
      total: Number(r.total),
    }));
  }

  /** Lotes (recibidos por compra o fabricados) del producto/variante. */
  private async _lotes(
    empresaId: string,
    productoId: string,
    scopeVarianteIds: string[],
    varianteId: string | null,
  ) {
    const where: any = varianteId
      ? { empresaId, varianteId }
      : {
          empresaId,
          OR: [
            { productoId },
            ...(scopeVarianteIds.length
              ? [{ varianteId: { in: scopeVarianteIds } }]
              : []),
          ],
        };
    const rows = await this.prisma.lote.findMany({
      where,
      take: 30,
      orderBy: { fechaIngreso: 'desc' },
      select: {
        id: true,
        codigo: true,
        precioCosto: true,
        cantidadInicial: true,
        cantidadActual: true,
        fechaIngreso: true,
        fechaVencimiento: true,
        estado: true,
        nombreProveedor: true,
        compraId: true,
        variante: { select: { nombre: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      precioCosto: Number(r.precioCosto),
      cantidadInicial: r.cantidadInicial,
      cantidadActual: r.cantidadActual,
      fechaIngreso: r.fechaIngreso,
      fechaVencimiento: r.fechaVencimiento,
      estado: r.estado,
      proveedor: r.nombreProveedor,
      compraId: r.compraId,
      varianteNombre: r.variante?.nombre ?? null,
    }));
  }

  /** Últimas ventas donde salió el producto/variante. */
  private async _ventas(empresaId: string, orProductoOVariante: any[]) {
    const rows = await this.prisma.ventaDetalle.findMany({
      where: {
        OR: orProductoOVariante,
        venta: { empresaId },
      },
      take: 20,
      orderBy: { venta: { fechaVenta: 'desc' } },
      select: {
        cantidad: true,
        precioUnitario: true,
        total: true,
        varianteId: true,
        venta: {
          select: {
            id: true,
            codigo: true,
            fechaVenta: true,
            nombreCliente: true,
            estado: true,
            moneda: true,
          },
        },
        variante: { select: { nombre: true } },
      },
    });
    return rows.map((r) => ({
      ventaId: r.venta.id,
      ventaCodigo: r.venta.codigo,
      fecha: r.venta.fechaVenta,
      cliente: r.venta.nombreCliente,
      estado: r.venta.estado,
      moneda: r.venta.moneda,
      varianteNombre: r.variante?.nombre ?? null,
      cantidad: Number(r.cantidad),
      precioUnitario: Number(r.precioUnitario),
      total: Number(r.total),
    }));
  }

  /** Lotes fabricados (PRODUCCION_ENTRADA) de este producto/variante. */
  private async _fabricaciones(stockIds: string[]) {
    if (stockIds.length === 0) return [];
    const movs = await this.prisma.movimientoStock.findMany({
      where: {
        productoStockId: { in: stockIds },
        tipo: 'PRODUCCION_ENTRADA',
      },
      take: 20,
      orderBy: { creadoEn: 'desc' },
      select: {
        numeroDocumento: true,
        cantidad: true,
        precioCostoUnitario: true,
        costoManoObra: true,
        creadoEn: true,
      },
    });
    return movs.map((m) => ({
      numeroDocumento: m.numeroDocumento,
      cantidad: m.cantidad,
      precioCostoUnitario:
        m.precioCostoUnitario != null ? Number(m.precioCostoUnitario) : null,
      costoManoObra: m.costoManoObra != null ? Number(m.costoManoObra) : null,
      fecha: m.creadoEn,
    }));
  }

  /** Recetas donde este insumo (o su variante) se usa como componente. */
  private async _usadoComoInsumo(
    empresaId: string,
    productoId: string,
    scopeVarianteIds: string[],
    varianteId: string | null,
  ) {
    const where: any = varianteId
      ? { componenteVarianteId: varianteId }
      : {
          OR: [
            { componenteId: productoId, componenteVarianteId: null },
            ...(scopeVarianteIds.length
              ? [{ componenteVarianteId: { in: scopeVarianteIds } }]
              : []),
          ],
        };
    const rows = await this.prisma.productoComponente.findMany({
      where: { ...where, producto: { empresaId } },
      select: {
        cantidad: true,
        producto: { select: { id: true, nombre: true } },
        variante: { select: { nombre: true } },
        componenteVariante: { select: { nombre: true } },
      },
    });
    return rows.map((r) => ({
      productoFinalId: r.producto.id,
      productoFinalNombre: r.producto.nombre,
      varianteFinalNombre: r.variante?.nombre ?? null,
      componenteVarianteNombre: r.componenteVariante?.nombre ?? null,
      cantidadPorUnidad: Number(r.cantidad),
    }));
  }

  /** Kardex consolidado: movimientos de TODAS las sedes del producto. */
  private async _kardexConsolidado(
    stockIds: string[],
    sedePorStockId: Map<string, string | null>,
  ) {
    if (stockIds.length === 0) return [];
    const movs = await this.prisma.movimientoStock.findMany({
      where: { productoStockId: { in: stockIds } },
      take: 50,
      orderBy: { creadoEn: 'desc' },
      select: {
        tipo: true,
        tipoDocumento: true,
        numeroDocumento: true,
        cantidad: true,
        precioCostoUnitario: true,
        creadoEn: true,
        productoStockId: true,
      },
    });
    return movs.map((m) => ({
      tipo: m.tipo,
      tipoDocumento: m.tipoDocumento,
      numeroDocumento: m.numeroDocumento,
      cantidad: m.cantidad,
      precioCostoUnitario:
        m.precioCostoUnitario != null ? Number(m.precioCostoUnitario) : null,
      fecha: m.creadoEn,
      sedeNombre: sedePorStockId.get(m.productoStockId) ?? null,
    }));
  }

  /** Transferencias entre sedes donde participó el producto/variante. */
  private async _transferencias(empresaId: string, orProductoOVariante: any[]) {
    const rows = await this.prisma.transferenciaStockItem.findMany({
      where: {
        OR: orProductoOVariante,
        transferencia: { empresaId },
      },
      take: 20,
      orderBy: { transferencia: { fechaSolicitud: 'desc' } },
      select: {
        cantidadSolicitada: true,
        cantidadEnviada: true,
        cantidadRecibida: true,
        estado: true,
        varianteId: true,
        transferencia: {
          select: {
            id: true,
            codigo: true,
            estado: true,
            fechaSolicitud: true,
            sedeOrigen: { select: { nombre: true } },
            sedeDestino: { select: { nombre: true } },
          },
        },
        variante: { select: { nombre: true } },
      },
    });
    return rows.map((r) => ({
      transferenciaId: r.transferencia.id,
      codigo: r.transferencia.codigo,
      origen: r.transferencia.sedeOrigen?.nombre ?? null,
      destino: r.transferencia.sedeDestino?.nombre ?? null,
      estado: r.transferencia.estado,
      estadoItem: r.estado,
      fecha: r.transferencia.fechaSolicitud,
      cantidadSolicitada: r.cantidadSolicitada,
      cantidadEnviada: r.cantidadEnviada,
      cantidadRecibida: r.cantidadRecibida,
      varianteNombre: r.variante?.nombre ?? null,
    }));
  }

  /** Devoluciones donde se devolvió el producto/variante. */
  private async _devoluciones(empresaId: string, orProductoOVariante: any[]) {
    const rows = await this.prisma.devolucionItem.findMany({
      where: {
        OR: orProductoOVariante,
        devolucion: { empresaId },
      },
      take: 20,
      orderBy: { devolucion: { creadoEn: 'desc' } },
      select: {
        cantidad: true,
        motivo: true,
        varianteId: true,
        devolucion: {
          select: {
            id: true,
            codigo: true,
            estado: true,
            creadoEn: true,
            ventaId: true,
            venta: { select: { codigo: true } },
          },
        },
        variante: { select: { nombre: true } },
      },
    });
    return rows.map((r) => ({
      devolucionId: r.devolucion.id,
      codigo: r.devolucion.codigo,
      estado: r.devolucion.estado,
      fecha: r.devolucion.creadoEn,
      ventaCodigo: r.devolucion.venta?.codigo ?? null,
      cantidad: r.cantidad,
      motivo: r.motivo,
      varianteNombre: r.variante?.nombre ?? null,
    }));
  }

  /** Proveedores que han surtido el producto, con stats agregadas. */
  private async _proveedores(empresaId: string, orProductoOVariante: any[]) {
    const detalles = await this.prisma.compraDetalle.findMany({
      where: { OR: orProductoOVariante, compra: { empresaId } },
      select: {
        cantidad: true,
        precioUnitario: true,
        compra: {
          select: {
            proveedorId: true,
            nombreProveedor: true,
            fechaRecepcion: true,
          },
        },
      },
    });
    const map = new Map<
      string,
      {
        proveedor: string;
        veces: number;
        cantidadAcum: number;
        sumaPrecioXCant: number;
        ultimaCompra: Date | null;
      }
    >();
    for (const d of detalles) {
      const key = d.compra.proveedorId ?? d.compra.nombreProveedor;
      const acc =
        map.get(key) ?? {
          proveedor: d.compra.nombreProveedor,
          veces: 0,
          cantidadAcum: 0,
          sumaPrecioXCant: 0,
          ultimaCompra: null,
        };
      acc.veces += 1;
      acc.cantidadAcum += d.cantidad;
      acc.sumaPrecioXCant += Number(d.precioUnitario) * d.cantidad;
      if (
        !acc.ultimaCompra ||
        d.compra.fechaRecepcion > acc.ultimaCompra
      ) {
        acc.ultimaCompra = d.compra.fechaRecepcion;
      }
      map.set(key, acc);
    }
    return Array.from(map.values())
      .map((v) => ({
        proveedor: v.proveedor,
        veces: v.veces,
        cantidadAcum: v.cantidadAcum,
        precioPromedio:
          v.cantidadAcum > 0
            ? round6(v.sumaPrecioXCant / v.cantidadAcum)
            : 0,
        ultimaCompra: v.ultimaCompra,
      }))
      .sort((a, b) => b.cantidadAcum - a.cantidadAcum);
  }

  /** Insumos consumidos en las fabricaciones (PROD-) de este producto. */
  private async _insumosConsumidos(numerosDocumento: string[]) {
    const docs = numerosDocumento.filter((d): d is string => !!d);
    if (docs.length === 0) return [];
    const movs = await this.prisma.movimientoStock.findMany({
      where: {
        numeroDocumento: { in: docs },
        tipo: 'PRODUCCION_SALIDA',
      },
      select: {
        cantidad: true,
        precioCostoUnitario: true,
        valorMovimiento: true,
        productoStock: {
          select: {
            producto: { select: { nombre: true } },
            variante: { select: { nombre: true } },
          },
        },
      },
    });
    const map = new Map<
      string,
      { insumo: string; cantidad: number; costo: number }
    >();
    for (const m of movs) {
      const ps = m.productoStock;
      const insumo =
        ps?.variante?.nombre ?? ps?.producto?.nombre ?? 'Insumo';
      const acc = map.get(insumo) ?? { insumo, cantidad: 0, costo: 0 };
      acc.cantidad += Math.abs(m.cantidad);
      acc.costo +=
        m.valorMovimiento != null
          ? Number(m.valorMovimiento)
          : Math.abs(m.cantidad) *
            (m.precioCostoUnitario != null
              ? Number(m.precioCostoUnitario)
              : 0);
      map.set(insumo, acc);
    }
    return Array.from(map.values())
      .map((v) => ({ ...v, costo: +v.costo.toFixed(2) }))
      .sort((a, b) => b.costo - a.costo);
  }
}
