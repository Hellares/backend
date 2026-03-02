-- Habilitar extensión pg_trgm para búsquedas parciales con ILIKE
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================
-- Índices GIN trigram en Persona (búsqueda de clientes)
-- Optimiza: WHERE nombres ILIKE '%valor%'
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
-- Índices GIN trigram en Cotizacion (búsqueda en cotizaciones)
-- Optimiza: WHERE nombreCliente ILIKE '%valor%'
-- =============================================
CREATE INDEX IF NOT EXISTS "Cotizacion_nombreCliente_trgm_idx"
  ON "Cotizacion" USING GIN ("nombreCliente" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Cotizacion_documentoCliente_trgm_idx"
  ON "Cotizacion" USING GIN ("documentoCliente" gin_trgm_ops);
