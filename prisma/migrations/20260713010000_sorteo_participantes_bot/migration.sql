-- CreateEnum
CREATE TYPE "EstadoParticipanteSorteo" AS ENUM ('PENDIENTE_PAGO', 'ACTIVO', 'RECHAZADO');

-- CreateTable
CREATE TABLE "SorteoParticipante" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sorteoId" TEXT NOT NULL,
    "celular" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "dni" TEXT NOT NULL,
    "estado" "EstadoParticipanteSorteo" NOT NULL DEFAULT 'PENDIENTE_PAGO',
    "numeroTicket" INTEGER,
    "activadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SorteoParticipante_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversacion_whatsapp" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "celular" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'MENU',
    "contexto" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversacion_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SorteoParticipante_sorteoId_dni_key" ON "SorteoParticipante"("sorteoId", "dni");

-- CreateIndex
CREATE INDEX "SorteoParticipante_empresaId_celular_idx" ON "SorteoParticipante"("empresaId", "celular");

-- CreateIndex
CREATE INDEX "SorteoParticipante_sorteoId_estado_idx" ON "SorteoParticipante"("sorteoId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "conversacion_whatsapp_empresaId_celular_key" ON "conversacion_whatsapp"("empresaId", "celular");

-- AddForeignKey
ALTER TABLE "SorteoParticipante" ADD CONSTRAINT "SorteoParticipante_sorteoId_fkey" FOREIGN KEY ("sorteoId") REFERENCES "Sorteo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
