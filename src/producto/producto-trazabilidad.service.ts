import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

    const [
      stocks,
      compras,
      lotes,
      ventas,
      fabricaciones,
      usadoEnRecetas,
      tieneReceta,
    ] = await Promise.all([
      this._stockPorSede(productoId, scopeVarianteIds, varianteId),
      this._compras(empresaId, orProductoOVariante),
      this._lotes(empresaId, productoId, scopeVarianteIds, varianteId),
      this._ventas(empresaId, orProductoOVariante),
      this._fabricaciones(productoId, varianteId),
      producto.esInsumo
        ? this._usadoComoInsumo(empresaId, productoId, scopeVarianteIds, varianteId)
        : Promise.resolve([]),
      this.prisma.productoComponente.count({ where: { productoId } }),
    ]);

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
      compras,
      lotes,
      ventas,
      fabricacion: {
        // Si el producto se fabrica: lotes PROD- producidos.
        lotesFabricados: fabricaciones,
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
  private async _fabricaciones(productoId: string, varianteId: string | null) {
    const stockWhere: any = varianteId
      ? { varianteId }
      : { productoId, varianteId: null };
    const stock = await this.prisma.productoStock.findMany({
      where: stockWhere,
      select: { id: true },
    });
    const stockIds = stock.map((s) => s.id);
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
}
