-- Autoservicio del banner: la empresa solicita un pack de días (1d S/5,
-- 2d S/8, 3d S/10) y el admin aprueba desde syncronize-admin. Aditiva.

-- CreateEnum
CREATE TYPE "EstadoSolicitudBanner" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "SolicitudBannerMarketplace" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "dias" INTEGER NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "estado" "EstadoSolicitudBanner" NOT NULL DEFAULT 'PENDIENTE',
    "atendidoPorId" TEXT,
    "atendidoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SolicitudBannerMarketplace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolicitudBannerMarketplace_estado_creadoEn_idx" ON "SolicitudBannerMarketplace"("estado", "creadoEn");

-- CreateIndex
CREATE INDEX "SolicitudBannerMarketplace_empresaId_idx" ON "SolicitudBannerMarketplace"("empresaId");

-- AddForeignKey
ALTER TABLE "SolicitudBannerMarketplace" ADD CONSTRAINT "SolicitudBannerMarketplace_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
