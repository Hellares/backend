-- Cabecera configurable del mensaje de confirmación al validar el pago,
-- una por tipo de sorteo. Variables: {nombre} {titulo} {ticket} {empresa}.
ALTER TABLE "integracion_whatsapp" ADD COLUMN "plantillaConfirmacionSorteo" TEXT;
ALTER TABLE "integracion_whatsapp" ADD COLUMN "plantillaConfirmacionDinamica" TEXT;
