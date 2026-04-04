-- Sede: campos opcionales de facturación electrónica (override por sede)
ALTER TABLE "Sede" ADD COLUMN "rucSede" TEXT;
ALTER TABLE "Sede" ADD COLUMN "razonSocialSede" TEXT;
ALTER TABLE "Sede" ADD COLUMN "direccionFiscalSede" TEXT;
ALTER TABLE "Sede" ADD COLUMN "nubefactRuta" TEXT;
ALTER TABLE "Sede" ADD COLUMN "nubefactToken" TEXT;
ALTER TABLE "Sede" ADD COLUMN "nubefactActivo" BOOLEAN;
ALTER TABLE "Sede" ADD COLUMN "resolucionSunat" TEXT;

-- ComprobanteElectronico: sedeId para saber desde qué sede se emitió
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "sedeId" TEXT;
ALTER TABLE "ComprobanteElectronico" ADD CONSTRAINT "ComprobanteElectronico_sedeId_fkey"
  FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ComprobanteElectronico_sedeId_idx" ON "ComprobanteElectronico"("sedeId");
