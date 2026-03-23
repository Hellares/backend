-- =========================================
-- MÓDULO RRHH: Empleados, Turnos, Asistencia, Planilla
-- =========================================

-- Enums
CREATE TYPE "DiaSemana" AS ENUM ('LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO');
CREATE TYPE "TipoContrato" AS ENUM ('PLANILLA', 'LOCADOR', 'RECIBO_HONORARIOS', 'PRACTICANTE');
CREATE TYPE "EstadoEmpleado" AS ENUM ('ACTIVO', 'VACACIONES', 'LICENCIA', 'SUSPENDIDO', 'CESADO');
CREATE TYPE "TipoAsistencia" AS ENUM ('NORMAL', 'FERIADO', 'DOMINICAL');
CREATE TYPE "EstadoAsistencia" AS ENUM ('PRESENTE', 'TARDANZA', 'FALTA', 'JUSTIFICADO', 'VACACION', 'LICENCIA', 'FERIADO', 'DESCANSO');
CREATE TYPE "TipoIncidencia" AS ENUM ('VACACION', 'LICENCIA_MEDICA', 'PERMISO', 'DESCANSO_MEDICO', 'LICENCIA_PATERNIDAD', 'LICENCIA_MATERNIDAD', 'OTRO');
CREATE TYPE "EstadoIncidencia" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA', 'CANCELADA');
CREATE TYPE "EstadoPeriodoPlanilla" AS ENUM ('BORRADOR', 'CALCULADA', 'APROBADA', 'PAGADA', 'CERRADA');
CREATE TYPE "EstadoBoletaPago" AS ENUM ('PENDIENTE_BOLETA', 'PAGADA_BOLETA', 'ANULADA_BOLETA');
CREATE TYPE "TipoDetalleBoleta" AS ENUM ('INGRESO', 'DESCUENTO', 'APORTE_EMPLEADOR');
CREATE TYPE "ConceptoBoleta" AS ENUM ('SALARIO_BASICO', 'HORAS_EXTRA', 'BONIFICACION', 'ASIGNACION_FAMILIAR', 'GRATIFICACION', 'COMISION', 'OTRO_INGRESO_BOLETA', 'AFP', 'ONP', 'ESSALUD_EMPLEADO', 'RENTA_5TA', 'TARDANZAS', 'FALTAS', 'ADELANTO_DESCUENTO', 'PRESTAMO_DESCUENTO', 'OTRO_DESCUENTO_BOLETA', 'ESSALUD_EMPLEADOR', 'SCTR', 'SENATI');
CREATE TYPE "EstadoAdelanto" AS ENUM ('PENDIENTE_ADELANTO', 'APROBADO_ADELANTO', 'PAGADO_ADELANTO', 'DESCONTADO_ADELANTO', 'RECHAZADO_ADELANTO');

-- Extender CategoriaMovimientoCaja con nuevas categorías RRHH
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'PAGO_PLANILLA';
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'ADELANTO_EMPLEADO';
ALTER TYPE "CategoriaMovimientoCaja" ADD VALUE 'BONIFICACION_EMPLEADO';

-- =========================================
-- TABLAS
-- =========================================

-- Turno
CREATE TABLE "Turno" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "horaInicio" TEXT NOT NULL,
    "horaFin" TEXT NOT NULL,
    "duracionAlmuerzoMin" INTEGER NOT NULL DEFAULT 60,
    "horasEfectivas" DECIMAL(4,2) NOT NULL,
    "color" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Turno_pkey" PRIMARY KEY ("id")
);

-- HorarioPlantilla
CREATE TABLE "HorarioPlantilla" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HorarioPlantilla_pkey" PRIMARY KEY ("id")
);

-- HorarioPlantillaDia
CREATE TABLE "HorarioPlantillaDia" (
    "id" TEXT NOT NULL,
    "horarioPlantillaId" TEXT NOT NULL,
    "diaSemana" "DiaSemana" NOT NULL,
    "turnoId" TEXT,
    "esDescanso" BOOLEAN NOT NULL DEFAULT false,
    "horaInicioOverride" TEXT,
    "horaFinOverride" TEXT,
    CONSTRAINT "HorarioPlantillaDia_pkey" PRIMARY KEY ("id")
);

-- Empleado
CREATE TABLE "Empleado" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "cargo" TEXT,
    "departamento" TEXT,
    "fechaIngreso" TIMESTAMP(3) NOT NULL,
    "fechaCese" TIMESTAMP(3),
    "tipoContrato" "TipoContrato" NOT NULL DEFAULT 'PLANILLA',
    "salarioBase" DECIMAL(10,2) NOT NULL,
    "moneda" TEXT NOT NULL DEFAULT 'PEN',
    "banco" TEXT,
    "numeroCuenta" TEXT,
    "cci" TEXT,
    "horarioPlantillaId" TEXT,
    "estado" "EstadoEmpleado" NOT NULL DEFAULT 'ACTIVO',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Empleado_pkey" PRIMARY KEY ("id")
);

-- Asistencia
CREATE TABLE "Asistencia" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "horaEntrada" TIMESTAMP(3),
    "horaSalida" TIMESTAMP(3),
    "horaAlmuerzoInicio" TIMESTAMP(3),
    "horaAlmuerzoFin" TIMESTAMP(3),
    "horasTrabajadas" DECIMAL(5,2),
    "horasExtra" DECIMAL(5,2),
    "tipoAsistencia" "TipoAsistencia" NOT NULL DEFAULT 'NORMAL',
    "estado" "EstadoAsistencia" NOT NULL,
    "observaciones" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Asistencia_pkey" PRIMARY KEY ("id")
);

-- Incidencia
CREATE TABLE "Incidencia" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tipo" "TipoIncidencia" NOT NULL,
    "fechaInicio" DATE NOT NULL,
    "fechaFin" DATE NOT NULL,
    "diasTotal" INTEGER NOT NULL,
    "motivo" TEXT,
    "documentoAdjunto" TEXT,
    "estado" "EstadoIncidencia" NOT NULL DEFAULT 'PENDIENTE',
    "aprobadoPorId" TEXT,
    "fechaAprobacion" TIMESTAMP(3),
    "motivoRechazo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Incidencia_pkey" PRIMARY KEY ("id")
);

-- PeriodoPlanilla
CREATE TABLE "PeriodoPlanilla" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT,
    "periodo" TEXT NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "fechaInicio" DATE NOT NULL,
    "fechaFin" DATE NOT NULL,
    "estado" "EstadoPeriodoPlanilla" NOT NULL DEFAULT 'BORRADOR',
    "totalBruto" DECIMAL(12,2),
    "totalDescuentos" DECIMAL(12,2),
    "totalNeto" DECIMAL(12,2),
    "totalAportaciones" DECIMAL(12,2),
    "calculadoPorId" TEXT,
    "aprobadoPorId" TEXT,
    "fechaAprobacion" TIMESTAMP(3),
    "observaciones" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PeriodoPlanilla_pkey" PRIMARY KEY ("id")
);

-- BoletaPago
CREATE TABLE "BoletaPago" (
    "id" TEXT NOT NULL,
    "periodoId" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "diasTrabajados" INTEGER NOT NULL,
    "diasFalta" INTEGER NOT NULL DEFAULT 0,
    "diasTardanza" INTEGER NOT NULL DEFAULT 0,
    "horasExtra" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "salarioBase" DECIMAL(10,2) NOT NULL,
    "totalIngresos" DECIMAL(10,2) NOT NULL,
    "totalDescuentos" DECIMAL(10,2) NOT NULL,
    "totalAportaciones" DECIMAL(10,2) NOT NULL,
    "totalNeto" DECIMAL(10,2) NOT NULL,
    "estado" "EstadoBoletaPago" NOT NULL DEFAULT 'PENDIENTE_BOLETA',
    "fechaPago" TIMESTAMP(3),
    "metodoPago" "MetodoPagoVenta",
    "movimientoCajaId" TEXT,
    "pagadoPorId" TEXT,
    "observaciones" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BoletaPago_pkey" PRIMARY KEY ("id")
);

-- DetalleBoletaPago
CREATE TABLE "DetalleBoletaPago" (
    "id" TEXT NOT NULL,
    "boletaId" TEXT NOT NULL,
    "tipo" "TipoDetalleBoleta" NOT NULL,
    "concepto" "ConceptoBoleta" NOT NULL,
    "descripcion" TEXT,
    "monto" DECIMAL(10,2) NOT NULL,
    "porcentaje" DECIMAL(5,2),
    CONSTRAINT "DetalleBoletaPago_pkey" PRIMARY KEY ("id")
);

-- AdelantoPago
CREATE TABLE "AdelantoPago" (
    "id" TEXT NOT NULL,
    "empleadoId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "motivo" TEXT,
    "fechaSolicitud" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "EstadoAdelanto" NOT NULL DEFAULT 'PENDIENTE_ADELANTO',
    "aprobadoPorId" TEXT,
    "fechaAprobacion" TIMESTAMP(3),
    "metodoPago" "MetodoPagoVenta",
    "movimientoCajaId" TEXT,
    "pagadoPorId" TEXT,
    "descontadoEnBoletaId" TEXT,
    "motivoRechazo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdelantoPago_pkey" PRIMARY KEY ("id")
);

-- =========================================
-- FOREIGN KEYS
-- =========================================

-- Turno
ALTER TABLE "Turno" ADD CONSTRAINT "Turno_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- HorarioPlantilla
ALTER TABLE "HorarioPlantilla" ADD CONSTRAINT "HorarioPlantilla_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- HorarioPlantillaDia
ALTER TABLE "HorarioPlantillaDia" ADD CONSTRAINT "HorarioPlantillaDia_horarioPlantillaId_fkey" FOREIGN KEY ("horarioPlantillaId") REFERENCES "HorarioPlantilla"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HorarioPlantillaDia" ADD CONSTRAINT "HorarioPlantillaDia_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "Turno"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Empleado
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Empleado" ADD CONSTRAINT "Empleado_horarioPlantillaId_fkey" FOREIGN KEY ("horarioPlantillaId") REFERENCES "HorarioPlantilla"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Asistencia
ALTER TABLE "Asistencia" ADD CONSTRAINT "Asistencia_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asistencia" ADD CONSTRAINT "Asistencia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asistencia" ADD CONSTRAINT "Asistencia_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Asistencia" ADD CONSTRAINT "Asistencia_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Incidencia
ALTER TABLE "Incidencia" ADD CONSTRAINT "Incidencia_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Incidencia" ADD CONSTRAINT "Incidencia_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Incidencia" ADD CONSTRAINT "Incidencia_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PeriodoPlanilla
ALTER TABLE "PeriodoPlanilla" ADD CONSTRAINT "PeriodoPlanilla_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PeriodoPlanilla" ADD CONSTRAINT "PeriodoPlanilla_sedeId_fkey" FOREIGN KEY ("sedeId") REFERENCES "Sede"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PeriodoPlanilla" ADD CONSTRAINT "PeriodoPlanilla_calculadoPorId_fkey" FOREIGN KEY ("calculadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PeriodoPlanilla" ADD CONSTRAINT "PeriodoPlanilla_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BoletaPago
ALTER TABLE "BoletaPago" ADD CONSTRAINT "BoletaPago_periodoId_fkey" FOREIGN KEY ("periodoId") REFERENCES "PeriodoPlanilla"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BoletaPago" ADD CONSTRAINT "BoletaPago_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BoletaPago" ADD CONSTRAINT "BoletaPago_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BoletaPago" ADD CONSTRAINT "BoletaPago_pagadoPorId_fkey" FOREIGN KEY ("pagadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DetalleBoletaPago
ALTER TABLE "DetalleBoletaPago" ADD CONSTRAINT "DetalleBoletaPago_boletaId_fkey" FOREIGN KEY ("boletaId") REFERENCES "BoletaPago"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AdelantoPago
ALTER TABLE "AdelantoPago" ADD CONSTRAINT "AdelantoPago_empleadoId_fkey" FOREIGN KEY ("empleadoId") REFERENCES "Empleado"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdelantoPago" ADD CONSTRAINT "AdelantoPago_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdelantoPago" ADD CONSTRAINT "AdelantoPago_aprobadoPorId_fkey" FOREIGN KEY ("aprobadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdelantoPago" ADD CONSTRAINT "AdelantoPago_pagadoPorId_fkey" FOREIGN KEY ("pagadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdelantoPago" ADD CONSTRAINT "AdelantoPago_descontadoEnBoletaId_fkey" FOREIGN KEY ("descontadoEnBoletaId") REFERENCES "BoletaPago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =========================================
-- INDEXES
-- =========================================

-- Turno
CREATE UNIQUE INDEX "Turno_empresaId_nombre_key" ON "Turno"("empresaId", "nombre");
CREATE INDEX "Turno_empresaId_idx" ON "Turno"("empresaId");
CREATE INDEX "Turno_empresaId_isActive_idx" ON "Turno"("empresaId", "isActive");

-- HorarioPlantilla
CREATE UNIQUE INDEX "HorarioPlantilla_empresaId_nombre_key" ON "HorarioPlantilla"("empresaId", "nombre");
CREATE INDEX "HorarioPlantilla_empresaId_idx" ON "HorarioPlantilla"("empresaId");
CREATE INDEX "HorarioPlantilla_empresaId_isActive_idx" ON "HorarioPlantilla"("empresaId", "isActive");

-- HorarioPlantillaDia
CREATE UNIQUE INDEX "HorarioPlantillaDia_horarioPlantillaId_diaSemana_key" ON "HorarioPlantillaDia"("horarioPlantillaId", "diaSemana");
CREATE INDEX "HorarioPlantillaDia_horarioPlantillaId_idx" ON "HorarioPlantillaDia"("horarioPlantillaId");

-- Empleado
CREATE UNIQUE INDEX "Empleado_empresaId_usuarioId_key" ON "Empleado"("empresaId", "usuarioId");
CREATE UNIQUE INDEX "Empleado_empresaId_codigo_key" ON "Empleado"("empresaId", "codigo");
CREATE INDEX "Empleado_empresaId_sedeId_idx" ON "Empleado"("empresaId", "sedeId");
CREATE INDEX "Empleado_empresaId_estado_idx" ON "Empleado"("empresaId", "estado");
CREATE INDEX "Empleado_empresaId_isActive_idx" ON "Empleado"("empresaId", "isActive");
CREATE INDEX "Empleado_empresaId_deletedAt_idx" ON "Empleado"("empresaId", "deletedAt");

-- Asistencia
CREATE UNIQUE INDEX "Asistencia_empleadoId_fecha_key" ON "Asistencia"("empleadoId", "fecha");
CREATE INDEX "Asistencia_empresaId_fecha_idx" ON "Asistencia"("empresaId", "fecha");
CREATE INDEX "Asistencia_empresaId_sedeId_fecha_idx" ON "Asistencia"("empresaId", "sedeId", "fecha");
CREATE INDEX "Asistencia_empleadoId_idx" ON "Asistencia"("empleadoId");

-- Incidencia
CREATE INDEX "Incidencia_empresaId_estado_idx" ON "Incidencia"("empresaId", "estado");
CREATE INDEX "Incidencia_empleadoId_idx" ON "Incidencia"("empleadoId");
CREATE INDEX "Incidencia_empresaId_tipo_idx" ON "Incidencia"("empresaId", "tipo");

-- PeriodoPlanilla
CREATE UNIQUE INDEX "PeriodoPlanilla_empresaId_periodo_sedeId_key" ON "PeriodoPlanilla"("empresaId", "periodo", "sedeId");
CREATE INDEX "PeriodoPlanilla_empresaId_estado_idx" ON "PeriodoPlanilla"("empresaId", "estado");
CREATE INDEX "PeriodoPlanilla_empresaId_anio_mes_idx" ON "PeriodoPlanilla"("empresaId", "anio", "mes");

-- BoletaPago
CREATE UNIQUE INDEX "BoletaPago_periodoId_empleadoId_key" ON "BoletaPago"("periodoId", "empleadoId");
CREATE INDEX "BoletaPago_empresaId_estado_idx" ON "BoletaPago"("empresaId", "estado");
CREATE INDEX "BoletaPago_periodoId_idx" ON "BoletaPago"("periodoId");
CREATE INDEX "BoletaPago_empleadoId_idx" ON "BoletaPago"("empleadoId");

-- DetalleBoletaPago
CREATE INDEX "DetalleBoletaPago_boletaId_idx" ON "DetalleBoletaPago"("boletaId");

-- AdelantoPago
CREATE INDEX "AdelantoPago_empresaId_estado_idx" ON "AdelantoPago"("empresaId", "estado");
CREATE INDEX "AdelantoPago_empleadoId_idx" ON "AdelantoPago"("empleadoId");

-- =========================================
-- ALTERACIONES A TABLAS EXISTENTES
-- =========================================

-- Agregar FKs de RRHH a MovimientoCaja
ALTER TABLE "MovimientoCaja" ADD COLUMN "boletaPagoId" TEXT;
ALTER TABLE "MovimientoCaja" ADD COLUMN "adelantoPagoId" TEXT;
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_boletaPagoId_fkey" FOREIGN KEY ("boletaPagoId") REFERENCES "BoletaPago"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_adelantoPagoId_fkey" FOREIGN KEY ("adelantoPagoId") REFERENCES "AdelantoPago"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Agregar campos RRHH a ConfiguracionEmpresa
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN "horasJornadaDefault" DOUBLE PRECISION NOT NULL DEFAULT 8.0;
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN "horasExtraPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 25.0;
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN "dominicalPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 100.0;
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN "feriadoPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 100.0;
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN "essaludPorcentaje" DOUBLE PRECISION NOT NULL DEFAULT 9.0;
ALTER TABLE "ConfiguracionEmpresa" ADD COLUMN "periodoPlanillaTipo" TEXT NOT NULL DEFAULT 'MENSUAL';

-- Agregar campos código empleado a ConfiguracionCodigos
ALTER TABLE "ConfiguracionCodigos" ADD COLUMN "empleadoCodigo" TEXT NOT NULL DEFAULT 'EMP';
ALTER TABLE "ConfiguracionCodigos" ADD COLUMN "empleadoSeparador" TEXT NOT NULL DEFAULT '-';
ALTER TABLE "ConfiguracionCodigos" ADD COLUMN "empleadoLongitud" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "ConfiguracionCodigos" ADD COLUMN "ultimoEmpleado" INTEGER NOT NULL DEFAULT 0;
