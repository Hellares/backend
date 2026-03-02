-- =============================================
-- Índice compuesto en EmpresaPersona para acelerar
-- el JOIN filtrado por empresa + soft delete
-- Cubre: WHERE empresaId = X AND deletedAt IS NULL
-- e incluye personaId para index-only scan en el JOIN
-- =============================================
CREATE INDEX IF NOT EXISTS "EmpresaPersona_empresaId_deletedAt_personaId_idx"
  ON "EmpresaPersona" ("empresaId", "deletedAt", "personaId");

-- =============================================
-- Índice compuesto en Persona para acelerar
-- filtro isActive + soft delete (pre-filtro antes del trigram)
-- =============================================
CREATE INDEX IF NOT EXISTS "Persona_isActive_deletedAt_idx"
  ON "Persona" ("isActive", "deletedAt");
