-- Multi-RUC v2: el emisor socio es una entidad de EMPRESA (no de sede).
-- Cualquier sede puede emitir con cualquier emisor; las series del socio
-- viven en el emisor (Syncrofact = un juego de series por company).

-- 1. Tabla de emisores
CREATE TABLE "EmisorFacturacion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "ruc" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "direccionFiscal" TEXT,
    "proveedorActivo" "ProveedorFacturacion",
    "proveedorRuta" TEXT,
    "proveedorToken" TEXT,
    "proveedorConfig" JSONB,
    "facturacionActiva" BOOLEAN NOT NULL DEFAULT false,
    "resolucionSunat" TEXT,
    "serieFactura" TEXT NOT NULL DEFAULT 'F001',
    "serieBoleta" TEXT NOT NULL DEFAULT 'B001',
    "serieNotaCredito" TEXT NOT NULL DEFAULT 'FC01',
    "serieNotaCreditoBoleta" TEXT NOT NULL DEFAULT 'BC01',
    "serieNotaDebito" TEXT NOT NULL DEFAULT 'FD01',
    "serieNotaDebitoBoleta" TEXT NOT NULL DEFAULT 'BD01',
    "serieGuiaRemision" TEXT,
    "ultimoNumeroFactura" INTEGER NOT NULL DEFAULT 0,
    "ultimoNumeroBoleta" INTEGER NOT NULL DEFAULT 0,
    "ultimoNumeroNotaCredito" INTEGER NOT NULL DEFAULT 0,
    "ultimoNumeroNotaCreditoBoleta" INTEGER NOT NULL DEFAULT 0,
    "ultimoNumeroNotaDebito" INTEGER NOT NULL DEFAULT 0,
    "ultimoNumeroNotaDebitoBoleta" INTEGER NOT NULL DEFAULT 0,
    "ultimoNumeroGuiaRemision" INTEGER NOT NULL DEFAULT 0,
    "seriesSincronizadasEn" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmisorFacturacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmisorFacturacion_empresaId_ruc_key" ON "EmisorFacturacion"("empresaId", "ruc");
CREATE INDEX "EmisorFacturacion_empresaId_idx" ON "EmisorFacturacion"("empresaId");

ALTER TABLE "EmisorFacturacion" ADD CONSTRAINT "EmisorFacturacion_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Venta: emisor elegido en flujos diferidos (Yape)
ALTER TABLE "Venta" ADD COLUMN "emisorIdDiferido" TEXT;

-- 3. Data-move: sedes con RUC propio -> EmisorFacturacion (series y
--    contadores incluidos; aún no emitieron, vienen del sync del proveedor).
INSERT INTO "EmisorFacturacion" (
    "id", "empresaId", "ruc", "razonSocial", "direccionFiscal",
    "proveedorActivo", "proveedorRuta", "proveedorToken", "proveedorConfig",
    "facturacionActiva", "resolucionSunat",
    "serieFactura", "serieBoleta", "serieNotaCredito", "serieNotaCreditoBoleta",
    "serieNotaDebito", "serieNotaDebitoBoleta", "serieGuiaRemision",
    "ultimoNumeroFactura", "ultimoNumeroBoleta", "ultimoNumeroNotaCredito",
    "ultimoNumeroNotaCreditoBoleta", "ultimoNumeroNotaDebito",
    "ultimoNumeroNotaDebitoBoleta", "ultimoNumeroGuiaRemision",
    "seriesSincronizadasEn", "actualizadoEn"
)
SELECT
    'emisor_' || s.id, s."empresaId", s."rucSede",
    COALESCE(s."razonSocialSede", ''), s."direccionFiscalSede",
    s."proveedorActivo", s."proveedorRuta", s."proveedorToken", s."proveedorConfig",
    COALESCE(s."facturacionActiva", false), s."resolucionSunat",
    s."serieFactura", s."serieBoleta", s."serieNotaCredito", s."serieNotaCreditoBoleta",
    s."serieNotaDebito", s."serieNotaDebitoBoleta", s."serieGuiaRemision",
    s."ultimoNumeroFactura", s."ultimoNumeroBoleta", s."ultimoNumeroNotaCredito",
    s."ultimoNumeroNotaCreditoBoleta", s."ultimoNumeroNotaDebito",
    s."ultimoNumeroNotaDebitoBoleta", COALESCE(s."ultimoNumeroGuiaRemision", 0),
    s."seriesSincronizadasEn", CURRENT_TIMESTAMP
FROM "Sede" s
WHERE s."rucSede" IS NOT NULL;

-- 4. Restaurar contadores de las sedes reconvertidas: el sync del socio pudo
--    haberlos alineado a su proveedor (ej. 595 -> 0). La sede vuelve a emitir
--    para el RUC PRINCIPAL: su contador debe cubrir el MAX ya emitido por ese
--    RUC con la serie de la sede.
UPDATE "Sede" s SET
  "ultimoNumeroFactura" = GREATEST(s."ultimoNumeroFactura", COALESCE((
      SELECT MAX(CAST(c.correlativo AS INTEGER)) FROM "ComprobanteElectronico" c
      JOIN "Empresa" e ON e.id = s."empresaId"
      WHERE c."empresaId" = s."empresaId" AND c."rucEmisor" = e.ruc
        AND c."tipoComprobante" = 'FACTURA' AND c.serie = s."serieFactura"), 0)),
  "ultimoNumeroBoleta" = GREATEST(s."ultimoNumeroBoleta", COALESCE((
      SELECT MAX(CAST(c.correlativo AS INTEGER)) FROM "ComprobanteElectronico" c
      JOIN "Empresa" e ON e.id = s."empresaId"
      WHERE c."empresaId" = s."empresaId" AND c."rucEmisor" = e.ruc
        AND c."tipoComprobante" = 'BOLETA' AND c.serie = s."serieBoleta"), 0)),
  "ultimoNumeroNotaCredito" = GREATEST(s."ultimoNumeroNotaCredito", COALESCE((
      SELECT MAX(CAST(c.correlativo AS INTEGER)) FROM "ComprobanteElectronico" c
      JOIN "Empresa" e ON e.id = s."empresaId"
      WHERE c."empresaId" = s."empresaId" AND c."rucEmisor" = e.ruc
        AND c."tipoComprobante" = 'NOTA_CREDITO' AND c.serie = s."serieNotaCredito"), 0)),
  "ultimoNumeroNotaCreditoBoleta" = GREATEST(s."ultimoNumeroNotaCreditoBoleta", COALESCE((
      SELECT MAX(CAST(c.correlativo AS INTEGER)) FROM "ComprobanteElectronico" c
      JOIN "Empresa" e ON e.id = s."empresaId"
      WHERE c."empresaId" = s."empresaId" AND c."rucEmisor" = e.ruc
        AND c."tipoComprobante" = 'NOTA_CREDITO' AND c.serie = s."serieNotaCreditoBoleta"), 0)),
  "ultimoNumeroNotaDebito" = GREATEST(s."ultimoNumeroNotaDebito", COALESCE((
      SELECT MAX(CAST(c.correlativo AS INTEGER)) FROM "ComprobanteElectronico" c
      JOIN "Empresa" e ON e.id = s."empresaId"
      WHERE c."empresaId" = s."empresaId" AND c."rucEmisor" = e.ruc
        AND c."tipoComprobante" = 'NOTA_DEBITO' AND c.serie = s."serieNotaDebito"), 0)),
  "ultimoNumeroNotaDebitoBoleta" = GREATEST(s."ultimoNumeroNotaDebitoBoleta", COALESCE((
      SELECT MAX(CAST(c.correlativo AS INTEGER)) FROM "ComprobanteElectronico" c
      JOIN "Empresa" e ON e.id = s."empresaId"
      WHERE c."empresaId" = s."empresaId" AND c."rucEmisor" = e.ruc
        AND c."tipoComprobante" = 'NOTA_DEBITO' AND c.serie = s."serieNotaDebitoBoleta"), 0))
WHERE s."rucSede" IS NOT NULL;

-- 5. Limpiar el override de facturación en las sedes: vuelven a ser puntos
--    de emisión del RUC principal.
UPDATE "Sede" SET
  "rucSede" = NULL, "razonSocialSede" = NULL, "direccionFiscalSede" = NULL,
  "proveedorActivo" = NULL, "proveedorRuta" = NULL, "proveedorToken" = NULL,
  "proveedorConfig" = NULL, "facturacionActiva" = NULL, "resolucionSunat" = NULL
WHERE "rucSede" IS NOT NULL;
