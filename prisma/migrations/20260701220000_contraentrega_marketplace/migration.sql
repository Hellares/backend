-- Contraentrega en el marketplace: nuevo método de pago (paga al recibir) y
-- flag opt-in por empresa. Aditiva.

-- AlterEnum
ALTER TYPE "MetodoPagoMarketplace" ADD VALUE 'CONTRAENTREGA';

-- AlterTable
ALTER TABLE "Empresa" ADD COLUMN "permiteContraentrega" BOOLEAN NOT NULL DEFAULT false;
