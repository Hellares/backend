-- Ventana de venta de tickets de la rifa (informativa; el cierre sigue
-- siendo manual) — el bot anuncia "tickets hasta el X, se juega el Y".
ALTER TABLE "Sorteo" ADD COLUMN "ventaDesde" TIMESTAMP(3);
ALTER TABLE "Sorteo" ADD COLUMN "ventaHasta" TIMESTAMP(3);
