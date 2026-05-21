-- Valoración monetaria del Kardex.
-- precioCostoUnitario: snapshot del costo por unidad al momento del movimiento.
-- valorMovimiento: |cantidad| × costo (siempre positivo; el signo de la operación
-- queda en `cantidad`). Ambos nullable porque los movimientos previos a esta
-- migración no tienen snapshot — la UI mostrará "—" en esos casos.

ALTER TABLE "MovimientoStock"
  ADD COLUMN "precioCostoUnitario" DECIMAL(14,4),
  ADD COLUMN "valorMovimiento" DECIMAL(14,2);
