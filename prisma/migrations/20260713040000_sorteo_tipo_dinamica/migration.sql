-- CreateEnum
CREATE TYPE "TipoSorteo" AS ENUM ('SORTEO', 'DINAMICA');

-- AlterTable
ALTER TABLE "Sorteo" ADD COLUMN "tipo" "TipoSorteo" NOT NULL DEFAULT 'SORTEO';
