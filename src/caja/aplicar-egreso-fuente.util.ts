import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  MetodoPagoVenta,
  FuenteEgreso,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
} from '@prisma/client';
import { CajaService } from './caja.service';

export interface AplicarEgresoInput {
  empresaId: string;
  sedeId: string;
  usuarioId: string;
  metodoPago: MetodoPagoVenta;
  monto: number;
  /** Moneda del egreso (default PEN). Si != PEN obliga fuente=BANCO. */
  moneda?: string;
  fuente?: FuenteEgreso;
  bancoId?: string;
  categoria: CategoriaMovimientoCaja;
  descripcion: string;
  // Refs opcionales para el MovimientoCaja (trazabilidad).
  adelantoPagoId?: string;
  boletaPagoId?: string;
}

export interface AplicarEgresoResult {
  fuente: FuenteEgreso;
  bancoId: string | null;
  movimientoCajaId: string | null;
  /** Método con el que quedó registrado el egreso. TESORERIA siempre lo
   * registra como EFECTIVO (la bóveda/caja central guarda efectivo), para que
   * el egreso reduzca la bóveda visible y no quede en el bucket digital. */
  metodoPago: MetodoPagoVenta;
}

/**
 * Rutea un EGRESO según su fuente, DENTRO de una transacción ya abierta.
 * Mismo criterio que `aplicarPagoCompra` (CxP) pero genérico (sin crear un
 * PagoCompra); lo usan los pagos de RRHH (adelanto / boleta de planilla).
 *  - TESORERIA → EGRESO en la Caja Central de la sede (default efectivo).
 *  - CAJA      → EGRESO en la caja operativa abierta del usuario (400 si no hay).
 *  - BANCO     → decrementa EmpresaBanco.saldoActual (default digital).
 * Reglas: EFECTIVO no puede ser BANCO; moneda != PEN obliga BANCO; la moneda
 * del banco debe coincidir con la del egreso.
 */
export async function aplicarEgresoConFuente(
  tx: Prisma.TransactionClient,
  cajaService: CajaService,
  input: AplicarEgresoInput,
): Promise<AplicarEgresoResult> {
  const fuente: FuenteEgreso =
    input.fuente ??
    (input.metodoPago === MetodoPagoVenta.EFECTIVO
      ? FuenteEgreso.TESORERIA
      : FuenteEgreso.BANCO);

  if (input.metodoPago === MetodoPagoVenta.EFECTIVO && fuente === FuenteEgreso.BANCO) {
    throw new BadRequestException(
      'Un pago en efectivo no puede salir de una cuenta bancaria',
    );
  }
  if (fuente === FuenteEgreso.BANCO && !input.bancoId) {
    throw new BadRequestException(
      'Falta la cuenta bancaria (bancoId) para fuente=BANCO',
    );
  }
  const moneda = input.moneda || 'PEN';
  if (moneda !== 'PEN' && fuente !== FuenteEgreso.BANCO) {
    throw new BadRequestException(
      `Un pago en ${moneda} debe salir de una cuenta bancaria`,
    );
  }

  // TESORERIA = bóveda (Caja Central) → siempre efectivo: el egreso debe
  // reducir el saldo efectivo visible, no caer en el bucket digital histórico.
  const metodoMovimiento =
    fuente === FuenteEgreso.TESORERIA
      ? MetodoPagoVenta.EFECTIVO
      : input.metodoPago;

  let movimientoCajaId: string | null = null;
  let bancoId: string | null = null;

  if (fuente === FuenteEgreso.BANCO) {
    const banco = await tx.empresaBanco.findFirst({
      where: { id: input.bancoId, empresaId: input.empresaId, isActive: true },
      select: { id: true, moneda: true },
    });
    if (!banco) throw new BadRequestException('Cuenta bancaria no encontrada');
    const bancoMoneda = banco.moneda ?? 'PEN';
    if (bancoMoneda !== moneda) {
      throw new BadRequestException(
        `El pago es en ${moneda} pero la cuenta bancaria es en ${bancoMoneda}. Elegí una cuenta en ${moneda}.`,
      );
    }
    await tx.empresaBanco.update({
      where: { id: banco.id },
      data: { saldoActual: { decrement: input.monto } },
    });
    bancoId = banco.id;
  } else if (fuente === FuenteEgreso.CAJA) {
    const cajaOp = await tx.caja.findFirst({
      where: {
        empresaId: input.empresaId,
        sedeId: input.sedeId,
        usuarioId: input.usuarioId,
        estado: 'ABIERTA',
        esCajaCentral: false,
      },
      select: { id: true },
    });
    if (!cajaOp) {
      throw new BadRequestException(
        'No tenés una caja abierta en esta sede. Pagá desde Tesorería o abrí caja.',
      );
    }
    const mov = await cajaService.crearMovimientoAutomatico(
      input.empresaId,
      cajaOp.id,
      {
        tipo: TipoMovimientoCaja.EGRESO,
        categoria: input.categoria,
        metodoPago: metodoMovimiento,
        monto: input.monto,
        descripcion: input.descripcion,
        adelantoPagoId: input.adelantoPagoId,
        boletaPagoId: input.boletaPagoId,
        registradoPorId: input.usuarioId,
      },
      tx,
    );
    movimientoCajaId = mov?.id ?? null;
  } else {
    // TESORERIA
    const central = await cajaService.getOrCreateCajaCentral(
      input.empresaId,
      input.sedeId,
      tx,
    );
    const mov = await cajaService.crearMovimientoAutomatico(
      input.empresaId,
      central.id,
      {
        tipo: TipoMovimientoCaja.EGRESO,
        categoria: input.categoria,
        metodoPago: metodoMovimiento,
        monto: input.monto,
        descripcion: `[TESORERÍA] ${input.descripcion}`,
        adelantoPagoId: input.adelantoPagoId,
        boletaPagoId: input.boletaPagoId,
        registradoPorId: input.usuarioId,
      },
      tx,
    );
    movimientoCajaId = mov?.id ?? null;
  }

  return { fuente, bancoId, movimientoCajaId, metodoPago: metodoMovimiento };
}

export interface EgresoARevertir {
  monto: Prisma.Decimal | number;
  fuente: FuenteEgreso | null;
  bancoId: string | null;
  movimientoCajaId: string | null;
}

/**
 * Revierte un egreso ruteado (al anular un adelanto/boleta ya pagado), DENTRO
 * de una transacción:
 *  - TESORERIA/CAJA → marca el MovimientoCaja del egreso como anulado.
 *  - BANCO → devuelve el monto a EmpresaBanco.saldoActual (increment).
 */
export async function revertirEgresoConFuente(
  tx: Prisma.TransactionClient,
  egreso: EgresoARevertir,
  usuarioId: string,
  motivo: string,
) {
  const monto = Number(egreso.monto);

  if (
    (egreso.fuente === FuenteEgreso.TESORERIA ||
      egreso.fuente === FuenteEgreso.CAJA) &&
    egreso.movimientoCajaId
  ) {
    await tx.movimientoCaja.update({
      where: { id: egreso.movimientoCajaId },
      data: {
        anulado: true,
        motivoAnulacion: motivo,
        anuladoPorId: usuarioId,
        fechaAnulacion: new Date(),
      },
    });
  } else if (egreso.fuente === FuenteEgreso.BANCO && egreso.bancoId) {
    await tx.empresaBanco.update({
      where: { id: egreso.bancoId },
      data: { saldoActual: { increment: monto } },
    });
  }
}
