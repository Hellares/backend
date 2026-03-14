-- CreateEnum
CREATE TYPE "EstadoCita" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'EN_PROCESO', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO');

-- AlterTable: Add cita code generation fields to ConfiguracionCodigos
ALTER TABLE "ConfiguracionCodigos" ADD COLUMN "citaCodigo" TEXT NOT NULL DEFAULT 'CITA';
ALTER TABLE "ConfiguracionCodigos" ADD COLUMN "citaSeparador" TEXT NOT NULL DEFAULT '-';
ALTER TABLE "ConfiguracionCodigos" ADD COLUMN "citaLongitud" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "ConfiguracionCodigos" ADD COLUMN "ultimaCita" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Cita" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "servicioId" TEXT NOT NULL,
    "tecnicoId" TEXT NOT NULL,
    "clienteId" TEXT,
    "clienteEmpresaId" TEXT,
    "codigo" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "estado" "EstadoCita" NOT NULL DEFAULT 'PENDIENTE',
    "notas" TEXT,
    "ordenServicioId" TEXT,
    "creadoPor" TEXT,
    "canceladoPor" TEXT,
    "motivoCancelacion" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cita_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistorialCita" (
    "id" TEXT NOT NULL,
    "citaId" TEXT NOT NULL,
    "estadoAnterior" "EstadoCita" NOT NULL,
    "estadoNuevo" "EstadoCita" NOT NULL,
    "notas" TEXT,
    "creadoPor" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialCita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cita_empresaId_fecha_idx" ON "Cita"("empresaId", "fecha");
CREATE INDEX "Cita_empresaId_tecnicoId_fecha_idx" ON "Cita"("empresaId", "tecnicoId", "fecha");
CREATE INDEX "Cita_empresaId_estado_idx" ON "Cita"("empresaId", "estado");
CREATE INDEX "Cita_sedeId_fecha_idx" ON "Cita"("sedeId", "fecha");
CREATE INDEX "Cita_clienteId_idx" ON "Cita"("clienteId");
CREATE INDEX "Cita_clienteEmpresaId_idx" ON "Cita"("clienteEmpresaId");
CREATE INDEX "Cita_ordenServicioId_idx" ON "Cita"("ordenServicioId");
CREATE UNIQUE INDEX "Cita_empresaId_codigo_key" ON "Cita"("empresaId", "codigo");

-- CreateIndex
CREATE INDEX "HistorialCita_citaId_idx" ON "HistorialCita"("citaId");

-- AddForeignKey
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_servicioId_fkey" FOREIGN KEY ("servicioId") REFERENCES "Servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_tecnicoId_fkey" FOREIGN KEY ("tecnicoId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "EmpresaPersona"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_clienteEmpresaId_fkey" FOREIGN KEY ("clienteEmpresaId") REFERENCES "ClienteEmpresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Cita" ADD CONSTRAINT "Cita_ordenServicioId_fkey" FOREIGN KEY ("ordenServicioId") REFERENCES "OrdenServicio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistorialCita" ADD CONSTRAINT "HistorialCita_citaId_fkey" FOREIGN KEY ("citaId") REFERENCES "Cita"("id") ON DELETE CASCADE ON UPDATE CASCADE;
