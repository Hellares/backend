-- Banner promocional de empresas en el home del marketplace (slider 60px
-- entre categorías y ofertas), gateado por la característica premium
-- BANNER_MARKETPLACE. Catálogo LottieFondo lo carga la plataforma. Aditiva.

-- AlterEnum
ALTER TYPE "CaracteristicaPremium" ADD VALUE IF NOT EXISTS 'BANNER_MARKETPLACE';

-- CreateTable
CREATE TABLE "LottieFondo" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LottieFondo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannerMarketplace" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "colorFondo" TEXT NOT NULL DEFAULT '#1565C0',
    "lottieFondoId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BannerMarketplace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BannerMarketplace_empresaId_key" ON "BannerMarketplace"("empresaId");

-- CreateIndex
CREATE INDEX "BannerMarketplace_isActive_idx" ON "BannerMarketplace"("isActive");

-- AddForeignKey
ALTER TABLE "BannerMarketplace" ADD CONSTRAINT "BannerMarketplace_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannerMarketplace" ADD CONSTRAINT "BannerMarketplace_lottieFondoId_fkey" FOREIGN KEY ("lottieFondoId") REFERENCES "LottieFondo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
