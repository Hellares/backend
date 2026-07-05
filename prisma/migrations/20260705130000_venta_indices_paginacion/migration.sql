-- Índices para la lista de ventas paginada por cursor.
-- 1) Compuesto empresa + orden cronológico (el listado ordena por creadoEn).
CREATE INDEX IF NOT EXISTS "Venta_empresaId_creadoEn_idx"
  ON "Venta"("empresaId", "creadoEn" DESC);

-- 2) GIN trigram para el search del listado (codigo/nombreCliente/
--    documentoCliente hacen ILIKE '%texto%').
CREATE INDEX IF NOT EXISTS "Venta_codigo_trgm_idx"
  ON "Venta" USING GIN ("codigo" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Venta_nombreCliente_trgm_idx"
  ON "Venta" USING GIN ("nombreCliente" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Venta_documentoCliente_trgm_idx"
  ON "Venta" USING GIN ("documentoCliente" gin_trgm_ops);
