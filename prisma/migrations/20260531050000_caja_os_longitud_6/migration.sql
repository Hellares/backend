-- Subir a 6 dígitos el correlativo de Caja y Orden de Servicio (antes 5).
-- Default para empresas nuevas + actualización de las existentes que aún
-- tienen el default 5 (no se tocan las que el usuario haya personalizado a
-- otro valor). Solo afecta los códigos NUEVOS; los ya emitidos no cambian.

ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "cajaLongitud" SET DEFAULT 6;
ALTER TABLE "ConfiguracionCodigos" ALTER COLUMN "ordenServicioLongitud" SET DEFAULT 6;

UPDATE "ConfiguracionCodigos" SET "cajaLongitud" = 6 WHERE "cajaLongitud" = 5;
UPDATE "ConfiguracionCodigos" SET "ordenServicioLongitud" = 6 WHERE "ordenServicioLongitud" = 5;
