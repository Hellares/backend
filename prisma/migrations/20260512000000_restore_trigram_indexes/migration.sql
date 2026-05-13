-- =============================================
-- RESTAURACIÓN DE ÍNDICES GIN TRIGRAM
--
-- Origen del problema:
--   `prisma migrate dev` compara `schema.prisma` con la BD para detectar
--   drift. Como los índices GIN trigram fueron creados con SQL crudo y
--   nunca declarados en el schema, Prisma los marcó como "índices
--   inesperados" y los DROP-eó silenciosamente en migraciones autogeneradas
--   posteriores (la primera fue `20260322020000_add_agente_bancario`).
--
-- Resultado: 24 de 26 índices GIN trigram declarados originalmente en
-- marzo desaparecieron. Toda búsqueda ILIKE '%texto%' del sistema
-- (productos, clientes, cotizaciones, compras, proveedores, servicios)
-- estaba haciendo Seq Scan completo.
--
-- Esta migración recrea los 24 índices perdidos. Es idempotente
-- (IF NOT EXISTS), por lo que es seguro re-ejecutarla.
--
-- IMPORTANTE: Para evitar que vuelvan a ser dropeados por una próxima
-- `prisma migrate dev`, hay que declararlos en `schema.prisma` con
-- sintaxis nativa de Prisma 7 (@@index(... type: Gin, ops: raw(...))).
-- Eso es trabajo pendiente — sin esa declaración, la próxima migración
-- autogenerada los volverá a borrar.
-- =============================================

-- Asegurar que la extensión esté disponible (ya debería estarlo)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================
-- Producto (5 índices)
-- =============================================
CREATE INDEX IF NOT EXISTS "Producto_nombre_trgm_idx"
  ON "Producto" USING GIN ("nombre" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Producto_descripcion_trgm_idx"
  ON "Producto" USING GIN ("descripcion" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Producto_codigoEmpresa_trgm_idx"
  ON "Producto" USING GIN ("codigoEmpresa" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Producto_sku_trgm_idx"
  ON "Producto" USING GIN ("sku" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Producto_codigoBarras_trgm_idx"
  ON "Producto" USING GIN ("codigoBarras" gin_trgm_ops);

-- =============================================
-- Persona (5 índices) — búsqueda de clientes
-- =============================================
CREATE INDEX IF NOT EXISTS "Persona_nombres_trgm_idx"
  ON "Persona" USING GIN ("nombres" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Persona_apellidos_trgm_idx"
  ON "Persona" USING GIN ("apellidos" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Persona_dni_trgm_idx"
  ON "Persona" USING GIN ("dni" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Persona_telefono_trgm_idx"
  ON "Persona" USING GIN ("telefono" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Persona_email_trgm_idx"
  ON "Persona" USING GIN ("email" gin_trgm_ops);

-- =============================================
-- Cotizacion (2 índices)
-- =============================================
CREATE INDEX IF NOT EXISTS "Cotizacion_nombreCliente_trgm_idx"
  ON "Cotizacion" USING GIN ("nombreCliente" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Cotizacion_documentoCliente_trgm_idx"
  ON "Cotizacion" USING GIN ("documentoCliente" gin_trgm_ops);

-- =============================================
-- Compra (2 índices)
-- =============================================
CREATE INDEX IF NOT EXISTS "Compra_nombreProveedor_trgm_idx"
  ON "Compra" USING GIN ("nombreProveedor" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Compra_codigo_trgm_idx"
  ON "Compra" USING GIN ("codigo" gin_trgm_ops);

-- =============================================
-- OrdenCompra (2 índices)
-- =============================================
CREATE INDEX IF NOT EXISTS "OrdenCompra_nombreProveedor_trgm_idx"
  ON "OrdenCompra" USING GIN ("nombreProveedor" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "OrdenCompra_codigo_trgm_idx"
  ON "OrdenCompra" USING GIN ("codigo" gin_trgm_ops);

-- =============================================
-- Lote (1 índice — los otros 2 sobrevivieron al drift)
-- =============================================
CREATE INDEX IF NOT EXISTS "Lote_codigo_trgm_idx"
  ON "Lote" USING GIN ("codigo" gin_trgm_ops);

-- =============================================
-- Proveedor (2 índices)
-- =============================================
CREATE INDEX IF NOT EXISTS "Proveedor_nombre_trgm_idx"
  ON "Proveedor" USING GIN ("nombre" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Proveedor_numeroDocumento_trgm_idx"
  ON "Proveedor" USING GIN ("numeroDocumento" gin_trgm_ops);

-- =============================================
-- Servicio (1 índice)
-- =============================================
CREATE INDEX IF NOT EXISTS "Servicio_nombre_trgm_idx"
  ON "Servicio" USING GIN ("nombre" gin_trgm_ops);

-- =============================================
-- Empresa (1 índice) — búsqueda marketplace
-- =============================================
CREATE INDEX IF NOT EXISTS "Empresa_nombre_trgm_idx"
  ON "Empresa" USING GIN ("nombre" gin_trgm_ops);

-- =============================================
-- ProductoAtributo / Valor / Plantilla (3 índices)
-- =============================================
CREATE INDEX IF NOT EXISTS "ProductoAtributo_nombre_trgm_idx"
  ON "ProductoAtributo" USING GIN ("nombre" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ProductoAtributoValor_valor_trgm_idx"
  ON "ProductoAtributoValor" USING GIN ("valor" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ProductoAtributoPlantilla_nombre_trgm_idx"
  ON "ProductoAtributoPlantilla" USING GIN ("nombre" gin_trgm_ops);
