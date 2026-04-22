-- Nuevo valor del enum AccionAudit para auditar sincronización de series
ALTER TYPE "AccionAudit" ADD VALUE IF NOT EXISTS 'SERIES_SINCRONIZADAS';
