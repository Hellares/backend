-- AlterEnum
-- Los tipos de dato de las plantillas de servicio (TipoCampoServicio) pasan a
-- estar disponibles tambien como tipo de atributo de producto.
--
-- No se agregan TABLA ni OBJETO: guardan estructura y el valor de un atributo
-- es un String con indice GIN para los filtros del marketplace.
--
-- Tampoco se duplican OPCION_SIMPLES / OPCION_MULTIPLE / CHECKBOX: ya existen
-- aca como SELECT / MULTI_SELECT / BOOLEAN. Se unifican las etiquetas que ve
-- el usuario, no los nombres internos, que obligarian a migrar filas vivas.
--
-- IF NOT EXISTS para que reintentar la migracion sea seguro si se corta a
-- medias: ADD VALUE no es reversible dentro de la transaccion.
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'TEXTO_AREA';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'MONEDA';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'EMAIL';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'TELEFONO';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'URL';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'FECHA';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'HORA';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'CODIGO_BARRAS';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'PIN_CLAVE';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'PATRON_DESBLOQUEO';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'DOCUMENTO_IDENTIDAD';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'PLACA_VEHICULO';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'LICENCIA_CONDUCIR';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'FOTO';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'FIRMA';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'ARCHIVO';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'INSPECCION_VISUAL';
ALTER TYPE "AtributoTipo" ADD VALUE IF NOT EXISTS 'PRODUCTO_CATALOGO';
