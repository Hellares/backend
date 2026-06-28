import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  MetodoPagoVenta,
  FuenteIngreso,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
} from '@prisma/client';
import { CajaService } from './caja.service';

export interface AplicarIngresoInput {
  empresaId: string;
  sedeId: string;
  usuarioId: string;
  metodoPago: MetodoPagoVenta;
  monto: number;
  /** Moneda del ingreso (default PEN). Si != PEN obliga fuente=BANCO. */
  moneda?: string;
  fuente?: FuenteIngreso;
  bancoId?: string;
  categoria: CategoriaMovimientoCaja;
  descripcion: string;
}

export interface AplicarIngresoResult {
  fuente: FuenteIngreso;
  bancoId: string | null;
  movimientoCajaId: string | null;
  /** Método con el que quedó registrado el ingreso. TESORERIA siempre lo
   * registra como EFECTIVO (la bóveda/caja central guarda efectivo). */
  metodoPago: MetodoPagoVenta;
}

/**
 * Rutea un INGRESO según su fuente, DENTRO de una transacción ya abierta.
 * Espejo de `aplicarEgresoConFuente` (RRHH) / `aplicarPagoCompra` (CxP), pero
 * para entradas de dinero (abonos a crédito de CxC):
 *  - TESORERIA → INGRESO en la Caja Central de la sede (default efectivo).
 *  - CAJA      → INGRESO en la caja operativa abierta del usuario (400 si no hay).
 *  - BANCO     → incrementa EmpresaBanco.saldoActual (default digital).
 * Reglas: EFECTIVO no puede ser BANCO; moneda != PEN obliga BANCO; la moneda
 * del banco debe coincidir con la del ingreso.
 */
export async function aplicarIngresoConFuente(
  tx: Prisma.TransactionClient,
  cajaService: CajaService,
  input: AplicarIngresoInput,
): Promise<AplicarIngresoResult> {
  const fuente: FuenteIngreso =
    input.fuente ??
    (input.metodoPago === MetodoPagoVenta.EFECTIVO
      ? FuenteIngreso.TESORERIA
      : FuenteIngreso.BANCO);

  if (input.metodoPago === MetodoPagoVenta.EFECTIVO && fuente === FuenteIngreso.BANCO) {
    throw new BadRequestException(
      'Un cobro en efectivo no puede ingresar a una cuenta bancaria',
    );
  }
  if (fuente === FuenteIngreso.BANCO && !input.bancoId) {
    throw new BadRequestException(
      'Falta la cuenta bancaria (bancoId) para fuente=BANCO',
    );
  }
  const moneda = input.moneda || 'PEN';
  if (moneda !== 'PEN' && fuente !== FuenteIngreso.BANCO) {
    throw new BadRequestException(
      `Un cobro en ${moneda} debe ingresar a una cuenta bancaria`,
    );
  }

  // TESORERIA = bóveda (Caja Central) → siempre efectivo: el ingreso aumenta el
  // saldo efectivo visible, no el bucket digital.
  const metodoMovimiento =
    fuente === FuenteIngreso.TESORERIA
      ? MetodoPagoVenta.EFECTIVO
      : input.metodoPago;

  let movimientoCajaId: string | null = null;
  let bancoId: string | null = null;

  if (fuente === FuenteIngreso.BANCO) {
    const banco = await tx.empresaBanco.findFirst({
      where: { id: input.bancoId, empresaId: input.empresaId, isActive: true },
      select: { id: true, moneda: true },
    });
    if (!banco) throw new BadRequestException('Cuenta bancaria no encontrada');
    const bancoMoneda = banco.moneda ?? 'PEN';
    if (bancoMoneda !== moneda) {
      throw new BadRequestException(
        `El cobro es en ${moneda} pero la cuenta bancaria es en ${bancoMoneda}. Elegí una cuenta en ${moneda}.`,
      );
    }
    await tx.empresaBanco.update({
      where: { id: banco.id },
      data: { saldoActual: { increment: input.monto } },
    });
    bancoId = banco.id;
  } else if (fuente === FuenteIngreso.CAJA) {
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
        'No tenés una caja abierta en esta sede. Cobrá desde Tesorería o abrí caja.',
      );
    }
    const mov = await cajaService.crearMovimientoAutomatico(
      input.empresaId,
      cajaOp.id,
      {
        tipo: TipoMovimientoCaja.INGRESO,
        categoria: input.categoria,
        metodoPago: metodoMovimiento,
        monto: input.monto,
        descripcion: input.descripcion,
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
        tipo: TipoMovimientoCaja.INGRESO,
        categoria: input.categoria,
        metodoPago: metodoMovimiento,
        monto: input.monto,
        descripcion: `[TESORERÍA] ${input.descripcion}`,
        registradoPorId: input.usuarioId,
      },
      tx,
    );
    movimientoCajaId = mov?.id ?? null;
  }

  return { fuente, bancoId, movimientoCajaId, metodoPago: metodoMovimiento };
}

export interface IngresoARevertir {
  monto: Prisma.Decimal | number;
  fuente: FuenteIngreso | null;
  bancoId: string | null;
  movimientoCajaId: string | null;
}

/**
 * Revierte un ingreso ruteado (al anular un abono ya cobrado), DENTRO de una
 * transacción:
 *  - TESORERIA/CAJA → marca el MovimientoCaja del ingreso como anulado.
 *  - BANCO → resta el monto a EmpresaBanco.saldoActual (decrement).
 */
export async function revertirIngresoConFuente(
  tx: Prisma.TransactionClient,
  ingreso: IngresoARevertir,
  usuarioId: string,
  motivo: string,
) {
  const monto = Number(ingreso.monto);

  if (
    (ingreso.fuente === FuenteIngreso.TESORERIA ||
      ingreso.fuente === FuenteIngreso.CAJA) &&
    ingreso.movimientoCajaId
  ) {
    await tx.movimientoCaja.update({
      where: { id: ingreso.movimientoCajaId },
      data: {
        anulado: true,
        motivoAnulacion: motivo,
        anuladoPorId: usuarioId,
        fechaAnulacion: new Date(),
      },
    });
  } else if (ingreso.fuente === FuenteIngreso.BANCO && ingreso.bancoId) {
    await tx.empresaBanco.update({
      where: { id: ingreso.bancoId },
      data: { saldoActual: { decrement: monto } },
    });
  }
}
