-- Avisos del dueño de la plataforma en el slider del marketplace (festividades,
-- promoción del app) con vigencia programada. Aditiva.

-- CreateTable
CREATE TABLE "BannerPlataforma" (
    "id" TEXT NOT NULL,
    "titulo" TEXT,
    "texto" TEXT NOT NULL,
    "colorFondo" TEXT NOT NULL DEFAULT '#C62828',
    "colorTexto" TEXT,
    "colorBrillo" TEXT,
    "lottieFondoId" TEXT,
    "logoUrl" TEXT,
    "link" TEXT,
    "vigenciaDesde" TIMESTAMP(3),
    "vigenciaHasta" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BannerPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BannerPlataforma_isActive_idx" ON "BannerPlataforma"("isActive");

-- AddForeignKey
ALTER TABLE "BannerPlataforma" ADD CONSTRAINT "BannerPlataforma_lottieFondoId_fkey" FOREIGN KEY ("lottieFondoId") REFERENCES "LottieFondo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
