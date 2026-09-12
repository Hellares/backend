-- VENCIMIENTOS (Fase 2). Todo ADITIVO con default: nada cambia para los
-- productos existentes, que quedan en NINGUNO y no controlan vencimiento.
--
-- 🔑 La FECHA no va en Producto: va en Lote.fechaVencimiento, que ya existia.
-- Un producto no vence, vence cada lote — dos compras de la misma leche vencen
-- distinto. En Producto va solo la POLITICA.

-- El corte NO es "perecedero si/no": es la distincion que hacen DIGESA e
-- INDECOPI entre una fecha de CADUCIDAD ("no consumir despues de") y una de
-- consumo preferente ("mejor antes de"). Son dos cosas que no admiten la misma
-- politica: la primera se bloquea seco, la segunda se autoriza.
CREATE TYPE "TipoVencimiento" AS ENUM ('NINGUNO', 'CONSUMO_PREFERENTE', 'CADUCIDAD');

ALTER TABLE "Producto"
  ADD COLUMN "tipoVencimiento" "TipoVencimiento" NOT NULL DEFAULT 'NINGUNO',
  -- Vida util en dias desde la recepcion. Solo SUGIERE la fecha al cargar la
  -- linea de compra; la que manda es la que se tipea, porque la impresa en el
  -- envase es la unica que vale.
  ADD COLUMN "diasVidaUtil" INTEGER,
  -- Cuantos dias antes empieza a avisar. Null = el default de la empresa.
  ADD COLUMN "diasAlertaVencimiento" INTEGER;

-- La fecha de ESTA entrega. Al confirmar la compra viaja al Lote que se crea,
-- y es lo que le permite a FEFO sacar primero lo que caduca antes.
ALTER TABLE "CompraDetalle"
  ADD COLUMN "fechaVencimiento" TIMESTAMP(3);

-- Los lotes se buscan por vencimiento en el consumo FEFO y en las alertas.
CREATE INDEX "Lote_productoStockId_fechaVencimiento_idx"
  ON "Lote"("productoStockId", "fechaVencimiento");
