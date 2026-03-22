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

  async getDashboardVendedor(empresaId: string, vendedorId: string, sedeId?: string) {
    this.logger.log(`Obteniendo dashboard del vendedor ${vendedorId}`);

    const now = new Date();
    const hoy = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const manana = new Date(hoy); manana.setDate(manana.getDate() + 1);

    // Start of week (Monday)
    const inicioSemana = new Date(hoy);
    const day = inicioSemana.getDay();
    const diff = inicioSemana.getDate() - day + (day === 0 ? -6 : 1);
    inicioSemana.setDate(diff);

    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

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
    const ticketPromedio = ventasMesCant > 0 ? Math.round((montoMes / ventasMesCant) * 100) / 100 : 0;

    // Cotizaciones
    const cotizBaseWhere: any = { empresaId, vendedorId };
    if (sedeId) cotizBaseWhere.sedeId = sedeId;

    const [cotizacionesTotal, cotizacionesConvertidas] = await Promise.all([
      this.prisma.cotizacion.count({ where: { ...cotizBaseWhere, creadoEn: { gte: inicioMes } } }),
      this.prisma.cotizacion.count({ where: { ...cotizBaseWhere, estado: 'CONVERTIDA', creadoEn: { gte: inicioMes } } }),
    ]);
    const tasaConversion = cotizacionesTotal > 0 ? Math.round((cotizacionesConvertidas / cotizacionesTotal) * 10000) / 100 : 0;

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
      SELECT DATE(v."fechaVenta") as fecha,
             COUNT(*)::int as cantidad,
             COALESCE(SUM(v.total), 0)::float as monto
      FROM "Venta" v
      WHERE v."empresaId" = ${empresaId}
      AND v."vendedorId" = ${vendedorId}
      AND v."estado" != 'ANULADA'
      AND v."fechaVenta" >= ${hace7Dias}
      ${sedeId ? Prisma.sql`AND v."sedeId" = ${sedeId}` : Prisma.empty}
      GROUP BY DATE(v."fechaVenta")
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
        ventasHoy: { cantidad: ventasHoyCant, monto: Math.round(montoHoy * 100) / 100 },
        ventasSemana: { cantidad: ventasSemanaCant, monto: Math.round(montoSemana * 100) / 100 },
        ventasMes: { cantidad: ventasMesCant, monto: Math.round(montoMes * 100) / 100 },
        ticketPromedio,
        cotizacionesTotal,
        cotizacionesConvertidas,
        tasaConversion,
      },
      creditos: {
        totalPendiente: Math.round(totalPendiente * 100) / 100,
        cantidadPendientes,
        totalVencido: Math.round(totalVencido * 100) / 100,
        cantidadVencidos,
      },
      metodosPago: Object.fromEntries(
        Object.entries(metodosPago).map(([k, v]) => [k, Math.round(v * 100) / 100])
      ),
      ventasPorDia: ventasPorDiaRaw.map(r => ({
        fecha: r.fecha,
        cantidad: r.cantidad,
        monto: Math.round(r.monto * 100) / 100,
      })),
      topProductos: topProductosRaw.map(r => ({
        nombre: r.nombre ?? 'Sin nombre',
        cantidad: r.cantidad,
        monto: Math.round(r.monto * 100) / 100,
      })),
      topClientes: topClientesRaw.map(r => ({
        nombre: r.nombre ?? 'Sin nombre',
        cantidadCompras: r.cantidadCompras,
        montoTotal: Math.round(r.montoTotal * 100) / 100,
      })),
      ranking: {
        posicion: posicion > 0 ? posicion : rankingRaw.length + 1,
        totalVendedores: rankingRaw.length,
        montoVendedor: Math.round(montoMes * 100) / 100,
        montoLider: Math.round(montoLider * 100) / 100,
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
