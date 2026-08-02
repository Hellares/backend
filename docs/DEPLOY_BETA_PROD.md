# 🚀 Runbook de Deploy — Syncronize SaaS (beta y prod)

> Guía para hacer el deploy MANUAL del backend. Última actualización: 2026-07-25
> (pase a prod del sprint delivery + multi-RUC, donde se validó todo este flujo).

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
4. **Cambiaste un transformer/shape de respuesta cacheada** → flush Redis manual después
   del deploy, o servirá datos stale.
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
Recordar el gotcha: tras un data-fix de catálogo, bump de `actualizadoEn` + flush Redis.

### Paso 8 — Flush Redis PROD

```bash
# ⚠️ El Redis de PROD es el contenedor "redis-dev" (sí, en serio)
ssh root@86.48.26.221 'PASS=$(grep "^REDIS_URL=" /opt/syncronize/deploy/stack.prod.env | sed -E "s|.*default:([^@]+)@.*|\1|"); docker exec redis-dev redis-cli -a "$PASS" --no-auth-warning DBSIZE; docker exec redis-dev redis-cli -a "$PASS" --no-auth-warning FLUSHDB'
```

### Paso 9 — Verificar paridad de schemas beta vs prod

Los tres diffs deben salir VACÍOS. Entrar por SSH al VPS y correr (el quoting es
mucho más simple dentro de la sesión):

```bash
ssh root@86.48.26.221
# ya dentro del VPS:
comparar() {
  docker exec postgres psql -U postgres -d db_saas_beta -t -A -c "$1" > /tmp/b.txt
  docker exec postgres psql -U postgres -d db_saas      -t -A -c "$1" > /tmp/p.txt
  diff /tmp/b.txt /tmp/p.txt && echo "== IDENTICO =="
}

# Columnas
comparar "SELECT table_name||'.'||column_name||':'||data_type||':'||is_nullable FROM information_schema.columns WHERE table_schema='public' ORDER BY 1"
# Índices
comparar "SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY 1"
# Enums
comparar "SELECT t.typname||':'||e.enumlabel FROM pg_type t JOIN pg_enum e ON t.oid=e.enumtypid ORDER BY t.typname, e.enumsortorder"
```

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

---

## ✅ Checklist rápido (imprimir mentalmente)

**Beta**: push → `deploy.sh beta` → migrate (si hay) → health.

**Prod**: beta validado e2e → diff de migraciones → **backup** → psql migraciones →
env nuevos → `deploy.sh prod` → `resolve --applied` + `migrate deploy` ("No pending") →
health + logs → backfills → flush `redis-dev` → paridad schemas → smoke → APK al final.
