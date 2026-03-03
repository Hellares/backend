-- =============================================
-- Índices GIN trigram para módulo de Compras
-- Optimiza búsquedas ILIKE '%texto%' en 20M+ registros
-- pg_trgm ya fue habilitado en migración anterior
-- =============================================

-- =============================================
-- 1. COMPRA
-- Búsqueda: codigo (startsWith) + nombreProveedor (contains)
-- =============================================

-- nombreProveedor: búsqueda parcial con ILIKE '%valor%'
CREATE INDEX IF NOT EXISTS "Compra_nombreProveedor_trgm_idx"
  ON "Compra" USING GIN ("nombreProveedor" gin_trgm_ops);

-- codigo: búsqueda por prefijo (btree es suficiente para startsWith)
CREATE INDEX IF NOT EXISTS "Compra_codigo_trgm_idx"
  ON "Compra" USING GIN ("codigo" gin_trgm_ops);

-- Índice compuesto para filtro SaaS principal
CREATE INDEX IF NOT EXISTS "Compra_empresaId_estado_creadoEn_idx"
  ON "Compra" ("empresaId", "estado", "creadoEn" DESC);

-- =============================================
-- 2. ORDEN DE COMPRA
-- Búsqueda: codigo (startsWith) + nombreProveedor (contains)
-- =============================================

CREATE INDEX IF NOT EXISTS "OrdenCompra_nombreProveedor_trgm_idx"
  ON "OrdenCompra" USING GIN ("nombreProveedor" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "OrdenCompra_codigo_trgm_idx"
  ON "OrdenCompra" USING GIN ("codigo" gin_trgm_ops);

-- Índice compuesto para filtro SaaS principal
CREATE INDEX IF NOT EXISTS "OrdenCompra_empresaId_estado_creadoEn_idx"
  ON "OrdenCompra" ("empresaId", "estado", "creadoEn" DESC);

-- =============================================
-- 3. LOTE
-- Búsqueda: codigo (startsWith) + numeroLote (contains) + nombreProveedor (contains)
-- =============================================

CREATE INDEX IF NOT EXISTS "Lote_nombreProveedor_trgm_idx"
  ON "Lote" USING GIN ("nombreProveedor" gin_trgm_ops)
  WHERE "nombreProveedor" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Lote_codigo_trgm_idx"
  ON "Lote" USING GIN ("codigo" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Lote_numeroLote_trgm_idx"
  ON "Lote" USING GIN ("numeroLote" gin_trgm_ops)
  WHERE "numeroLote" IS NOT NULL;

-- Índice compuesto para filtro SaaS principal
CREATE INDEX IF NOT EXISTS "Lote_empresaId_estado_creadoEn_idx"
  ON "Lote" ("empresaId", "estado", "creadoEn" DESC);

-- Índice para búsqueda de lotes por productoStockId (consulta frecuente)
CREATE INDEX IF NOT EXISTS "Lote_productoStockId_estado_idx"
  ON "Lote" ("productoStockId", "estado");

-- Índice para lotes próximos a vencer (consulta frecuente)
CREATE INDEX IF NOT EXISTS "Lote_empresaId_fechaVencimiento_estado_idx"
  ON "Lote" ("empresaId", "fechaVencimiento", "estado")
  WHERE "fechaVencimiento" IS NOT NULL;
