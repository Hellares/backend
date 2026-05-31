-- =========================================
-- BOM POR VARIANTE
-- =========================================
--
-- Agrega `varianteId` opcional a ProductoComponente para soportar recetas
-- por variante del producto final (Peluche talla S/M/L, misma materia prima
-- en distinta cantidad). varianteId NULL = receta del producto base
-- (retrocompatible con todo lo existente).
--
-- La unique pasa a (productoId, varianteId, componenteId). OJO: Postgres NO
-- considera dos NULL como iguales, por lo que esta unique NO protege las
-- recetas base (varianteId NULL) de duplicados — eso se valida a nivel de
-- app en ProductoComponenteService.crear(). Se evitó un índice único parcial
-- (WHERE varianteId IS NULL) porque `prisma migrate dev` los dropea por drift.

-- AddColumn
ALTER TABLE "ProductoComponente" ADD COLUMN "varianteId" TEXT;

-- DropIndex (unique vieja a nivel producto)
DROP INDEX IF EXISTS "ProductoComponente_productoId_componenteId_key";

-- CreateIndex (nueva unique incluyendo variante)
CREATE UNIQUE INDEX "ProductoComponente_productoId_varianteId_componenteId_key"
    ON "ProductoComponente"("productoId", "varianteId", "componenteId");

-- CreateIndex
CREATE INDEX "ProductoComponente_varianteId_idx" ON "ProductoComponente"("varianteId");

-- AddForeignKey: variante (cascade — si se borra la variante, se va su receta)
ALTER TABLE "ProductoComponente" ADD CONSTRAINT "ProductoComponente_varianteId_fkey"
    FOREIGN KEY ("varianteId") REFERENCES "ProductoVariante"("id") ON DELETE CASCADE ON UPDATE CASCADE;
