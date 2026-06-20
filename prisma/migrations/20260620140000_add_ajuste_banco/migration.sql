-- Historial de ajustes/conciliaciones del saldo de cuentas bancarias.
CREATE TYPE "OrigenAjusteBanco" AS ENUM ('CONCILIACION', 'AJUSTE_MANUAL');

CREATE TABLE "AjusteBanco" (
  "id"            TEXT NOT NULL,
  "empresaId"     TEXT NOT NULL,
  "bancoId"       TEXT NOT NULL,
  "tipo"          "TipoMovimientoCaja" NOT NULL,
  "monto"         DECIMAL(12,2) NOT NULL,
  "motivo"        TEXT NOT NULL,
  "origen"        "OrigenAjusteBanco" NOT NULL,
  "saldoAnterior" DECIMAL(12,2) NOT NULL,
  "saldoNuevo"    DECIMAL(12,2) NOT NULL,
  "usuarioId"     TEXT,
  "creadoEn"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AjusteBanco_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AjusteBanco_empresaId_bancoId_idx" ON "AjusteBanco"("empresaId", "bancoId");
CREATE INDEX "AjusteBanco_bancoId_creadoEn_idx" ON "AjusteBanco"("bancoId", "creadoEn" DESC);

ALTER TABLE "AjusteBanco"
  ADD CONSTRAINT "AjusteBanco_bancoId_fkey"
  FOREIGN KEY ("bancoId") REFERENCES "EmpresaBanco"("id") ON DELETE CASCADE ON UPDATE CASCADE;
