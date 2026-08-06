-- Unidad de PRESENTACIÓN del producto (fase 1).
--
-- Cómo se le habla al usuario y al cliente cuando la unidad atómica es
-- demasiado chica para mostrarla: un alimento a granel se guarda en gramos
-- -para que la balanza y el stock entero funcionen- pero se cotiza, se cobra
-- y se imprime en KILOS.
--
-- `factorPresentacion` = unidades atómicas que trae 1 de presentación
-- (kg = 1000 g), igual que `factorCompra` para el bulto de compra.
--
-- NO cambia nada de lo almacenado: stock, precioCosto y movimientos siguen
-- SIEMPRE en unidad atómica. Es capa de vista y de captura. Ambas columnas son
-- nullable: un producto sin presentación se muestra en su unidad atómica, que
-- es el comportamiento de siempre, así que esta migración no altera el
-- funcionamiento de ninguna empresa existente.

ALTER TABLE "Producto"
  ADD COLUMN "unidadPresentacionId" TEXT,
  ADD COLUMN "factorPresentacion" numeric(12,4);

ALTER TABLE "Producto"
  ADD CONSTRAINT "Producto_unidadPresentacionId_fkey"
  FOREIGN KEY ("unidadPresentacionId") REFERENCES "EmpresaUnidadMedida"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Producto_unidadPresentacionId_idx"
  ON "Producto"("unidadPresentacionId");
