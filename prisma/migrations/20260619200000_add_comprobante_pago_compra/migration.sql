-- Comprobante (voucher Yape/Plin/transferencia) para pagos a proveedor (CxP).
-- 1) Nuevo valor del enum polimórfico Archivo.EntidadTipo. El valor NO se usa
--    en esta misma migración, así que es seguro en la transacción (PG12+).
-- 2) Columna comprobanteUrl en PagoCompra (URL S3 Contabo, opcional).
ALTER TYPE "EntidadTipo" ADD VALUE IF NOT EXISTS 'PAGO_COMPRA';

ALTER TABLE "PagoCompra" ADD COLUMN IF NOT EXISTS "comprobanteUrl" TEXT;
