-- ============================================
-- SCRIPT PARA LIMPIAR REGISTROS LEGACY
-- ============================================
-- Ejecutar después de la migración v2.0
-- Este script migra registros antiguos a los nuevos valores del enum

-- ============================================
-- 1. VERIFICAR REGISTROS EXISTENTES
-- ============================================

-- Ver cuántos registros usan valores legacy
SELECT
    tipo,
    COUNT(*) as cantidad
FROM "MovimientoStock"
WHERE tipo IN ('ENTRADA_AJUSTE', 'SALIDA_AJUSTE')
GROUP BY tipo;

-- Ver detalle de los registros
SELECT
    id,
    tipo,
    "numeroDocumento",
    motivo,
    cantidad,
    "creadoEn"
FROM "MovimientoStock"
WHERE tipo IN ('ENTRADA_AJUSTE', 'SALIDA_AJUSTE')
ORDER BY "creadoEn" DESC;

-- ============================================
-- 2. MIGRAR REGISTROS LEGACY A NUEVOS VALORES
-- ============================================

-- OPCIÓN A: Migrar automáticamente (RECOMENDADO)
BEGIN;

-- Migrar ENTRADA_AJUSTE → AJUSTE_ENTRADA
UPDATE "MovimientoStock"
SET tipo = 'AJUSTE_ENTRADA'
WHERE tipo = 'ENTRADA_AJUSTE';

-- Migrar SALIDA_AJUSTE → AJUSTE_SALIDA
UPDATE "MovimientoStock"
SET tipo = 'AJUSTE_SALIDA'
WHERE tipo = 'SALIDA_AJUSTE';

-- Verificar que no queden registros legacy
SELECT COUNT(*) as registros_legacy_restantes
FROM "MovimientoStock"
WHERE tipo IN ('ENTRADA_AJUSTE', 'SALIDA_AJUSTE');
-- Debe retornar 0

COMMIT;
-- Descomentar COMMIT solo si todo está OK

-- ============================================
-- 3. VERIFICAR RESULTADO
-- ============================================

-- Ver distribución de tipos después de la migración
SELECT
    tipo,
    COUNT(*) as cantidad
FROM "MovimientoStock"
GROUP BY tipo
ORDER BY cantidad DESC;

-- ============================================
-- OPCIÓN B: Eliminar registros legacy (NO RECOMENDADO)
-- ============================================
-- ⚠️ CUIDADO: Esto eliminará datos permanentemente
-- Solo ejecutar si estás SEGURO de que no necesitas estos registros

-- BEGIN;
--
-- DELETE FROM "MovimientoStock"
-- WHERE tipo IN ('ENTRADA_AJUSTE', 'SALIDA_AJUSTE');
--
-- COMMIT;

-- ============================================
-- 4. LIMPIEZA DEL ENUM (Opcional - Futuro)
-- ============================================
-- Una vez que NO haya registros usando valores legacy,
-- puedes eliminar esos valores del enum en una migración futura.
-- Por ahora, mantenerlos no afecta el funcionamiento.

-- Para remover en el futuro (cuando NO haya registros legacy):
-- 1. Verificar que no haya registros:
--    SELECT COUNT(*) FROM "MovimientoStock" WHERE tipo IN ('ENTRADA_AJUSTE', 'SALIDA_AJUSTE');
-- 2. Eliminar del schema.prisma los valores ENTRADA_AJUSTE y SALIDA_AJUSTE
-- 3. Ejecutar: npx prisma db push

-- ============================================
-- NOTAS IMPORTANTES
-- ============================================
--
-- - Los valores legacy se mantienen en el enum por compatibilidad
-- - NO afectan el funcionamiento del sistema
-- - La migración AJUSTE_ENTRADA/AJUSTE_SALIDA es cosmética
-- - Solo migrar si quieres mantener consistencia en la nomenclatura
--
-- ============================================
