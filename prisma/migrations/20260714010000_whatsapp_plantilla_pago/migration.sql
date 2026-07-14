-- Plantilla de las instrucciones de pago del bot (null = default del
-- sistema). Variables: {monto} {numero} {empresa}.
ALTER TABLE "integracion_whatsapp" ADD COLUMN "plantillaPago" TEXT;
