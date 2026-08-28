# 🚀 Runbook de Deploy — Syncronize SaaS (beta y prod)

> Guía para hacer el deploy MANUAL del backend. Última actualización: 2026-08-09
> (pase a prod de unidad de presentación + variantes con apertura de bulto, donde se
> corrigió el paso 8: en prod el cache se invalida por patrón, nunca con `FLUSHDB`).

---

## 📋 Datos base (memorizar esto)

| Qué | Valor |
|---|---|
| VPS SaaS | `ssh root@86.48.26.221` |
| Script de deploy | `/opt/syncronize/deploy/deploy.sh beta\|prod\|migrate <env>` |
| Archivos de entorno | `/opt/syncronize/deploy/stack.beta.env` y `stack.prod.env` |
| Contenedor Postgres | `postgres` — DB beta = `db_saas_beta`, DB prod = `db_saas` |
| Contenedores backend | `syncronize-backend-beta` / `syncronize-backend-prod` |
| **Imágenes (separadas desde 08-2026)** | beta = `syncronize-api:latest` · **prod = `syncronize-api:prod-actual`** — ver gotcha 8 |
| Puerto interno del backend | **6000** (el health desde dentro del contenedor es a `localhost:6000`, NO 3001) |
| Redis | beta = contenedor `redis-beta` · **PROD = contenedor `redis-dev`** ⚠️ (nombre engañoso, NO es dev) |
| Backups | `/opt/backups/` |
| Health check | `GET /api/redis/health` → esperar `{"status":"healthy","connected":true}` |
| Health público | beta: `https://saas-beta.syncronize.net.pe/api/redis/health` · prod: `https://saas.syncronize.net.pe/api/redis/health` |
| Web (Next.js) | `/opt/syncronize/web-deploy/deploy.sh beta\|prod` (variables `NEXT_PUBLIC_*` van como build-arg) |

### ⚠️ Gotchas que SIEMPRE muerden

1. **`deploy.sh` NO corre las migraciones** — hay que correrlas aparte (ver abajo).
2. **`deploy.sh migrate <env>` corre dentro del contenedor VIEJO** si lo lanzas antes
   del deploy — las migraciones nuevas no existen ahí. Orden correcto: deploy primero,
   migrate después (o psql manual antes, ver flujo prod).
3. **Migraciones con `CREATE EXTENSION`** (ej: `pg_trgm`): el usuario del contenedor no
   puede crear extensiones → aplicarlas por `psql -U postgres` (superuser).
4. **Cambiaste un transformer/shape de respuesta cacheada** → invalidar Redis a mano
   después del deploy, o servirá datos stale. En **beta** alcanza `FLUSHDB`; en **prod
   va por patrón, NUNCA `FLUSHDB`** — ese Redis tiene sesiones vivas y los webhooks de
   Yape sin TTL. Ver paso 8.
5. **Los env nuevos van ANTES del deploy** — el contenedor toma `stack.<env>.env` al
   recrearse. Si agregas la variable después, toca recrear de nuevo.
6. **Health interno `000` por IPv4 no significa caído** — el socket puede ser IPv6-only
   o el puerto es 6000. Verificar con los comandos de abajo antes de asustarse.
7. **El health desde fuera puede tardar ~15-30s** tras recrear el contenedor (NestJS bootea).
8. **Beta y prod usan IMÁGENES DISTINTAS** (separadas en 08-2026). Antes compartían
   `syncronize-api:latest`, así que un `docker compose up -d` **sin nombrar el servicio**
   recreaba prod con lo último compilado para beta — código no liberado y migraciones sin
   aplicar, sin que nadie lo decidiera. El caso realista era aplicar un cambio de
   `stack.prod.env`, que obliga a recrear el contenedor.
   Hoy prod está fijado a `syncronize-api:prod-actual` y **`deploy.sh prod` mueve esa
   etiqueta solo** (retag explícito antes de recrear). Consecuencias prácticas:
   - Aplicar un env nuevo a prod ya **no** arrastra código: recrear es seguro.
   - Si alguna vez desplegás prod **a mano** (`docker build` + `compose up`), sos vos quien
     tiene que hacer `docker tag syncronize-api:latest syncronize-api:prod-actual`, o prod
     se recreará con el código viejo y parecerá que desplegaste.
   - Rollback rápido: apuntar `prod-actual` a la imagen anterior y recrear.
   - Respaldos del cambio: `docker-compose.yml.bak.*` y `deploy.sh.bak.*` en
     `/opt/syncronize/deploy/`.

---

## 🟢 Deploy a BETA (rutina diaria)

### Sin migraciones

```bash
# 1. En local: commit + push a main
git push

# 2. Deploy (tarda unos minutos por el build de la imagen)
ssh root@86.48.26.221 "/opt/syncronize/deploy/deploy.sh beta"

# 3. Health
curl -s https://saas-beta.syncronize.net.pe/api/redis/health
```

### Con migraciones

```bash
# 1. push a main (la migración viaja en el repo)
# 2. Deploy (la imagen nueva trae la carpeta prisma/migrations actualizada)
ssh root@86.48.26.221 "/opt/syncronize/deploy/deploy.sh beta"

# 3. Migrate DESPUÉS del deploy (en el contenedor nuevo)
ssh root@86.48.26.221 "docker exec syncronize-backend-beta npx prisma migrate deploy"

# 4. Health
curl -s https://saas-beta.syncronize.net.pe/api/redis/health
```

> Si la migración necesita superuser (extensiones) o el código nuevo la necesita YA
> (columna que el listado usa apenas arranca), usa el flujo de prod: psql manual ANTES
> del deploy + `migrate resolve --applied` después.

### Flush Redis beta (solo si cambió un transformer/cache)

```bash
ssh root@86.48.26.221 'PASS=$(grep "^REDIS_URL=" /opt/syncronize/deploy/stack.beta.env | sed -E "s|.*default:([^@]+)@.*|\1|"); docker exec redis-beta redis-cli -a "$PASS" --no-auth-warning FLUSHDB'
```

---

## 🔴 Pase a PROD (el ritual completo)

**Regla de oro: prod se toca solo cuando beta está validado e2e.** El objetivo al
terminar: `migrate deploy` dice "No pending" y los schemas beta/prod son idénticos.

### Paso 0 — Saber qué migraciones faltan en prod

```bash
ssh root@86.48.26.221 'docker exec postgres psql -U postgres -d db_saas_beta -t -A -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL" | sort > /tmp/mb.txt; docker exec postgres psql -U postgres -d db_saas -t -A -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL" | sort > /tmp/mp.txt; echo "== Faltan en prod =="; comm -23 /tmp/mb.txt /tmp/mp.txt'
```

### Paso 1 — BACKUP (nunca saltarse esto)

```bash
ssh root@86.48.26.221 'TS=$(date +%Y%m%d_%H%M%S); docker exec postgres pg_dump -U postgres -Fc db_saas > /opt/backups/db_saas_pre_<motivo>_${TS}.dump && ls -lh /opt/backups/db_saas_pre_<motivo>_${TS}.dump'
```

### Paso 2 — Aplicar las migraciones pendientes por psql (ANTES del deploy)

Aplicarlas manualmente elimina la ventana en la que el código nuevo corre sin sus
columnas/tablas. Desde la carpeta del repo local, en orden de timestamp:

```bash
cd backend/prisma/migrations
for d in <mig1> <mig2> <mig3>; do
  echo "=== $d ==="
  ssh root@86.48.26.221 "docker exec -i postgres psql -U postgres -d db_saas --single-transaction -v ON_ERROR_STOP=1" < "$d/migration.sql" || break
done
```

- `--single-transaction`: si algo falla, esa migración entera se revierte.
- `psql -U postgres` = superuser → los `CREATE EXTENSION` pasan sin drama.
- Revisar antes cada SQL buscando `DROP`, `CONCURRENTLY` (no funciona en transacción),
  `TRUNCATE`, `DELETE FROM` — entender qué hace antes de aplicarla.

### Paso 3 — Variables de entorno nuevas (si las hay)

```bash
ssh root@86.48.26.221 'cd /opt/syncronize/deploy && cp stack.prod.env stack.prod.env.bak.$(date +%Y%m%d_%H%M%S) && echo "NUEVA_VAR=valor" >> stack.prod.env'
```

### Paso 4 — Deploy

```bash
ssh root@86.48.26.221 "/opt/syncronize/deploy/deploy.sh prod"
```

El script compila `syncronize-api:latest`, **lo retiquetea como `syncronize-api:prod-actual`**
y recién ahí recrea el contenedor. Ese retag es lo que hace que prod avance: sin él, recrear
prod lo dejaría en el código anterior (ver gotcha 8). En la salida tiene que aparecer:

```
==> [tag] syncronize-api:latest -> syncronize-api:prod-actual
```

Verificar que prod quedó en la imagen nueva:

```bash
ssh root@86.48.26.221 'docker inspect syncronize-backend-prod --format "{{.Image}}"; docker images syncronize-api --format "{{.Repository}}:{{.Tag}} {{.ID}}"'
```

### Paso 5 — Registrar las migraciones manuales + verificar

```bash
# resolve --applied por CADA migración aplicada a mano en el paso 2
ssh root@86.48.26.221 'for m in <mig1> <mig2> <mig3>; do docker exec syncronize-backend-prod npx prisma migrate resolve --applied $m; done; docker exec syncronize-backend-prod npx prisma migrate deploy'
# ↑ debe terminar en: "No pending migrations to apply."
```

### Paso 6 — Health + logs

```bash
curl -s https://saas.syncronize.net.pe/api/redis/health
ssh root@86.48.26.221 "docker logs --since 10m syncronize-backend-prod 2>&1 | grep -iE 'error|exception|unhandled' | head -20"
```

### Paso 7 — Backfills / data-fixes del pase (si los hay)

Correr los UPDATE que la sesión haya dejado pendientes (siempre probados en beta antes).
Recordar el gotcha: tras un data-fix de catálogo, bump de `actualizadoEn` + invalidar el
cache de catálogo (paso 8, por patrón).

### Paso 8 — Invalidar cache en PROD (🔴 NUNCA con FLUSHDB)

> ⚠️ El Redis de PROD es el contenedor **`redis-dev`** (sí, en serio).
>
> 🔴 **En prod NO se hace `FLUSHDB`.** Ese Redis no es solo cache: guarda las
> **sesiones activas** de los usuarios y los hashes **`yape-prod:webhooks:*`,
> que no tienen TTL** — o sea estado durable de pagos, no cache. Un FLUSHDB
> desloguea a todo el mundo y borra esos webhooks para siempre.
> (Medido el 09-08-2026: 135 claves en prod, **ninguna de catálogo**.)

**8.1 — Inspeccionar primero.** Siempre, antes de borrar nada:

```bash
ssh root@86.48.26.221 'PASS=$(grep "^REDIS_URL=" /opt/syncronize/deploy/stack.prod.env | sed -E "s|.*default:([^@]+)@.*|\1|"); docker exec redis-dev redis-cli -a "$PASS" --no-auth-warning DBSIZE; docker exec redis-dev redis-cli -a "$PASS" --no-auth-warning --scan | awk -F: "{print \$1}" | sort | uniq -c | sort -rn'
```

**8.2 — Borrar SOLO el patrón afectado**, si el pase cambió un transformer o el
`select` de un endpoint cacheado. Si el listado de arriba no muestra claves de
catálogo, **no hay nada que hacer y este paso se salta**:

```bash
ssh root@86.48.26.221 'PASS=$(grep "^REDIS_URL=" /opt/syncronize/deploy/stack.prod.env | sed -E "s|.*default:([^@]+)@.*|\1|"); docker exec redis-dev redis-cli -a "$PASS" --no-auth-warning --scan --pattern "productos:empresa:*" | xargs -r -n 100 docker exec -i redis-dev redis-cli -a "$PASS" --no-auth-warning DEL'
```

> En **BETA** el `FLUSHDB` sigue estando bien (ver la sección de beta): ahí no
> hay sesiones que cuidar y el cache de catálogo sí está poblado.

### Paso 9 — Verificar paridad de schemas beta vs prod

Un solo comando, desde la carpeta del repo local:

```bash
ssh root@86.48.26.221 'bash -s' < backend/scripts/parity-schemas.sh
```

Tiene que terminar en **`LAS 12 DIMENSIONES DAN IDENTICO`** y salir con código 0.
Si algo difiere, imprime el diff de esa dimensión (`<` beta, `>` prod) y sale 1.

Compara **12 dimensiones**, no las 3 de antes:

| | | |
|---|---|---|
| 1. Tablas | 5. Constraints — **definición** | 9. Triggers de usuario |
| 2. Columnas: tipo, escala, nullable | 6. Enums (label + orden) | 10. Vistas |
| 3. **Defaults de columna** | 7. Extensiones + versión | 11. Secuencias |
| 4. Índices — **definición** | 8. Funciones | 12. Migraciones aplicadas |

Por qué se amplió (09-08-2026): la versión vieja comparaba **nombres**, y un
índice puede llamarse igual con otras columnas, otro `WHERE` parcial u otro
método; una FK puede llamarse igual y haber pasado de `ON DELETE SET NULL` a
`CASCADE`. Los chequeos 4 y 5 comparan la definición entera. Y los **defaults**
no se miraban nunca, que es drift silencioso clásico.

🔴 **La trampa que el script cubre**: si el SQL de un chequeo está mal escrito,
las dos bases devuelven vacío y el `diff` dice "idéntico" — un falso positivo que
parece verificación. Por eso las dimensiones que legítimamente dan cero
(triggers, vistas, secuencias: Prisma no crea nada de eso, los IDs son `cuid()`)
llevan una **query de control** que tiene que devolver > 0 para probar que la
consulta corre de verdad. Se ve así, y está bien:

```
9. TRIGGERS de usuario    beta:0  prod:0  VACIO EN AMBAS (control ok: 1928/1928)
```

> Compara SOLO estructura. **Que los datos difieran es lo correcto** — son
> entornos distintos. Si los datos fueran iguales, algo pisó producción.

Variables opcionales: `BETA_DB`, `PROD_DB`, `PGC` (contenedor de Postgres). Sirven
para probar que el script *sabe fallar*: `PROD_DB=db_yape bash -s` tiene que
reportar diferencias y salir 1.

### Paso 10 — Smoke e2e + APK

- Emitir una boleta real (JAYLI) y verificar en BD que grabe bien (correlativo continúa).
- Probar el flujo que motivó el pase.
- **El APK se genera y publica DESPUÉS de que el backend prod esté sano — nunca antes.**

---

## 🌐 Deploy de la WEB

```bash
ssh root@86.48.26.221 "/opt/syncronize/web-deploy/deploy.sh beta"   # web-beta.syncronize.net.pe
ssh root@86.48.26.221 "/opt/syncronize/web-deploy/deploy.sh prod"   # syncronize.net.pe
```

- Las `NEXT_PUBLIC_*` se hornean en el build (build-arg) — cambiarlas exige rebuild.
- ⚠️ El deploy de web prod arrastra TODO lo que esté en main del repo web — revisar
  qué hay sin deployar antes de lanzarlo.

---

## ⏪ Rollback

### Código (backend)

El deploy buildea desde `/opt/syncronize/backend` y hace `git pull --ff-only` antes
del build → NO hacer `git checkout <commit>` en el VPS (rompe el siguiente pull).
El rollback correcto es **revertir en local y redeployar**:

```bash
# En local:
git revert <commit-malo>        # o varios: git revert <a>..<b>
git push
ssh root@86.48.26.221 "/opt/syncronize/deploy/deploy.sh prod"
```

### Base de datos (último recurso — pierde lo escrito después del backup)

```bash
ssh root@86.48.26.221 "docker exec -i postgres pg_restore -U postgres -d db_saas --clean --if-exists < /opt/backups/<archivo>.dump"
```

> Las migraciones de este proyecto son aditivas (columnas nullable, tablas nuevas) a
> propósito: el código viejo convive con el schema nuevo. Ante un problema, el rollback
> de CÓDIGO casi siempre basta; el de BD es excepcional.

### ⚠️ Contadores de código: paso extra si se revierte más allá del 27-08

Desde la migración `20260827000000_contador_codigo_fila_por_tipo`, los 22 contadores
(`ultimaVenta`, `ultimaCompra`, `ultimoProducto`…) viven en la tabla `ContadorCodigo`,
una fila por (empresa, tipo). Las columnas `ultimo*` de `ConfiguracionCodigos` siguen
existiendo pero **ya no se actualizan**.

Si se revierte el código a una versión anterior a esa migración, el código viejo vuelve
a leer las columnas — que quedaron congeladas — y **empieza a repetir códigos** hasta
chocar contra `@@unique([empresaId, codigo])`. Antes de levantar la versión vieja hay
que copiar los valores de vuelta:

```bash
# Copia los 22 contadores de ContadorCodigo de vuelta a las columnas.
# Idempotente y con GREATEST: nunca hace retroceder un contador.
cat prisma/fixes/2026-08-27_rollback_contadores_a_configuracioncodigos.sql \
  | ssh root@86.48.26.221 "docker exec -i postgres psql -U postgres -d db_saas"
```

> **Sin este paso el rollback deja el mostrador sin poder vender.** El mapeo
> columna ↔ tipo está en `src/configuracion-codigos/contador-codigo.util.ts` y en el
> backfill de la migración.

---

## ✅ Checklist rápido (imprimir mentalmente)

**Beta**: push → `deploy.sh beta` → migrate (si hay) → health.

**Prod**: beta validado e2e → diff de migraciones → **backup** → psql migraciones →
env nuevos → `deploy.sh prod` → `resolve --applied` + `migrate deploy` ("No pending") →
health + logs → backfills → invalidar cache **por patrón** (🔴 nunca `FLUSHDB` en prod) →
paridad schemas (`scripts/parity-schemas.sh`, 12 dimensiones) → smoke → APK al final.
