-- Pago de la empresa origen al tercero (destino) por el servicio tercerizado.
-- El EGRESO se registra como PAGO_PROVEEDOR en la caja del origen; aquí solo
-- se marca el estado de pago en la tercerización + el id del movimiento.

ALTER TABLE "TercerizacionServicio" ADD COLUMN "pagadoB2B" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TercerizacionServicio" ADD COLUMN "fechaPagoB2B" TIMESTAMP(3);
ALTER TABLE "TercerizacionServicio" ADD COLUMN "movimientoPagoB2BId" TEXT;
