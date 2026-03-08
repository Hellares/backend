-- CreateTable: OrdenServicioArchivo (archive of OrdenServicio)
CREATE TABLE "OrdenServicioArchivo" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tecnicoId" TEXT,
    "sedeId" TEXT,
    "codigo" TEXT NOT NULL,
    "tipoServicio" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL DEFAULT 'NORMAL',
    "tipoEquipo" TEXT,
    "marcaEquipo" TEXT,
    "numeroSerie" TEXT,
    "modeloEquipoId" TEXT,
    "diagnostico" JSONB,
    "descripcionProblema" TEXT,
    "sintomas" JSONB,
    "presupuesto" DECIMAL(10,2),
    "tiempoEstimado" INTEGER,
    "fechaEntrega" TIMESTAMPTZ,
    "estado" TEXT NOT NULL DEFAULT 'RECIBIDO',
    "estadoDiagnostico" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "notas" TEXT,
    "accesorios" JSONB,
    "condicionEquipo" TEXT,
    "datosPersonalizados" JSONB,
    "servicioId" TEXT,
    "comprobanteId" TEXT,
    "cantidadReingresos" INTEGER NOT NULL DEFAULT 0,
    "motivoReingreso" TEXT,
    "creadoEn" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ NOT NULL,
    "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedBy" TEXT NOT NULL DEFAULT 'SYSTEM',

    CONSTRAINT "OrdenServicioArchivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ServicioComponenteArchivo (archive of ServicioComponente)
CREATE TABLE "ServicioComponenteArchivo" (
    "id" TEXT NOT NULL,
    "ordenServicioId" TEXT NOT NULL,
    "componenteId" TEXT NOT NULL,
    "tipoAccion" TEXT NOT NULL,
    "estadoComponente" TEXT NOT NULL DEFAULT 'INGRESADO',
    "descripcionAccion" TEXT,
    "detallesAccion" JSONB,
    "costoAccion" DECIMAL(10,2),
    "tiempoAccion" INTEGER,
    "costoRepuestos" DECIMAL(10,2),
    "resultadoAccion" TEXT,
    "pruebaRealizada" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "garantiaMeses" INTEGER,
    "fechaGarantia" TIMESTAMPTZ,
    "creadoEn" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ NOT NULL,
    "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedBy" TEXT NOT NULL DEFAULT 'SYSTEM',

    CONSTRAINT "ServicioComponenteArchivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable: HistorialOrdenServicioArchivo (archive of HistorialOrdenServicio)
CREATE TABLE "HistorialOrdenServicioArchivo" (
    "id" TEXT NOT NULL,
    "ordenServicioId" TEXT NOT NULL,
    "estadoAnterior" TEXT NOT NULL,
    "estadoNuevo" TEXT NOT NULL,
    "notas" TEXT,
    "diagnostico" JSONB,
    "presupuesto" DECIMAL(10,2),
    "comunicarCliente" BOOLEAN NOT NULL DEFAULT false,
    "creadoPor" TEXT,
    "creadoEn" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivoReingreso" TEXT,
    "archivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedBy" TEXT NOT NULL DEFAULT 'SYSTEM',

    CONSTRAINT "HistorialOrdenServicioArchivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: OrdenServicioArchivo indexes
CREATE INDEX "OrdenServicioArchivo_empresaId_idx" ON "OrdenServicioArchivo"("empresaId");
CREATE INDEX "OrdenServicioArchivo_codigo_idx" ON "OrdenServicioArchivo"("codigo");
CREATE INDEX "OrdenServicioArchivo_creadoEn_idx" ON "OrdenServicioArchivo"("creadoEn");
CREATE INDEX "OrdenServicioArchivo_estado_idx" ON "OrdenServicioArchivo"("estado");
CREATE INDEX "OrdenServicioArchivo_archivedAt_idx" ON "OrdenServicioArchivo"("archivedAt");

-- CreateIndex: ServicioComponenteArchivo indexes
CREATE INDEX "ServicioComponenteArchivo_ordenServicioId_idx" ON "ServicioComponenteArchivo"("ordenServicioId");
CREATE INDEX "ServicioComponenteArchivo_creadoEn_idx" ON "ServicioComponenteArchivo"("creadoEn");

-- CreateIndex: HistorialOrdenServicioArchivo indexes
CREATE INDEX "HistorialOrdenServicioArchivo_ordenServicioId_idx" ON "HistorialOrdenServicioArchivo"("ordenServicioId");
CREATE INDEX "HistorialOrdenServicioArchivo_creadoEn_idx" ON "HistorialOrdenServicioArchivo"("creadoEn");
