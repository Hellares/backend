-- CreateEnum
CREATE TYPE "TipoArqueoCaja" AS ENUM ('RUTINARIO', 'SORPRESIVO', 'RELEVO');

-- CreateTable
CREATE TABLE "ArqueoCaja" (
    "id" TEXT NOT NULL,
    "cajaId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "TipoArqueoCaja" NOT NULL,
    "montoApertura" DECIMAL(10,2) NOT NULL,
    "totalIngresos" DECIMAL(10,2) NOT NULL,
    "totalEgresos" DECIMAL(10,2) NOT NULL,
    "totalEsperado" DECIMAL(10,2) NOT NULL,
    "totalConteoFisico" DECIMAL(10,2) NOT NULL,
    "diferencia" DECIMAL(10,2) NOT NULL,
    "detallePorMetodoPago" JSONB NOT NULL,
    "observaciones" TEXT,
    "realizadoPorId" TEXT NOT NULL,
    "autorizadoPorId" TEXT,
    "turnoEntregadoAId" TEXT,
    "alertaEnviada" BOOLEAN NOT NULL DEFAULT false,
    "fechaArqueo" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArqueoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArqueoCaja_cajaId_idx" ON "ArqueoCaja"("cajaId");

-- CreateIndex
CREATE INDEX "ArqueoCaja_empresaId_fechaArqueo_idx" ON "ArqueoCaja"("empresaId", "fechaArqueo");

-- CreateIndex
CREATE INDEX "ArqueoCaja_tipo_idx" ON "ArqueoCaja"("tipo");

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_cajaId_fkey" FOREIGN KEY ("cajaId") REFERENCES "Caja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_realizadoPorId_fkey" FOREIGN KEY ("realizadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArqueoCaja" ADD CONSTRAINT "ArqueoCaja_turnoEntregadoAId_fkey" FOREIGN KEY ("turnoEntregadoAId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
