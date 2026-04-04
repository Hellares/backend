-- ConfiguracionFacturacion: agregar credenciales Nubefact
ALTER TABLE "ConfiguracionFacturacion" ADD COLUMN "nubefactRuta" TEXT;
ALTER TABLE "ConfiguracionFacturacion" ADD COLUMN "nubefactToken" TEXT;
ALTER TABLE "ConfiguracionFacturacion" ADD COLUMN "nubefactActivo" BOOLEAN NOT NULL DEFAULT false;

-- ComprobanteElectronico: campos de respuesta Nubefact
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "sunatCdrUrl" TEXT;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "cadenaQR" TEXT;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "enlaceNubefact" TEXT;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "nubefactEnviado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "nubefactError" TEXT;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "intentosEnvio" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "ultimoIntentoEnvio" TIMESTAMP(3);

-- ComprobanteElectronico: self-relation para Notas Crédito/Débito
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "comprobanteOrigenId" TEXT;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "tipoNotaCredito" INTEGER;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "tipoNotaDebito" INTEGER;
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "motivoNota" TEXT;

-- Foreign key para self-relation
ALTER TABLE "ComprobanteElectronico" ADD CONSTRAINT "ComprobanteElectronico_comprobanteOrigenId_fkey"
  FOREIGN KEY ("comprobanteOrigenId") REFERENCES "ComprobanteElectronico"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índices
CREATE INDEX "ComprobanteElectronico_comprobanteOrigenId_idx" ON "ComprobanteElectronico"("comprobanteOrigenId");
CREATE INDEX "ComprobanteElectronico_sunatStatus_idx" ON "ComprobanteElectronico"("sunatStatus");
