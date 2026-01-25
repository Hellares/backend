-- =====================================================
-- SCRIPT: Limpiar todos los productos de una empresa
-- VERSIÓN SIMPLE - Solo cambia el empresaId abajo
-- =====================================================
-- IMPORTANTE: Este script elimina TODOS los productos
-- =====================================================

DO $$
DECLARE
  -- ⚠️⚠️⚠️ CAMBIA SOLO ESTA LÍNEA ⚠️⚠️⚠️
  v_empresa_id TEXT := 'cmkc2bzm70000p4udrkari5qe'; -- Reemplaza con tu empresa ID

  -- Variables de conteo
  empresa_nombre TEXT;
  count_transferencias INT;
  count_historial_sede INT;
  count_historial INT;
  count_combos INT;
  count_precios_nivel INT;
  count_atributo_valores INT;
  count_stock_variantes INT;
  count_variantes INT;
  count_stock_productos INT;
  count_archivos INT;
  count_atributos INT;
  count_plantillas INT;
  count_productos INT;
  total_eliminado INT := 0;
BEGIN
  -- Verificar empresa
  SELECT nombre INTO empresa_nombre FROM "Empresa" WHERE id = v_empresa_id;

  IF empresa_nombre IS NULL THEN
    RAISE EXCEPTION '❌ Empresa no encontrada con ID: %', v_empresa_id;
  END IF;

  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE '🔥 LIMPIANDO PRODUCTOS DE EMPRESA';
  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE 'Empresa: %', empresa_nombre;
  RAISE NOTICE 'ID: %', v_empresa_id;
  RAISE NOTICE '⚠️  Esta operación NO se puede deshacer';
  RAISE NOTICE '';

  -- 1. Transferencias de Stock
  WITH deleted AS (
    DELETE FROM "TransferenciaStock"
    WHERE empresaId = v_empresa_id
    RETURNING id
  )
  SELECT COUNT(*) INTO count_transferencias FROM deleted;
  RAISE NOTICE '1. ✓ Transferencias eliminadas: %', count_transferencias;
  total_eliminado := total_eliminado + count_transferencias;

  -- 2. Historial de precios por sede
  WITH deleted AS (
    DELETE FROM "ProductoPrecioHistorialSede"
    WHERE empresaId = v_empresa_id
    RETURNING id
  )
  SELECT COUNT(*) INTO count_historial_sede FROM deleted;
  RAISE NOTICE '2. ✓ Historial precios sede eliminados: %', count_historial_sede;
  total_eliminado := total_eliminado + count_historial_sede;

  -- 3. Historial de precios
  WITH deleted AS (
    DELETE FROM "ProductoPrecioHistorial"
    WHERE "productoId" IN (SELECT id FROM "Producto" WHERE "empresaId" = v_empresa_id)
       OR "varianteId" IN (
         SELECT v.id FROM "ProductoVariante" v
         INNER JOIN "Producto" p ON v."productoId" = p.id
         WHERE p."empresaId" = v_empresa_id
       )
    RETURNING id
  )
  SELECT COUNT(*) INTO count_historial FROM deleted;
  RAISE NOTICE '3. ✓ Historial precios eliminados: %', count_historial;
  total_eliminado := total_eliminado + count_historial;

  -- 4. Combos
  WITH deleted AS (
    DELETE FROM "ProductoCombo"
    WHERE "productoComboId" IN (SELECT id FROM "Producto" WHERE "empresaId" = v_empresa_id)
       OR "productoComponenteId" IN (SELECT id FROM "Producto" WHERE "empresaId" = v_empresa_id)
    RETURNING id
  )
  SELECT COUNT(*) INTO count_combos FROM deleted;
  RAISE NOTICE '4. ✓ Relaciones combos eliminadas: %', count_combos;
  total_eliminado := total_eliminado + count_combos;

  -- 5. Precios por nivel
  WITH deleted AS (
    DELETE FROM "PrecioNivel"
    WHERE "productoId" IN (SELECT id FROM "Producto" WHERE "empresaId" = v_empresa_id)
       OR "varianteId" IN (
         SELECT v.id FROM "ProductoVariante" v
         INNER JOIN "Producto" p ON v."productoId" = p.id
         WHERE p."empresaId" = v_empresa_id
       )
    RETURNING id
  )
  SELECT COUNT(*) INTO count_precios_nivel FROM deleted;
  RAISE NOTICE '5. ✓ Precios por nivel eliminados: %', count_precios_nivel;
  total_eliminado := total_eliminado + count_precios_nivel;

  -- 6. Valores de atributos
  WITH deleted AS (
    DELETE FROM "ProductoAtributoValor"
    WHERE "productoId" IN (SELECT id FROM "Producto" WHERE "empresaId" = v_empresa_id)
       OR "varianteId" IN (
         SELECT v.id FROM "ProductoVariante" v
         INNER JOIN "Producto" p ON v."productoId" = p.id
         WHERE p."empresaId" = v_empresa_id
       )
    RETURNING id
  )
  SELECT COUNT(*) INTO count_atributo_valores FROM deleted;
  RAISE NOTICE '6. ✓ Valores de atributos eliminados: %', count_atributo_valores;
  total_eliminado := total_eliminado + count_atributo_valores;

  -- 7. Stock de variantes
  WITH deleted AS (
    DELETE FROM "ProductoStock"
    WHERE "varianteId" IN (
      SELECT v.id FROM "ProductoVariante" v
      INNER JOIN "Producto" p ON v."productoId" = p.id
      WHERE p."empresaId" = v_empresa_id
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO count_stock_variantes FROM deleted;
  RAISE NOTICE '7. ✓ Stock de variantes eliminado: %', count_stock_variantes;
  total_eliminado := total_eliminado + count_stock_variantes;

  -- 8. Variantes
  WITH deleted AS (
    DELETE FROM "ProductoVariante"
    WHERE "productoId" IN (SELECT id FROM "Producto" WHERE "empresaId" = v_empresa_id)
    RETURNING id
  )
  SELECT COUNT(*) INTO count_variantes FROM deleted;
  RAISE NOTICE '8. ✓ Variantes eliminadas: %', count_variantes;
  total_eliminado := total_eliminado + count_variantes;

  -- 9. Stock de productos
  WITH deleted AS (
    DELETE FROM "ProductoStock"
    WHERE empresaId = v_empresa_id
    RETURNING id
  )
  SELECT COUNT(*) INTO count_stock_productos FROM deleted;
  RAISE NOTICE '9. ✓ Stock de productos eliminado: %', count_stock_productos;
  total_eliminado := total_eliminado + count_stock_productos;

  -- 10. Archivos
  WITH deleted AS (
    DELETE FROM "Archivo"
    WHERE empresaId = v_empresa_id
      AND "entidadTipo" = 'PRODUCTO'
    RETURNING id
  )
  SELECT COUNT(*) INTO count_archivos FROM deleted;
  RAISE NOTICE '10. ✓ Archivos eliminados: %', count_archivos;
  total_eliminado := total_eliminado + count_archivos;

  -- 11. Atributos
  WITH deleted AS (
    DELETE FROM "ProductoAtributo"
    WHERE empresaId = v_empresa_id
    RETURNING id
  )
  SELECT COUNT(*) INTO count_atributos FROM deleted;
  RAISE NOTICE '11. ✓ Atributos eliminados: %', count_atributos;
  total_eliminado := total_eliminado + count_atributos;

  -- 12. Plantillas
  WITH deleted AS (
    DELETE FROM "ProductoAtributoPlantilla"
    WHERE empresaId = v_empresa_id
    RETURNING id
  )
  SELECT COUNT(*) INTO count_plantillas FROM deleted;
  RAISE NOTICE '12. ✓ Plantillas eliminadas: %', count_plantillas;
  total_eliminado := total_eliminado + count_plantillas;

  -- 13. Productos (TABLA PRINCIPAL)
  WITH deleted AS (
    DELETE FROM "Producto"
    WHERE empresaId = v_empresa_id
    RETURNING id
  )
  SELECT COUNT(*) INTO count_productos FROM deleted;
  RAISE NOTICE '13. ✓ Productos eliminados: %', count_productos;
  total_eliminado := total_eliminado + count_productos;

  -- Resumen
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE '✅ LIMPIEZA COMPLETADA EXITOSAMENTE';
  RAISE NOTICE '════════════════════════════════════════════════════';
  RAISE NOTICE 'Total de registros eliminados: %', total_eliminado;
  RAISE NOTICE '';
  RAISE NOTICE '💡 IMPORTANTE:';
  RAISE NOTICE '   - Los cambios se han aplicado';
  RAISE NOTICE '   - Invalida el cache de Redis';
  RAISE NOTICE '   - Reinicia el backend y Flutter';
  RAISE NOTICE '════════════════════════════════════════════════════';
END $$;
