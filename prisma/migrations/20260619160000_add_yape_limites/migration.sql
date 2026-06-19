-- Límites para pagos divididos Yape/Plin (configurables por empresa).
-- Por transacción (500) dispara el auto-split; por día (2000) es advertencia.
ALTER TABLE "integracion_yape" ADD COLUMN "montoMaxPorTransaccion" DECIMAL(10,2) NOT NULL DEFAULT 500;
ALTER TABLE "integracion_yape" ADD COLUMN "montoMaxPorDia" DECIMAL(10,2) NOT NULL DEFAULT 2000;
