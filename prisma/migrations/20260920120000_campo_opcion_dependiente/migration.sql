-- AlterEnum
-- Campo de plantilla de servicio con seleccion en CASCADA (Fabricante ->
-- Familia -> Modelo). El arbol de opciones va en la columna `opciones`
-- (Json) que ya existe: no hace falta tabla ni columna nueva.
--
-- IF NOT EXISTS para que reintentar sea seguro si se corta a medias:
-- ADD VALUE no es reversible dentro de la transaccion.
ALTER TYPE "TipoCampoServicio" ADD VALUE IF NOT EXISTS 'OPCION_DEPENDIENTE';
