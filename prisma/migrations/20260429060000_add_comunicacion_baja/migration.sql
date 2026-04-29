-- Comunicación de Baja (RA SUNAT) — anula Facturas/NC-FC/ND-FD ACEPTADOS, plazo 7 días.
-- Boletas y notas BC*/BD* van por Resumen Diario, NO por aquí.

CREATE TABLE "ComunicacionBaja" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "numeroCompleto" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "correlativo" TEXT NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaReferencia" TIMESTAMP(3) NOT NULL,
    "motivoBaja" VARCHAR(500) NOT NULL,
    "estadoSunat" "EstadoSunat" NOT NULL DEFAULT 'PENDIENTE',
    "ticket" TEXT,
    "hashCdr" TEXT,
    "errorProveedor" TEXT,
    "cdrResponse" JSONB,
    "sunatXmlUrl" TEXT,
    "sunatCdrUrl" TEXT,
    "proveedorEmisor" "ProveedorFacturacion" NOT NULL,
    "proveedorBajaId" TEXT,
    "enviadoAProveedor" BOOLEAN NOT NULL DEFAULT false,
    "intentosEnvio" INTEGER NOT NULL DEFAULT 0,
    "ultimoIntentoEnvio" TIMESTAMP(3),
    "usuarioCreacionId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComunicacionBaja_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DetalleComunicacionBaja" (
    "id" TEXT NOT NULL,
    "comunicacionBajaId" TEXT NOT NULL,
    "comprobanteId" TEXT NOT NULL,
    "motivoEspecifico" VARCHAR(250) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetalleComunicacionBaja_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ComunicacionBaja_empresaId_numeroCompleto_key"
    ON "ComunicacionBaja"("empresaId", "numeroCompleto");

CREATE INDEX "ComunicacionBaja_empresaId_idx" ON "ComunicacionBaja"("empresaId");
CREATE INDEX "ComunicacionBaja_sedeId_idx" ON "ComunicacionBaja"("sedeId");
CREATE INDEX "ComunicacionBaja_empresaId_estadoSunat_idx" ON "ComunicacionBaja"("empresaId", "estadoSunat");
CREATE INDEX "ComunicacionBaja_empresaId_fechaReferencia_idx" ON "ComunicacionBaja"("empresaId", "fechaReferencia");
CREATE INDEX "ComunicacionBaja_empresaId_fechaEmision_idx" ON "ComunicacionBaja"("empresaId", "fechaEmision");

CREATE UNIQUE INDEX "DetalleComunicacionBaja_comunicacionBajaId_comprobanteId_key"
    ON "DetalleComunicacionBaja"("comunicacionBajaId", "comprobanteId");

CREATE INDEX "DetalleComunicacionBaja_comprobanteId_idx" ON "DetalleComunicacionBaja"("comprobanteId");

ALTER TABLE "ComunicacionBaja"
    ADD CONSTRAINT "ComunicacionBaja_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ComunicacionBaja"
    ADD CONSTRAINT "ComunicacionBaja_sedeId_fkey"
    FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DetalleComunicacionBaja"
    ADD CONSTRAINT "DetalleComunicacionBaja_comunicacionBajaId_fkey"
    FOREIGN KEY ("comunicacionBajaId") REFERENCES "ComunicacionBaja"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DetalleComunicacionBaja"
    ADD CONSTRAINT "DetalleComunicacionBaja_comprobanteId_fkey"
    FOREIGN KEY ("comprobanteId") REFERENCES "ComprobanteElectronico"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
