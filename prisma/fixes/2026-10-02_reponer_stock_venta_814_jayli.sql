-- Repone la unidad que la anulación de VTA-SED-00000814 (JAYLI, 17-09-2026)
-- nunca devolvió al inventario.
--
-- La venta se anuló cuando `anular()` todavía buscaba el stock de una VARIANTE
-- con productoId Y varianteId a la vez: no encontraba la fila y se salteaba la
-- línea en silencio (arreglado ese mismo día en c6200fc). El código quedó bien
-- pero el dato no se reparó: el sistema marcaba 0 y en la tienda hay 1
-- (confirmado por el dueño el 02-10-2026).
--
-- Hace lo mismo que debió hacer la anulación: stock +1, el movimiento
-- AJUSTE_SALIDA_VENTA al costo con que salió (S/ 68) y el lote de vuelta.
--
-- Idempotente: no hace nada si la venta ya tiene su movimiento de reposición.
-- Las fechas van en UTC (`timezone('UTC', now())`): un now() local rompe los
-- deltas de sync.

DO $$
DECLARE
  v_venta   text := 'cmu4pbk1a00bq01p5bmk6spzc';  -- VTA-SED-00000814
  v_stock   text := 'cmsp5jxnd00vn01o4ik2h0c32';  -- 2 PLAZAS / CARNERITO / 3 PZS / HOMBRE / CRISTAL
  v_lote    text := 'cmsp6hgw800y401o4odni08rl';  -- LOTE-00000078
  v_antes   int;
  v_ahora   timestamp := timezone('UTC', now());
BEGIN
  IF EXISTS (
    SELECT 1 FROM "MovimientoStock"
    WHERE "ventaId" = v_venta AND tipo = 'AJUSTE_SALIDA_VENTA'
  ) THEN
    RAISE NOTICE 'La venta ya tiene su movimiento de reposicion: no se hace nada.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM "Venta" WHERE id = v_venta AND estado = 'ANULADA') THEN
    RAISE EXCEPTION 'La venta no esta ANULADA: no corresponde reponer';
  END IF;

  SELECT "stockActual" INTO v_antes FROM "ProductoStock" WHERE id = v_stock FOR UPDATE;
  IF v_antes IS NULL THEN
    RAISE EXCEPTION 'No existe la fila de stock %', v_stock;
  END IF;

  UPDATE "ProductoStock"
     SET "stockActual" = v_antes + 1, "actualizadoEn" = v_ahora
   WHERE id = v_stock;

  INSERT INTO "MovimientoStock" (
    id, "sedeId", "productoStockId", "empresaId", tipo, "tipoDocumento", "numeroDocumento",
    "cantidadAnterior", cantidad, "cantidadNueva", motivo, observaciones,
    "ventaId", "usuarioId", "creadoEn", "precioCostoUnitario", "valorMovimiento"
  )
  SELECT
    'fix814' || substr(md5(v_venta || v_stock), 1, 19),
    v."sedeId", v_stock, v."empresaId", 'AJUSTE_SALIDA_VENTA', 'VENTA', v.codigo,
    v_antes, 1, v_antes + 1,
    'Anulacion venta ' || v.codigo || ' - EDREDONES - 2 PLAZAS / CARNERITO / 3 PZS / HOMBRE / CRISTAL',
    'Reposicion aplicada el 02-10-2026: la anulacion del 17-09 no devolvio la unidad (error ya corregido).',
    v.id, v."anuladoPorId", v_ahora, 68.000000, 68.00
  FROM "Venta" v WHERE v.id = v_venta;

  -- El lote vuelve a tener la unidad (y deja de estar AGOTADO).
  UPDATE "Lote"
     SET "cantidadActual" = "cantidadActual" + 1, estado = 'ACTIVO', "actualizadoEn" = v_ahora
   WHERE id = v_lote;

  -- El producto padre se marca como cambiado para que el app lo traiga en su
  -- proximo delta-sync.
  UPDATE "Producto" SET "actualizadoEn" = v_ahora
   WHERE id = (SELECT "productoId" FROM "ProductoVariante" WHERE id = 'cmsp5jxml00vh01o46omvzrcw');
  UPDATE "ProductoVariante" SET "actualizadoEn" = v_ahora
   WHERE id = 'cmsp5jxml00vh01o46omvzrcw';

  RAISE NOTICE 'Repuesto: stock % -> %', v_antes, v_antes + 1;
END $$;
