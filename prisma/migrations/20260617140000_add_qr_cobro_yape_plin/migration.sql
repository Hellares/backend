-- QR de cobro Yape/Plin (imagen estática del comercio) en la config de empresa.
-- Se muestra en la hoja de cobro para que el cliente escanee; el monto se
-- teclea aparte. Nullable: la empresa puede no tenerlo configurado.
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN "qrYapeUrl" TEXT;
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN "qrPlinUrl" TEXT;
