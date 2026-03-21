import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class CuentasPorCobrarService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Listar cuentas por cobrar (ventas a crédito con saldo pendiente)
   */
  async listar(
    empresaId: string,
    filtros?: {
      estado?: 'PENDIENTE' | 'VENCIDA' | 'PAGADA';
      clienteId?: string;
      sedeId?: string;
      search?: string;
    },
  ) {
    const where: Prisma.VentaWhereInput = {
      empresaId,
      esCredito: true,
      estado: { not: 'ANULADA' },
    };

    if (filtros?.clienteId) where.clienteId = filtros.clienteId;
    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreCliente: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const ventas = await this.prisma.venta.findMany({
      where,
      include: {
        pagos: { select: { id: true, monto: true, metodoPago: true, fechaPago: true } },
        cuotas: {
          orderBy: { numero: 'asc' },
          select: {
            id: true, numero: true, monto: true, montoPagado: true,
            saldoPendiente: true, fechaVencimiento: true, estado: true,
          },
        },
        sede: { select: { id: true, nombre: true } },
        cliente: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true, telefono: true } },
          },
        },
      },
      orderBy: { fechaVencimientoPago: 'asc' },
    });

    const now = new Date();

    const cuentas = ventas.map((v) => {
      const totalVenta = Number(v.total);
      const totalPagado = v.pagos.reduce((sum, p) => sum + Number(p.monto), 0);
      const saldoPendiente = Math.round((totalVenta - totalPagado) * 100) / 100;
      const proximaCuota = v.cuotas?.find((c: any) =>
        c.estado === 'PENDIENTE' || c.estado === 'PAGADA_PARCIAL' || c.estado === 'VENCIDA'
      );
      const fechaVencimientoEfectiva = proximaCuota?.fechaVencimiento ?? v.fechaVencimientoPago;
      const estaVencida = fechaVencimientoEfectiva ? fechaVencimientoEfectiva < now : false;
      const estaPagada = saldoPendiente <= 0;

      const diasVencimiento = fechaVencimientoEfectiva
        ? Math.ceil((fechaVencimientoEfectiva.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        ventaId: v.id,
        codigo: v.codigo,
        nombreCliente: v.nombreCliente,
        documentoCliente: v.documentoCliente,
        telefonoCliente: v.telefonoCliente ?? v.cliente?.persona?.telefono,
        sedeNombre: v.sede?.nombre,
        moneda: v.moneda,
        totalVenta,
        totalPagado: Math.round(totalPagado * 100) / 100,
        saldoPendiente,
        plazoCredito: v.plazoCredito,
        fechaVenta: v.fechaVenta,
        fechaVencimiento: fechaVencimientoEfectiva,
        diasVencimiento,
        estado: estaPagada ? 'PAGADA' : estaVencida ? 'VENCIDA' : 'PENDIENTE',
        pagos: v.pagos,
        numeroCuotas: v.numeroCuotas,
        cuotas: v.cuotas?.map(c => ({
          ...c,
          monto: Number(c.monto),
          montoPagado: Number(c.montoPagado),
          saldoPendiente: Number(c.saldoPendiente),
        })),
        proximaCuota: (() => {
          const proxima = v.cuotas?.find((c: any) =>
            c.estado === 'PENDIENTE' || c.estado === 'PAGADA_PARCIAL' || c.estado === 'VENCIDA'
          );
          return proxima ? {
            id: proxima.id,
            numero: proxima.numero,
            monto: Number(proxima.monto),
            saldoPendiente: Number(proxima.saldoPendiente),
            fechaVencimiento: proxima.fechaVencimiento,
            estado: proxima.estado,
          } : null;
        })(),
      };
    });

    // Filtrar por estado si se especificó
    if (filtros?.estado) {
      return cuentas.filter((c) => c.estado === filtros.estado);
    }

    return cuentas;
  }

  /**
   * Resumen de cuentas por cobrar
   */
  async getResumen(empresaId: string) {
    const cuentas = await this.listar(empresaId);

    const pendientes = cuentas.filter((c) => c.estado === 'PENDIENTE');
    const vencidas = cuentas.filter((c) => c.estado === 'VENCIDA');
    const pagadas = cuentas.filter((c) => c.estado === 'PAGADA');

    return {
      totalPendiente: Math.round(pendientes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100,
      totalVencido: Math.round(vencidas.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100,
      cantidadPendientes: pendientes.length,
      cantidadVencidas: vencidas.length,
      cantidadPagadas: pagadas.length,
      totalCuentas: cuentas.length,
      // Top 5 clientes con más deuda
      topDeudores: this._topDeudores(cuentas),
      // Próximas a vencer (7 días)
      proximasVencer: cuentas
        .filter((c) => c.estado === 'PENDIENTE' && c.diasVencimiento !== null && c.diasVencimiento <= 7 && c.diasVencimiento >= 0)
        .slice(0, 5),
    };
  }

  /**
   * Detalle de una cuenta (venta + pagos)
   */
  async getDetalle(empresaId: string, ventaId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId, esCredito: true },
      include: {
        pagos: { orderBy: { fechaPago: 'desc' } },
        detalles: {
          select: {
            id: true,
            descripcion: true,
            cantidad: true,
            precioUnitario: true,
            total: true,
          },
        },
        sede: { select: { nombre: true } },
        cliente: {
          select: {
            persona: { select: { nombres: true, apellidos: true, telefono: true, dni: true } },
          },
        },
      },
    });

    if (!venta) return null;

    const totalPagado = venta.pagos.reduce((sum, p) => sum + Number(p.monto), 0);

    return {
      ...venta,
      total: Number(venta.total),
      subtotal: Number(venta.subtotal),
      totalPagado: Math.round(totalPagado * 100) / 100,
      saldoPendiente: Math.round((Number(venta.total) - totalPagado) * 100) / 100,
    };
  }

  private _topDeudores(cuentas: any[]) {
    const deudaPorCliente = new Map<string, { nombre: string; total: number; cantidad: number }>();

    for (const c of cuentas) {
      if (c.estado === 'PAGADA') continue;
      const key = c.nombreCliente;
      if (!deudaPorCliente.has(key)) {
        deudaPorCliente.set(key, { nombre: key, total: 0, cantidad: 0 });
      }
      const d = deudaPorCliente.get(key)!;
      d.total += c.saldoPendiente;
      d.cantidad++;
    }

    return Array.from(deudaPorCliente.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((d) => ({ ...d, total: Math.round(d.total * 100) / 100 }));
  }
}
