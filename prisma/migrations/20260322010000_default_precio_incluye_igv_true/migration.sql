-- Cambiar default de precioIncluyeIgv a true
ALTER TABLE "ProductoStock" ALTER COLUMN "precioIncluyeIgv" SET DEFAULT true;

-- Actualizar registros existentes que están en false
UPDATE "ProductoStock" SET "precioIncluyeIgv" = true WHERE "precioIncluyeIgv" = false;
