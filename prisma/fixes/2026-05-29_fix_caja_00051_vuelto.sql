-- ============================================================================
-- Fix puntual: corregir desglose por método de pago de la venta MIXTO
-- VTA-SED-00000348 en CAJA-00051 (db_saas_beta).
--
-- Bug (corregido en código por construirPagosParaCaja): el vuelto se restó al
-- medio digital (Yape) en vez de al efectivo, corriendo el desglose:
--   Efectivo  registrado 100.00  → debe ser  69.70  (100.00 recibido − 30.30 vuelto)
--   Yape      registrado 110.70  → debe ser 141.00  (valor nominal, no da vuelto)
-- El total (210.70) ya cuadraba; solo el desglose por método estaba corrido,
-- por eso al cerrar caja aparecía -30.30 de diferencia fantasma en efectivo.
--
-- El resumen de caja se calcula sumando MovimientoCaja (no hay total
-- denormalizado), así que basta con corregir los 2 montos.
--
-- Idempotente: cada UPDATE filtra por el monto ERRÓNEO actual, re-ejecutar = no-op.
-- ============================================================================

BEGIN;

-- 1) ANTES — inspeccionar los movimientos de la venta
SELECT mc.id, mc."metodoPago", mc.monto, mc.descripcion, mc.anulado
FROM "MovimientoCaja" mc
JOIN "Venta" v ON v.id = mc."ventaId"
WHERE v.codigo = 'VTA-SED-00000348'
  AND mc.tipo = 'INGRESO'
  AND mc.categoria = 'VENTA'
ORDER BY mc."metodoPago";

-- 2) Corregir EFECTIVO: 100.00 → 69.70 (neto de vuelto)
UPDATE "MovimientoCaja" mc
SET monto = 69.70
FROM "Venta" v
WHERE v.id = mc."ventaId"
  AND v.codigo = 'VTA-SED-00000348'
  AND mc.tipo = 'INGRESO'
  AND mc.categoria = 'VENTA'
  AND mc."metodoPago" = 'EFECTIVO'
  AND mc.monto = 100.00
  AND mc.anulado = false;

-- 3) Corregir YAPE: 110.70 → 141.00 (valor nominal)
UPDATE "MovimientoCaja" mc
SET monto = 141.00
FROM "Venta" v
WHERE v.id = mc."ventaId"
  AND v.codigo = 'VTA-SED-00000348'
  AND mc.tipo = 'INGRESO'
  AND mc.categoria = 'VENTA'
  AND mc."metodoPago" = 'YAPE'
  AND mc.monto = 110.70
  AND mc.anulado = false;

-- 4) DESPUÉS — verificar el desglose corregido (debe dar EFECTIVO 69.70 + YAPE 141.00 = 210.70)
SELECT mc."metodoPago", mc.monto
FROM "MovimientoCaja" mc
JOIN "Venta" v ON v.id = mc."ventaId"
WHERE v.codigo = 'VTA-SED-00000348'
  AND mc.tipo = 'INGRESO'
  AND mc.categoria = 'VENTA'
  AND mc.anulado = false
ORDER BY mc."metodoPago";

-- Si el SELECT del paso 4 muestra 69.70 / 141.00, confirmar:
COMMIT;
-- En caso de duda: ROLLBACK;
