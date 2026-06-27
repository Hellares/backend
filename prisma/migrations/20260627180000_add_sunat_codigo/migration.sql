-- Código de error de SUNAT (ej. "2335", "0103") en comprobantes rechazados.
-- Antes solo se guardaba el mensaje (errorProveedor); el código se descartaba.
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "sunatCodigo" TEXT;
