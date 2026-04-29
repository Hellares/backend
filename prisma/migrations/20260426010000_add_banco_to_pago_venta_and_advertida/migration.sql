-- Bancarización Ley 28194 — Fase 2 (multi-medio real).
-- Agrega banco por pago + flag de advertencia legal a nivel venta.

ALTER TABLE "PagoVenta"
  ADD COLUMN "banco" VARCHAR(50);

ALTER TABLE "Venta"
  ADD COLUMN "bancarizacionAdvertida" BOOLEAN NOT NULL DEFAULT false;
