-- De QUE lotes salio (o a cuales volvio) cada movimiento de stock.
--
-- Es una tabla PUENTE y no un "loteId" en MovimientoStock porque una sola
-- salida puede comer de VARIOS lotes: se venden 5, el lote nuevo tiene 3 y las
-- otras 2 salen del anterior. Con una columna suelta habria que partir el
-- movimiento o mentir sobre el origen de la mitad.
--
-- Es tambien lo que permite REVERTIR con exactitud: una devolucion o la
-- anulacion de una venta devuelve las unidades a los lotes de los que
-- realmente salieron, con su vencimiento y su costo.
--
-- ADITIVA: tabla nueva, nada existente cambia. El consumo de lotes arranca
-- APAGADO (env LOTES_FEFO_ENABLED); se prende recien despues de correr la
-- conciliacion, porque los lotes historicos tienen cantidadActual inflado
-- (nunca bajaron al vender).
CREATE TABLE "MovimientoStockLote" (
  "id"                TEXT NOT NULL,
  "movimientoStockId" TEXT NOT NULL,
  "loteId"            TEXT NOT NULL,
  "cantidad"          INTEGER NOT NULL,
  "costoUnitario"     DECIMAL(14,6),
  "creadoEn"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MovimientoStockLote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MovimientoStockLote_movimientoStockId_idx"
  ON "MovimientoStockLote"("movimientoStockId");

CREATE INDEX "MovimientoStockLote_loteId_idx"
  ON "MovimientoStockLote"("loteId");

ALTER TABLE "MovimientoStockLote"
  ADD CONSTRAINT "MovimientoStockLote_movimientoStockId_fkey"
  FOREIGN KEY ("movimientoStockId") REFERENCES "MovimientoStock"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MovimientoStockLote"
  ADD CONSTRAINT "MovimientoStockLote_loteId_fkey"
  FOREIGN KEY ("loteId") REFERENCES "Lote"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
