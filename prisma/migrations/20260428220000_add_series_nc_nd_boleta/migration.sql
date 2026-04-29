-- Agregar series duales para NC/ND según documento afectado (FC/BC/FD/BD)
-- SUNAT diferencia: NC sobre Factura usa serie FC*, NC sobre Boleta usa BC*; ND idem.

ALTER TABLE "Sede"
  ADD COLUMN "serieNotaCreditoBoleta"        TEXT NOT NULL DEFAULT 'BC01',
  ADD COLUMN "serieNotaDebitoBoleta"         TEXT NOT NULL DEFAULT 'BD01',
  ADD COLUMN "ultimoNumeroNotaCreditoBoleta" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ultimoNumeroNotaDebitoBoleta"  INTEGER NOT NULL DEFAULT 0;
