-- ============================================================================
-- AUDITORÍA: Movimientos de caja manuales con tipo/categoría incoherente
-- ============================================================================
-- Causa: bug Flutter (CategoriaMovimientoCaja.esIngreso clasificaba COMPRA y
-- DEVOLUCION como ingreso). Los cajeros que registraban un egreso por compra
-- o devolución terminaban grabando tipo=INGRESO. El monto SUMABA al saldo
-- en lugar de RESTAR.
--
-- Fix aplicado:
--  - Flutter: esIngreso ahora retorna false para COMPRA/DEVOLUCION
--  - Backend: guard `_validarCoherenciaTipoCategoria` rechaza nuevos casos
--
-- Este script SOLO LISTA, no modifica nada. Decidir caso por caso si
-- corregir el tipo (UPDATE), marcar anulado + crear contrapartida, o dejar.
-- ============================================================================

-- 1) Resumen agregado por empresa: cuántos movimientos hay y por cuánta plata
SELECT
  e.id           AS empresa_id,
  e."razonSocial" AS empresa,
  COUNT(*)                                                   AS cant_movimientos,
  SUM(m.monto)                                               AS total_monto,
  MIN(m."fechaMovimiento")                                   AS primer_caso,
  MAX(m."fechaMovimiento")                                   AS ultimo_caso
FROM "MovimientoCaja" m
JOIN "Empresa" e ON e.id = m."empresaId"
WHERE m."esManual"  = true
  AND m.anulado     = false
  AND (
    -- caso A: categoría EGRESO pura registrada como INGRESO
    (m.tipo = 'INGRESO' AND m.categoria IN (
      'COMPRA', 'DEVOLUCION', 'PAGO_PROVEEDOR', 'GASTO_OPERATIVO',
      'OTRO_EGRESO', 'REPOSICION_CAJA_CHICA',
      'COMISION_AGENTE', 'PAGO_PLANILLA',
      'ADELANTO_EMPLEADO', 'BONIFICACION_EMPLEADO'
    ))
    OR
    -- caso B (defensivo): categoría INGRESO pura registrada como EGRESO
    (m.tipo = 'EGRESO' AND m.categoria IN (
      'VENTA', 'PEDIDO_MARKETPLACE', 'ADELANTO_SERVICIO', 'OTRO_INGRESO'
    ))
  )
GROUP BY e.id, e."razonSocial"
ORDER BY total_monto DESC;

-- 2) Detalle por caja: para hacer un cuadre antes/después
SELECT
  e."razonSocial"  AS empresa,
  c.codigo         AS caja,
  c.estado         AS caja_estado,
  c."fechaApertura"::date AS apertura,
  c."fechaCierre"::date   AS cierre,
  COUNT(m.id)      AS cant_mov_incoherentes,
  SUM(m.monto)     AS monto_incoherente,
  -- Si fuera EGRESO, el saldo bajaría 2x el monto (saca el ingreso + pone egreso)
  SUM(m.monto) * 2 AS impacto_correccion_saldo
FROM "MovimientoCaja" m
JOIN "Caja" c    ON c.id = m."cajaId"
JOIN "Empresa" e ON e.id = m."empresaId"
WHERE m."esManual"  = true
  AND m.anulado     = false
  AND (
    (m.tipo = 'INGRESO' AND m.categoria IN (
      'COMPRA', 'DEVOLUCION', 'PAGO_PROVEEDOR', 'GASTO_OPERATIVO',
      'OTRO_EGRESO', 'REPOSICION_CAJA_CHICA',
      'COMISION_AGENTE', 'PAGO_PLANILLA',
      'ADELANTO_EMPLEADO', 'BONIFICACION_EMPLEADO'
    ))
    OR
    (m.tipo = 'EGRESO' AND m.categoria IN (
      'VENTA', 'PEDIDO_MARKETPLACE', 'ADELANTO_SERVICIO', 'OTRO_INGRESO'
    ))
  )
GROUP BY e."razonSocial", c.codigo, c.estado, c."fechaApertura", c."fechaCierre"
ORDER BY c."fechaApertura" DESC;

-- 3) Detalle fila a fila (para revisar caso por caso)
SELECT
  e."razonSocial" AS empresa,
  c.codigo        AS caja,
  c.estado        AS caja_estado,
  m.id            AS movimiento_id,
  m.tipo          AS tipo_grabado,
  m.categoria,
  CASE
    WHEN m.categoria IN ('VENTA','PEDIDO_MARKETPLACE','ADELANTO_SERVICIO','OTRO_INGRESO')
      THEN 'INGRESO'
    ELSE 'EGRESO'
  END             AS tipo_correcto,
  m.monto,
  m."metodoPago",
  m.descripcion,
  m."fechaMovimiento",
  u.id            AS registrado_por_id,
  COALESCE(p.nombres || ' ' || p.apellidos, '?') AS registrado_por
FROM "MovimientoCaja" m
JOIN "Caja"    c ON c.id = m."cajaId"
JOIN "Empresa" e ON e.id = m."empresaId"
LEFT JOIN "Usuario" u ON u.id = m."registradoPorId"
LEFT JOIN "Persona" p ON p.id = u."personaId"
WHERE m."esManual"  = true
  AND m.anulado     = false
  AND (
    (m.tipo = 'INGRESO' AND m.categoria IN (
      'COMPRA', 'DEVOLUCION', 'PAGO_PROVEEDOR', 'GASTO_OPERATIVO',
      'OTRO_EGRESO', 'REPOSICION_CAJA_CHICA',
      'COMISION_AGENTE', 'PAGO_PLANILLA',
      'ADELANTO_EMPLEADO', 'BONIFICACION_EMPLEADO'
    ))
    OR
    (m.tipo = 'EGRESO' AND m.categoria IN (
      'VENTA', 'PEDIDO_MARKETPLACE', 'ADELANTO_SERVICIO', 'OTRO_INGRESO'
    ))
  )
ORDER BY m."fechaMovimiento" DESC;

-- ============================================================================
-- OPCIONES DE CORRECCIÓN (NO ejecutar sin antes leer las query 1-3)
-- ============================================================================

-- Opción A — UPDATE directo: corrige el tipo conservando el monto y categoria.
-- Más simple, cuadra la caja inmediatamente. Pierde trazabilidad del bug.
-- DESCOMENTAR Y EJECUTAR EN TX MANUAL DESPUÉS DE RESPALDAR:
--
-- BEGIN;
-- UPDATE "MovimientoCaja"
-- SET tipo = 'EGRESO'
-- WHERE "esManual" = true
--   AND anulado    = false
--   AND tipo       = 'INGRESO'
--   AND categoria IN (
--     'COMPRA','DEVOLUCION','PAGO_PROVEEDOR','GASTO_OPERATIVO',
--     'OTRO_EGRESO','REPOSICION_CAJA_CHICA',
--     'COMISION_AGENTE','PAGO_PLANILLA',
--     'ADELANTO_EMPLEADO','BONIFICACION_EMPLEADO'
--   );
-- UPDATE "MovimientoCaja"
-- SET tipo = 'INGRESO'
-- WHERE "esManual" = true
--   AND anulado    = false
--   AND tipo       = 'EGRESO'
--   AND categoria IN ('VENTA','PEDIDO_MARKETPLACE','ADELANTO_SERVICIO','OTRO_INGRESO');
-- COMMIT;
--
-- (NO ejecutar en cajas ya CERRADAS sin antes confirmar que el CierreCaja
-- correspondiente se va a re-calcular o quedará desfasado.)

-- Opción B — Marcar como anulado + crear contrapartida (más auditable):
-- Requiere script aparte que reproduzca el patrón de anularMovimiento
-- (crea EGRESO espejo con anulado=true, marca original anulado=true).
-- Indicado si queremos preservar evidencia del bug original.
