-- AlterTable: agregar bancoPago y referenciaPago a Venta
-- Requerido para bancarización Ley 28194 cuando total >= S/2000 o USD 500

ALTER TABLE "Venta"
  ADD COLUMN "bancoPago" VARCHAR(50),
  ADD COLUMN "referenciaPago" VARCHAR(50);
