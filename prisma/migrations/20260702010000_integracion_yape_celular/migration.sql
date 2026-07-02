-- Número Yape del comercio en la integración api-yape: el comprador del
-- marketplace lo copia (sin verlo) para pagar desde la app Yape. Aditiva.

-- AlterTable
ALTER TABLE "integracion_yape" ADD COLUMN "celular" TEXT;
