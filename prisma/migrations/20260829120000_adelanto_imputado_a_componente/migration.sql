-- Imputar un abono del libro de adelantos a un componente de la orden.
--
-- ETIQUETA, no cuenta aparte: el saldo de la orden sigue siendo
-- facturable − adelanto − descuento. Sirve para decir "estos 100 son la
-- carcasa" y para mostrar qué repuesto ya está cubierto.
--
-- ADITIVA: columna nullable, sin backfill. Todos los abonos existentes quedan
-- con NULL = imputados al costo del servicio (o sin imputar), que es
-- exactamente lo que eran. El rollback es volver a la imagen anterior.
ALTER TABLE "AdelantoOrdenServicio"
  ADD COLUMN "servicioComponenteId" TEXT;

CREATE INDEX "AdelantoOrdenServicio_servicioComponenteId_idx"
  ON "AdelantoOrdenServicio"("servicioComponenteId");

-- SET NULL y no CASCADE: si se borra el componente, la plata cobrada sigue
-- existiendo. Se pierde la imputación, nunca la fila del libro.
ALTER TABLE "AdelantoOrdenServicio"
  ADD CONSTRAINT "AdelantoOrdenServicio_servicioComponenteId_fkey"
  FOREIGN KEY ("servicioComponenteId") REFERENCES "ServicioComponente"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
