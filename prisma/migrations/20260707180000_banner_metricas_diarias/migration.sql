-- Métricas diarias del banner del marketplace (impresiones/taps por día zona
-- Lima) para reportes de publicidad a las empresas. Aditiva.

-- CreateTable
CREATE TABLE "BannerMetricaDiaria" (
    "id" TEXT NOT NULL,
    "bannerId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "impresiones" INTEGER NOT NULL DEFAULT 0,
    "taps" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BannerMetricaDiaria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BannerMetricaDiaria_bannerId_fecha_key" ON "BannerMetricaDiaria"("bannerId", "fecha");

-- AddForeignKey
ALTER TABLE "BannerMetricaDiaria" ADD CONSTRAINT "BannerMetricaDiaria_bannerId_fkey" FOREIGN KEY ("bannerId") REFERENCES "BannerMarketplace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
