import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  TipoMovimientoCaja,
  OrigenAjusteBanco,
  FuenteEgreso,
  EstadoAdelanto,
  EstadoBoletaPago,
} from '@prisma/client';

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

  /**
   * Estado de cuenta REAL de un banco (conciliación por banco): los movimientos
   * que tocaron ESTA cuenta en el período — recaudación que entró (cobros
   * digitales del cierre/migración), pagos que salieron (proveedores y gastos)
   * y ajustes/conciliaciones — con su saldo del sistema. El usuario concilia
   * comparando `saldoActual` con su extracto (acción conciliar()).
   */
  async getEstadoCuenta(empresaId: string, id: string, fechaDesde?: string, fechaHasta?: string) {
    const cuenta = await this.prisma.empresaBanco.findFirst({ where: { id, empresaId } });
    if (!cuenta) throw new NotFoundException('Cuenta no encontrada');

    const now = new Date();
    const desde = fechaDesde ? new Date(fechaDesde) : new Date(now.getFullYear(), now.getMonth(), 1);
    // Si fechaHasta viene como fecha sin hora (YYYY-MM-DD), incluirla hasta el
    // FIN del día (si no, "2026-06-20" = medianoche excluye todo lo de hoy).
    const hasta = fechaHasta
      ? new Date(fechaHasta.includes('T') ? fechaHasta : `${fechaHasta}T23:59:59.999`)
      : now;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const empleadoNombreSelect = {
      empleado: {
        select: {
          usuario: {
            select: {
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      },
    };

    const [
      recaud,
      pagosCompra,
      pagosGasto,
      ajustes,
      pagosAdelanto,
      pagosBoleta,
      pagosVenta,
      recaudadoTotal,
    ] = await Promise.all([
      // Ingresos: cobros digitales que entraron al banco (barrido + migración).
      this.prisma.movimientoCaja.findMany({
        where: {
          empresaId,
          anulado: false,
          tipo: 'EGRESO',
          fechaMovimiento: { gte: desde, lte: hasta },
          metadata: { path: ['bancoId'], equals: id },
        },
        select: { metodoPago: true, monto: true, fechaMovimiento: true },
      }),
      // Egresos: pagos a proveedor desde este banco.
      this.prisma.pagoCompra.findMany({
        where: { bancoId: id, anulado: false, fechaPago: { gte: desde, lte: hasta } },
        select: { monto: true, fechaPago: true, compra: { select: { codigo: true, nombreProveedor: true } } },
      }),
      // Egresos: pagos de gastos recurrentes desde este banco.
      this.prisma.pagoGastoRecurrente.findMany({
        where: { bancoId: id, anulado: false, fechaPago: { gte: desde, lte: hasta } },
        select: { montoReal: true, fechaPago: true, gastoRecurrente: { select: { nombre: true } } },
      }),
      // Ajustes/conciliaciones del período.
      this.prisma.ajusteBanco.findMany({
        where: { empresaId, bancoId: id, creadoEn: { gte: desde, lte: hasta } },
        select: { tipo: true, monto: true, motivo: true, origen: true, creadoEn: true },
      }),
      // Egresos: adelantos de sueldo pagados desde este banco (RRHH).
      this.prisma.adelantoPago.findMany({
        where: {
          empresaId,
          bancoId: id,
          fuentePago: FuenteEgreso.BANCO,
          estado: EstadoAdelanto.PAGADO_ADELANTO,
          actualizadoEn: { gte: desde, lte: hasta },
        },
        select: { monto: true, actualizadoEn: true, ...empleadoNombreSelect },
      }),
      // Egresos: boletas de planilla pagadas desde este banco (RRHH).
      this.prisma.boletaPago.findMany({
        where: {
          empresaId,
          bancoId: id,
          fuentePago: FuenteEgreso.BANCO,
          estado: EstadoBoletaPago.PAGADA_BOLETA,
          fechaPago: { gte: desde, lte: hasta },
        },
        select: {
          totalNeto: true,
          fechaPago: true,
          periodo: { select: { periodo: true } },
          ...empleadoNombreSelect,
        },
      }),
      // Ingresos: abonos a crédito (CxC) cobrados a este banco.
      this.prisma.pagoVenta.findMany({
        where: {
          bancoId: id,
          anulado: false,
          fechaPago: { gte: desde, lte: hasta },
        },
        select: {
          monto: true,
          metodoPago: true,
          fechaPago: true,
          venta: { select: { codigo: true, nombreCliente: true } },
        },
      }),
      // Desglose ACUMULADO (todo el tiempo) de lo recaudado por método en este
      // banco — "cuánto se tiene de Yape, Plin, Transferencia, etc.".
      this.prisma.$queryRaw<{ metodoPago: string; total: number }[]>`
        SELECT "metodoPago", SUM("monto")::float8 AS total
        FROM "MovimientoCaja"
        WHERE "empresaId" = ${empresaId} AND tipo = 'EGRESO' AND anulado = false
          AND (metadata->>'bancoId') = ${id}
        GROUP BY 1`,
    ]);

    const recaudadoPorMetodo: Record<string, number> = {};
    for (const r of recaudadoTotal) {
      recaudadoPorMetodo[r.metodoPago] = r2(Number(r.total));
    }
    // Los abonos a crédito cobrados a este banco también son recaudación por método.
    for (const p of pagosVenta) {
      recaudadoPorMetodo[p.metodoPago] = r2(
        (recaudadoPorMetodo[p.metodoPago] ?? 0) + Number(p.monto),
      );
    }

    const nombreEmp = (x: any): string | null => {
      const p = x?.empleado?.usuario?.persona;
      const n = p ? `${p.nombres ?? ''} ${p.apellidos ?? ''}`.trim() : '';
      return n.length > 0 ? n : null;
    };

    const movimientos = [
      ...recaud.map((m) => ({
        fecha: m.fechaMovimiento,
        tipo: 'INGRESO',
        concepto: `Recaudación ${m.metodoPago}`,
        detalle: null as string | null,
        metodoPago: m.metodoPago,
        monto: r2(Number(m.monto)),
        origen: 'RECAUDACION',
      })),
      ...pagosCompra.map((p) => ({
        fecha: p.fechaPago,
        tipo: 'EGRESO',
        concepto: 'Pago proveedor',
        detalle: `${p.compra?.nombreProveedor ?? ''}${p.compra?.codigo ? ` (${p.compra.codigo})` : ''}`.trim(),
        metodoPago: null as string | null,
        monto: r2(Number(p.monto)),
        origen: 'PAGO_PROVEEDOR',
      })),
      ...pagosGasto.map((p) => ({
        fecha: p.fechaPago,
        tipo: 'EGRESO',
        concepto: 'Pago gasto',
        detalle: p.gastoRecurrente?.nombre ?? null,
        metodoPago: null as string | null,
        monto: r2(Number(p.montoReal)),
        origen: 'PAGO_GASTO',
      })),
      ...pagosAdelanto.map((p) => ({
        fecha: p.actualizadoEn,
        tipo: 'EGRESO',
        concepto: 'Adelanto sueldo',
        detalle: nombreEmp(p),
        metodoPago: null as string | null,
        monto: r2(Number(p.monto)),
        origen: 'ADELANTO_EMPLEADO',
      })),
      ...pagosBoleta.map((p) => ({
        fecha: p.fechaPago as Date,
        tipo: 'EGRESO',
        concepto: 'Pago planilla',
        detalle:
          [nombreEmp(p), p.periodo?.periodo].filter(Boolean).join(' · ') ||
          null,
        metodoPago: null as string | null,
        monto: r2(Number(p.totalNeto)),
        origen: 'PAGO_PLANILLA',
      })),
      ...ajustes.map((a) => ({
        fecha: a.creadoEn,
        tipo: a.tipo as string,
        concepto: a.origen === 'CONCILIACION' ? 'Conciliación' : 'Ajuste',
        detalle: a.motivo,
        metodoPago: null as string | null,
        monto: r2(Number(a.monto)),
        origen: a.origen as string,
      })),
      ...pagosVenta.map((p) => ({
        fecha: p.fechaPago,
        tipo: 'INGRESO',
        concepto: 'Abono cliente',
        detalle: `${p.venta?.nombreCliente ?? ''}${p.venta?.codigo ? ` (${p.venta.codigo})` : ''}`.trim() || null,
        metodoPago: p.metodoPago as string | null,
        monto: r2(Number(p.monto)),
        origen: 'ABONO_CREDITO',
      })),
    ].sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

    const totalIngresos = r2(movimientos.filter((m) => m.tipo === 'INGRESO').reduce((s, m) => s + m.monto, 0));
    const totalEgresos = r2(movimientos.filter((m) => m.tipo === 'EGRESO').reduce((s, m) => s + m.monto, 0));

    return {
      cuenta: {
        id: cuenta.id,
        nombreBanco: cuenta.nombreBanco,
        numeroCuenta: cuenta.numeroCuenta,
        moneda: cuenta.moneda ?? 'PEN',
        saldoActual: cuenta.saldoActual != null ? Number(cuenta.saldoActual) : 0,
      },
      periodo: { desde, hasta },
      resumen: {
        totalIngresos,
        totalEgresos,
        neto: r2(totalIngresos - totalEgresos),
        cantidad: movimientos.length,
      },
      recaudadoPorMetodo,
      movimientos,
    };
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
