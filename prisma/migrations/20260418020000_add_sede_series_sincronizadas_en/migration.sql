-- Timestamp de última sincronización de series entre la Sede y el proveedor
-- de facturación (Syncrofact/etc). Permite mostrar "Última sincronización: X"
-- en la UI y detectar sedes que llevan tiempo sin sincronizar.

ALTER TABLE "Sede" ADD COLUMN "seriesSincronizadasEn" TIMESTAMP(3);
