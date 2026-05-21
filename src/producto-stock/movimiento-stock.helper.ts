import { Prisma } from '@prisma/client';

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

  const { precioCostoUnitario: _ignored, ...rest } = data;
  return tx.movimientoStock.create({
    data: {
      ...rest,
      precioCostoUnitario: costoUnit,
      valorMovimiento: valorMov,
    },
  });
}
