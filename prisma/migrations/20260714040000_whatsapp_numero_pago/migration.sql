-- Celular al que los clientes yapean (9 dígitos, editable en la pantalla
-- WhatsApp de la empresa). Null = fallback a IntegracionYape.celular y
-- luego al número vinculado por WhatsApp.
ALTER TABLE "integracion_whatsapp" ADD COLUMN "numeroPago" TEXT;
