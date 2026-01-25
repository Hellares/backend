-- =====================================================
-- SCRIPT: Limpiar todos los productos de una empresa
-- =====================================================
-- IMPORTANTE: Reemplaza 'TU_EMPRESA_ID' con el ID real de tu empresa
-- Este script elimina TODOS los productos y datos relacionados
-- =====================================================

-- Variable para el empresaId (reemplazar antes de ejecutar)
-- Ejemplo: SET @empresaId = 'cmkc2bzm70000p4udrkari5qe';

BEGIN;

-- Mostrar empresa que será limpiada
DO $$
DECLARE
  empresa_id TEXT := 'cmkc2bzm70000p4udrkari5qe'; -- ⚠️ REEMPLAZAR AQUÍ
  empresa_nombre TEXT;
BEGIN
  SELECT nombre INTO empresa_nombre FROM "Empresa" WHERE id = empresa_id;
  RAISE NOTICE '🔥 Limpiando productos de empresa: % (ID: %)', empresa_nombre, empresa_id;
  RAISE NOTICE '⚠️  Esta operación NO se puede deshacer';
  RAISE NOTICE '';
END $$;

-- =====================================================
-- 1. TRANSFERENCIAS DE STOCK
-- =====================================================
WITH deleted AS (
  DELETE FROM "TransferenciaStock"
  WHERE empresaId = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Transferencias eliminadas

-- =====================================================
-- 2. HISTORIAL DE PRECIOS POR SEDE
-- =====================================================
WITH deleted AS (
  DELETE FROM "ProductoPrecioHistorialSede"
  WHERE empresaId = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Historial de precios por sede eliminados

-- =====================================================
-- 3. HISTORIAL DE PRECIOS
-- =====================================================
WITH deleted AS (
  DELETE FROM "ProductoPrecioHistorial"
  WHERE "productoId" IN (
    SELECT id FROM "Producto" WHERE "empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  OR "varianteId" IN (
    SELECT v.id FROM "ProductoVariante" v
    INNER JOIN "Producto" p ON v."productoId" = p.id
    WHERE p."empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Historial de precios eliminados

-- =====================================================
-- 4. COMBOS (relaciones entre productos)
-- =====================================================
WITH deleted AS (
  DELETE FROM "ProductoCombo"
  WHERE "productoComboId" IN (
    SELECT id FROM "Producto" WHERE "empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  OR "productoComponenteId" IN (
    SELECT id FROM "Producto" WHERE "empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Relaciones de combos eliminadas

-- =====================================================
-- 5. PRECIOS POR NIVEL (precios por volumen)
-- =====================================================
WITH deleted AS (
  DELETE FROM "PrecioNivel"
  WHERE "productoId" IN (
    SELECT id FROM "Producto" WHERE "empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  OR "varianteId" IN (
    SELECT v.id FROM "ProductoVariante" v
    INNER JOIN "Producto" p ON v."productoId" = p.id
    WHERE p."empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Niveles de precio eliminados

-- =====================================================
-- 6. VALORES DE ATRIBUTOS (variantes y productos)
-- =====================================================
WITH deleted AS (
  DELETE FROM "ProductoAtributoValor"
  WHERE "productoId" IN (
    SELECT id FROM "Producto" WHERE "empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  OR "varianteId" IN (
    SELECT v.id FROM "ProductoVariante" v
    INNER JOIN "Producto" p ON v."productoId" = p.id
    WHERE p."empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Valores de atributos eliminados

-- =====================================================
-- 7. STOCK DE VARIANTES (ProductoStock de variantes)
-- =====================================================
WITH deleted AS (
  DELETE FROM "ProductoStock"
  WHERE "varianteId" IN (
    SELECT v.id FROM "ProductoVariante" v
    INNER JOIN "Producto" p ON v."productoId" = p.id
    WHERE p."empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Stocks de variantes eliminados

-- =====================================================
-- 8. VARIANTES DE PRODUCTOS
-- =====================================================
WITH deleted AS (
  DELETE FROM "ProductoVariante"
  WHERE "productoId" IN (
    SELECT id FROM "Producto" WHERE "empresaId" = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  )
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Variantes eliminadas

-- =====================================================
-- 9. STOCK DE PRODUCTOS (ProductoStock)
-- =====================================================
WITH deleted AS (
  DELETE FROM "ProductoStock"
  WHERE empresaId = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Stocks de productos eliminados

-- =====================================================
-- 10. ARCHIVOS DE PRODUCTOS
-- =====================================================
WITH deleted AS (
  DELETE FROM "Archivo"
  WHERE empresaId = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
    AND "entidadTipo" = 'PRODUCTO'
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Archivos eliminados

-- =====================================================
-- 11. ATRIBUTOS DE PRODUCTOS (solo de esta empresa)
-- =====================================================
-- NOTA: Solo elimina atributos específicos de esta empresa
-- Los atributos compartidos se mantienen
WITH deleted AS (
  DELETE FROM "ProductoAtributo"
  WHERE empresaId = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Atributos eliminados

-- =====================================================
-- 12. PLANTILLAS DE ATRIBUTOS (solo de esta empresa)
-- =====================================================
WITH deleted AS (
  DELETE FROM "ProductoAtributoPlantilla"
  WHERE empresaId = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Plantillas eliminadas

-- =====================================================
-- 13. PRODUCTOS (tabla principal)
-- =====================================================
WITH deleted AS (
  DELETE FROM "Producto"
  WHERE empresaId = 'cmkc2bzm70000p4udrkari5qe' -- ⚠️ REEMPLAZAR AQUÍ
  RETURNING id
)
SELECT COUNT(*) AS count FROM deleted;
-- Muestra: Productos eliminados

-- =====================================================
-- RESUMEN FINAL
-- =====================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Limpieza completada exitosamente';
  RAISE NOTICE '📊 Verifica los contadores arriba para confirmar';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  IMPORTANTE: Revisa que los números sean correctos antes de hacer COMMIT';
  RAISE NOTICE '💡 Si algo está mal, ejecuta ROLLBACK; para deshacer los cambios';
  RAISE NOTICE '✅ Si todo está bien, ejecuta COMMIT; para confirmar';
END $$;

-- =====================================================
-- NO HACER COMMIT AUTOMÁTICO
-- Revisa los resultados y luego ejecuta manualmente:
-- COMMIT;   -- Para confirmar los cambios
-- ROLLBACK; -- Para deshacer los cambios
-- =====================================================
