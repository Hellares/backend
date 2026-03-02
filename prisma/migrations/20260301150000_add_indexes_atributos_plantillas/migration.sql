-- =============================================
-- ProductoAtributo: índices para consultas SaaS
-- =============================================

-- findAll: WHERE empresaId = X AND isActive = true ORDER BY orden
CREATE INDEX IF NOT EXISTS "ProductoAtributo_empresaId_isActive_orden_idx"
  ON "ProductoAtributo" ("empresaId", "isActive", "orden");

-- findByCategoria: WHERE categoriaIds @> ARRAY[categoriaId]
-- GIN index para operador "has" en arrays de PostgreSQL
CREATE INDEX IF NOT EXISTS "ProductoAtributo_categoriaIds_gin_idx"
  ON "ProductoAtributo" USING GIN ("categoriaIds");

-- Búsqueda por nombre de atributo (futuro filtrado/búsqueda)
CREATE INDEX IF NOT EXISTS "ProductoAtributo_nombre_trgm_idx"
  ON "ProductoAtributo" USING GIN ("nombre" gin_trgm_ops);

-- findOne/update/remove: WHERE id AND empresaId AND isActive
CREATE INDEX IF NOT EXISTS "ProductoAtributo_id_empresaId_isActive_idx"
  ON "ProductoAtributo" ("id", "empresaId", "isActive");

-- =============================================
-- ProductoAtributoValor: tabla de mayor volumen
-- (cada producto/variante x cada atributo = millones de filas)
-- =============================================

-- getProductoAtributos: WHERE productoId (incluye JOIN con atributo)
-- Compuesto para cubrir el JOIN sin lookup adicional
CREATE INDEX IF NOT EXISTS "ProductoAtributoValor_productoId_atributoId_idx"
  ON "ProductoAtributoValor" ("productoId", "atributoId")
  WHERE "productoId" IS NOT NULL;

-- getVarianteAtributos: WHERE varianteId (incluye JOIN con atributo)
CREATE INDEX IF NOT EXISTS "ProductoAtributoValor_varianteId_atributoId_idx"
  ON "ProductoAtributoValor" ("varianteId", "atributoId")
  WHERE "varianteId" IS NOT NULL;

-- Filtro por valor de atributo (ej: "todos los productos con color = Negro")
-- Trigram para búsqueda parcial en marketplace/catálogo
CREATE INDEX IF NOT EXISTS "ProductoAtributoValor_valor_trgm_idx"
  ON "ProductoAtributoValor" USING GIN ("valor" gin_trgm_ops);

-- Consulta por atributoId + valor (filtros de catálogo: "Socket = AM5")
CREATE INDEX IF NOT EXISTS "ProductoAtributoValor_atributoId_valor_idx"
  ON "ProductoAtributoValor" ("atributoId", "valor");

-- =============================================
-- ProductoAtributoPlantilla: índices para consultas SaaS
-- =============================================

-- findAll: WHERE empresaId AND isActive ORDER BY orden, nombre
CREATE INDEX IF NOT EXISTS "ProductoAtributoPlantilla_empresaId_isActive_orden_idx"
  ON "ProductoAtributoPlantilla" ("empresaId", "isActive", "orden");

-- findAll con categoría: WHERE empresaId AND isActive AND categoriaId
CREATE INDEX IF NOT EXISTS "ProductoAtributoPlantilla_empresaId_isActive_categoriaId_idx"
  ON "ProductoAtributoPlantilla" ("empresaId", "isActive", "categoriaId");

-- Búsqueda por nombre de plantilla
CREATE INDEX IF NOT EXISTS "ProductoAtributoPlantilla_nombre_trgm_idx"
  ON "ProductoAtributoPlantilla" USING GIN ("nombre" gin_trgm_ops);

-- =============================================
-- PlantillaAtributo: índice compuesto para JOIN
-- =============================================

-- Cubre: WHERE plantillaId con JOIN a atributo (include clause)
CREATE INDEX IF NOT EXISTS "PlantillaAtributo_plantillaId_atributoId_orden_idx"
  ON "PlantillaAtributo" ("plantillaId", "atributoId", "orden");

-- =============================================
-- ReglaCompatibilidad: índices para validación SaaS
-- =============================================

-- Validación de compatibilidad entre productos
CREATE INDEX IF NOT EXISTS "ReglaCompatibilidad_empresaId_isActive_idx"
  ON "ReglaCompatibilidad" ("empresaId", "isActive");
