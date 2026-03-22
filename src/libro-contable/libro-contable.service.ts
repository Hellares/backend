import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AsientoContable {
  fecha: Date;
  tipo: 'INGRESO' | 'EGRESO';
  categoria: string;
  descripcion: string;
  monto: number;
  referencia: string | null;
  saldoAcumulado: number;
}

@Injectable()
export class LibroContableService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Obtiene el libro contable (todos los movimientos financieros) de un mes/anio
   */
  async getLibro(empresaId: string, mes: number, anio: number) {
    const fechaInicio = new Date(anio, mes - 1, 1);
    const fechaFin = new Date(anio, mes, 0, 23, 59, 59, 999);

    const [ventas, compras, movimientosCaja, pagosPrestamo] = await Promise.all([
      this._getVentas(empresaId, fechaInicio, fechaFin),
      this._getCompras(empresaId, fechaInicio, fechaFin),
      this._getMovimientosCaja(empresaId, fechaInicio, fechaFin),
      this._getPagosPrestamo(empresaId, fechaInicio, fechaFin),
    ]);

    // Unificar en lista de asientos
    const asientos: AsientoContable[] = [
      ...ventas,
      ...compras,
      ...movimientosCaja,
      ...pagosPrestamo,
    ];

    // Ordenar cronologicamente
    asientos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

    // Calcular saldo acumulado
    let saldoAcumulado = 0;
    for (const asiento of asientos) {
      if (asiento.tipo === 'INGRESO') {
        saldoAcumulado += asiento.monto;
      } else {
        saldoAcumulado -= asiento.monto;
      }
      asiento.saldoAcumulado = Math.round(saldoAcumulado * 100) / 100;
    }

    const totalIngresos = asientos
      .filter((a) => a.tipo === 'INGRESO')
      .reduce((sum, a) => sum + a.monto, 0);

    const totalEgresos = asientos
      .filter((a) => a.tipo === 'EGRESO')
      .reduce((sum, a) => sum + a.monto, 0);

    return {
      periodo: { mes, anio },
      asientos,
      resumen: {
        totalIngresos: Math.round(totalIngresos * 100) / 100,
        totalEgresos: Math.round(totalEgresos * 100) / 100,
        saldo: Math.round((totalIngresos - totalEgresos) * 100) / 100,
      },
    };
  }

  private async _getVentas(
    empresaId: string,
    desde: Date,
    hasta: Date,
  ): Promise<AsientoContable[]> {
    const ventas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        fechaVenta: { gte: desde, lte: hasta },
        estado: { not: 'ANULADA' },
      },
      select: {
        id: true,
        codigo: true,
        total: true,
        fechaVenta: true,
        nombreCliente: true,
      },
      orderBy: { fechaVenta: 'asc' },
    });

    return ventas.map((v) => ({
      fecha: v.fechaVenta,
      tipo: 'INGRESO' as const,
      categoria: 'VENTA',
      descripcion: `Venta ${v.codigo} - ${v.nombreCliente}`,
      monto: Number(v.total),
      referencia: v.codigo,
      saldoAcumulado: 0,
    }));
  }

  private async _getCompras(
    empresaId: string,
    desde: Date,
    hasta: Date,
  ): Promise<AsientoContable[]> {
    const compras = await this.prisma.compra.findMany({
      where: {
        empresaId,
        fechaRecepcion: { gte: desde, lte: hasta },
        estado: 'CONFIRMADA',
      },
      select: {
        id: true,
        codigo: true,
        total: true,
        fechaRecepcion: true,
        nombreProveedor: true,
      },
      orderBy: { fechaRecepcion: 'asc' },
    });

    return compras.map((c) => ({
      fecha: c.fechaRecepcion,
      tipo: 'EGRESO' as const,
      categoria: 'COMPRA',
      descripcion: `Compra ${c.codigo} - ${c.nombreProveedor}`,
      monto: Number(c.total),
      referencia: c.codigo,
      saldoAcumulado: 0,
    }));
  }

  /**
   * Etiquetas legibles para categorías de movimientos de caja
   */
  private static readonly CATEGORIA_LABELS: Record<string, string> = {
    DEPOSITO_AGENTE: 'Depósito Agente Bancario',
    RETIRO_AGENTE: 'Retiro Agente Bancario',
    COMISION_AGENTE: 'Comisión Agente Bancario',
    GASTO_OPERATIVO: 'Gasto Operativo',
    ADELANTO_SERVICIO: 'Adelanto de Servicio',
    OTRO_INGRESO: 'Otro Ingreso',
    OTRO_EGRESO: 'Otro Egreso',
    DEVOLUCION: 'Devolución',
  };

  /**
   * Obtiene movimientos de caja que NO son VENTA ni COMPRA (esos ya se cuentan
   * directamente desde sus tablas respectivas para evitar doble conteo).
   * Incluye: devoluciones, pedidos marketplace, pagos proveedor, gastos operativos,
   * adelantos de servicio, otros ingresos/egresos, movimientos manuales y agente bancario.
   */
  private async _getMovimientosCaja(
    empresaId: string,
    desde: Date,
    hasta: Date,
  ): Promise<AsientoContable[]> {
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        fechaMovimiento: { gte: desde, lte: hasta },
        // Excluir VENTA y COMPRA para evitar doble conteo con _getVentas/_getCompras
        categoria: { notIn: ['VENTA', 'COMPRA'] },
      },
      select: {
        id: true,
        tipo: true,
        categoria: true,
        monto: true,
        descripcion: true,
        fechaMovimiento: true,
        esManual: true,
      },
      orderBy: { fechaMovimiento: 'asc' },
    });

    return movimientos.map((m) => {
      const label = LibroContableService.CATEGORIA_LABELS[m.categoria] ?? m.categoria;
      return {
        fecha: m.fechaMovimiento,
        tipo: m.tipo as 'INGRESO' | 'EGRESO',
        categoria: `CAJA_${m.categoria}`,
        descripcion: m.descripcion ?? `${m.esManual ? 'Manual' : 'Automático'} - ${label}`,
        monto: Number(m.monto),
        referencia: m.id,
        saldoAcumulado: 0,
      };
    });
  }

  private async _getPagosPrestamo(
    empresaId: string,
    desde: Date,
    hasta: Date,
  ): Promise<AsientoContable[]> {
    const pagos = await this.prisma.pagoPrestamo.findMany({
      where: {
        fechaPago: { gte: desde, lte: hasta },
        prestamo: { empresaId },
      },
      include: {
        prestamo: {
          select: { entidadPrestamo: true, tipo: true },
        },
      },
      orderBy: { fechaPago: 'asc' },
    });

    return pagos.map((p) => ({
      fecha: p.fechaPago,
      tipo: 'EGRESO' as const,
      categoria: 'PAGO_PRESTAMO',
      descripcion: `Pago prestamo ${p.prestamo.tipo} - ${p.prestamo.entidadPrestamo}`,
      monto: Number(p.monto),
      referencia: p.referencia,
      saldoAcumulado: 0,
    }));
  }
}
