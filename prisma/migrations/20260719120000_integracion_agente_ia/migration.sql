-- CreateEnum
CREATE TYPE "ModoAgenteIA" AS ENUM ('SOLO_CONSULTA', 'VENDE');

-- CreateTable
CREATE TABLE "integracion_agente_ia" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT false,
    "nombreAgente" TEXT,
    "promptPersonalidad" TEXT,
    "mensajeBienvenida" TEXT,
    "modo" "ModoAgenteIA" NOT NULL DEFAULT 'SOLO_CONSULTA',
    "puedeCobrarYape" BOOLEAN NOT NULL DEFAULT false,
    "escalarAHumano" BOOLEAN NOT NULL DEFAULT true,
    "horarioTexto" TEXT,
    "proveedorPropio" BOOLEAN NOT NULL DEFAULT false,
    "proveedorTipo" TEXT,
    "proveedorModelo" TEXT,
    "proveedorApiKey" TEXT,
    "proveedorAprobado" BOOLEAN NOT NULL DEFAULT false,
    "modeloProveedor" TEXT,
    "maxProductosMostrar" INTEGER NOT NULL DEFAULT 5,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integracion_agente_ia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integracion_agente_ia_empresaId_key" ON "integracion_agente_ia"("empresaId");

-- AddForeignKey
ALTER TABLE "integracion_agente_ia" ADD CONSTRAINT "integracion_agente_ia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
