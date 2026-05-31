-- Estandariza a 8 dígitos los correlativos de: venta (ya 8), cotización, caja,
-- servicio, orden de servicio, orden de compra, lote e inventario.
-- Default para empresas nuevas + actualización de TODAS las existentes (es una
-- estandarización deliberada). Solo afecta los códigos NUEVOS; los emitidos no
-- cambian.

ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "servicioLongitud" SET DEFAULT 8;
ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "cotizacionLongitud" SET DEFAULT 8;
ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "cajaLongitud" SET DEFAULT 8;
ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "ordenServicioLongitud" SET DEFAULT 8;
ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "ordenCompraLongitud" SET DEFAULT 8;
ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "loteLongitud" SET DEFAULT 8;
ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "inventarioLongitud" SET DEFAULT 8;

UPDATE "ConfiguracionCodigos" SET
  "servicioLongitud" = 8,
  "cotizacionLongitud" = 8,
  "cajaLongitud" = 8,
  "ordenServicioLongitud" = 8,
  "ordenCompraLongitud" = 8,
  "loteLongitud" = 8,
  "inventarioLongitud" = 8;
