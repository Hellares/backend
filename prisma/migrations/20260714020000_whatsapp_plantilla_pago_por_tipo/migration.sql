-- Plantilla de pago por TIPO de sorteo: la existente pasa a ser la de
-- DINAMICA (conserva lo que la empresa ya editó) y se agrega la de
-- SORTEO clásico.
ALTER TABLE "integracion_whatsapp" RENAME COLUMN "plantillaPago" TO "plantillaPagoDinamica";
ALTER TABLE "integracion_whatsapp" ADD COLUMN "plantillaPagoSorteo" TEXT;
