import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoMetaFinanciera } from '@prisma/client';

@Injectable()
export class MetaFinancieraService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(empresaId: string) {
    return this.prisma.metaFinanciera.findMany({
      where: { empresaId, isActive: true },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async crear(
    empresaId: string,
    data: {
      tipo: string;
      nombre: string;
      montoMeta: number;
      moneda?: string;
      fechaInicio: string;
      fechaFin: string;
    },
  ) {
    return this.prisma.metaFinanciera.create({
      data: {
        empresaId,
        tipo: data.tipo as TipoMetaFinanciera,
        nombre: data.nombre,
        montoMeta: data.montoMeta,
        moneda: data.moneda ?? 'PEN',
        fechaInicio: new Date(data.fechaInicio),
        fechaFin: new Date(data.fechaFin),
      },
    });
  }

  async getProgreso(empresaId: string, metaId: string) {
    const meta = await this.prisma.metaFinanciera.findFirst({
      where: { id: metaId, empresaId },
    });

    if (!meta) {
      throw new NotFoundException('Meta financiera no encontrada');
    }

    const desde = meta.fechaInicio;
    const hasta = meta.fechaFin;
    let actual = 0;

    switch (meta.tipo) {
      case 'VENTAS':
        actual = await this._calcularVentas(empresaId, desde, hasta);
        break;
      case 'INGRESOS':
        actual = await this._calcularIngresos(empresaId, desde, hasta);
        break;
      case 'AHORRO':
        actual = await this._calcularAhorro(empresaId, desde, hasta);
        break;
      case 'REDUCCION_GASTOS':
        actual = await this._calcularEgresos(empresaId, desde, hasta);
        break;
    }

    const montoMeta = Number(meta.montoMeta);
    let porcentaje: number;

    if (meta.tipo === 'REDUCCION_GASTOS') {
      // Para reduccion de gastos, menor es mejor
      // Si la meta es gastar maximo X, el porcentaje es cuanto hemos consumido
      porcentaje = montoMeta > 0 ? Math.round(((montoMeta - actual) / montoMeta) * 100) : 0;
    } else {
      porcentaje = montoMeta > 0 ? Math.round((actual / montoMeta) * 100) : 0;
    }

    return {
      meta: {
        id: meta.id,
        tipo: meta.tipo,
        nombre: meta.nombre,
        montoMeta,
        moneda: meta.moneda,
        fechaInicio: meta.fechaInicio,
        fechaFin: meta.fechaFin,
      },
      actual: Math.round(actual * 100) / 100,
      porcentaje: Math.min(porcentaje, 100),
      diferencia: Math.round((montoMeta - actual) * 100) / 100,
    };
  }

  async getResumen(empresaId: string) {
    const metas = await this.prisma.metaFinanciera.findMany({
      where: { empresaId, isActive: true },
      orderBy: { fechaFin: 'asc' },
    });

    const resultados = await Promise.all(
      metas.map((meta) => this.getProgreso(empresaId, meta.id)),
    );

    return resultados;
  }

  private async _calcularVentas(empresaId: string, desde: Date, hasta: Date): Promise<number> {
    const ventas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        fechaVenta: { gte: desde, lte: hasta },
        estado: { not: 'ANULADA' },
      },
      select: { total: true },
    });

    return ventas.reduce((sum, v) => sum + Number(v.total), 0);
  }

  private async _calcularIngresos(empresaId: string, desde: Date, hasta: Date): Promise<number> {
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        tipo: 'INGRESO',
        fechaMovimiento: { gte: desde, lte: hasta },
      },
      select: { monto: true },
    });

    return movimientos.reduce((sum, m) => sum + Number(m.monto), 0);
  }

  private async _calcularAhorro(empresaId: string, _desde: Date, _hasta: Date): Promise<number> {
    // Ahorro = saldo bancario actual (incremento en el periodo)
    const cuentas = await this.prisma.empresaBanco.findMany({
      where: { empresaId, isActive: true },
      select: { saldoActual: true },
    });

    return cuentas.reduce((sum, c) => sum + (c.saldoActual ? Number(c.saldoActual) : 0), 0);
  }

  private async _calcularEgresos(empresaId: string, desde: Date, hasta: Date): Promise<number> {
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        tipo: 'EGRESO',
        fechaMovimiento: { gte: desde, lte: hasta },
      },
      select: { monto: true },
    });

    return movimientos.reduce((sum, m) => sum + Number(m.monto), 0);
  }
}
