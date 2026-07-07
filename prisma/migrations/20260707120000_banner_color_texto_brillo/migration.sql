-- La empresa elige el color del TEXTO del banner (null = contraste automático)
-- y el color del BRILLO/destello que recorre el texto (null = default del app).
-- Aditiva.

-- AlterTable
ALTER TABLE "BannerMarketplace" ADD COLUMN "colorTexto" TEXT;
ALTER TABLE "BannerMarketplace" ADD COLUMN "colorBrillo" TEXT;
