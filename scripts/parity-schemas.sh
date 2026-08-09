#!/bin/bash
#
# Paridad estructural entre los esquemas de BETA y PROD.
#
# Se corre DENTRO del VPS (o por stdin desde local):
#     ssh root@86.48.26.221 'bash -s' < backend/scripts/parity-schemas.sh
#
# Compara SOLO estructura. Que los DATOS difieran es lo correcto: son entornos
# distintos con empresas y operaciones distintas. Si los datos fueran iguales,
# significaría que algo pisó producción.
#
# Por qué 12 dimensiones y no las 3 de siempre (columnas / nombres de índice /
# enums): un índice puede llamarse igual y tener otras columnas, otro WHERE
# parcial u otro método; una FK puede llamarse igual y haber cambiado de
# ON DELETE SET NULL a CASCADE; y los DEFAULTS no se miraban nunca, que es una
# fuente clásica de drift silencioso. Acá se comparan las DEFINICIONES enteras.
#
set -uo pipefail

BETA_DB="${BETA_DB:-db_saas_beta}"
PROD_DB="${PROD_DB:-db_saas}"
PGC="${PGC:-postgres}"   # contenedor de Postgres

FALLOS=0
SOSPECHAS=0

q() { docker exec "$PGC" psql -U postgres -d "$1" -t -A -c "$2"; }

# comparar <titulo> <sql> [sql_control]
#
# sql_control existe por una razón concreta: si el SQL está mal escrito, las dos
# bases devuelven vacío y el diff dice "idéntico". Eso es un FALSO POSITIVO que
# ya mordió una vez. Cuando una dimensión da vacío en ambas, el control tiene
# que devolver > 0 para probar que la query corre de verdad.
comparar() {
  local titulo="$1" sql="$2" control="${3:-}"
  q "$BETA_DB" "$sql" | sort > /tmp/pb.txt
  q "$PROD_DB" "$sql" | sort > /tmp/pp.txt
  local nb np
  nb=$(wc -l < /tmp/pb.txt); np=$(wc -l < /tmp/pp.txt)
  printf '%-32s beta:%-6s prod:%-6s ' "$titulo" "$nb" "$np"

  if ! diff -q /tmp/pb.txt /tmp/pp.txt > /dev/null; then
    echo "*** DIFERENCIAS ***"
    FALLOS=$((FALLOS+1))
    echo "      (< beta   > prod)"
    diff /tmp/pb.txt /tmp/pp.txt | head -40 | sed 's/^/      /'
    return
  fi

  if [ "$nb" -eq 0 ]; then
    if [ -n "$control" ]; then
      local cb cp
      cb=$(q "$BETA_DB" "$control"); cp=$(q "$PROD_DB" "$control")
      if [ "${cb:-0}" -gt 0 ] && [ "${cp:-0}" -gt 0 ]; then
        echo "VACIO EN AMBAS (control ok: $cb/$cp)"
      else
        echo "!! VACIO Y CONTROL VACIO - CHEQUEO NO CONFIABLE"
        SOSPECHAS=$((SOSPECHAS+1))
      fi
    else
      echo "!! VACIO EN AMBAS - SIN CONTROL, NO CONFIABLE"
      SOSPECHAS=$((SOSPECHAS+1))
    fi
    return
  fi

  echo "IDENTICO"
}

PUB="nspname='public'"
echo "=================================================================="
echo " PARIDAD ESTRUCTURAL   $BETA_DB  vs  $PROD_DB"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "=================================================================="
echo

comparar "1. TABLAS" \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'"

comparar "2. COLUMNAS tipo+escala+null" \
  "SELECT table_name||'.'||column_name||' :: '||data_type||'('||coalesce(numeric_precision::text,coalesce(character_maximum_length::text,'-'))||','||coalesce(numeric_scale::text,'-')||') null='||is_nullable FROM information_schema.columns WHERE table_schema='public'"

comparar "3. DEFAULTS DE COLUMNA" \
  "SELECT table_name||'.'||column_name||' = '||coalesce(column_default,'(sin default)') FROM information_schema.columns WHERE table_schema='public'"

comparar "4. INDICES (definicion completa)" \
  "SELECT indexdef FROM pg_indexes WHERE schemaname='public'"

comparar "5. CONSTRAINTS (definicion)" \
  "SELECT c.conrelid::regclass||' '||c.conname||' '||pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE $PUB"

comparar "6. ENUMS (label + orden)" \
  "SELECT t.typname||':'||e.enumlabel||':'||e.enumsortorder FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid"

comparar "7. EXTENSIONES" \
  "SELECT extname||' v'||extversion FROM pg_extension"

comparar "8. FUNCIONES" \
  "SELECT p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE $PUB"

# Prisma no crea triggers de usuario: se espera 0. El control cuenta los
# triggers INTERNOS (los que Postgres crea para hacer cumplir cada FK), que son
# miles — si además coinciden, es una confirmación extra de que la estructura de
# claves foráneas es la misma.
comparar "9. TRIGGERS de usuario" \
  "SELECT c.relname||'.'||t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE $PUB AND NOT t.tgisinternal" \
  "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE $PUB AND t.tgisinternal"

# Tampoco crea vistas. Control: las vistas de sistema, que siempre existen.
comparar "10. VISTAS" \
  "SELECT table_name FROM information_schema.views WHERE table_schema='public'" \
  "SELECT count(*) FROM information_schema.views"

# Ni secuencias: los IDs son cuid(), no serial. Control: total de relaciones.
comparar "11. SECUENCIAS" \
  "SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'" \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE $PUB"

# Ojo: se filtra por finished_at IS NOT NULL a propósito. Hay 7 filas viejas
# (feb-abr 2026) con finished_at NULL y rolled_back_at seteado; Prisma las
# ignora y NO son migraciones pendientes.
comparar "12. MIGRACIONES APLICADAS" \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"

echo
echo "=================================================================="
if [ "$FALLOS" -eq 0 ] && [ "$SOSPECHAS" -eq 0 ]; then
  echo " RESULTADO: LAS 12 DIMENSIONES DAN IDENTICO"
  echo " Los esquemas de beta y prod son estructuralmente iguales."
  RC=0
else
  [ "$FALLOS"    -gt 0 ] && echo " RESULTADO: $FALLOS dimension(es) CON DIFERENCIAS"
  [ "$SOSPECHAS" -gt 0 ] && echo " RESULTADO: $SOSPECHAS chequeo(s) NO CONFIABLES (revisar el SQL)"
  RC=1
fi
echo "=================================================================="
exit $RC
