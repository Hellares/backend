import { Injectable } from '@nestjs/common';
import { EstadoVenta, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { round2 } from '../../common/utils/money.util';
import { getTodayStart, getTomorrowStart, getWeekStart, getMonthStart, parseStartOfDay, parseEndOfDay } from '../../common/utils/date-utils';
import {
  VentaAnalyticsQueryDto,
  PeriodoAgrupacion,
} from './dto/venta-analytics.dto';

@Injectable()
export class VentaAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(VentaAnalyticsService.name);
  }

  // ==================== HELPERS ====================

  private buildDateFilter(query: VentaAnalyticsQueryDto): { gte?: Date; lte?: Date } | undefined {
    if (!query.fechaInicio && !query.fechaFin) return undefined;

    const filter: { gte?: Date; lte?: Date } = {};
    if (query.fechaInicio) filter.gte = parseStartOfDay(query.fechaInicio);
    if (query.fechaFin) filter.lte = parseEndOfDay(query.fechaFin);
    return filter;
  }

  private buildVentaWhere(
    empresaId: string,
    query: VentaAnalyticsQueryDto,
  ): Prisma.VentaWhereInput {
    const where: Prisma.VentaWhereInput = {
      empresaId,
      estado: {
        notIn: [EstadoVenta.BORRADOR, EstadoVenta.ANULADA],
      },
    };

    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.clienteId) where.clienteId = query.clienteId;
    if (query.canalVenta) where.canalVenta = query.canalVenta;
    if (query.conEnvio === 'true') where.conEnvio = true;
    if (query.conEnvio === 'false') where.conEnvio = false;

    const dateFilter = this.buildDateFilter(query);
    if (dateFilter) where.fechaVenta = dateFilter;

    return where;
  }

  private parseLimit(query: VentaAnalyticsQueryDto, fallback = 10): number {
    const parsed = query.limit ? parseInt(query.limit, 10) : NaN;
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(Math.max(parsed, 1), 100);
  }

  private nombreCategoria(
    cat: {
      nombreLocal: string | null;
      nombrePersonalizado: string | null;
      categoriaMaestra: { nombre: string } | null;
    } | null,
  ): string {
    if (!cat) return 'Sin categoria';
    return (
      cat.nombreLocal ??
      cat.nombrePersonalizado ??
      cat.categoriaMaestra?.nombre ??
      'Sin categoria'
    );
  }

  private nombreMarca(
    marca: {
      nombreLocal: string | null;
      nombrePersonalizado: string | null;
      marcaMaestra: { nombre: string } | null;
    } | null,
  ): string {
    if (!marca) return 'Sin marca';
    return (
      marca.nombreLocal ??
      marca.nombrePersonalizado ??
      marca.marcaMaestra?.nombre ??
      'Sin marca'
    );
  }

  private getPeriodoKey(fecha: Date, periodo?: PeriodoAgrupacion): string {
    // Convertir a hora Perú para agrupar correctamente
    const utc = new Date(fecha);
    const peruMs = utc.getTime() + (-5 * 60 * 60 * 1000) + (utc.getTimezoneOffset() * 60 * 1000);
    const d = new Date(peruMs);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');

    switch (periodo) {
      case PeriodoAgrupacion.DIARIO:
        return `${year}-${month}-${day}`;
      case PeriodoAgrupacion.SEMANAL: {
        const startOfYear = new Date(year, 0, 1);
        const diff = d.getTime() - startOfYear.getTime();
        const week = Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7);
        return `${year}-S${String(week).padStart(2, '0')}`;
      }
      case PeriodoAgrupacion.ANUAL:
        return `${year}`;
      case PeriodoAgrupacion.MENSUAL:
      default:
        return `${year}-${month}`;
    }
  }

  // ==================== METHODS ====================

  async getResumenGeneral(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo resumen general de ventas');

    const where = this.buildVentaWhere(empresaId, query);
    const whereBorrador: Prisma.VentaWhereInput = {
      empresaId,
      estado: EstadoVenta.BORRADOR,
      ...(query.sedeId ? { sedeId: query.sedeId } : {}),
    };
    const wherePagada: Prisma.VentaWhereInput = {
      ...where,
      estado: EstadoVenta.PAGADA_COMPLETA,
    };

    // Anuladas del mismo periodo/filtros — informativo: NO suman al monto
    // total (buildVentaWhere ya las excluye de todos los agregados).
    const whereAnulada: Prisma.VentaWhereInput = {
      ...where,
      estado: EstadoVenta.ANULADA,
    };

    // Devoluciones de cliente PROCESADAS en el periodo. El modelo no guarda
    // un monto directo (depende de la acción por item), así que el KPI es
    // cantidad de devoluciones + items devueltos.
    const dateFilter = this.buildDateFilter(query);
    const whereDevolucion: Prisma.DevolucionWhereInput = {
      empresaId,
      estado: 'PROCESADA',
      ventaId: { not: null },
      ...(query.sedeId ? { sedeId: query.sedeId } : {}),
      ...(dateFilter ? { procesadoEn: dateFilter } : {}),
    };

    const [
      aggregate,
      ventasBorrador,
      ventasPagadasCompleta,
      anuladas,
      devoluciones,
      itemsDevueltos,
      detallesMargen,
    ] = await Promise.all([
      this.prisma.venta.aggregate({
        where,
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.venta.count({ where: whereBorrador }),
      this.prisma.venta.count({ where: wherePagada }),
      this.prisma.venta.aggregate({
        where: whereAnulada,
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.devolucion.count({ where: whereDevolucion }),
      this.prisma.devolucionItem.aggregate({
        where: { devolucion: whereDevolucion },
        _sum: { cantidad: true },
      }),
      // Utilidad bruta: margenSnapshot es POR UNIDAD (precio - descuento -
      // costo al momento de la venta) → utilidad = Σ margen × cantidad.
      this.prisma.ventaDetalle.findMany({
        where: { venta: where },
        select: { margenSnapshot: true, cantidad: true },
      }),
    ]);

    const totalVentas = aggregate._count.id;
    const montoTotal = aggregate._sum.total?.toNumber() ?? 0;
    const promedioPorVenta = aggregate._avg.total?.toNumber() ?? 0;

    const utilidadBruta = detallesMargen.reduce(
      (sum, d) =>
        sum + (d.margenSnapshot?.toNumber() ?? 0) * d.cantidad.toNumber(),
      0,
    );

    return {
      totalVentas,
      montoTotal,
      promedioPorVenta,
      ventasBorrador,
      ventasPagadasCompleta,
      ticketPromedio: totalVentas > 0 ? montoTotal / totalVentas : 0,
      ventasAnuladas: anuladas._count.id,
      montoAnulado: round2(anuladas._sum.total?.toNumber() ?? 0),
      devoluciones,
      itemsDevueltos: itemsDevueltos._sum.cantidad ?? 0,
      utilidadBruta: round2(utilidadBruta),
      margenPorcentaje:
        montoTotal > 0 ? round2((utilidadBruta / montoTotal) * 100) : 0,
    };
  }

  async getVentasPorPeriodo(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo ventas por periodo');

    const where = this.buildVentaWhere(empresaId, query);

    const ventas = await this.prisma.venta.findMany({
      where,
      select: {
        fechaVenta: true,
        total: true,
      },
      orderBy: { fechaVenta: 'asc' },
    });

    const agrupado = new Map<string, { total: number; cantidad: number }>();

    for (const venta of ventas) {
      const key = this.getPeriodoKey(venta.fechaVenta, query.periodo);
      const existing = agrupado.get(key) || { total: 0, cantidad: 0 };
      existing.total += venta.total.toNumber();
      existing.cantidad += 1;
      agrupado.set(key, existing);
    }

    return Array.from(agrupado.entries()).map(([periodo, data]) => ({
      periodo,
      total: round2(data.total),
      cantidad: data.cantidad,
    }));
  }

  async getTopProductos(
    empresaId: string,
    query: VentaAnalyticsQueryDto,
    limit = 10,
  ) {
    this.logger.log('Obteniendo top productos vendidos');

    const where = this.buildVentaWhere(empresaId, query);

    const detalles = await this.prisma.ventaDetalle.findMany({
      where: {
        venta: where,
        productoId: { not: null },
        ...(query.productoId ? { productoId: query.productoId } : {}),
        ...(query.categoriaId
          ? { producto: { empresaCategoriaId: query.categoriaId } }
          : {}),
      },
      select: {
        productoId: true,
        varianteId: true,
        cantidad: true,
        total: true,
        precioUnitario: true,
        margenSnapshot: true,
        producto: {
          select: {
            nombre: true,
            codigoEmpresa: true,
            empresaCategoriaId: true,
            empresaCategoria: {
              select: {
                nombreLocal: true,
                nombrePersonalizado: true,
                categoriaMaestra: { select: { nombre: true } },
              },
            },
          },
        },
        variante: { select: { nombre: true } },
      },
    });

    const agrupado = new Map<
      string,
      {
        productoId: string;
        nombre: string;
        codigo: string;
        categoriaId: string | null;
        categoria: string;
        cantidadVendida: number;
        ingresoTotal: number;
        margenTotal: number;
        sumaPrecio: number;
        count: number;
        variantes: Map<
          string,
          {
            varianteId: string | null;
            nombre: string;
            cantidadVendida: number;
            ingresoTotal: number;
          }
        >;
      }
    >();

    for (const d of detalles) {
      if (!d.productoId) continue;
      const existing = agrupado.get(d.productoId) || {
        productoId: d.productoId,
        nombre: d.producto?.nombre ?? '',
        codigo: d.producto?.codigoEmpresa ?? '',
        categoriaId: d.producto?.empresaCategoriaId ?? null,
        categoria: this.nombreCategoria(d.producto?.empresaCategoria ?? null),
        cantidadVendida: 0,
        ingresoTotal: 0,
        margenTotal: 0,
        sumaPrecio: 0,
        count: 0,
        variantes: new Map(),
      };
      existing.cantidadVendida += d.cantidad.toNumber();
      existing.ingresoTotal += d.total.toNumber();
      existing.margenTotal +=
        (d.margenSnapshot?.toNumber() ?? 0) * d.cantidad.toNumber();
      existing.sumaPrecio += d.precioUnitario.toNumber();
      existing.count += 1;

      // Desglose por variante; los detalles sin variante van al bucket BASE
      const vKey = d.varianteId ?? 'BASE';
      const vExisting = existing.variantes.get(vKey) || {
        varianteId: d.varianteId ?? null,
        nombre: d.variante?.nombre ?? 'Sin variante',
        cantidadVendida: 0,
        ingresoTotal: 0,
      };
      vExisting.cantidadVendida += d.cantidad.toNumber();
      vExisting.ingresoTotal += d.total.toNumber();
      existing.variantes.set(vKey, vExisting);

      agrupado.set(d.productoId, existing);
    }

    const orden = query.orden ?? 'DESC';
    const criterio = query.ordenarPor ?? 'INGRESO';
    const valorDe = (p: { cantidadVendida: number; ingresoTotal: number }) =>
      criterio === 'CANTIDAD' ? p.cantidadVendida : p.ingresoTotal;

    return Array.from(agrupado.values())
      .map((p) => ({
        productoId: p.productoId,
        nombre: p.nombre,
        codigo: p.codigo,
        categoriaId: p.categoriaId,
        categoria: p.categoria,
        cantidadVendida: round2(p.cantidadVendida),
        ingresoTotal: round2(p.ingresoTotal),
        margenTotal: round2(p.margenTotal),
        margenPorcentaje:
          p.ingresoTotal > 0
            ? round2((p.margenTotal / p.ingresoTotal) * 100)
            : 0,
        precioPromedio:
          p.count > 0
            ? round2(p.sumaPrecio / p.count)
            : 0,
        // Solo el bucket BASE = producto sin variantes → sin desglose
        variantes:
          p.variantes.size === 1 && p.variantes.has('BASE')
            ? []
            : Array.from(p.variantes.values())
                .map((v) => ({
                  varianteId: v.varianteId,
                  nombre: v.nombre,
                  cantidadVendida: round2(v.cantidadVendida),
                  ingresoTotal: round2(v.ingresoTotal),
                }))
                .sort((a, b) => b.ingresoTotal - a.ingresoTotal),
      }))
      .sort((a, b) =>
        orden === 'ASC' ? valorDe(a) - valorDe(b) : valorDe(b) - valorDe(a),
      )
      .slice(0, this.parseLimit(query, limit));
  }

  async getTopClientes(
    empresaId: string,
    query: VentaAnalyticsQueryDto,
    limit = 10,
  ) {
    this.logger.log('Obteniendo top clientes');

    const where = this.buildVentaWhere(empresaId, query);

    const ventas = await this.prisma.venta.findMany({
      where,
      select: {
        clienteId: true,
        nombreCliente: true,
        total: true,
      },
    });

    const agrupado = new Map<
      string,
      {
        clienteId: string | null;
        nombre: string;
        totalCompras: number;
        montoTotal: number;
      }
    >();

    // El mismo cliente puede aparecer con clienteId en unas ventas y solo
    // con el nombre (snapshot) en otras, o con el nombre escrito distinto
    // (mayúsculas/espacios). Sin normalizar salía repetido en el top.
    const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, ' ');
    const idPorNombre = new Map<string, string>();
    for (const v of ventas) {
      if (v.clienteId) idPorNombre.set(norm(v.nombreCliente), v.clienteId);
    }

    for (const v of ventas) {
      const key =
        v.clienteId ??
        idPorNombre.get(norm(v.nombreCliente)) ??
        `NOMBRE:${norm(v.nombreCliente)}`;
      const existing = agrupado.get(key) || {
        clienteId: v.clienteId,
        nombre: v.nombreCliente,
        totalCompras: 0,
        montoTotal: 0,
      };
      existing.totalCompras += 1;
      existing.montoTotal += v.total.toNumber();
      // Si una venta posterior trae el clienteId del mismo bucket, guardarlo
      existing.clienteId ??= v.clienteId;
      agrupado.set(key, existing);
    }

    return Array.from(agrupado.values())
      .map((c) => ({
        clienteId: c.clienteId,
        nombre: c.nombre,
        totalCompras: c.totalCompras,
        montoTotal: round2(c.montoTotal),
      }))
      .sort((a, b) => b.montoTotal - a.montoTotal)
      .slice(0, this.parseLimit(query, limit));
  }

  async getVentasPorCanal(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo ventas por canal');

    const where = this.buildVentaWhere(empresaId, query);

    const [porCanal, porEnvio] = await Promise.all([
      this.prisma.venta.groupBy({
        by: ['canalVenta'],
        where,
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.venta.groupBy({
        by: ['conEnvio'],
        where,
        _count: { id: true },
        _sum: { total: true },
      }),
    ]);

    return {
      porCanal: porCanal
        .map((g) => ({
          canal: g.canalVenta,
          cantidad: g._count.id,
          monto: round2(g._sum.total?.toNumber() ?? 0),
        }))
        .sort((a, b) => b.monto - a.monto),
      porEnvio: porEnvio.map((g) => ({
        conEnvio: g.conEnvio,
        cantidad: g._count.id,
        monto: round2(g._sum.total?.toNumber() ?? 0),
      })),
    };
  }

  async getVentasPorCategoria(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo ventas por categoria');

    const where = this.buildVentaWhere(empresaId, query);

    const detalles = await this.prisma.ventaDetalle.findMany({
      where: {
        venta: where,
        productoId: { not: null },
      },
      select: {
        productoId: true,
        cantidad: true,
        total: true,
        producto: {
          select: {
            empresaCategoriaId: true,
            empresaCategoria: {
              select: {
                nombreLocal: true,
                nombrePersonalizado: true,
                categoriaMaestra: { select: { nombre: true } },
              },
            },
          },
        },
      },
    });

    const agrupado = new Map<
      string,
      {
        categoriaId: string | null;
        categoria: string;
        cantidadVendida: number;
        ingresoTotal: number;
        productos: Set<string>;
      }
    >();

    for (const d of detalles) {
      const categoriaId = d.producto?.empresaCategoriaId ?? null;
      const key = categoriaId ?? 'SIN_CATEGORIA';
      const existing = agrupado.get(key) || {
        categoriaId,
        categoria: this.nombreCategoria(d.producto?.empresaCategoria ?? null),
        cantidadVendida: 0,
        ingresoTotal: 0,
        productos: new Set<string>(),
      };
      existing.cantidadVendida += d.cantidad.toNumber();
      existing.ingresoTotal += d.total.toNumber();
      if (d.productoId) existing.productos.add(d.productoId);
      agrupado.set(key, existing);
    }

    return Array.from(agrupado.values())
      .map((c) => ({
        categoriaId: c.categoriaId,
        categoria: c.categoria,
        cantidadVendida: round2(c.cantidadVendida),
        ingresoTotal: round2(c.ingresoTotal),
        productosDistintos: c.productos.size,
      }))
      .sort((a, b) => b.ingresoTotal - a.ingresoTotal);
  }

  async getVentasPorMarca(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo ventas por marca');

    const where = this.buildVentaWhere(empresaId, query);

    const detalles = await this.prisma.ventaDetalle.findMany({
      where: {
        venta: where,
        productoId: { not: null },
      },
      select: {
        productoId: true,
        cantidad: true,
        total: true,
        producto: {
          select: {
            empresaMarcaId: true,
            empresaMarca: {
              select: {
                nombreLocal: true,
                nombrePersonalizado: true,
                marcaMaestra: { select: { nombre: true } },
              },
            },
          },
        },
      },
    });

    const agrupado = new Map<
      string,
      {
        marcaId: string | null;
        marca: string;
        cantidadVendida: number;
        ingresoTotal: number;
        productos: Set<string>;
      }
    >();

    for (const d of detalles) {
      const marcaId = d.producto?.empresaMarcaId ?? null;
      const key = marcaId ?? 'SIN_MARCA';
      const existing = agrupado.get(key) || {
        marcaId,
        marca: this.nombreMarca(d.producto?.empresaMarca ?? null),
        cantidadVendida: 0,
        ingresoTotal: 0,
        productos: new Set<string>(),
      };
      existing.cantidadVendida += d.cantidad.toNumber();
      existing.ingresoTotal += d.total.toNumber();
      if (d.productoId) existing.productos.add(d.productoId);
      agrupado.set(key, existing);
    }

    return Array.from(agrupado.values())
      .map((m) => ({
        marcaId: m.marcaId,
        marca: m.marca,
        cantidadVendida: round2(m.cantidadVendida),
        ingresoTotal: round2(m.ingresoTotal),
        productosDistintos: m.productos.size,
      }))
      .sort((a, b) => b.ingresoTotal - a.ingresoTotal);
  }

  async getVentasPorProveedor(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo ventas por proveedor');

    const where = this.buildVentaWhere(empresaId, query);

    const detalles = await this.prisma.ventaDetalle.findMany({
      where: {
        venta: where,
        productoId: { not: null },
      },
      select: {
        productoId: true,
        cantidad: true,
        total: true,
      },
    });

    const productoIds = [
      ...new Set(detalles.map((d) => d.productoId).filter(Boolean)),
    ] as string[];

    // Proveedor↔producto es N:M (ProveedorProducto). La venta no registra de
    // qué proveedor salió el stock, así que se atribuye al vínculo preferido
    // (esPreferido) y como fallback al más antiguo. Sin vínculo → "Sin proveedor".
    const vinculos = productoIds.length
      ? await this.prisma.proveedorProducto.findMany({
          where: {
            empresaId,
            productoId: { in: productoIds },
            isActive: true,
          },
          select: {
            productoId: true,
            proveedorId: true,
            proveedor: { select: { nombre: true, nombreComercial: true } },
          },
          orderBy: [{ esPreferido: 'desc' }, { creadoEn: 'asc' }],
        })
      : [];

    const proveedorDe = new Map<
      string,
      { proveedorId: string; nombre: string }
    >();
    for (const v of vinculos) {
      if (!v.productoId || proveedorDe.has(v.productoId)) continue;
      proveedorDe.set(v.productoId, {
        proveedorId: v.proveedorId,
        nombre: v.proveedor.nombreComercial ?? v.proveedor.nombre,
      });
    }

    const agrupado = new Map<
      string,
      {
        proveedorId: string | null;
        proveedor: string;
        cantidadVendida: number;
        ingresoTotal: number;
        productos: Set<string>;
      }
    >();

    for (const d of detalles) {
      const vinculo = d.productoId ? proveedorDe.get(d.productoId) : undefined;
      const key = vinculo?.proveedorId ?? 'SIN_PROVEEDOR';
      const existing = agrupado.get(key) || {
        proveedorId: vinculo?.proveedorId ?? null,
        proveedor: vinculo?.nombre ?? 'Sin proveedor',
        cantidadVendida: 0,
        ingresoTotal: 0,
        productos: new Set<string>(),
      };
      existing.cantidadVendida += d.cantidad.toNumber();
      existing.ingresoTotal += d.total.toNumber();
      if (d.productoId) existing.productos.add(d.productoId);
      agrupado.set(key, existing);
    }

    return Array.from(agrupado.values())
      .map((p) => ({
        proveedorId: p.proveedorId,
        proveedor: p.proveedor,
        cantidadVendida: round2(p.cantidadVendida),
        ingresoTotal: round2(p.ingresoTotal),
        productosDistintos: p.productos.size,
      }))
      .sort((a, b) => b.ingresoTotal - a.ingresoTotal);
  }

  /**
   * Métricas de entrega: distribución por tipo (mismo criterio que el
   * filtro del listado: delivery activo manda, luego envío; sin ambos el
   * canal decide física vs recojo) + zonas top de envíos por agencia
   * (destino) y de delivery local (distrito).
   */
  async getEntregasAnalytics(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo analytics de entregas');

    const where = this.buildVentaWhere(empresaId, query);

    const [ventas, envios, deliveries] = await Promise.all([
      this.prisma.venta.findMany({
        where,
        select: {
          total: true,
          conEnvio: true,
          canalVenta: true,
          deliveryLocal: { select: { estado: true } },
        },
      }),
      this.prisma.ventaEnvio.findMany({
        where: { venta: { is: where } },
        select: {
          destinoDepartamento: true,
          destinoProvincia: true,
          venta: { select: { total: true } },
        },
      }),
      this.prisma.deliveryLocal.findMany({
        where: { estado: { not: 'CANCELADO' }, venta: { is: where } },
        select: { distrito: true, venta: { select: { total: true } } },
      }),
    ]);

    const porTipo = new Map<string, { cantidad: number; monto: number }>();
    for (const v of ventas) {
      const tipo =
        v.deliveryLocal && v.deliveryLocal.estado !== 'CANCELADO'
          ? 'DELIVERY'
          : v.conEnvio
            ? 'ENVIO'
            : v.canalVenta === 'ONLINE' || v.canalVenta === 'WHATSAPP_IA'
              ? 'RECOJO'
              : 'FISICA';
      const e = porTipo.get(tipo) || { cantidad: 0, monto: 0 };
      e.cantidad += 1;
      e.monto += v.total.toNumber();
      porTipo.set(tipo, e);
    }

    const agruparZonas = (filas: Array<{ zona: string; total: number }>) => {
      const zonas = new Map<string, { cantidad: number; monto: number }>();
      for (const f of filas) {
        const e = zonas.get(f.zona) || { cantidad: 0, monto: 0 };
        e.cantidad += 1;
        e.monto += f.total;
        zonas.set(f.zona, e);
      }
      return Array.from(zonas.entries())
        .map(([zona, e]) => ({
          zona,
          cantidad: e.cantidad,
          monto: round2(e.monto),
        }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 10);
    };

    // Orden fijo de tipos: el color sigue a la entidad en el gráfico
    const ordenTipos = ['ENVIO', 'DELIVERY', 'RECOJO', 'FISICA'];

    return {
      porTipoEntrega: ordenTipos
        .filter((t) => porTipo.has(t))
        .map((t) => ({
          tipo: t,
          cantidad: porTipo.get(t)!.cantidad,
          monto: round2(porTipo.get(t)!.monto),
        })),
      zonasEnvio: agruparZonas(
        envios.map((e) => ({
          zona:
            [e.destinoDepartamento, e.destinoProvincia]
              .filter((s) => s && s.trim())
              .join(' / ') || 'Sin destino',
          total: e.venta?.total.toNumber() ?? 0,
        })),
      ),
      zonasDelivery: agruparZonas(
        deliveries.map((d) => ({
          zona: d.distrito?.trim() || 'Sin distrito',
          total: d.venta?.total.toNumber() ?? 0,
        })),
      ),
    };
  }

  /**
   * Reposición sugerida: velocidad de venta de los ÚLTIMOS 30 DÍAS (fija e
   * independiente del periodo del dashboard — un filtro "Hoy" haría ruido)
   * cruzada con el stock actual → días de cobertura y cantidad a comprar
   * para 15 días. La cobertura es POR VARIANTE cuando existe (la talla que
   * se agota no se ve a nivel producto). Solo respeta el filtro de sede.
   */
  async getReposicionSugerida(
    empresaId: string,
    query: VentaAnalyticsQueryDto,
  ) {
    this.logger.log('Obteniendo reposición sugerida');

    const DIAS_VELOCIDAD = 30;
    const DIAS_OBJETIVO = 15;
    const desde = new Date(Date.now() - DIAS_VELOCIDAD * 24 * 60 * 60 * 1000);

    const whereVenta: Prisma.VentaWhereInput = {
      empresaId,
      estado: { notIn: [EstadoVenta.BORRADOR, EstadoVenta.ANULADA] },
      fechaVenta: { gte: desde },
      ...(query.sedeId ? { sedeId: query.sedeId } : {}),
    };

    const detalles = await this.prisma.ventaDetalle.findMany({
      where: { venta: whereVenta, productoId: { not: null } },
      select: {
        productoId: true,
        varianteId: true,
        cantidad: true,
        producto: { select: { nombre: true } },
        variante: { select: { nombre: true } },
      },
    });

    // Agrupar por variante cuando existe; si no, por producto base
    const vendidos = new Map<
      string,
      {
        productoId: string;
        varianteId: string | null;
        nombre: string;
        cantidad30d: number;
      }
    >();
    for (const d of detalles) {
      if (!d.productoId) continue;
      const key = d.varianteId ?? `P:${d.productoId}`;
      const existing = vendidos.get(key) || {
        productoId: d.productoId,
        varianteId: d.varianteId ?? null,
        nombre: d.variante?.nombre
          ? `${d.producto?.nombre ?? ''} — ${d.variante.nombre}`
          : (d.producto?.nombre ?? ''),
        cantidad30d: 0,
      };
      existing.cantidad30d += d.cantidad.toNumber();
      vendidos.set(key, existing);
    }
    if (vendidos.size === 0) return [];

    // Stock actual: ramificar producto base vs variante — las filas de
    // ProductoStock viven en UNO de los dos ejes, nunca AND de ambos.
    const items = [...vendidos.values()];
    const productoIds = [
      ...new Set(items.filter((v) => !v.varianteId).map((v) => v.productoId)),
    ];
    const varianteIds = [
      ...new Set(
        items
          .filter((v) => v.varianteId)
          .map((v) => v.varianteId as string),
      ),
    ];
    const whereSede = query.sedeId ? { sedeId: query.sedeId } : {};

    const [stockBase, stockVariantes] = await Promise.all([
      productoIds.length
        ? this.prisma.productoStock.findMany({
            where: { empresaId, productoId: { in: productoIds }, ...whereSede },
            select: { productoId: true, stockActual: true },
          })
        : Promise.resolve([]),
      varianteIds.length
        ? this.prisma.productoStock.findMany({
            where: { empresaId, varianteId: { in: varianteIds }, ...whereSede },
            select: { varianteId: true, stockActual: true },
          })
        : Promise.resolve([]),
    ]);

    // Sin filtro de sede el stock se suma entre sedes
    const stockDe = new Map<string, number>();
    for (const s of stockBase) {
      if (!s.productoId) continue;
      const k = `P:${s.productoId}`;
      stockDe.set(k, (stockDe.get(k) ?? 0) + s.stockActual);
    }
    for (const s of stockVariantes) {
      if (!s.varianteId) continue;
      stockDe.set(s.varianteId, (stockDe.get(s.varianteId) ?? 0) + s.stockActual);
    }

    return [...vendidos.entries()]
      .map(([key, v]) => {
        const stock = stockDe.get(key);
        // Sin fila de stock = sin control de inventario (servicio/combo) → fuera
        if (stock == null) return null;
        const ventaDiaria = v.cantidad30d / DIAS_VELOCIDAD;
        if (ventaDiaria <= 0) return null;
        const diasCobertura = stock / ventaDiaria;
        const nivel =
          diasCobertura <= 7 ? 'CRITICO' : diasCobertura <= 15 ? 'BAJO' : 'OK';
        return {
          productoId: v.productoId,
          varianteId: v.varianteId,
          nombre: v.nombre,
          ventaDiaria: round2(ventaDiaria),
          stockActual: stock,
          diasCobertura: round2(diasCobertura),
          nivel,
          sugeridoComprar: Math.max(
            0,
            Math.ceil(ventaDiaria * DIAS_OBJETIVO - stock),
          ),
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.diasCobertura - b.diasCobertura)
      .slice(0, 15);
  }

  /**
   * Distribución horaria de las ventas en hora Perú (UTC-5): por hora del
   * día (0-23) y por día de semana (1=Lun…7=Dom). Para decidir horarios
   * de personal y cobertura de delivery.
   */
  async getHorasPico(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo horas pico');

    const where = this.buildVentaWhere(empresaId, query);
    const ventas = await this.prisma.venta.findMany({
      where,
      select: { fechaVenta: true, total: true },
    });

    const porHora = Array.from({ length: 24 }, (_, hora) => ({
      hora,
      cantidad: 0,
      monto: 0,
    }));
    const porDiaSemana = Array.from({ length: 7 }, (_, i) => ({
      dia: i + 1,
      cantidad: 0,
      monto: 0,
    }));

    for (const v of ventas) {
      // Shift fijo -5h y getters UTC: independiente del TZ del servidor
      const peru = new Date(v.fechaVenta.getTime() - 5 * 60 * 60 * 1000);
      const hora = peru.getUTCHours();
      const diaJs = peru.getUTCDay(); // 0=Dom
      const dia = diaJs === 0 ? 7 : diaJs; // 1=Lun … 7=Dom
      const monto = v.total.toNumber();
      porHora[hora].cantidad += 1;
      porHora[hora].monto += monto;
      porDiaSemana[dia - 1].cantidad += 1;
      porDiaSemana[dia - 1].monto += monto;
    }

    return {
      porHora: porHora.map((h) => ({ ...h, monto: round2(h.monto) })),
      porDiaSemana: porDiaSemana.map((d) => ({ ...d, monto: round2(d.monto) })),
    };
  }

  /**
   * Proyección de cierre del MES CALENDARIO actual (hora Perú), con ritmo
   * por día de semana: promedio de lo vendido cada Lun/Mar/… en las últimas
   * 8 semanas × los días que faltan. La banda min–max sale de la
   * variabilidad real de las semanas históricas. Solo respeta sedeId —
   * es una proyección del negocio, no del filtro visual.
   */
  async getProyeccionMes(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo proyección de cierre de mes');

    const MS_H = 3600 * 1000;
    const VENTANA_DIAS = 56; // 8 semanas de historia
    // Calendario Perú: shift -5h y getters UTC (independiente del TZ server)
    const peruHoy = new Date(Date.now() - 5 * MS_H);
    const y = peruHoy.getUTCFullYear();
    const m = peruHoy.getUTCMonth();
    const d = peruHoy.getUTCDate();
    const diasEnMes = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    // Instantes UTC de los bordes (día Perú arranca a las 05:00 UTC)
    const utcDe = (yy: number, mm: number, dd: number) =>
      new Date(Date.UTC(yy, mm, dd) + 5 * MS_H);
    const inicioMes = utcDe(y, m, 1);
    const inicioMesAnterior = utcDe(y, m - 1, 1);
    const inicioVentana = utcDe(y, m, d - (VENTANA_DIAS - 1));
    const desde =
      inicioVentana < inicioMesAnterior ? inicioVentana : inicioMesAnterior;

    const ventas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        estado: { notIn: [EstadoVenta.BORRADOR, EstadoVenta.ANULADA] },
        fechaVenta: { gte: desde },
        ...(query.sedeId ? { sedeId: query.sedeId } : {}),
      },
      select: { fechaVenta: true, total: true },
    });

    // Buckets por día calendario Perú ('yyyy-mm-dd' → monto)
    const porDia = new Map<string, number>();
    const keyDe = (fecha: Date) => {
      const p = new Date(fecha.getTime() - 5 * MS_H);
      return `${p.getUTCFullYear()}-${p.getUTCMonth()}-${p.getUTCDate()}`;
    };
    let mesActual = 0;
    let mesAnterior = 0;
    for (const v of ventas) {
      const monto = v.total.toNumber();
      porDia.set(keyDe(v.fechaVenta), (porDia.get(keyDe(v.fechaVenta)) ?? 0) + monto);
      if (v.fechaVenta >= inicioMes) mesActual += monto;
      else if (v.fechaVenta >= inicioMesAnterior) mesAnterior += monto;
    }

    // Historia efectiva: desde la primera venta de la ventana hasta AYER
    // (hoy es parcial). Los días sin ventas cuentan como 0.
    const montoDelDia = (offset: number) => {
      const dia = new Date(Date.UTC(y, m, d + offset));
      return {
        dow: dia.getUTCDay(),
        monto:
          porDia.get(
            `${dia.getUTCFullYear()}-${dia.getUTCMonth()}-${dia.getUTCDate()}`,
          ) ?? 0,
      };
    };
    let primerOffset = -(VENTANA_DIAS - 1);
    while (primerOffset <= -1 && montoDelDia(primerOffset).monto === 0) {
      primerOffset++;
    }
    const diasHistoria = -primerOffset; // días completos con historia
    if (diasHistoria < 7) {
      return { suficiente: false, diasHistoria, ventasActual: round2(mesActual) };
    }

    // Promedio por día de semana sobre la historia efectiva
    const sumaDow = Array.from({ length: 7 }, () => ({ suma: 0, n: 0 }));
    for (let off = primerOffset; off <= -1; off++) {
      const { dow, monto } = montoDelDia(off);
      sumaDow[dow].suma += monto;
      sumaDow[dow].n += 1;
    }
    const promedioDow = sumaDow.map((s) => (s.n > 0 ? s.suma / s.n : 0));

    // Restante del mes: días después de hoy + lo que le falte a hoy
    const dowHoy = new Date(Date.UTC(y, m, d)).getUTCDay();
    const ventasHoy = montoDelDia(0).monto;
    let restante = Math.max(0, promedioDow[dowHoy] - ventasHoy);
    for (let dia = d + 1; dia <= diasEnMes; dia++) {
      restante += promedioDow[new Date(Date.UTC(y, m, dia)).getUTCDay()];
    }

    // Banda: coeficiente de variación de las semanas completas históricas
    const semanas: number[] = [];
    for (let fin = -1; fin - 6 >= primerOffset; fin -= 7) {
      let s = 0;
      for (let off = fin - 6; off <= fin; off++) s += montoDelDia(off).monto;
      semanas.push(s);
    }
    let cv = 0.25; // sin semanas suficientes: banda genérica ±25%
    if (semanas.length >= 2) {
      const prom = semanas.reduce((a, b) => a + b, 0) / semanas.length;
      if (prom > 0) {
        const varianza =
          semanas.reduce((a, b) => a + (b - prom) * (b - prom), 0) /
          semanas.length;
        cv = Math.min(0.5, Math.sqrt(varianza) / prom);
      }
    }

    const proyeccion = mesActual + restante;
    return {
      suficiente: true,
      diasHistoria,
      diasTranscurridos: d,
      diasEnMes,
      ventasActual: round2(mesActual),
      proyeccionCierre: round2(proyeccion),
      proyeccionMin: round2(mesActual + restante * (1 - cv)),
      proyeccionMax: round2(mesActual + restante * (1 + cv)),
      mesAnterior: round2(mesAnterior),
      variacionPct:
        mesAnterior > 0
          ? round2(((proyeccion - mesAnterior) / mesAnterior) * 100)
          : null,
    };
  }

  /**
   * Dashboard consolidado: todas las secciones de estadísticas en UNA
   * respuesta. El app hacía 15 requests paralelos — cada uno pagaba
   * round-trip móvil + auth + tenant; acá el fan-out corre server-side
   * contra la BD local. Los endpoints individuales siguen vivos por
   * compatibilidad con APKs viejos.
   */
  async getDashboard(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo dashboard consolidado de ventas');

    const [
      resumen,
      ventasPeriodo,
      topProductos,
      menosVendidos,
      topClientes,
      comparativo,
      alertas,
      porCanal,
      porCategoria,
      porMarca,
      porProveedor,
      entregas,
      metodosPago,
      horasPico,
      reposicion,
      proyeccion,
      porEmisor,
    ] = await Promise.all([
      this.getResumenGeneral(empresaId, query),
      this.getVentasPorPeriodo(empresaId, query),
      this.getTopProductos(empresaId, { ...query, orden: 'DESC' }),
      this.getTopProductos(empresaId, { ...query, orden: 'ASC' }),
      this.getTopClientes(empresaId, query),
      this.getComparativoVentas(empresaId, query),
      this.getAlertasVentas(empresaId, query.sedeId),
      this.getVentasPorCanal(empresaId, query),
      this.getVentasPorCategoria(empresaId, query),
      this.getVentasPorMarca(empresaId, query),
      this.getVentasPorProveedor(empresaId, query),
      this.getEntregasAnalytics(empresaId, query),
      this.getMetodosPago(empresaId, query),
      this.getHorasPico(empresaId, query),
      this.getReposicionSugerida(empresaId, query),
      this.getProyeccionMes(empresaId, query),
      this.getVentasPorEmisor(empresaId, query),
    ]);

    return {
      resumen,
      ventasPeriodo,
      topProductos,
      menosVendidos,
      topClientes,
      comparativo,
      alertas,
      porCanal,
      porCategoria,
      porMarca,
      porProveedor,
      entregas,
      metodosPago,
      horasPico,
      reposicion,
      proyeccion,
      porEmisor,
    };
  }

  /**
   * Ventas por EMISOR (multi-RUC): agrupa por el RUC con el que salió el
   * comprobante electrónico. Los Tickets (nota de venta, sin comprobante)
   * van en `sinComprobante`. `multiEmisor` indica si la empresa tiene
   * emisores socio registrados (la UI oculta la sección si no los hay).
   */
  async getVentasPorEmisor(empresaId: string, query: VentaAnalyticsQueryDto) {
    const where = this.buildVentaWhere(empresaId, query);

    const [ventas, empresa, emisoresDb] = await Promise.all([
      this.prisma.venta.findMany({
        where,
        select: {
          total: true,
          comprobante: { select: { rucEmisor: true } },
        },
      }),
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { ruc: true, razonSocial: true, nombre: true },
      }),
      this.prisma.emisorFacturacion.findMany({
        where: { empresaId },
        select: { ruc: true, razonSocial: true },
      }),
    ]);

    const nombres = new Map<string, string>();
    if (empresa?.ruc) {
      nombres.set(empresa.ruc, empresa.razonSocial || empresa.nombre || 'Principal');
    }
    for (const e of emisoresDb) nombres.set(e.ruc, e.razonSocial);

    const acc = new Map<string, { ventas: number; monto: number }>();
    const sinComprobante = { ventas: 0, monto: 0 };
    for (const v of ventas) {
      const monto = Number(v.total);
      const ruc = v.comprobante?.rucEmisor ?? null;
      if (!ruc) {
        sinComprobante.ventas++;
        sinComprobante.monto += monto;
        continue;
      }
      const cur = acc.get(ruc) ?? { ventas: 0, monto: 0 };
      cur.ventas++;
      cur.monto += monto;
      acc.set(ruc, cur);
    }

    return {
      emisores: [...acc.entries()]
        .map(([ruc, s]) => ({
          ruc,
          razonSocial: nombres.get(ruc) ?? ruc,
          esPrincipal: ruc === empresa?.ruc,
          ventas: s.ventas,
          monto: round2(s.monto),
        }))
        .sort((a, b) => b.monto - a.monto),
      sinComprobante: {
        ventas: sinComprobante.ventas,
        monto: round2(sinComprobante.monto),
      },
      multiEmisor: emisoresDb.length > 0,
    };
  }

  /**
   * Distribución de pagos por método (fuente de verdad: tabla PagoVenta —
   * una venta MIXTO aporta a cada método por separado). Ventas a crédito
   * sin pagos aún no aparecen: es distribución de lo COBRADO.
   */
  async getMetodosPago(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo distribución por método de pago');

    const where = this.buildVentaWhere(empresaId, query);

    const grupos = await this.prisma.pagoVenta.groupBy({
      by: ['metodoPago'],
      where: { venta: { is: where } },
      _count: { id: true },
      _sum: { monto: true },
    });

    return grupos
      .map((g) => ({
        metodo: g.metodoPago,
        cantidad: g._count.id,
        monto: round2(g._sum.monto?.toNumber() ?? 0),
      }))
      .sort((a, b) => b.monto - a.monto);
  }

  async getComparativoVentas(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo comparativo de ventas');

    const now = new Date();
    let fechaInicioActual: Date;
    let fechaFinActual: Date;
    let fechaInicioAnterior: Date;
    let fechaFinAnterior: Date;

    if (query.fechaInicioA && query.fechaFinA && query.fechaInicioB && query.fechaFinB) {
      // Periodos explícitos del frontend
      fechaInicioAnterior = parseStartOfDay(query.fechaInicioA);
      fechaFinAnterior = parseEndOfDay(query.fechaFinA);
      fechaInicioActual = parseStartOfDay(query.fechaInicioB);
      fechaFinActual = parseEndOfDay(query.fechaFinB);
    } else if (query.fechaInicio && query.fechaFin) {
      fechaInicioActual = parseStartOfDay(query.fechaInicio);
      fechaFinActual = parseEndOfDay(query.fechaFin);
      const esInicioMes = fechaInicioActual.getDate() === 1;
      if (esInicioMes) {
        const m = fechaInicioActual.getMonth();
        const y = fechaInicioActual.getFullYear();
        fechaInicioAnterior = new Date(y, m - 1, 1);
        fechaFinAnterior = new Date(y, m, 0, 23, 59, 59, 999);
      } else {
        const diffMs = fechaFinActual.getTime() - fechaInicioActual.getTime();
        fechaFinAnterior = new Date(fechaInicioActual.getTime() - 1);
        fechaInicioAnterior = new Date(fechaFinAnterior.getTime() - diffMs);
      }
    } else {
      // Default: mes actual vs mes anterior (zona negocio)
      fechaInicioActual = getMonthStart();
      fechaFinActual = now;
      const biz = fechaInicioActual;
      fechaInicioAnterior = new Date(Date.UTC(biz.getUTCFullYear(), biz.getUTCMonth() - 1, 1));
      fechaFinAnterior = new Date(Date.UTC(biz.getUTCFullYear(), biz.getUTCMonth(), 0, 23, 59, 59, 999));
    }

    const baseWhere: Prisma.VentaWhereInput = {
      empresaId,
      estado: { notIn: [EstadoVenta.BORRADOR, EstadoVenta.ANULADA] },
      ...(query.sedeId ? { sedeId: query.sedeId } : {}),
      ...(query.clienteId ? { clienteId: query.clienteId } : {}),
    };

    const [actual, anterior] = await Promise.all([
      this.prisma.venta.aggregate({
        where: {
          ...baseWhere,
          fechaVenta: { gte: fechaInicioActual, lte: fechaFinActual },
        },
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.venta.aggregate({
        where: {
          ...baseWhere,
          fechaVenta: { gte: fechaInicioAnterior, lte: fechaFinAnterior },
        },
        _count: { id: true },
        _sum: { total: true },
      }),
    ]);

    const montoActual = actual._sum.total?.toNumber() ?? 0;
    const montoAnterior = anterior._sum.total?.toNumber() ?? 0;
    const diferencia = montoActual - montoAnterior;
    const porcentajeCambio =
      montoAnterior > 0
        ? round2((diferencia / montoAnterior) * 100)
        : montoActual > 0
          ? 100
          : 0;

    return {
      periodoActual: {
        fechaInicio: fechaInicioActual,
        fechaFin: fechaFinActual,
        totalVentas: actual._count.id,
        montoTotal: montoActual,
      },
      periodoAnterior: {
        fechaInicio: fechaInicioAnterior,
        fechaFin: fechaFinAnterior,
        totalVentas: anterior._count.id,
        montoTotal: montoAnterior,
      },
      diferencia,
      porcentajeCambio,
    };
  }

  async getDashboardVendedor(empresaId: string, vendedorId: string, sedeId?: string) {
    this.logger.log(`Obteniendo dashboard del vendedor ${vendedorId}`);

    const now = new Date();
    const hoy = getTodayStart();
    const manana = getTomorrowStart();
    const inicioSemana = getWeekStart();
    const inicioMes = getMonthStart();

    const baseWhere: any = { empresaId, vendedorId, estado: { not: 'ANULADA' as const } };
    if (sedeId) baseWhere.sedeId = sedeId;

    // Get vendedor info
    const vendedor = await this.prisma.usuario.findUnique({
      where: { id: vendedorId },
      select: { id: true, email: true, persona: { select: { nombres: true, apellidos: true } } },
    });

    const nombreVendedor = vendedor
      ? `${vendedor.persona?.nombres ?? ''} ${vendedor.persona?.apellidos ?? ''}`.trim()
      : 'Vendedor';

    // Parallel queries for sales
    const [
      ventasHoyCant, ventasSemanaCant, ventasMesCant,
    ] = await Promise.all([
      this.prisma.venta.count({ where: { ...baseWhere, fechaVenta: { gte: hoy, lt: manana } } }),
      this.prisma.venta.count({ where: { ...baseWhere, fechaVenta: { gte: inicioSemana } } }),
      this.prisma.venta.count({ where: { ...baseWhere, fechaVenta: { gte: inicioMes } } }),
    ]);

    // Montos with aggregate
    const [montoHoyAgg, montoSemanaAgg, montoMesAgg] = await Promise.all([
      this.prisma.venta.aggregate({ where: { ...baseWhere, fechaVenta: { gte: hoy, lt: manana } }, _sum: { total: true } }),
      this.prisma.venta.aggregate({ where: { ...baseWhere, fechaVenta: { gte: inicioSemana } }, _sum: { total: true } }),
      this.prisma.venta.aggregate({ where: { ...baseWhere, fechaVenta: { gte: inicioMes } }, _sum: { total: true } }),
    ]);

    const montoHoy = Number(montoHoyAgg._sum.total ?? 0);
    const montoSemana = Number(montoSemanaAgg._sum.total ?? 0);
    const montoMes = Number(montoMesAgg._sum.total ?? 0);
    const ticketPromedio = ventasMesCant > 0 ? round2(montoMes / ventasMesCant) : 0;

    // Cotizaciones
    const cotizBaseWhere: any = { empresaId, vendedorId };
    if (sedeId) cotizBaseWhere.sedeId = sedeId;

    const [cotizacionesTotal, cotizacionesConvertidas] = await Promise.all([
      this.prisma.cotizacion.count({ where: { ...cotizBaseWhere, creadoEn: { gte: inicioMes } } }),
      this.prisma.cotizacion.count({ where: { ...cotizBaseWhere, estado: 'CONVERTIDA', creadoEn: { gte: inicioMes } } }),
    ]);
    const tasaConversion = cotizacionesTotal > 0 ? round2((cotizacionesConvertidas / cotizacionesTotal) * 100) : 0;

    // Creditos pendientes (override estado from baseWhere)
    const creditosVentas = await this.prisma.venta.findMany({
      where: { empresaId, vendedorId, esCredito: true, estado: { in: ['CONFIRMADA', 'PAGADA_PARCIAL'] }, ...(sedeId && { sedeId }) },
      include: { pagos: { select: { monto: true } } },
    });

    let totalPendiente = 0, cantidadPendientes = 0, totalVencido = 0, cantidadVencidos = 0;
    for (const v of creditosVentas) {
      const pagado = v.pagos.reduce((s, p) => s + Number(p.monto), 0);
      const saldo = Number(v.total) - pagado;
      if (saldo > 0) {
        totalPendiente += saldo;
        cantidadPendientes++;
        if (v.fechaVencimientoPago && v.fechaVencimientoPago < now) {
          totalVencido += saldo;
          cantidadVencidos++;
        }
      }
    }

    // Metodos de pago del mes
    const pagosDelMes = await this.prisma.pagoVenta.findMany({
      where: { venta: { ...baseWhere, fechaVenta: { gte: inicioMes } } },
      select: { metodoPago: true, monto: true },
    });

    const metodosPago: Record<string, number> = {};
    for (const p of pagosDelMes) {
      metodosPago[p.metodoPago] = (metodosPago[p.metodoPago] ?? 0) + Number(p.monto);
    }

    // Ventas por día (últimos 7 días)
    const hace7Dias = new Date(hoy);
    hace7Dias.setDate(hace7Dias.getDate() - 6);

    const ventasPorDiaRaw = await this.prisma.$queryRaw<any[]>`
      SELECT DATE(v."fechaVenta" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima') as fecha,
             COUNT(*)::int as cantidad,
             COALESCE(SUM(v.total), 0)::float as monto
      FROM "Venta" v
      WHERE v."empresaId" = ${empresaId}
      AND v."vendedorId" = ${vendedorId}
      AND v."estado" != 'ANULADA'
      AND v."fechaVenta" >= ${hace7Dias}
      ${sedeId ? Prisma.sql`AND v."sedeId" = ${sedeId}` : Prisma.empty}
      GROUP BY DATE(v."fechaVenta" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Lima')
      ORDER BY fecha ASC
    `;

    // Top 5 productos del mes
    const topProductosRaw = await this.prisma.$queryRaw<any[]>`
      SELECT p.nombre, SUM(vd.cantidad)::int as cantidad, SUM(vd.total)::float as monto
      FROM "VentaDetalle" vd
      JOIN "Venta" v ON v.id = vd."ventaId"
      LEFT JOIN "Producto" p ON p.id = vd."productoId"
      WHERE v."empresaId" = ${empresaId}
      AND v."vendedorId" = ${vendedorId}
      AND v."estado" != 'ANULADA'
      AND v."fechaVenta" >= ${inicioMes}
      ${sedeId ? Prisma.sql`AND v."sedeId" = ${sedeId}` : Prisma.empty}
      GROUP BY p.nombre
      ORDER BY monto DESC
      LIMIT 5
    `;

    // Top 5 clientes del mes
    const topClientesRaw = await this.prisma.$queryRaw<any[]>`
      SELECT v."nombreCliente" as nombre,
             COUNT(*)::int as "cantidadCompras",
             SUM(v.total)::float as "montoTotal"
      FROM "Venta" v
      WHERE v."empresaId" = ${empresaId}
      AND v."vendedorId" = ${vendedorId}
      AND v."estado" != 'ANULADA'
      AND v."fechaVenta" >= ${inicioMes}
      ${sedeId ? Prisma.sql`AND v."sedeId" = ${sedeId}` : Prisma.empty}
      GROUP BY v."nombreCliente"
      ORDER BY "montoTotal" DESC
      LIMIT 5
    `;

    // Ranking del mes
    const rankingRaw = await this.prisma.$queryRaw<any[]>`
      SELECT v."vendedorId",
             CONCAT(p.nombres, ' ', p.apellidos) as nombre,
             COUNT(*)::int as "cantidadVentas",
             COALESCE(SUM(v.total), 0)::float as "montoTotal"
      FROM "Venta" v
      JOIN "Usuario" u ON u.id = v."vendedorId"
      JOIN "Persona" p ON p.id = u."personaId"
      WHERE v."empresaId" = ${empresaId}
      AND v."estado" != 'ANULADA'
      AND v."fechaVenta" >= ${inicioMes}
      ${sedeId ? Prisma.sql`AND v."sedeId" = ${sedeId}` : Prisma.empty}
      GROUP BY v."vendedorId", p.nombres, p.apellidos
      ORDER BY "montoTotal" DESC
    `;

    const posicion = rankingRaw.findIndex((r: any) => r.vendedorId === vendedorId) + 1;
    const montoLider = rankingRaw.length > 0 ? rankingRaw[0].montoTotal : 0;

    return {
      vendedor: { id: vendedorId, nombre: nombreVendedor, email: vendedor?.email },
      resumen: {
        ventasHoy: { cantidad: ventasHoyCant, monto: round2(montoHoy) },
        ventasSemana: { cantidad: ventasSemanaCant, monto: round2(montoSemana) },
        ventasMes: { cantidad: ventasMesCant, monto: round2(montoMes) },
        ticketPromedio,
        cotizacionesTotal,
        cotizacionesConvertidas,
        tasaConversion,
      },
      creditos: {
        totalPendiente: round2(totalPendiente),
        cantidadPendientes,
        totalVencido: round2(totalVencido),
        cantidadVencidos,
      },
      metodosPago: Object.fromEntries(
        Object.entries(metodosPago).map(([k, v]) => [k, round2(v)])
      ),
      ventasPorDia: ventasPorDiaRaw.map(r => ({
        fecha: r.fecha,
        cantidad: r.cantidad,
        monto: round2(r.monto),
      })),
      topProductos: topProductosRaw.map(r => ({
        nombre: r.nombre ?? 'Sin nombre',
        cantidad: r.cantidad,
        monto: round2(r.monto),
      })),
      topClientes: topClientesRaw.map(r => ({
        nombre: r.nombre ?? 'Sin nombre',
        cantidadCompras: r.cantidadCompras,
        montoTotal: round2(r.montoTotal),
      })),
      ranking: {
        posicion: posicion > 0 ? posicion : rankingRaw.length + 1,
        totalVendedores: rankingRaw.length,
        montoVendedor: round2(montoMes),
        montoLider: round2(montoLider),
      },
    };
  }

  async getAlertasVentas(empresaId: string, sedeId?: string) {
    this.logger.log('Obteniendo alertas de ventas');

    const alertas: { tipo: string; mensaje: string; datos: any }[] = [];
    const now = new Date();
    const tresDiasAtras = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const baseWhere = {
      empresaId,
      ...(sedeId ? { sedeId } : {}),
    };

    // 1. Ventas en BORRADOR > 3 dias
    const ventasBorradorAntiguas = await this.prisma.venta.findMany({
      where: {
        ...baseWhere,
        estado: EstadoVenta.BORRADOR,
        creadoEn: { lt: tresDiasAtras },
      },
      select: {
        id: true,
        codigo: true,
        nombreCliente: true,
        total: true,
        creadoEn: true,
      },
      take: 20,
    });

    if (ventasBorradorAntiguas.length > 0) {
      alertas.push({
        tipo: 'BORRADORES_ANTIGUOS',
        mensaje: `Hay ${ventasBorradorAntiguas.length} venta(s) en borrador con mas de 3 dias`,
        datos: ventasBorradorAntiguas,
      });
    }

    // 2. Creditos vencidos
    const creditosVencidos = await this.prisma.venta.findMany({
      where: {
        ...baseWhere,
        esCredito: true,
        fechaVencimientoPago: { lt: now },
        estado: { not: EstadoVenta.ANULADA },
      },
      select: {
        id: true,
        codigo: true,
        nombreCliente: true,
        total: true,
        fechaVencimientoPago: true,
      },
      take: 20,
    });

    if (creditosVencidos.length > 0) {
      alertas.push({
        tipo: 'CREDITOS_VENCIDOS',
        mensaje: `Hay ${creditosVencidos.length} venta(s) a credito con pago vencido`,
        datos: creditosVencidos,
      });
    }

    return alertas;
  }
}
