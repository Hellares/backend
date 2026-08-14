-- Plantillas de atributos aplicadas a un producto, como SECCIONES de su ficha
-- tecnica: un celular puede traer PROCESADOR, MEMORIA, PANTALLA y DISENO.
--
-- Es memoria de la UI: los valores siguen viviendo en ProductoAtributoValor por
-- atributo, asi que quitar una plantilla no borra nada de lo cargado. Sin esta
-- columna, al reabrir el producto los atributos aparecen sueltos y no hay como
-- saber en que secciones agruparlos.
ALTER TABLE "Producto" ADD COLUMN IF NOT EXISTS "plantillasAtributosIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
