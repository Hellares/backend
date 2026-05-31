-- Soporte de VARIANTES DE INSUMO en recetas BOM.
-- `componenteVarianteId` apunta a una variante específica del insumo (ej.
-- "Planta T20 Niño"). null = insumo sin variantes (producto base) → retro-
-- compatible: las recetas existentes quedan con NULL.
-- `fabricar` consume el stock de esa variante; el costeo se resuelve por
-- (componenteId, componenteVarianteId).

ALTER TABLE "ProductoComponente" ADD COLUMN "componenteVarianteId" TEXT;

ALTER TABLE "ProductoComponente"
  ADD CONSTRAINT "ProductoComponente_componenteVarianteId_fkey"
  FOREIGN KEY ("componenteVarianteId") REFERENCES "ProductoVariante"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ProductoComponente_componenteVarianteId_idx"
  ON "ProductoComponente"("componenteVarianteId");

-- Reemplazar el unique para incluir la variante del componente.
DROP INDEX IF EXISTS "ProductoComponente_productoId_varianteId_componenteId_key";
CREATE UNIQUE INDEX "ProductoComponente_receta_componente_key"
  ON "ProductoComponente"("productoId", "varianteId", "componenteId", "componenteVarianteId");
