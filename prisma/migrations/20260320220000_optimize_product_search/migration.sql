-- Habilitar extensión pg_trgm para búsquedas ILIKE eficientes
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Índice GIN trigram en nombre de producto (acelera ILIKE '%texto%')
CREATE INDEX IF NOT EXISTS "Producto_nombre_trgm_idx"
ON "Producto" USING GIN ("nombre" gin_trgm_ops);

-- Índice GIN trigram en descripción de producto
CREATE INDEX IF NOT EXISTS "Producto_descripcion_trgm_idx"
ON "Producto" USING GIN ("descripcion" gin_trgm_ops);

-- Índice para búsqueda exacta de código de barras en variantes
CREATE INDEX IF NOT EXISTS "ProductoVariante_codigoBarras_idx"
ON "ProductoVariante" ("codigoBarras")
WHERE "codigoBarras" IS NOT NULL;

-- Índice compuesto para filtro de stock bajo por empresa
CREATE INDEX IF NOT EXISTS "ProductoStock_stockBajo_idx"
ON "ProductoStock" ("empresaId", "productoId")
WHERE "stockMinimo" IS NOT NULL AND "stockActual" <= "stockMinimo";
