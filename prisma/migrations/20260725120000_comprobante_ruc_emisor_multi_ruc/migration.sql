-- Multi-RUC: serie+correlativo (y codigoGenerado) son únicos POR EMISOR ante
-- SUNAT, no por empresa. Una sede-socio con rucSede propio puede usar F001
-- aunque el emisor principal también la tenga.

-- 1. Columna del RUC emisor (snapshot al emitir)
ALTER TABLE "ComprobanteElectronico" ADD COLUMN "rucEmisor" TEXT;

-- 2. Backfill: todo lo emitido hasta hoy fue con el RUC de la empresa
--    (no existían sedes-socio antes de esta migración).
UPDATE "ComprobanteElectronico" c
SET "rucEmisor" = e.ruc
FROM "Empresa" e
WHERE e.id = c."empresaId" AND c."rucEmisor" IS NULL;

-- 3. Reemplazar los únicos empresa-wide por únicos POR EMISOR
DROP INDEX "ComprobanteElectronico_empresaId_tipoComprobante_serie_corr_key";
CREATE UNIQUE INDEX "ComprobanteElectronico_empresa_emisor_tipo_serie_corr_key"
  ON "ComprobanteElectronico"("empresaId", "rucEmisor", "tipoComprobante", "serie", "correlativo");

DROP INDEX "ComprobanteElectronico_empresaId_codigoGenerado_key";
CREATE UNIQUE INDEX "ComprobanteElectronico_empresa_emisor_codigo_key"
  ON "ComprobanteElectronico"("empresaId", "rucEmisor", "codigoGenerado");
