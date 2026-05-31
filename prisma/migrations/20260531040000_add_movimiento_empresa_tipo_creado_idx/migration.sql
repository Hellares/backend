-- Índice para la lista global de producción (GET /produccion/lotes):
-- filtra por empresaId + tipo='PRODUCCION_ENTRADA' y ordena por creadoEn desc.

CREATE INDEX "MovimientoStock_empresaId_tipo_creadoEn_idx"
  ON "MovimientoStock" ("empresaId", "tipo", "creadoEn" DESC);
