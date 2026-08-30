-- Dónde va el logo en la hoja: IZQUIERDA | CENTRO | DERECHA.
--
-- ADITIVA con default: las plantillas existentes quedan en DERECHA, que es
-- exactamente donde el generador ya lo dibujaba. Nadie ve un cambio.
--
-- String y no enum a propósito: es una perilla de layout que va a ganar
-- valores, y agregar valores a un enum de Postgres es bastante más caro.
ALTER TABLE "PlantillaDocumento"
  ADD COLUMN "posicionLogo" TEXT NOT NULL DEFAULT 'DERECHA';
