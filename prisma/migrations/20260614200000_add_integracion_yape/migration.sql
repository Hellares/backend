-- CreateTable
CREATE TABLE "integracion_yape" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "apiBaseUrl" TEXT NOT NULL,
    "accountApiKey" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "webhookSecret" TEXT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integracion_yape_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integracion_yape_empresaId_key" ON "integracion_yape"("empresaId");

-- CreateIndex
CREATE INDEX "integracion_yape_accountId_idx" ON "integracion_yape"("accountId");

-- AddForeignKey
ALTER TABLE "integracion_yape" ADD CONSTRAINT "integracion_yape_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
