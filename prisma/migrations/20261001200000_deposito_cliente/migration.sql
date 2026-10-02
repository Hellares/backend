-- Depósitos del cliente sin repartir + saldo a favor.
-- Aditiva: dos tablas nuevas, un enum y dos columnas opcionales.

CREATE TYPE "OrigenDepositoCliente" AS ENUM ('PANEL', 'TIENDA');

-- El titular de un pago reportado SIN compras (depósito).
ALTER TABLE "ReporteAbono" ADD COLUMN "clienteId" TEXT;
ALTER TABLE "ReporteAbono" ADD COLUMN "clienteEmpresaId" TEXT;

CREATE TABLE "DepositoCliente" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "sedeId" TEXT NOT NULL,
    "clienteId" TEXT,
    "clienteEmpresaId" TEXT,
    "monto" DECIMAL(10,2) NOT NULL,
    "montoAplicado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "metodoPago" "MetodoPagoVenta" NOT NULL,
    "referencia" TEXT,
    "fuente" "FuenteIngreso" NOT NULL,
    "bancoId" TEXT,
    "movimientoCajaId" TEXT,
    "origen" "OrigenDepositoCliente" NOT NULL DEFAULT 'PANEL',
    "reporteAbonoId" TEXT,
    "nota" TEXT,
    "registradoPorId" TEXT NOT NULL,
    "anulado" BOOLEAN NOT NULL DEFAULT false,
    "motivoAnulacion" TEXT,
    "anuladoPorId" TEXT,
    "fechaAnulacion" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepositoCliente_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AplicacionDeposito" (
    "id" TEXT NOT NULL,
    "depositoId" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "monto" DECIMAL(10,2) NOT NULL,
    "pagoVentaId" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AplicacionDeposito_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DepositoCliente_movimientoCajaId_key" ON "DepositoCliente"("movimientoCajaId");
CREATE UNIQUE INDEX "DepositoCliente_reporteAbonoId_key" ON "DepositoCliente"("reporteAbonoId");
CREATE INDEX "DepositoCliente_empresaId_clienteId_idx" ON "DepositoCliente"("empresaId", "clienteId");
CREATE INDEX "DepositoCliente_empresaId_clienteEmpresaId_idx" ON "DepositoCliente"("empresaId", "clienteEmpresaId");

CREATE UNIQUE INDEX "AplicacionDeposito_pagoVentaId_key" ON "AplicacionDeposito"("pagoVentaId");
CREATE INDEX "AplicacionDeposito_depositoId_idx" ON "AplicacionDeposito"("depositoId");
CREATE INDEX "AplicacionDeposito_ventaId_idx" ON "AplicacionDeposito"("ventaId");

ALTER TABLE "AplicacionDeposito" ADD CONSTRAINT "AplicacionDeposito_depositoId_fkey" FOREIGN KEY ("depositoId") REFERENCES "DepositoCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
