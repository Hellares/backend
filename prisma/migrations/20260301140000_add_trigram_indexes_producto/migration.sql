-- pg_trgm ya fue habilitado en migración anterior

-- =============================================
-- Índices GIN trigram en Producto (búsqueda de productos)
-- Optimiza: WHERE nombre ILIKE '%valor%' OR sku ILIKE '%valor%' ...
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
-- Índice compuesto para filtro principal + soft delete
-- Cubre: WHERE empresaId = X AND deletedAt IS NULL
-- =============================================
CREATE INDEX IF NOT EXISTS "Producto_empresaId_deletedAt_nombre_idx"
  ON "Producto" ("empresaId", "deletedAt", "nombre");

-- =============================================
-- Índice para ProductoStock por sede (acelera subquery de stock)
-- Cubre: WHERE sedeId = X AND productoId IS NOT NULL
-- =============================================
CREATE INDEX IF NOT EXISTS "ProductoStock_sedeId_productoId_idx"
  ON "ProductoStock" ("sedeId", "productoId")
  WHERE "productoId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "ProductoStock_sedeId_varianteId_idx"
  ON "ProductoStock" ("sedeId", "varianteId")
  WHERE "varianteId" IS NOT NULL;
