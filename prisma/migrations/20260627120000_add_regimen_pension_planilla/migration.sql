-- CreateEnum
CREATE TYPE "RegimenPension" AS ENUM ('NINGUNO', 'ONP', 'AFP');

-- AlterTable
ALTER TABLE "Empleado" ADD COLUMN     "regimenPension" "RegimenPension" NOT NULL DEFAULT 'NINGUNO';

-- AlterTable
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN     "onpPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 13.0,
ADD COLUMN     "afpAportePorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
ADD COLUMN     "afpComisionPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 1.6,
ADD COLUMN     "afpPrimaPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 1.35;
