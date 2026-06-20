-- Config de impresoras por dispositivo: persiste al reinstalar el app
-- (keyed por empresa + deviceId/ANDROID_ID).
CREATE TABLE "ImpresoraDispositivo" (
  "id" TEXT NOT NULL,
  "empresaId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "config" JSONB NOT NULL DEFAULT '[]',
  "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImpresoraDispositivo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImpresoraDispositivo_empresaId_deviceId_key" ON "ImpresoraDispositivo"("empresaId", "deviceId");
CREATE INDEX "ImpresoraDispositivo_empresaId_idx" ON "ImpresoraDispositivo"("empresaId");
