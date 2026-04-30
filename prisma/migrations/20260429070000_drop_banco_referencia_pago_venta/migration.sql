-- Drop columnas legacy de bancarización Fase 1 (1 banco/ref por venta).
-- Reemplazadas por PagoVenta.banco / PagoVenta.referencia (multi-medio real, Fase 2).
-- Sesión 2026-04-26 marcó deprecated; sesión 2026-04-29 confirma que ningún
-- consumer activo lee/escribe estos campos.

ALTER TABLE "Venta"
  DROP COLUMN "bancoPago",
  DROP COLUMN "referenciaPago";
