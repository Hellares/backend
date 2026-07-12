-- CreateEnum
CREATE TYPE "EstadoWhatsappInstancia" AS ENUM ('PENDIENTE_QR', 'CONECTADO', 'DESCONECTADO');

-- CreateTable
CREATE TABLE "integracion_whatsapp" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "instanceName" TEXT NOT NULL,
    "estado" "EstadoWhatsappInstancia" NOT NULL DEFAULT 'PENDIENTE_QR',
    "numero" TEXT,
    "plantillaPremio" TEXT,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "conectadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integracion_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integracion_whatsapp_empresaId_key" ON "integracion_whatsapp"("empresaId");

-- CreateIndex
CREATE UNIQUE INDEX "integracion_whatsapp_instanceName_key" ON "integracion_whatsapp"("instanceName");

-- AddForeignKey
ALTER TABLE "integracion_whatsapp" ADD CONSTRAINT "integracion_whatsapp_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
