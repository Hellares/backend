-- Presentación por fondo Lottie del catálogo (fit/alignment/widthFactor/
-- opacity): las animaciones puntuales (estrellas, destello…) no deben ir en
-- cover a pantalla completa como confeti. Editable sin APK. Aditiva.

-- AlterTable
ALTER TABLE "LottieFondo" ADD COLUMN "config" JSONB;
