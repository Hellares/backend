import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmpresaBancoService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(empresaId: string) {
    return this.prisma.empresaBanco.findMany({
      where: { empresaId, isActive: true },
      orderBy: [{ esPrincipal: 'desc' }, { creadoEn: 'asc' }],
    });
  }

  async crear(empresaId: string, data: {
    nombreBanco: string;
    tipoCuenta: string;
    numeroCuenta: string;
    cci?: string;
    moneda?: string;
    titular?: string;
    esPrincipal?: boolean;
    saldoActual?: number;
  }) {
    // Si es principal, quitar principal de las demás
    if (data.esPrincipal) {
      await this.prisma.empresaBanco.updateMany({
        where: { empresaId, esPrincipal: true },
        data: { esPrincipal: false },
      });
    }

    return this.prisma.empresaBanco.create({
      data: {
        empresaId,
        nombreBanco: data.nombreBanco,
        tipoCuenta: data.tipoCuenta as any,
        numeroCuenta: data.numeroCuenta,
        cci: data.cci,
        moneda: data.moneda ?? 'PEN',
        titular: data.titular,
        esPrincipal: data.esPrincipal ?? false,
        saldoActual: data.saldoActual,
      },
    });
  }

  async actualizar(empresaId: string, id: string, data: any) {
    const cuenta = await this.prisma.empresaBanco.findFirst({
      where: { id, empresaId },
    });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

    if (data.esPrincipal) {
      await this.prisma.empresaBanco.updateMany({
        where: { empresaId, esPrincipal: true, id: { not: id } },
        data: { esPrincipal: false },
      });
    }

    return this.prisma.empresaBanco.update({
      where: { id },
      data,
    });
  }

  async eliminar(empresaId: string, id: string) {
    const cuenta = await this.prisma.empresaBanco.findFirst({
      where: { id, empresaId },
    });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

    await this.prisma.empresaBanco.update({
      where: { id },
      data: { isActive: false },
    });

    return { message: 'Cuenta eliminada' };
  }

  async marcarPrincipal(empresaId: string, id: string) {
    const cuenta = await this.prisma.empresaBanco.findFirst({
      where: { id, empresaId },
    });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

    await this.prisma.empresaBanco.updateMany({
      where: { empresaId, esPrincipal: true },
      data: { esPrincipal: false },
    });

    return this.prisma.empresaBanco.update({
      where: { id },
      data: { esPrincipal: true },
    });
  }

  async actualizarSaldo(empresaId: string, id: string, saldo: number) {
    const cuenta = await this.prisma.empresaBanco.findFirst({
      where: { id, empresaId },
    });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

    return this.prisma.empresaBanco.update({
      where: { id },
      data: { saldoActual: saldo },
    });
  }

  /**
   * Conciliación: comparar movimientos de caja con saldo bancario
   */
  async getConciliacion(empresaId: string, cuentaId: string, fechaDesde?: string, fechaHasta?: string) {
    const cuenta = await this.prisma.empresaBanco.findFirst({
      where: { id: cuentaId, empresaId },
    });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

    const desde = fechaDesde ? new Date(fechaDesde) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const hasta = fechaHasta ? new Date(fechaHasta) : new Date();

    // Método de pago asociado al banco (TRANSFERENCIA para bancos)
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        empresaId,
        anulado: false,
        metodoPago: 'TRANSFERENCIA',
        fechaMovimiento: { gte: desde, lte: hasta },
      },
      select: { id: true, tipo: true, monto: true, descripcion: true, fechaMovimiento: true, esManual: true },
      orderBy: { fechaMovimiento: 'desc' },
    });

    const totalIngresos = movimientos.filter((m) => m.tipo === 'INGRESO').reduce((s, m) => s + Number(m.monto), 0);
    const totalEgresos = movimientos.filter((m) => m.tipo === 'EGRESO').reduce((s, m) => s + Number(m.monto), 0);
    const saldoSistema = totalIngresos - totalEgresos;
    const saldoBanco = cuenta.saldoActual ? Number(cuenta.saldoActual) : 0;
    const diferencia = saldoBanco - saldoSistema;

    return {
      cuenta: {
        id: cuenta.id,
        nombreBanco: cuenta.nombreBanco,
        numeroCuenta: cuenta.numeroCuenta,
        moneda: cuenta.moneda,
        saldoActual: saldoBanco,
      },
      periodo: { desde, hasta },
      movimientosSistema: {
        cantidad: movimientos.length,
        totalIngresos: Math.round(totalIngresos * 100) / 100,
        totalEgresos: Math.round(totalEgresos * 100) / 100,
        saldoSistema: Math.round(saldoSistema * 100) / 100,
      },
      conciliacion: {
        saldoBanco,
        saldoSistema: Math.round(saldoSistema * 100) / 100,
        diferencia: Math.round(diferencia * 100) / 100,
        conciliado: Math.abs(diferencia) < 0.01,
      },
      movimientos: movimientos.map((m) => ({
        ...m,
        monto: Number(m.monto),
      })),
    };
  }
}
