-- Agrega la acción COMPRAR a TipoAccionComponente (componente solicitado como
-- repuesto a comprar). PostgreSQL 12+: ADD VALUE es permitido en transacción
-- mientras no se use el valor en la misma migración. Idempotente.
ALTER TYPE "TipoAccionComponente" ADD VALUE IF NOT EXISTS 'COMPRAR';
