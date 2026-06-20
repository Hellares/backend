import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TipoMovimientoCaja, OrigenAjusteBanco } from '@prisma/client';

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

    // El saldo NO se pisa desde el form de edición: lo maneja el sistema
    // (cobros/pagos) y la edición manual va por conciliar()/ajustar().
    const { saldoActual, ...resto } = data ?? {};
    void saldoActual;

    return this.prisma.empresaBanco.update({
      where: { id },
      data: resto,
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

  /**
   * Fijar el saldo (compat). Ahora NO pisa en silencio: delega en conciliar()
   * para que el delta quede asentado como ajuste de conciliación.
   */
  async actualizarSaldo(empresaId: string, id: string, saldo: number, usuarioId?: string) {
    return this.conciliar(empresaId, id, usuarioId ?? null, saldo);
  }

  /**
   * Conciliar: el usuario fija el saldo REAL del extracto bancario. Se asienta
   * el delta (diferencia con el saldo del sistema) como ajuste CONCILIACION y
   * se actualiza el saldo. Evita el "doble conteo": el cambio queda registrado.
   */
  async conciliar(
    empresaId: string,
    id: string,
    usuarioId: string | null,
    saldoReal: number,
    motivo?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const cuenta = await tx.empresaBanco.findFirst({
        where: { id, empresaId },
        select: { id: true, saldoActual: true },
      });
      if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

      const anterior = cuenta.saldoActual != null ? Number(cuenta.saldoActual) : 0;
      const delta = Math.round((saldoReal - anterior) * 100) / 100;

      const actualizada = await tx.empresaBanco.update({
        where: { id },
        data: { saldoActual: saldoReal },
      });

      if (Math.abs(delta) >= 0.01) {
        await tx.ajusteBanco.create({
          data: {
            empresaId,
            bancoId: id,
            tipo: delta >= 0 ? TipoMovimientoCaja.INGRESO : TipoMovimientoCaja.EGRESO,
            monto: Math.abs(delta),
            motivo: motivo?.trim() || 'Conciliación con extracto',
            origen: OrigenAjusteBanco.CONCILIACION,
            saldoAnterior: anterior,
            saldoNuevo: saldoReal,
            usuarioId,
          },
        });
      }
      return actualizada;
    });
  }

  /** Ajuste manual +/- con motivo (comisión, interés, corrección). */
  async ajustar(
    empresaId: string,
    id: string,
    usuarioId: string | null,
    data: { tipo: 'INGRESO' | 'EGRESO'; monto: number; motivo: string },
  ) {
    if (!data.monto || data.monto <= 0) {
      throw new BadRequestException('El monto del ajuste debe ser mayor a 0');
    }
    if (!data.motivo?.trim()) {
      throw new BadRequestException('El motivo del ajuste es obligatorio');
    }
    return this.prisma.$transaction(async (tx) => {
      const cuenta = await tx.empresaBanco.findFirst({
        where: { id, empresaId },
        select: { id: true, saldoActual: true },
      });
      if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

      const anterior = cuenta.saldoActual != null ? Number(cuenta.saldoActual) : 0;
      const delta = data.tipo === 'INGRESO' ? data.monto : -data.monto;
      const nuevo = Math.round((anterior + delta) * 100) / 100;

      const actualizada = await tx.empresaBanco.update({
        where: { id },
        data: { saldoActual: nuevo },
      });
      await tx.ajusteBanco.create({
        data: {
          empresaId,
          bancoId: id,
          tipo: data.tipo as TipoMovimientoCaja,
          monto: data.monto,
          motivo: data.motivo.trim(),
          origen: OrigenAjusteBanco.AJUSTE_MANUAL,
          saldoAnterior: anterior,
          saldoNuevo: nuevo,
          usuarioId,
        },
      });
      return actualizada;
    });
  }

  /** Historial de ajustes/conciliaciones de una cuenta. */
  async getAjustes(empresaId: string, id: string) {
    const cuenta = await this.prisma.empresaBanco.findFirst({
      where: { id, empresaId },
      select: { id: true },
    });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');
    return this.prisma.ajusteBanco.findMany({
      where: { empresaId, bancoId: id },
      orderBy: { creadoEn: 'desc' },
      take: 100,
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
