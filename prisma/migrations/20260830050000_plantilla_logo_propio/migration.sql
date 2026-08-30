-- Logo propio por tipo de documento.
--
-- Un logo cuadrado se ve bien en un ticket de 80 mm y se pierde en la cabecera
-- de una cotización A4, que pide uno apaisado. Con este campo cada plantilla
-- puede tener el suyo.
--
-- ADITIVA y NULLABLE: null = sigue usando el logo de la marca, que es lo que
-- todas las plantillas hacen hoy. Nadie ve un cambio.
ALTER TABLE "PlantillaDocumento"
  ADD COLUMN "logoUrl" TEXT;
