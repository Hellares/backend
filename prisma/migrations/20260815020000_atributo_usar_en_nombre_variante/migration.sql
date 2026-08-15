-- Que el valor de un atributo entre o no en el NOMBRE de la variante.
--
-- El nombre se arma con los valores de los atributos marcados, en el orden de
-- `orden`, unidos por " / ". Sirve para dejar fuera lo que ya esta implicito:
-- con FABRICANTE -> FAMILIA -> PROCESADOR alcanza con el procesador, y
-- "AZUL / 860" se lee mejor que "AZUL / QUALQON / SNAPDRAGON 8XX / 860" en un
-- ticket de 58 mm.
--
-- Default true para no cambiarle el nombre a ninguna variante existente: el
-- comportamiento de hoy es que TODOS los atributos entran.
ALTER TABLE "ProductoAtributo"
  ADD COLUMN IF NOT EXISTS "usarEnNombreVariante" BOOLEAN NOT NULL DEFAULT true;
