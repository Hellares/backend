-- Cuenta de recaudación por método de pago digital (Yape→BCP, Plin→Interbank…).
-- Una cuenta bancaria por método y empresa. EFECTIVO no se mapea.
CREATE TABLE "CuentaRecaudacion" (
  "id"            TEXT NOT NULL,
  "empresaId"     TEXT NOT NULL,
  "metodoPago"    "MetodoPagoVenta" NOT NULL,
  "bancoId"       TEXT NOT NULL,
  "creadoEn"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualizadoEn" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CuentaRecaudacion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CuentaRecaudacion_empresaId_metodoPago_key" ON "CuentaRecaudacion"("empresaId", "metodoPago");
CREATE INDEX "CuentaRecaudacion_empresaId_idx" ON "CuentaRecaudacion"("empresaId");
CREATE INDEX "CuentaRecaudacion_bancoId_idx" ON "CuentaRecaudacion"("bancoId");

ALTER TABLE "CuentaRecaudacion"
  ADD CONSTRAINT "CuentaRecaudacion_empresaId_fkey"
  FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CuentaRecaudacion"
  ADD CONSTRAINT "CuentaRecaudacion_bancoId_fkey"
  FOREIGN KEY ("bancoId") REFERENCES "EmpresaBanco"("id") ON DELETE CASCADE ON UPDATE CASCADE;
