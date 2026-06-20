-- Fuente del dinero al pagar una compra (CxP): Tesorería / Caja operativa / Banco.
-- 1) Enum nuevo. 2) Columnas en PagoCompra. 3) Índices + FKs.

CREATE TYPE "FuentePagoCompra" AS ENUM ('TESORERIA', 'CAJA', 'BANCO');

ALTER TABLE "PagoCompra"
  ADD COLUMN "fuente" "FuentePagoCompra",
  ADD COLUMN "bancoId" TEXT,
  ADD COLUMN "movimientoCajaId" TEXT;

CREATE UNIQUE INDEX "PagoCompra_movimientoCajaId_key" ON "PagoCompra"("movimientoCajaId");
CREATE INDEX "PagoCompra_bancoId_idx" ON "PagoCompra"("bancoId");

ALTER TABLE "PagoCompra"
  ADD CONSTRAINT "PagoCompra_bancoId_fkey"
  FOREIGN KEY ("bancoId") REFERENCES "EmpresaBanco"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PagoCompra"
  ADD CONSTRAINT "PagoCompra_movimientoCajaId_fkey"
  FOREIGN KEY ("movimientoCajaId") REFERENCES "MovimientoCaja"("id") ON DELETE SET NULL ON UPDATE CASCADE;
