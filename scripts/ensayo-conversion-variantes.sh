#!/bin/bash
#
# Fotografía el estado de un producto ANTES y DESPUÉS de convertirlo a
# variantes, para verificar que la conversión hace lo que se espera.
#
#     ssh root@86.48.26.221 'bash -s' < backend/scripts/ensayo-conversion-variantes.sh <productoId> [db]
#
# Se corre dos veces (antes y después) y se comparan las salidas. Lo que hay que
# ver al comparar:
#
#   1. STOCK       el total NO cambia; la fila de ProductoStock pasa de
#                  productoId=<id>/varianteId=NULL a productoId=NULL/varianteId=<BASE>
#   2. VENTAS      count y suma IDENTICOS; las lineas viejas conservan su
#                  productoId y su varianteId sigue en NULL
#   3. VARIANTES   aparece una sola, con sku terminado en -BASE y SIN atributos
#   4. KARDEX      un MovimientoStock nuevo tipo MIGRACION_VARIANTE con
#                  cantidad=0 (no altera saldos, solo deja rastro)
#
set -uo pipefail
PID="${1:?falta el productoId}"
DB="${2:-db_saas_beta}"
P() { docker exec postgres psql -U postgres -d "$DB" -t -A -F' | ' -c "$1"; }

echo "=================================================================="
echo " ENSAYO CONVERSION A VARIANTES   producto=$PID   db=$DB"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=================================================================="

echo
echo "--- 0. PRODUCTO ---"
P "SELECT 'nombre='||nombre||' tieneVariantes='||\"tieneVariantes\"||' esCombo='||\"esCombo\"||' activo='||\"isActive\" FROM \"Producto\" WHERE id='$PID'"

echo
echo "--- 1. STOCK (filas de ProductoStock que apuntan al producto O a sus variantes) ---"
P "SELECT 'fila='||ps.id||' sede='||s.nombre||' productoId='||coalesce(ps.\"productoId\",'NULL')||' varianteId='||coalesce(ps.\"varianteId\",'NULL')||' stock='||ps.\"stockActual\"||' precio='||coalesce(ps.precio::text,'-')||' costo='||coalesce(ps.\"precioCosto\"::text,'-')
    FROM \"ProductoStock\" ps JOIN \"Sede\" s ON s.id=ps.\"sedeId\"
    WHERE ps.\"productoId\"='$PID' OR ps.\"varianteId\" IN (SELECT id FROM \"ProductoVariante\" WHERE \"productoId\"='$PID')
    ORDER BY 1"
echo -n "STOCK TOTAL -> "
P "SELECT coalesce(sum(ps.\"stockActual\"),0) FROM \"ProductoStock\" ps WHERE ps.\"productoId\"='$PID' OR ps.\"varianteId\" IN (SELECT id FROM \"ProductoVariante\" WHERE \"productoId\"='$PID')"

echo
echo "--- 2. VENTAS (deben quedar INTACTAS) ---"
echo -n "lineas / unidades / con varianteId -> "
P "SELECT count(*)||' lineas | '||coalesce(sum(cantidad),0)||' u | '||count(\"varianteId\")||' con variante' FROM \"VentaDetalle\" WHERE \"productoId\"='$PID'"
echo "ultimas 3 lineas:"
P "SELECT '  '||left(descripcion,30)||' cant='||cantidad||' pu='||\"precioUnitario\"||' varianteId='||coalesce(\"varianteId\",'NULL') FROM \"VentaDetalle\" WHERE \"productoId\"='$PID' ORDER BY \"creadoEn\" DESC LIMIT 3"

echo
echo "--- 3. VARIANTES ---"
P "SELECT 'id='||id||' nombre='||nombre||' sku='||coalesce(sku,'-')||' activa='||\"isActive\"||' borrada='||coalesce(\"deletedAt\"::text,'no') FROM \"ProductoVariante\" WHERE \"productoId\"='$PID' ORDER BY orden"
echo -n "cantidad de variantes -> "
P "SELECT count(*) FROM \"ProductoVariante\" WHERE \"productoId\"='$PID'"
echo "atributos de cada variante (una variante SIN atributos es INALCANZABLE en el sheet):"
P "SELECT '  variante='||v.nombre||' atributos='||(SELECT count(*) FROM \"ProductoAtributoValor\" av WHERE av.\"varianteId\"=v.id)||' -> '||coalesce((SELECT string_agg(a.clave||'='||av.valor,', ') FROM \"ProductoAtributoValor\" av JOIN \"ProductoAtributo\" a ON a.id=av.\"atributoId\" WHERE av.\"varianteId\"=v.id),'(NINGUNO)') FROM \"ProductoVariante\" v WHERE v.\"productoId\"='$PID'"

echo
echo "--- 4. KARDEX (ultimos 5 movimientos) ---"
P "SELECT '  '||to_char(m.\"creadoEn\",'MM-DD HH24:MI')||' '||m.tipo||' doc='||coalesce(m.\"tipoDocumento\",'-')||' ant='||m.\"cantidadAnterior\"||' cant='||m.cantidad||' nueva='||m.\"cantidadNueva\"
    FROM \"MovimientoStock\" m
    WHERE m.\"productoStockId\" IN (
      SELECT ps.id FROM \"ProductoStock\" ps
      WHERE ps.\"productoId\"='$PID' OR ps.\"varianteId\" IN (SELECT id FROM \"ProductoVariante\" WHERE \"productoId\"='$PID'))
    ORDER BY m.\"creadoEn\" DESC LIMIT 5"

echo
echo "=================================================================="
