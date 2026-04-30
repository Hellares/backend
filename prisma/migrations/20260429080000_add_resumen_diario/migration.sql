-- Resumen Diario (RC SUNAT) — anula Boletas (`03`) y notas BC*/BD* ACEPTADAS, plazo 3 días.
-- Facturas y notas FC*/FD* van por Comunicación de Baja, NO por aquí.

CREATE TABLE "ResumenDiario" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "numeroCompleto" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "correlativo" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaReferencia" TIMESTAMP(3) NOT NULL,
    "motivoAnulacion" VARCHAR(500) NOT NULL,
    "estadoSunat" "EstadoSunat" NOT NULL DEFAULT 'PENDIENTE',
    "ticket" TEXT,
    "hashCdr" TEXT,
    "errorProveedor" TEXT,
    "cdrResponse" JSONB,
    "sunatXmlUrl" TEXT,
    "sunatCdrUrl" TEXT,
    "proveedorEmisor" "ProveedorFacturacion" NOT NULL,
    "proveedorResumenId" TEXT,
    "enviadoAProveedor" BOOLEAN NOT NULL DEFAULT false,
    "intentosEnvio" INTEGER NOT NULL DEFAULT 0,
    "ultimoIntentoEnvio" TIMESTAMP(3),
    "usuarioCreacionId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumenDiario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DetalleResumenDiario" (
    "id" TEXT NOT NULL,
    "resumenDiarioId" TEXT NOT NULL,
    "comprobanteId" TEXT NOT NULL,
    "motivoEspecifico" VARCHAR(250) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetalleResumenDiario_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResumenDiario_empresaId_numeroCompleto_key"
    ON "ResumenDiario"("empresaId", "numeroCompleto");

CREATE INDEX "ResumenDiario_empresaId_idx" ON "ResumenDiario"("empresaId");
CREATE INDEX "ResumenDiario_sedeId_idx" ON "ResumenDiario"("sedeId");
CREATE INDEX "ResumenDiario_empresaId_estadoSunat_idx" ON "ResumenDiario"("empresaId", "estadoSunat");
CREATE INDEX "ResumenDiario_empresaId_fechaReferencia_idx" ON "ResumenDiario"("empresaId", "fechaReferencia");
CREATE INDEX "ResumenDiario_empresaId_fechaEmision_idx" ON "ResumenDiario"("empresaId", "fechaEmision");

CREATE UNIQUE INDEX "DetalleResumenDiario_resumenDiarioId_comprobanteId_key"
    ON "DetalleResumenDiario"("resumenDiarioId", "comprobanteId");

CREATE INDEX "DetalleResumenDiario_comprobanteId_idx" ON "DetalleResumenDiario"("comprobanteId");

ALTER TABLE "ResumenDiario"
    ADD CONSTRAINT "ResumenDiario_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ResumenDiario"
    ADD CONSTRAINT "ResumenDiario_sedeId_fkey"
    FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DetalleResumenDiario"
    ADD CONSTRAINT "DetalleResumenDiario_resumenDiarioId_fkey"
    FOREIGN KEY ("resumenDiarioId") REFERENCES "ResumenDiario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DetalleResumenDiario"
    ADD CONSTRAINT "DetalleResumenDiario_comprobanteId_fkey"
    FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteElectronico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
