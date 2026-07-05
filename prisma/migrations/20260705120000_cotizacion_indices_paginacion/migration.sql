-- Índices para la lista de cotizaciones paginada por cursor.
-- 1) Compuesto empresa + orden cronológico: cubre el findMany del listado
--    (where empresaId + orderBy creadoEn desc) sin scan.
CREATE INDEX IF NOT EXISTS "Cotizacion_empresaId_creadoEn_idx"
  ON "Cotizacion"("empresaId", "creadoEn" DESC);

-- 2) GIN trigram sobre codigo: la búsqueda del listado hace
--    codigo ILIKE '%texto%' (nombreCliente y documentoCliente ya lo tenían).
CREATE INDEX IF NOT EXISTS "Cotizacion_codigo_trgm_idx"
  ON "Cotizacion" USING GIN ("codigo" gin_trgm_ops);
