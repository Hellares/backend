-- Agrega SERVICIO_COMPONENTE a EntidadTipo para asociar imágenes (modelo
-- Archivo polimórfico) a un componente individual de una orden de servicio.
-- PostgreSQL 12+: ADD VALUE permitido en transacción si no se usa en la misma
-- migración. Idempotente.
ALTER TYPE "EntidadTipo" ADD VALUE IF NOT EXISTS 'SERVICIO_COMPONENTE';
