-- Geocoder propio Fase 1 (delivery): direcciones confirmadas con pin.
-- La búsqueda usa trigram (pg_trgm) sobre textoNormalizado.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE "DireccionFrecuente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "textoNormalizado" TEXT NOT NULL,
    "referencia" TEXT,
    "distrito" TEXT,
    "lat" DECIMAL(10,7) NOT NULL,
    "lon" DECIMAL(10,7) NOT NULL,
    "telefonoCliente" TEXT,
    "usos" INTEGER NOT NULL DEFAULT 1,
    "ultimoUsoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DireccionFrecuente_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DireccionFrecuente_empresaId_textoNormalizado_key"
    ON "DireccionFrecuente"("empresaId", "textoNormalizado");
CREATE INDEX "DireccionFrecuente_empresaId_telefonoCliente_idx"
    ON "DireccionFrecuente"("empresaId", "telefonoCliente");
-- Trigram para búsqueda difusa ("mercado modelo" ≈ "mercado modelo puesto 12")
CREATE INDEX "DireccionFrecuente_textoNormalizado_trgm_idx"
    ON "DireccionFrecuente" USING gin ("textoNormalizado" gin_trgm_ops);

ALTER TABLE "DireccionFrecuente" ADD CONSTRAINT "DireccionFrecuente_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
