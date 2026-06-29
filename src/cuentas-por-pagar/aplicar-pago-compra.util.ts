import { BadRequestException } from '@nestjs/common';
import {
  Prisma,
  MetodoPagoVenta,
  FuentePagoCompra,
  EstadoCaja,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
} from '@prisma/client';
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
      select: { id: true, moneda: true },
    });
    if (!banco) throw new BadRequestException('Cuenta bancaria no encontrada');
    // La moneda del banco debe coincidir con la de la compra: no se paga una
    // deuda en USD desde una cuenta en soles (ni viceversa) — son saldos por
    // moneda, mezclarlos descuadra.
    const bancoMoneda = banco.moneda ?? 'PEN';
    const compraMoneda = input.moneda || 'PEN';
    if (bancoMoneda !== compraMoneda) {
      throw new BadRequestException(
        `La compra es en ${compraMoneda} pero la cuenta bancaria es en ${bancoMoneda}. Elegí una cuenta en ${compraMoneda}.`,
      );
    }
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
    // Si no se pudo registrar el movimiento (caja inexistente/cerrada), abortar:
    // no crear un PagoCompra sin respaldo de caja (reduciría la deuda sin que
    // salga dinero de ninguna caja).
    if (!mov) {
      throw new BadRequestException(
        'No se pudo registrar el egreso en la caja (caja inexistente o cerrada). El pago no se registró.',
      );
    }
    movimientoCajaId = mov.id;
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
    // Igual que en CAJA: sin movimiento de respaldo no se crea el pago.
    if (!mov) {
      throw new BadRequestException(
        'No se pudo registrar el egreso en Tesorería (Caja Central no disponible). El pago no se registró.',
      );
    }
    movimientoCajaId = mov.id;
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
 *  - TESORERIA/CAJA:
 *      · caja origen ABIERTA  → marca el MovimientoCaja del egreso anulado=true
 *        (el saldo de esa caja vuelve a subir: la plata regresa).
 *      · caja origen CERRADA  → el cierre firmado es inmutable. Marca el egreso
 *        original anulado=true SOLO para auditoría y compensa con un INGRESO
 *        (REVERSO_CAJA_CERRADA, anulado=false) en la Caja Central de la SEDE
 *        DEL ORIGINAL — la plata vuelve a Tesorería sin tocar el snapshot.
 *        Mismo patrón que la anulación de ventas (reversarMovimientosDeOrigen).
 *  - BANCO → devuelve el monto a EmpresaBanco.saldoActual (increment).
 *  - marca el PagoCompra como anulado.
 * Usado por "anular pago" (CxP) y por anular una compra paga.
 */
export async function revertirPagoCompra(
  tx: Prisma.TransactionClient,
  cajaService: CajaService,
  pago: PagoARevertir,
  usuarioId: string,
  motivo: string,
) {
  const monto = Number(pago.monto);

  if (
    (pago.fuente === FuentePagoCompra.TESORERIA || pago.fuente === FuentePagoCompra.CAJA) &&
    pago.movimientoCajaId
  ) {
    const orig = await tx.movimientoCaja.findUnique({
      where: { id: pago.movimientoCajaId },
      select: {
        id: true,
        empresaId: true,
        metodoPago: true,
        compraId: true,
        caja: {
          select: {
            id: true,
            estado: true,
            sedeId: true,
            codigo: true,
            fechaCierre: true,
          },
        },
      },
    });

    if (orig && orig.caja.estado !== EstadoCaja.ABIERTA) {
      // Caja origen CERRADA: cierre snapshot inmutable. Marcar el egreso
      // original anulado=true solo para auditoría y compensar el reingreso en
      // la Caja Central de la sede del original.
      const fechaCierreStr = orig.caja.fechaCierre
        ? orig.caja.fechaCierre.toISOString().slice(0, 10)
        : 'desconocida';

      await tx.movimientoCaja.update({
        where: { id: orig.id },
        data: {
          anulado: true,
          motivoAnulacion: `[PAGO PROVEEDOR] ${motivo} | Caja origen ${orig.caja.codigo} ya cerrada; reingreso compensatorio en Tesorería de la sede`,
          anuladoPorId: usuarioId,
          fechaAnulacion: new Date(),
        },
      });

      const central = await cajaService.getOrCreateCajaCentral(
        orig.empresaId,
        orig.caja.sedeId,
        tx,
      );

      await tx.movimientoCaja.create({
        data: {
          cajaId: central.id,
          empresaId: orig.empresaId,
          tipo: TipoMovimientoCaja.INGRESO,
          categoria: CategoriaMovimientoCaja.REVERSO_CAJA_CERRADA,
          metodoPago: orig.metodoPago,
          monto,
          descripcion: `[REVERSO ${motivo}] Anulación pago proveedor — ${orig.caja.codigo} cerrada ${fechaCierreStr}; reingreso a Tesorería`,
          compraId: orig.compraId,
          esManual: false,
          registradoPorId: usuarioId,
          anulado: false,
          metadata: {
            movimientoOriginalId: orig.id,
            cajaOrigenId: orig.caja.id,
            cajaOrigenCodigo: orig.caja.codigo,
            fechaCierreOriginal: fechaCierreStr,
            esReversoCajaCerrada: true,
          },
        },
      });
    } else {
      // Caja origen ABIERTA (o sin movimiento cargable): marcar el egreso
      // anulado=true; el saldo de esa caja se recupera.
      await tx.movimientoCaja.update({
        where: { id: pago.movimientoCajaId },
        data: {
          anulado: true,
          motivoAnulacion: `[PAGO PROVEEDOR] ${motivo}`,
          anuladoPorId: usuarioId,
          fechaAnulacion: new Date(),
        },
      });
    }
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
