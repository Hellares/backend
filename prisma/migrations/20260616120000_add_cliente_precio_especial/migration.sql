-- CreateEnum
CREATE TYPE "EstrategiaMayor" AS ENUM ('PRIMER_NIVEL', 'MEJOR_NIVEL');

-- AlterEnum
ALTER TYPE "TipoCalculoDescuento" ADD VALUE 'PRECIO_COSTO';
ALTER TYPE "TipoCalculoDescuento" ADD VALUE 'PRECIO_MAYOR_DESDE_UNIDAD';

-- AlterTable: PoliticaDescuento (campos de precio especial VIP)
ALTER TABLE "PoliticaDescuento" ADD COLUMN "markupSobreCosto" DECIMAL(5,2);
ALTER TABLE "PoliticaDescuento" ADD COLUMN "estrategiaMayor" "EstrategiaMayor" NOT NULL DEFAULT 'PRIMER_NIVEL';

-- AlterTable: DescuentoUsoHistorial (cliente-aware + usuarioId opcional)
ALTER TABLE "DescuentoUsoHistorial" ALTER COLUMN "usuarioId" DROP NOT NULL;
ALTER TABLE "DescuentoUsoHistorial" ADD COLUMN "clienteId" TEXT;
ALTER TABLE "DescuentoUsoHistorial" ADD COLUMN "clienteEmpresaId" TEXT;
ALTER TABLE "DescuentoUsoHistorial" ADD COLUMN "ventaDetalleId" TEXT;

-- CreateTable
CREATE TABLE "ClientePoliticaDescuento" (
    "id" TEXT NOT NULL,
    "politicaId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT,
    "clienteEmpresaId" TEXT,
    "asignadoPor" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientePoliticaDescuento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientePoliticaDescuento_politicaId_clienteId_key" ON "ClientePoliticaDescuento"("politicaId", "clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientePoliticaDescuento_politicaId_clienteEmpresaId_key" ON "ClientePoliticaDescuento"("politicaId", "clienteEmpresaId");

-- CreateIndex
CREATE INDEX "ClientePoliticaDescuento_empresaId_idx" ON "ClientePoliticaDescuento"("empresaId");

-- CreateIndex
CREATE INDEX "ClientePoliticaDescuento_clienteId_idx" ON "ClientePoliticaDescuento"("clienteId");

-- CreateIndex
CREATE INDEX "ClientePoliticaDescuento_clienteEmpresaId_idx" ON "ClientePoliticaDescuento"("clienteEmpresaId");

-- CreateIndex
CREATE INDEX "ClientePoliticaDescuento_politicaId_idx" ON "ClientePoliticaDescuento"("politicaId");

-- CreateIndex
CREATE INDEX "ClientePoliticaDescuento_isActive_idx" ON "ClientePoliticaDescuento"("isActive");

-- CreateIndex
CREATE INDEX "DescuentoUsoHistorial_clienteId_idx" ON "DescuentoUsoHistorial"("clienteId");

-- CreateIndex
CREATE INDEX "DescuentoUsoHistorial_clienteEmpresaId_idx" ON "DescuentoUsoHistorial"("clienteEmpresaId");

-- AddForeignKey
ALTER TABLE "ClientePoliticaDescuento" ADD CONSTRAINT "ClientePoliticaDescuento_politicaId_fkey" FOREIGN KEY ("politicaId") REFERENCES "PoliticaDescuento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
