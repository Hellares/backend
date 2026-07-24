-- REPARTIDOR FREELANCE DE SYNCRONIZE (R1) — aditiva, sin datos.

-- Estado del repartidor freelance
CREATE TYPE "EstadoRepartidorSyncronize" AS ENUM ('PENDIENTE', 'APROBADO', 'SUSPENDIDO', 'BLOQUEADO');

-- Opt-in de la empresa a repartidores externos + tope de mercadería
ALTER TABLE "Empresa" ADD COLUMN "aceptaRepartidoresExternos" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Empresa" ADD COLUMN "montoMaxDeliveryExterno" DECIMAL(10,2);

-- Registro global de repartidores freelance
CREATE TABLE "repartidor_syncronize" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "estado" "EstadoRepartidorSyncronize" NOT NULL DEFAULT 'PENDIENTE',
    "dni" TEXT NOT NULL,
    "nombreCompleto" TEXT NOT NULL,
    "celular" TEXT NOT NULL,
    "celularVerificado" BOOLEAN NOT NULL DEFAULT false,
    "otpCodigo" TEXT,
    "otpExpiraEn" TIMESTAMP(3),
    "fotoUrl" TEXT,
    "placaVehiculo" TEXT,
    "antecedentesUrl" TEXT,
    "zonas" TEXT[],
    "entregasCompletadas" INTEGER NOT NULL DEFAULT 0,
    "entregasFallidas" INTEGER NOT NULL DEFAULT 0,
    "calificacionSuma" INTEGER NOT NULL DEFAULT 0,
    "calificacionTotal" INTEGER NOT NULL DEFAULT 0,
    "aprobadoPor" TEXT,
    "aprobadoEn" TIMESTAMP(3),
    "motivoEstado" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repartidor_syncronize_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "repartidor_syncronize_usuarioId_key" ON "repartidor_syncronize"("usuarioId");
CREATE UNIQUE INDEX "repartidor_syncronize_dni_key" ON "repartidor_syncronize"("dni");
CREATE INDEX "repartidor_syncronize_estado_idx" ON "repartidor_syncronize"("estado");

ALTER TABLE "repartidor_syncronize" ADD CONSTRAINT "repartidor_syncronize_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
