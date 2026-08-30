-- Condiciones con las que nace un documento nuevo de este tipo.
--
-- Es un DEFAULT del formulario, no una inyeccion al imprimir: la cotizacion
-- guarda su propio texto, asi que cambiar esto NO reescribe las ya emitidas.
--
-- ADITIVA y NULLABLE: sin valor, el formulario arranca vacio como hasta ahora.
ALTER TABLE "PlantillaDocumento"
  ADD COLUMN "condicionesPorDefecto" TEXT;
