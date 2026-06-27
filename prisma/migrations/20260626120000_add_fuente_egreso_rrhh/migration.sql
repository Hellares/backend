-- CreateEnum
CREATE TYPE "FuenteEgreso" AS ENUM ('TESORERIA', 'CAJA', 'BANCO');

-- AlterTable
ALTER TABLE "AdelantoPago" ADD COLUMN     "bancoId" TEXT,
ADD COLUMN     "fuentePago" "FuenteEgreso";

-- AlterTable
ALTER TABLE "BoletaPago" ADD COLUMN     "bancoId" TEXT,
ADD COLUMN     "fuentePago" "FuenteEgreso";
