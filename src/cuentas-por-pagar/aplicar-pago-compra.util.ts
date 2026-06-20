import { BadRequestException } from '@nestjs/common';
import { Prisma, MetodoPagoVenta, FuentePagoCompra } from '@prisma/client';
import { CajaService } from '../caja/caja.service';

export interface AplicarPagoCompraInput {
  empresaId: string;
  compraId: string;
  usuarioId: string;
  // Datos de la compra (snapshot) para rutear el egreso y describir.
  sedeId: string;
  nombreProveedor: string;
  codigo: string;
  moneda: string;
  // Pago
  metodoPago: MetodoPagoVenta;
  monto: number;
  fuente?: FuentePagoCompra;
  bancoId?: string;
  referencia?: string;
  bancoDestino?: string;
  cuentaDestino?: string;
  comprobanteUrl?: string;
}

/**
 * Registra un PagoCompra y rutea el egreso según la fuente, DENTRO de una
 * transacción ya abierta. Compartido por CxP (registrarPago) y por la
 * confirmación de compra al contado.
 *  - TESORERIA → EGRESO en la Caja Central de la sede (default efectivo).
 *  - CAJA      → EGRESO en la caja operativa abierta del usuario (400 si no hay).
 *  - BANCO     → decrementa EmpresaBanco.saldoActual (default digital).
 * Reglas: EFECTIVO no puede ser BANCO; moneda != PEN obliga BANCO.
 */
export async function aplicarPagoCompra(
  tx: Prisma.TransactionClient,
  cajaService: CajaService,
  input: AplicarPagoCompraInput,
) {
  const fuente: FuentePagoCompra =
    input.fuente ??
    (input.metodoPago === MetodoPagoVenta.EFECTIVO
      ? FuentePagoCompra.TESORERIA
      : FuentePagoCompra.BANCO);

  if (input.metodoPago === MetodoPagoVenta.EFECTIVO && fuente === FuentePagoCompra.BANCO) {
    throw new BadRequestException('Un pago en efectivo no puede salir de una cuenta bancaria');
  }
  if (fuente === FuentePagoCompra.BANCO && !input.bancoId) {
    throw new BadRequestException('Falta la cuenta bancaria (bancoId) para fuente=BANCO');
  }
  if (input.moneda && input.moneda !== 'PEN' && fuente !== FuentePagoCompra.BANCO) {
    throw new BadRequestException(
      `Una compra en ${input.moneda} debe pagarse desde una cuenta bancaria`,
    );
  }

  const descripcion = `Pago proveedor - ${input.nombreProveedor} (${input.codigo})`;
  let movimientoCajaId: string | null = null;
  let bancoId: string | null = null;

  if (fuente === FuentePagoCompra.BANCO) {
    const banco = await tx.empresaBanco.findFirst({
      where: { id: input.bancoId, empresaId: input.empresaId, isActive: true },
      select: { id: true },
    });
    if (!banco) throw new BadRequestException('Cuenta bancaria no encontrada');
    await tx.empresaBanco.update({
      where: { id: banco.id },
      data: { saldoActual: { decrement: input.monto } },
    });
    bancoId = banco.id;
  } else if (fuente === FuentePagoCompra.CAJA) {
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
        tipo: 'EGRESO',
        categoria: 'PAGO_PROVEEDOR',
        metodoPago: input.metodoPago,
        monto: input.monto,
        descripcion,
        compraId: input.compraId,
        registradoPorId: input.usuarioId,
      },
      tx,
    );
    movimientoCajaId = mov?.id ?? null;
  } else {
    const central = await cajaService.getOrCreateCajaCentral(input.empresaId, input.sedeId, tx);
    const mov = await cajaService.crearMovimientoAutomatico(
      input.empresaId,
      central.id,
      {
        tipo: 'EGRESO',
        categoria: 'PAGO_PROVEEDOR',
        metodoPago: input.metodoPago,
        monto: input.monto,
        descripcion: `[TESORERÍA] ${descripcion}`,
        compraId: input.compraId,
        registradoPorId: input.usuarioId,
      },
      tx,
    );
    movimientoCajaId = mov?.id ?? null;
  }

  return tx.pagoCompra.create({
    data: {
      compraId: input.compraId,
      metodoPago: input.metodoPago,
      monto: input.monto,
      referencia: input.referencia,
      bancoDestino: input.bancoDestino,
      cuentaDestino: input.cuentaDestino,
      comprobanteUrl: input.comprobanteUrl,
      fuente,
      bancoId,
      movimientoCajaId,
    },
  });
}

export interface PagoARevertir {
  id: string;
  monto: Prisma.Decimal | number;
  fuente: FuentePagoCompra | null;
  bancoId: string | null;
  movimientoCajaId: string | null;
}

/**
 * Revierte un PagoCompra (anulación soft-delete) DENTRO de una transacción:
 *  - TESORERIA/CAJA → marca el MovimientoCaja del egreso como anulado.
 *  - BANCO → devuelve el monto a EmpresaBanco.saldoActual (increment).
 *  - marca el PagoCompra como anulado.
 * Usado por "anular pago" (CxP) y por anular una compra paga.
 */
export async function revertirPagoCompra(
  tx: Prisma.TransactionClient,
  pago: PagoARevertir,
  usuarioId: string,
  motivo: string,
) {
  const monto = Number(pago.monto);

  if (
    (pago.fuente === FuentePagoCompra.TESORERIA || pago.fuente === FuentePagoCompra.CAJA) &&
    pago.movimientoCajaId
  ) {
    await tx.movimientoCaja.update({
      where: { id: pago.movimientoCajaId },
      data: {
        anulado: true,
        motivoAnulacion: `[PAGO PROVEEDOR] ${motivo}`,
        anuladoPorId: usuarioId,
        fechaAnulacion: new Date(),
      },
    });
  } else if (pago.fuente === FuentePagoCompra.BANCO && pago.bancoId) {
    await tx.empresaBanco.update({
      where: { id: pago.bancoId },
      data: { saldoActual: { increment: monto } },
    });
  }

  return tx.pagoCompra.update({
    where: { id: pago.id },
    data: {
      anulado: true,
      motivoAnulacion: motivo,
      anuladoPorId: usuarioId,
      fechaAnulacion: new Date(),
    },
  });
}
