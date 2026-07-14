-- Imagen opcional del premio del catálogo (Archivo polimórfico).
ALTER TYPE "EntidadTipo" ADD VALUE IF NOT EXISTS 'SORTEO_PREMIO_CATALOGO';

-- Catálogo de premios de la RIFA con ánfora: se registran antes de jugar
-- ("3× S/ 500 en efectivo", "2× celular"); cada unidad se adjudica al
-- salir un ticket ganador (SorteoPremio.catalogoId).
CREATE TABLE "SorteoPremioCatalogo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sorteoId" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SorteoPremioCatalogo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SorteoPremioCatalogo_sorteoId_idx" ON "SorteoPremioCatalogo"("sorteoId");

ALTER TABLE "SorteoPremioCatalogo" ADD CONSTRAINT "SorteoPremioCatalogo_sorteoId_fkey"
    FOREIGN KEY ("sorteoId") REFERENCES "Sorteo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SorteoPremio" ADD COLUMN "catalogoId" TEXT;

CREATE INDEX "SorteoPremio_catalogoId_idx" ON "SorteoPremio"("catalogoId");

ALTER TABLE "SorteoPremio" ADD CONSTRAINT "SorteoPremio_catalogoId_fkey"
    FOREIGN KEY ("catalogoId") REFERENCES "SorteoPremioCatalogo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
