# Variables de Entorno para Portainer

## Configuracion para el stack en Portainer

Estas son las variables de entorno necesarias para el stack de Portainer.
Los valores reales se configuran en `stack.env` (no se sube al repo).

### Variables Requeridas

```env
# Database (conecta al contenedor postgres en elastika-network)
DATABASE_URL=postgresql://usuario:password@postgres:5432/db_saas?connection_limit=20&pool_timeout=20

# Redis (conecta al contenedor redis-dev en elastika-network)
REDIS_URL=redis://default:password@redis-dev:6379
REDIS_SESSION_TTL=604800

# JWT Secrets (CAMBIAR EN PRODUCCION)
JWT_SECRET=<generar-con-openssl-rand-base64-64>
JWT_REFRESH_SECRET=<generar-con-openssl-rand-base64-64>
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Security
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15
BCRYPT_ROUNDS=12

# CORS
CORS_ORIGIN=https://app.syncronize.net.pe,https://syncronize.net.pe

# Application
PORT=6000
NODE_ENV=production
BACKEND_URL=https://saas.syncronize.net.pe

# Logging
LOG_LEVEL=info
DEBUG=false

# Email
EMAIL_HOST=<tu-smtp-host>
EMAIL_PORT=25
EMAIL_SECURE=false
EMAIL_USER=<tu-email-user>
EMAIL_PASS=<tu-email-password>
EMAIL_FROM=Syncronize <noreply@syncronize.net.pe>

# Cloudinary
CLOUDINARY_CLOUD_NAME=<tu-cloud-name>
CLOUDINARY_API_KEY=<tu-api-key>
CLOUDINARY_API_SECRET=<tu-api-secret>

# Factiliza API
FACTILIZA_API_URL=https://api.factiliza.com/v1
FACTILIZA_API_TOKEN=<tu-token>

# Google OAuth
GOOGLE_CLIENT_ID=<tu-web-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<tu-client-secret>
GOOGLE_ANDROID_CLIENT_ID=<tu-android-client-id>.apps.googleusercontent.com

# Firebase (Push Notifications)
FIREBASE_SERVICE_ACCOUNT=<json-de-service-account>
```

> **Nota:** Los valores reales estan en `stack.env`. Este archivo es solo referencia de las variables necesarias.

---

## Notas Importantes

### 1. Conexion a Base de Datos y Redis

Todos los contenedores estan en la red `elastika-network`, se conectan usando **nombres de contenedor**:

- **PostgreSQL**: `postgres:5432` (puerto interno)
- **Redis**: `redis-dev:6379` (puerto interno, NO usar 6380)

### 2. Seguridad - JWT Secrets

**IMPORTANTE**: Cambiar `JWT_SECRET` y `JWT_REFRESH_SECRET` por valores unicos y seguros.

Generar secrets seguros con:

```bash
openssl rand -base64 64
```

### 3. Puerto

El backend corre en el puerto **6000** (no 5000). Traefik enruta `api.syncronize.net.pe` al puerto 6000.

### 4. Variables NO necesarias en Portainer

Estas variables las inyecta el contenedor automaticamente, no agregarlas:

- `NODE_VERSION`
- `PATH`
- `YARN_VERSION`

---

## Como configurar en Portainer

1. Crea el stack desde git
2. En **"Environment variables"** usa **"Load variables from .env file"** y sube `stack.env`
3. Deploy

---

## Verificacion

Despues de configurar y redesplegar:

1. **Verifica logs del backend**:
   ```bash
   docker logs saas-backend --tail 50
   ```

   Deberias ver:
   - `Application started successfully`
   - Sin errores de Redis
   - Sin errores de PostgreSQL

2. **Verifica conectividad**:
   ```bash
   curl http://localhost:6000/api
   ```

---

## Troubleshooting

### Error: Cannot connect to Redis
- Verifica que `redis-dev` este en la red `elastika-network`
- Verifica la contrasena en `REDIS_URL`
- Usa puerto `6379` (interno), no `6380`

### Error: Cannot connect to PostgreSQL
- Verifica que `postgres` este en la red `elastika-network`
- Verifica credenciales en `DATABASE_URL`
- Usa puerto `5432`
