import { Injectable } from '@nestjs/common';
import { EstadoVenta, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
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
    if (query.fechaInicio) filter.gte = new Date(query.fechaInicio);
    if (query.fechaFin) filter.lte = new Date(query.fechaFin);
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

    const dateFilter = this.buildDateFilter(query);
    if (dateFilter) where.fechaVenta = dateFilter;

    return where;
  }

  private getPeriodoKey(fecha: Date, periodo?: PeriodoAgrupacion): string {
    const d = new Date(fecha);
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

    const [aggregate, ventasBorrador, ventasPagadasCompleta] = await Promise.all([
      this.prisma.venta.aggregate({
        where,
        _count: { id: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.venta.count({ where: whereBorrador }),
      this.prisma.venta.count({ where: wherePagada }),
    ]);

    const totalVentas = aggregate._count.id;
    const montoTotal = aggregate._sum.total?.toNumber() ?? 0;
    const promedioPorVenta = aggregate._avg.total?.toNumber() ?? 0;

    return {
      totalVentas,
      montoTotal,
      promedioPorVenta,
      ventasBorrador,
      ventasPagadasCompleta,
      ticketPromedio: totalVentas > 0 ? montoTotal / totalVentas : 0,
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
      total: Math.round(data.total * 100) / 100,
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
      },
      select: {
        productoId: true,
        cantidad: true,
        total: true,
        precioUnitario: true,
        producto: {
          select: {
            nombre: true,
            codigoEmpresa: true,
          },
        },
      },
    });

    const agrupado = new Map<
      string,
      {
        productoId: string;
        nombre: string;
        codigo: string;
        cantidadVendida: number;
        ingresoTotal: number;
        sumaPrecio: number;
        count: number;
      }
    >();

    for (const d of detalles) {
      if (!d.productoId) continue;
      const existing = agrupado.get(d.productoId) || {
        productoId: d.productoId,
        nombre: d.producto?.nombre ?? '',
        codigo: d.producto?.codigoEmpresa ?? '',
        cantidadVendida: 0,
        ingresoTotal: 0,
        sumaPrecio: 0,
        count: 0,
      };
      existing.cantidadVendida += d.cantidad.toNumber();
      existing.ingresoTotal += d.total.toNumber();
      existing.sumaPrecio += d.precioUnitario.toNumber();
      existing.count += 1;
      agrupado.set(d.productoId, existing);
    }

    return Array.from(agrupado.values())
      .map((p) => ({
        productoId: p.productoId,
        nombre: p.nombre,
        codigo: p.codigo,
        cantidadVendida: Math.round(p.cantidadVendida * 100) / 100,
        ingresoTotal: Math.round(p.ingresoTotal * 100) / 100,
        precioPromedio:
          p.count > 0
            ? Math.round((p.sumaPrecio / p.count) * 100) / 100
            : 0,
      }))
      .sort((a, b) => b.ingresoTotal - a.ingresoTotal)
      .slice(0, limit);
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

    for (const v of ventas) {
      const key = v.clienteId ?? v.nombreCliente;
      const existing = agrupado.get(key) || {
        clienteId: v.clienteId,
        nombre: v.nombreCliente,
        totalCompras: 0,
        montoTotal: 0,
      };
      existing.totalCompras += 1;
      existing.montoTotal += v.total.toNumber();
      agrupado.set(key, existing);
    }

    return Array.from(agrupado.values())
      .map((c) => ({
        clienteId: c.clienteId,
        nombre: c.nombre,
        totalCompras: c.totalCompras,
        montoTotal: Math.round(c.montoTotal * 100) / 100,
      }))
      .sort((a, b) => b.montoTotal - a.montoTotal)
      .slice(0, limit);
  }

  async getComparativoVentas(empresaId: string, query: VentaAnalyticsQueryDto) {
    this.logger.log('Obteniendo comparativo de ventas');

    const now = new Date();
    let fechaInicioActual: Date;
    let fechaFinActual: Date;
    let fechaInicioAnterior: Date;
    let fechaFinAnterior: Date;

    if (query.fechaInicio && query.fechaFin) {
      fechaInicioActual = new Date(query.fechaInicio);
      fechaFinActual = new Date(query.fechaFin);
      const diffMs = fechaFinActual.getTime() - fechaInicioActual.getTime();
      fechaFinAnterior = new Date(fechaInicioActual.getTime() - 1);
      fechaInicioAnterior = new Date(fechaFinAnterior.getTime() - diffMs);
    } else {
      // Default: mes actual vs mes anterior
      fechaInicioActual = new Date(now.getFullYear(), now.getMonth(), 1);
      fechaFinActual = now;
      fechaInicioAnterior = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      fechaFinAnterior = new Date(now.getFullYear(), now.getMonth(), 0);
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
        ? Math.round((diferencia / montoAnterior) * 10000) / 100
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
