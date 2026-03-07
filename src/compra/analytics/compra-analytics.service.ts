import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { CompraAnalyticsQueryDto, PeriodoAgrupacion } from './dto/compra-analytics.dto';
import { EstadoCompra, EstadoOrdenCompra, EstadoLote, Prisma } from '@prisma/client';

@Injectable()
export class CompraAnalyticsService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CompraAnalyticsService.name);
  }

  private buildDateFilter(query: CompraAnalyticsQueryDto) {
    const dateFilter: any = {};
    if (query.fechaInicio) dateFilter.gte = new Date(query.fechaInicio);
    if (query.fechaFin) {
      const end = new Date(query.fechaFin);
      end.setHours(23, 59, 59, 999);
      dateFilter.lte = end;
    }
    return Object.keys(dateFilter).length > 0 ? dateFilter : undefined;
  }

  private buildCompraWhere(empresaId: string, query: CompraAnalyticsQueryDto): Prisma.CompraWhereInput {
    const where: Prisma.CompraWhereInput = {
      empresaId,
      estado: EstadoCompra.CONFIRMADA,
    };
    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.proveedorId) where.proveedorId = query.proveedorId;
    const dateFilter = this.buildDateFilter(query);
    if (dateFilter) where.confirmadoEn = dateFilter;
    return where;
  }

  async getResumenGeneral(empresaId: string, query: CompraAnalyticsQueryDto) {
    const where = this.buildCompraWhere(empresaId, query);
    const ocWhere: Prisma.OrdenCompraWhereInput = { empresaId };
    if (query.sedeId) ocWhere.sedeId = query.sedeId;

    const [compras, comprasPendientes, totalOC, ocPendientes] = await Promise.all([
      this.prisma.compra.aggregate({
        where,
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.compra.count({
        where: {
          empresaId,
          estado: EstadoCompra.BORRADOR,
          ...(query.sedeId ? { sedeId: query.sedeId } : {}),
        },
      }),
      this.prisma.ordenCompra.count({ where: ocWhere }),
      this.prisma.ordenCompra.count({
        where: {
          ...ocWhere,
          estado: { in: [EstadoOrdenCompra.PENDIENTE, EstadoOrdenCompra.APROBADA, EstadoOrdenCompra.PARCIAL] },
        },
      }),
    ]);

    return {
      totalCompras: compras._count.id,
      montoTotal: Number(compras._sum.total ?? 0),
      promedioPorCompra: Math.round(Number(compras._avg.total ?? 0) * 100) / 100,
      comprasPendientes,
      totalOrdenesCompra: totalOC,
      ocPendientes,
    };
  }

  async getGastosPorPeriodo(empresaId: string, query: CompraAnalyticsQueryDto) {
    const where = this.buildCompraWhere(empresaId, query);
    const periodo = query.periodo || PeriodoAgrupacion.MENSUAL;

    const compras = await this.prisma.compra.findMany({
      where,
      select: {
        total: true,
        confirmadoEn: true,
      },
      orderBy: { confirmadoEn: 'asc' },
    });

    const agrupado = new Map<string, { total: number; cantidad: number }>();

    for (const compra of compras) {
      const fecha = compra.confirmadoEn ?? new Date();
      const key = this.getPeriodoKey(fecha, periodo);
      const current = agrupado.get(key) || { total: 0, cantidad: 0 };
      current.total += Number(compra.total);
      current.cantidad += 1;
      agrupado.set(key, current);
    }

    return Array.from(agrupado.entries()).map(([periodo, data]) => ({
      periodo,
      total: Math.round(data.total * 100) / 100,
      cantidad: data.cantidad,
    }));
  }

  async getTopProductos(empresaId: string, query: CompraAnalyticsQueryDto, limit: number = 10) {
    const where = this.buildCompraWhere(empresaId, query);

    const detalles = await this.prisma.compraDetalle.findMany({
      where: { compra: where },
      select: {
        productoId: true,
        cantidad: true,
        total: true,
        precioUnitario: true,
        producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
      },
    });

    const productoMap = new Map<string, {
      productoId: string;
      nombre: string;
      codigo: string;
      cantidad: number;
      costoTotal: number;
      count: number;
    }>();

    for (const d of detalles) {
      const pid = d.productoId || 'sin-producto';
      const current = productoMap.get(pid) || {
        productoId: pid,
        nombre: d.producto?.nombre ?? d.productoId ?? 'Producto eliminado',
        codigo: d.producto?.codigoEmpresa ?? '',
        cantidad: 0,
        costoTotal: 0,
        count: 0,
      };
      current.cantidad += d.cantidad;
      current.costoTotal += Number(d.total);
      current.count += 1;
      productoMap.set(pid, current);
    }

    const sorted = Array.from(productoMap.values())
      .sort((a, b) => b.costoTotal - a.costoTotal)
      .slice(0, limit);

    return sorted.map((p) => ({
      productoId: p.productoId,
      nombre: p.nombre,
      codigo: p.codigo,
      cantidad: p.cantidad,
      costoTotal: Math.round(p.costoTotal * 100) / 100,
      precioPromedio: p.cantidad > 0
        ? Math.round((p.costoTotal / p.cantidad) * 100) / 100
        : 0,
    }));
  }

  async getTopProveedores(empresaId: string, query: CompraAnalyticsQueryDto, limit: number = 10) {
    const where = this.buildCompraWhere(empresaId, query);

    const compras = await this.prisma.compra.findMany({
      where,
      select: {
        proveedorId: true,
        nombreProveedor: true,
        total: true,
      },
    });

    const proveedorMap = new Map<string, {
      proveedorId: string;
      nombre: string;
      totalCompras: number;
      montoTotal: number;
    }>();

    for (const c of compras) {
      const pid = c.proveedorId || 'sin-proveedor';
      const current = proveedorMap.get(pid) || {
        proveedorId: pid,
        nombre: c.nombreProveedor || 'Proveedor desconocido',
        totalCompras: 0,
        montoTotal: 0,
      };
      current.totalCompras += 1;
      current.montoTotal += Number(c.total);
      proveedorMap.set(pid, current);
    }

    return Array.from(proveedorMap.values())
      .sort((a, b) => b.montoTotal - a.montoTotal)
      .slice(0, limit)
      .map((p) => ({
        ...p,
        montoTotal: Math.round(p.montoTotal * 100) / 100,
      }));
  }

  async getHistorialPrecios(empresaId: string, productoId: string, sedeId?: string) {
    const [lotePrecios, historialPrecios] = await Promise.all([
      this.prisma.lote.findMany({
        where: {
          empresaId,
          productoId,
          ...(sedeId ? { sedeId } : {}),
        },
        select: {
          precioCosto: true,
          fechaIngreso: true,
          nombreProveedor: true,
        },
        orderBy: { fechaIngreso: 'asc' },
        take: 50,
      }),
      this.prisma.productoPrecioHistorialSede.findMany({
        where: {
          productoStock: {
            empresaId,
            productoId,
            ...(sedeId ? { sedeId } : {}),
          },
          precioCostoNuevo: { not: null },
        },
        select: {
          precioCostoNuevo: true,
          creadoEn: true,
        },
        orderBy: { creadoEn: 'asc' },
        take: 50,
      }),
    ]);

    const historial = [
      ...lotePrecios.map((l) => ({
        fecha: l.fechaIngreso,
        precio: Number(l.precioCosto),
        tipo: 'lote' as const,
        proveedor: l.nombreProveedor,
      })),
      ...historialPrecios.map((h) => ({
        fecha: h.creadoEn,
        precio: Number(h.precioCostoNuevo),
        tipo: 'historial' as const,
        proveedor: null,
      })),
    ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

    return historial;
  }

  async getComparativoCostos(empresaId: string, query: CompraAnalyticsQueryDto) {
    const ahora = new Date();
    const periodo = query.periodo || PeriodoAgrupacion.MENSUAL;

    let inicioActual: Date;
    let inicioAnterior: Date;
    let finAnterior: Date;

    switch (periodo) {
      case PeriodoAgrupacion.SEMANAL:
        inicioActual = new Date(ahora);
        inicioActual.setDate(ahora.getDate() - 7);
        finAnterior = new Date(inicioActual);
        inicioAnterior = new Date(finAnterior);
        inicioAnterior.setDate(finAnterior.getDate() - 7);
        break;
      case PeriodoAgrupacion.ANUAL:
        inicioActual = new Date(ahora.getFullYear(), 0, 1);
        finAnterior = new Date(inicioActual);
        inicioAnterior = new Date(ahora.getFullYear() - 1, 0, 1);
        break;
      case PeriodoAgrupacion.DIARIO:
        inicioActual = new Date(ahora);
        inicioActual.setHours(0, 0, 0, 0);
        finAnterior = new Date(inicioActual);
        inicioAnterior = new Date(finAnterior);
        inicioAnterior.setDate(finAnterior.getDate() - 1);
        break;
      default: // MENSUAL
        inicioActual = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
        finAnterior = new Date(inicioActual);
        inicioAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
        break;
    }

    const baseWhere: Prisma.CompraWhereInput = {
      empresaId,
      estado: EstadoCompra.CONFIRMADA,
      ...(query.sedeId ? { sedeId: query.sedeId } : {}),
    };

    const [actual, anterior] = await Promise.all([
      this.prisma.compra.aggregate({
        where: {
          ...baseWhere,
          confirmadoEn: { gte: inicioActual, lte: ahora },
        },
        _sum: { total: true },
        _count: { id: true },
      }),
      this.prisma.compra.aggregate({
        where: {
          ...baseWhere,
          confirmadoEn: { gte: inicioAnterior, lt: finAnterior },
        },
        _sum: { total: true },
        _count: { id: true },
      }),
    ]);

    const totalActual = Number(actual._sum.total ?? 0);
    const totalAnterior = Number(anterior._sum.total ?? 0);
    const diferencia = totalActual - totalAnterior;
    const porcentajeCambio = totalAnterior > 0
      ? Math.round(((diferencia / totalAnterior) * 100) * 100) / 100
      : totalActual > 0 ? 100 : 0;

    return {
      periodoActual: {
        inicio: inicioActual,
        fin: ahora,
        total: Math.round(totalActual * 100) / 100,
        cantidad: actual._count.id,
      },
      periodoAnterior: {
        inicio: inicioAnterior,
        fin: finAnterior,
        total: Math.round(totalAnterior * 100) / 100,
        cantidad: anterior._count.id,
      },
      diferencia: Math.round(diferencia * 100) / 100,
      porcentajeCambio,
    };
  }

  async getAlertasCompras(empresaId: string, sedeId?: string) {
    const sedeFilter = sedeId ? { sedeId } : {};

    const [ocPendientes, lotesProximosVencer, sinComprasRecientes] = await Promise.all([
      this.prisma.ordenCompra.findMany({
        where: {
          empresaId,
          ...sedeFilter,
          estado: { in: [EstadoOrdenCompra.PENDIENTE, EstadoOrdenCompra.APROBADA] },
        },
        select: {
          id: true,
          codigo: true,
          nombreProveedor: true,
          estado: true,
          fechaEntregaEsperada: true,
        },
        orderBy: { creadoEn: 'desc' },
        take: 20,
      }),
      (() => {
        const fechaLimite = new Date();
        fechaLimite.setDate(fechaLimite.getDate() + 30);
        return this.prisma.lote.findMany({
          where: {
            empresaId,
            ...sedeFilter,
            estado: EstadoLote.ACTIVO,
            fechaVencimiento: { not: null, lte: fechaLimite },
            cantidadActual: { gt: 0 },
          },
          select: {
            id: true,
            codigo: true,
            fechaVencimiento: true,
            cantidadActual: true,
            productoStock: {
              select: {
                producto: { select: { nombre: true } },
              },
            },
          },
          orderBy: { fechaVencimiento: 'asc' },
          take: 20,
        });
      })(),
      this.prisma.$queryRaw<Array<{ proveedorId: string }>>`
        SELECT "proveedorId"
        FROM "Compra"
        WHERE "empresaId" = ${empresaId}
          AND "estado" = 'CONFIRMADA'
          ${sedeId ? Prisma.sql`AND "sedeId" = ${sedeId}` : Prisma.empty}
        GROUP BY "proveedorId"
        HAVING MAX("confirmadoEn") < ${new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)}
      `,
    ]);

    const alertas: Array<{ tipo: string; mensaje: string; datos: any }> = [];

    // OC pendientes de aprobacion
    for (const oc of ocPendientes) {
      if (oc.estado === EstadoOrdenCompra.PENDIENTE) {
        alertas.push({
          tipo: 'oc_pendiente',
          mensaje: `OC ${oc.codigo} pendiente de aprobacion - ${oc.nombreProveedor}`,
          datos: { id: oc.id, codigo: oc.codigo },
        });
      }
    }

    // OC con entrega vencida
    const ahora = new Date();
    for (const oc of ocPendientes) {
      if (oc.fechaEntregaEsperada && oc.fechaEntregaEsperada < ahora) {
        alertas.push({
          tipo: 'entrega_vencida',
          mensaje: `OC ${oc.codigo} con entrega vencida desde ${oc.fechaEntregaEsperada.toISOString().split('T')[0]}`,
          datos: { id: oc.id, codigo: oc.codigo, fechaEntrega: oc.fechaEntregaEsperada },
        });
      }
    }

    // Lotes proximos a vencer
    for (const lote of lotesProximosVencer) {
      alertas.push({
        tipo: 'lote_por_vencer',
        mensaje: `Lote ${lote.codigo} de ${lote.productoStock?.producto?.nombre ?? 'producto'} vence ${lote.fechaVencimiento!.toISOString().split('T')[0]}`,
        datos: { id: lote.id, codigo: lote.codigo, cantidadActual: lote.cantidadActual },
      });
    }

    // Proveedores sin compras recientes
    if (sinComprasRecientes.length > 0) {
      alertas.push({
        tipo: 'sin_compras_recientes',
        mensaje: `${sinComprasRecientes.length} proveedor(es) sin compras en los ultimos 90 dias`,
        datos: { cantidad: sinComprasRecientes.length },
      });
    }

    return alertas;
  }

  private getPeriodoKey(fecha: Date, periodo: PeriodoAgrupacion): string {
    switch (periodo) {
      case PeriodoAgrupacion.DIARIO:
        return fecha.toISOString().split('T')[0];
      case PeriodoAgrupacion.SEMANAL: {
        const startOfWeek = new Date(fecha);
        startOfWeek.setDate(fecha.getDate() - fecha.getDay());
        return startOfWeek.toISOString().split('T')[0];
      }
      case PeriodoAgrupacion.MENSUAL:
        return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
      case PeriodoAgrupacion.ANUAL:
        return `${fecha.getFullYear()}`;
    }
  }
}
