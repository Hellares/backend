import { Prisma } from '@prisma/client';
import {
  consumirLotesFefo,
  crearLoteDeEntrada,
  devolverALotesDeOrigen,
  heredarLotesDeTransferencia,
  registrarAsignaciones,
  type AsignacionLote,
} from './lote-consumo.helper';

/**
 * Datos para crear un MovimientoStock con valoración monetaria.
 *
 * Para `precioCostoUnitario`:
 *   - `undefined` → el helper lo lee del ProductoStock al momento (valor actual).
 *   - número o Decimal → se usa ese valor (caso típico: COMPRA pasa el
 *     precio unitario de la línea, VENTA pasa el precioCostoSnapshot del
 *     VentaDetalle, PRODUCCION pasa el costo calculado del lote).
 *   - `null` explícito → se respeta como null (producto sin costo registrado).
 */
export interface CrearMovimientoStockData {
  productoStockId: string;
  empresaId: string;
  sedeId: string;
  tipo: any; // TipoMovimientoStock del cliente generado
  cantidad: number;
  cantidadAnterior: number;
  cantidadNueva: number;
  usuarioId: string;
  motivo?: string;
  observaciones?: string;
  numeroDocumento?: string;
  tipoDocumento?: string;
  ventaId?: string;
  compraId?: string;
  transferenciaId?: string;
  devolucionId?: string;
  precioCostoUnitario?: number | Prisma.Decimal | null;
  // Mano de obra del lote (solo se setea en PRODUCCION_ENTRADA de fabricaciones).
  costoManoObra?: number | Prisma.Decimal | null;
  /**
   * 🔴 El llamador YA administra los lotes de este movimiento: el helper no
   * los toca.
   *
   * Sin esto habría DOBLE movimiento de lote. Los casos reales, todos en
   * `compra.service`: anular una compra (pone SU lote en cero) y las dos patas
   * de la distribución a otra sede (descuenta el lote de origen y crea el de
   * destino). Si además corriera el consumo FEFO, se descontaría dos veces y
   * la suma de lotes se despegaría del `stockActual`.
   *
   * Se declara en el call site a propósito: quien sabe que administra lotes es
   * el que los administra, y adivinarlo acá por tipo de movimiento sería
   * frágil e invisible desde donde importa.
   */
  lotesGestionadosPorElLlamador?: boolean;
  /**
   * Consumir de ESTE lote primero, en vez del que elegiría FEFO.
   *
   * 🔑 Para la mercadería comprada POR ENCARGO: se le compró a un proveedor
   * puntual para un cliente puntual, así que esa caja tiene dueño y su costo
   * es otro. Sin esto se descontaría la del otro cliente.
   */
  loteIdPreferido?: string | null;
}

/**
 * Crea un MovimientoStock con valoración monetaria automática.
 * Centraliza la resolución del snapshot de costo y el cálculo del valor
 * total para que TODO el sistema produzca movimientos valorados.
 *
 * IMPORTANTE: debe llamarse dentro de una transacción que también haga
 * el update del ProductoStock; si no, el costo leído puede ser obsoleto.
 */
export async function crearMovimientoStockConValoracion(
  tx: Prisma.TransactionClient,
  data: CrearMovimientoStockData,
) {
  let costoUnit: Prisma.Decimal | null;
  if (data.precioCostoUnitario === null) {
    costoUnit = null;
  } else if (data.precioCostoUnitario === undefined) {
    const stock = await tx.productoStock.findUnique({
      where: { id: data.productoStockId },
      select: { precioCosto: true },
    });
    costoUnit = stock?.precioCosto ?? null;
  } else {
    costoUnit = new Prisma.Decimal(data.precioCostoUnitario as any);
  }

  // valorMovimiento siempre positivo; el signo de la operación queda
  // expresado en el campo `cantidad` (negativo = salida).
  const valorMov =
    costoUnit != null
      ? new Prisma.Decimal(Math.abs(data.cantidad)).mul(costoUnit)
      : null;

  const {
    precioCostoUnitario: _ignored,
    lotesGestionadosPorElLlamador,
    loteIdPreferido,
    ...rest
  } = data;
  const movimiento = await tx.movimientoStock.create({
    data: {
      ...rest,
      precioCostoUnitario: costoUnit,
      valorMovimiento: valorMov,
    },
  });

  if (!lotesGestionadosPorElLlamador) {
    await sincronizarLotes(tx, movimiento, costoUnit, loteIdPreferido);
  }

  return movimiento;
}

/**
 * ¿Está encendido el consumo de lotes?
 *
 * 🔴 Apagado por defecto A PROPÓSITO. El orden de encendido no es negociable:
 * primero se despliega el código, después se corre la conciliación
 * (`scripts/conciliar-lotes.ts`) y RECIÉN AHÍ se prende. Al revés, el motor
 * consumiría de los lotes históricos —cuyo `cantidadActual` está inflado
 * porque nunca bajaron al vender— y repartiría mercadería que no existe.
 *
 * Es también el freno de mano: esto cuelga del camino del cobro, y poder
 * apagarlo con una variable de entorno vale más que un rollback de imagen.
 */
function lotesActivos(): boolean {
  return process.env.LOTES_FEFO_ENABLED === 'true';
}

/**
 * Mantiene los lotes en línea con el movimiento recién creado.
 *
 * La invariante que sostiene: para cada `ProductoStock`, la suma de
 * `cantidadActual` de sus lotes ACTIVO es igual a `stockActual`.
 *
 * - **Salida** (cantidad < 0) → consume en orden FEFO.
 * - **Entrada por COMPRA** → no hace nada: `compra.service` crea el lote con
 *   su costo real, su proveedor y su vencimiento. Duplicarlo acá inflaría el
 *   stock por lotes al doble.
 * - **Entrada que revierte una salida** (anulación de venta, devolución) →
 *   devuelve a los lotes de los que salió, con su vencimiento y su costo.
 * - **Cualquier otra entrada** (ajuste, producción, transferencia recibida) →
 *   crea un lote, porque si no queda stock sin respaldo y el FEFO se
 *   quedaría corto después.
 */
async function sincronizarLotes(
  tx: Prisma.TransactionClient,
  movimiento: {
    id: string;
    productoStockId: string;
    empresaId: string;
    sedeId: string;
    tipo: string;
    cantidad: number;
    ventaId: string | null;
    transferenciaId: string | null;
    motivo: string | null;
    usuarioId: string;
  },
  costoUnit: Prisma.Decimal | null,
  loteIdPreferido?: string | null,
): Promise<void> {
  if (!lotesActivos()) return;
  // cantidad 0 = registro de auditoría (ej. migración a variantes), no mueve
  // mercadería y por lo tanto no toca ningún lote.
  if (movimiento.cantidad === 0) return;

  if (movimiento.cantidad < 0) {
    const { asignaciones, sinCubrir } = await consumirLotesFefo(
      tx,
      movimiento.productoStockId,
      Math.abs(movimiento.cantidad),
      loteIdPreferido,
    );
    await registrarAsignaciones(tx, movimiento.id, asignaciones);
    if (sinCubrir > 0) {
      // No se aborta: el stock ya lo validó quien vende, y frenar el cobro por
      // una inconsistencia de lotes que el cajero no puede resolver en el
      // mostrador sería peor. Queda el rastro para conciliar.
      console.warn(
        `[lotes] ${movimiento.tipo} ${movimiento.id}: faltaron ${sinCubrir} ` +
          `unidades sin lote en productoStock ${movimiento.productoStockId}`,
      );
    }
    return;
  }

  // ── Entradas ──
  if (movimiento.tipo === 'ENTRADA_COMPRA') return;

  let repuesto = 0;
  const asignaciones: AsignacionLote[] = [];

  // ¿Revierte una salida conocida? Solo se busca por venta: es el único
  // documento que tiene una salida previa identificable contra el MISMO
  // productoStock (una transferencia recibida sacó de OTRA sede, así que sus
  // lotes no son estos).
  if (movimiento.ventaId) {
    const origen = await tx.movimientoStock.findMany({
      where: {
        ventaId: movimiento.ventaId,
        productoStockId: movimiento.productoStockId,
        cantidad: { lt: 0 },
      },
      select: { id: true },
    });
    if (origen.length) {
      const r = await devolverALotesDeOrigen(
        tx,
        origen.map((o) => o.id),
        movimiento.cantidad,
      );
      asignaciones.push(...r.asignaciones);
      repuesto = movimiento.cantidad - r.sinCubrir;
    }
  }

  // 🔑 ¿Llega de OTRA sede? Hereda los lotes de los que salió allá — con su
  // vencimiento, su costo y su proveedor. Sin esto la mercadería transferida
  // entraba como un lote de ajuste sin fecha y FEFO la trataba como eterna.
  const stock = await tx.productoStock.findUnique({
    where: { id: movimiento.productoStockId },
    select: { productoId: true, varianteId: true },
  });
  if (movimiento.transferenciaId && repuesto < movimiento.cantidad) {
    const pendiente = movimiento.cantidad - repuesto;
    const r = await heredarLotesDeTransferencia(
      tx,
      { ...movimiento, transferenciaId: movimiento.transferenciaId },
      pendiente,
      {
        productoId: stock?.productoId ?? null,
        varianteId: stock?.varianteId ?? null,
      },
    );
    asignaciones.push(...r.asignaciones);
    repuesto += pendiente - r.sinCubrir;
  }

  const faltante = movimiento.cantidad - repuesto;
  if (faltante > 0) {
    const nuevo = await crearLoteDeEntrada(tx, {
      productoStockId: movimiento.productoStockId,
      empresaId: movimiento.empresaId,
      sedeId: movimiento.sedeId,
      productoId: stock?.productoId ?? null,
      varianteId: stock?.varianteId ?? null,
      cantidad: faltante,
      costoUnitario: costoUnit,
      // Único por construcción (el id del movimiento lo es) y se lee de un
      // vistazo: un lote AJU- no salió de una factura de proveedor.
      codigo: `AJU-${movimiento.id}`,
      motivo: movimiento.motivo ?? movimiento.tipo,
      usuarioId: movimiento.usuarioId,
    });
    if (nuevo) asignaciones.push(nuevo);
  }

  await registrarAsignaciones(tx, movimiento.id, asignaciones);
}
