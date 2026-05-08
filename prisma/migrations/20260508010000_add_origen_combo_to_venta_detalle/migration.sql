-- AlterTable: agregar trazabilidad de combo origen en VentaDetalle.
-- Cuando un componente se vende como parte de un combo expandido, estos
-- campos identifican el combo. NULL si el item se vendió suelto.
ALTER TABLE "VentaDetalle"
  ADD COLUMN "origenComboId" TEXT,
  ADD COLUMN "origenComboNombre" VARCHAR(120);

-- CreateIndex
CREATE INDEX "VentaDetalle_origenComboId_idx" ON "VentaDetalle"("origenComboId");

-- AddForeignKey (apunta a Producto que es donde viven los combos con esCombo=true)
ALTER TABLE "VentaDetalle"
  ADD CONSTRAINT "VentaDetalle_origenComboId_fkey"
  FOREIGN KEY ("origenComboId") REFERENCES "Producto"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
