-- =============================================================================
-- Cambio de proveedor de facturación: Nubefact -> Syncrofact con enrutamiento
-- =============================================================================

-- 1. Enum con los proveedores soportados
CREATE TYPE "ProveedorFacturacion" AS ENUM ('NUBEFACT', 'SYNCROFACT');

-- 2. Config extra flexible del proveedor (ej. Syncrofact: { companyId, branchId })
ALTER TABLE "ConfiguracionFacturacion" ADD COLUMN "proveedorConfig" JSONB;
ALTER TABLE "Sede" ADD COLUMN "proveedorConfig" JSONB;

-- 3. Proveedor activo (el que emitirá nuevos comprobantes)
--    ConfiguracionFacturacion: NOT NULL con default SYNCROFACT (empresas nuevas)
--    Sede: nullable (null = usa el de la empresa)
ALTER TABLE "ConfiguracionFacturacion"
  ADD COLUMN "proveedorActivo" "ProveedorFacturacion" NOT NULL DEFAULT 'SYNCROFACT';

ALTER TABLE "Sede"
  ADD COLUMN "proveedorActivo" "ProveedorFacturacion";

-- 4. Proveedor emisor por comprobante (se graba al crear, nunca cambia)
ALTER TABLE "ComprobanteElectronico"
  ADD COLUMN "proveedorEmisor" "ProveedorFacturacion";

-- 5. Backfill: todos los comprobantes históricos fueron emitidos por Nubefact
UPDATE "ComprobanteElectronico"
  SET "proveedorEmisor" = 'NUBEFACT'
  WHERE "proveedorEmisor" IS NULL;

-- 6. Backfill: empresas existentes mantienen NUBEFACT como activo hasta migrar manualmente.
--    (El default SYNCROFACT solo aplica a filas nuevas.)
UPDATE "ConfiguracionFacturacion" SET "proveedorActivo" = 'NUBEFACT';

-- 7. Índice para filtrar por proveedor emisor en monitor de facturación
CREATE INDEX "ComprobanteElectronico_empresaId_proveedorEmisor_idx"
  ON "ComprobanteElectronico"("empresaId", "proveedorEmisor");
