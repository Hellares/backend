-- CreateEnum
CREATE TYPE "TipoUbicacion" AS ENUM ('ZONA', 'PASILLO', 'ESTANTE', 'NIVEL', 'BIN');

-- AlterTable: Mora config en ConfiguracionEmpresa
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN     "diasGraciaMora" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "moraHabilitada" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "moraMaximaPorcentaje" DECIMAL(5,2) DEFAULT 30.0,
ADD COLUMN     "porcentajeMoraDiario" DECIMAL(5,4) DEFAULT 0.05;

-- AlterTable: Campos mora en CuotaVenta
ALTER TABLE "CuotaVenta" ADD COLUMN     "diasVencido" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fechaCalculoMora" TIMESTAMP(3);

-- AlterTable: Vencimiento en SolicitudCotizacion
ALTER TABLE "SolicitudCotizacion" ADD COLUMN     "fechaVencimiento" TIMESTAMP(3);

-- CreateTable: UbicacionAlmacen
CREATE TABLE "UbicacionAlmacen" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" "TipoUbicacion" NOT NULL DEFAULT 'ZONA',
    "parentId" TEXT,
    "capacidadMaxima" INTEGER,
    "descripcion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UbicacionAlmacen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UbicacionAlmacen_empresaId_sedeId_idx" ON "UbicacionAlmacen"("empresaId", "sedeId");

-- CreateIndex
CREATE INDEX "UbicacionAlmacen_empresaId_sedeId_tipo_idx" ON "UbicacionAlmacen"("empresaId", "sedeId", "tipo");

-- CreateIndex
CREATE INDEX "UbicacionAlmacen_parentId_idx" ON "UbicacionAlmacen"("parentId");

-- CreateIndex
CREATE INDEX "UbicacionAlmacen_isActive_idx" ON "UbicacionAlmacen"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "UbicacionAlmacen_empresaId_sedeId_codigo_key" ON "UbicacionAlmacen"("empresaId", "sedeId", "codigo");

-- AddForeignKey
ALTER TABLE "UbicacionAlmacen" ADD CONSTRAINT "UbicacionAlmacen_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UbicacionAlmacen" ADD CONSTRAINT "UbicacionAlmacen_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UbicacionAlmacen" ADD CONSTRAINT "UbicacionAlmacen_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "UbicacionAlmacen"("id") ON DELETE SET NULL ON UPDATE CASCADE;
