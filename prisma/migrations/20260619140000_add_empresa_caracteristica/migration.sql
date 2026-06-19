-- Características PREMIUM por empresa (feature flags con vigencia). El super admin
-- las activa; gate runtime = habilitado && (vigenteHasta IS NULL OR vigenteHasta > now()).
CREATE TYPE "CaracteristicaPremium" AS ENUM ('YAPE_QR');
CREATE TYPE "OrigenCaracteristica" AS ENUM ('PLAN', 'TRIAL', 'ADMIN', 'CORTESIA');

CREATE TABLE "empresa_caracteristica" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "caracteristica" "CaracteristicaPremium" NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "vigenteHasta" TIMESTAMP(3),
    "origen" "OrigenCaracteristica" NOT NULL DEFAULT 'ADMIN',
    "notaAdmin" TEXT,
    "otorgadoPorId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "empresa_caracteristica_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "empresa_caracteristica_empresaId_caracteristica_key" ON "empresa_caracteristica"("empresaId", "caracteristica");
CREATE INDEX "empresa_caracteristica_empresaId_idx" ON "empresa_caracteristica"("empresaId");

ALTER TABLE "empresa_caracteristica" ADD CONSTRAINT "empresa_caracteristica_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
