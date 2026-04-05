-- Emisor por defecto en Caja: sede/RUC con el que la caja factura
ALTER TABLE "Caja" ADD COLUMN "sedeFacturacionId" TEXT;
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_sedeFacturacionId_fkey" FOREIGN KEY ("sedeFacturacionId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;
