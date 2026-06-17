-- Nueva categoría de archivo para los QR de cobro Yape/Plin del comercio.
-- ADD VALUE no puede usarse en la misma transacción donde se crea, pero aquí
-- solo se agrega (PG 12+ lo permite). IF NOT EXISTS lo hace idempotente.
ALTER TYPE "CategoriaArchivo" ADD VALUE IF NOT EXISTS 'QR_COBRO';
