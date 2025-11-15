# 🐳 Variables de Entorno para Portainer

## Configuración para el stack en Portainer

Estas son las variables de entorno que debes configurar en tu stack de Portainer.

### 📋 Variables Requeridas

```env
# Database (conecta al contenedor postgres en elastika-network)
DATABASE_URL=postgresql://postgres:jtorres159.@postgres:5432/db_saas

# Redis (conecta al contenedor redis-dev en elastika-network)
REDIS_URL=redis://default:JTORRES159.@redis-dev:6379

# JWT Secrets (CAMBIAR ESTOS VALORES EN PRODUCCIÓN)
JWT_SECRET=your-super-secret-jwt-key-minimum-64-chars-for-security-purposes-change-this
JWT_REFRESH_SECRET=your-super-secret-refresh-key-minimum-64-characters-for-production-change-this
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Security
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION_MINUTES=15
BCRYPT_ROUNDS=12

# CORS (ajustar según tu dominio)
CORS_ORIGIN=https://app.syncronize.net.pe,https://syncronize.net.pe

# Application
PORT=5000
NODE_ENV=production

# Redis Settings
REDIS_SESSION_TTL=604800

# Email Configuration (configurar con tu proveedor de email)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=tu-email@gmail.com
EMAIL_PASS=tu-app-password
EMAIL_FROM=noreply@syncronize.net.pe

# Backend URL
BACKEND_URL=https://api.syncronize.net.pe

# Logging
LOG_LEVEL=info
DEBUG=false

# Grafana (observabilidad)
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=cambiar-este-password-seguro

# OAuth Providers (Opcional - dejar vacío si no se usa)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
```

---

## 🔑 Notas Importantes

### 1. Conexión a Base de Datos y Redis

Como todos los contenedores están en la red `elastika-network`, se conectan usando **nombres de contenedor**:

- **PostgreSQL**: `postgres:5432` (puerto interno)
- **Redis**: `redis-dev:6379` (puerto interno, NO usar 6380)

### 2. Seguridad - JWT Secrets

⚠️ **IMPORTANTE**: Cambia los valores de `JWT_SECRET` y `JWT_REFRESH_SECRET` por valores únicos y seguros.

Puedes generar secrets seguros con:

```bash
openssl rand -base64 64
```

### 3. Email Configuration

Configura con tu proveedor de email real. Ejemplo para Gmail:

1. Habilita "Autenticación de 2 factores"
2. Genera una "Contraseña de aplicación"
3. Usa esa contraseña en `EMAIL_PASS`

### 4. Grafana

Cambia `GRAFANA_ADMIN_PASSWORD` por una contraseña segura.

---

## 📝 Cómo configurar en Portainer

### Opción 1: Variables de Entorno del Stack (Recomendado)

1. Ve a tu stack en Portainer
2. Click en **"Editor"**
3. Scroll hasta abajo
4. En la sección **"Environment variables"**, pega las variables
5. Click **"Update the stack"**

### Opción 2: Editar docker-compose.yml directamente

Ya están configuradas las variables en el docker-compose.yml, solo falta que Portainer las tome de las variables de entorno del stack.

---

## ✅ Verificación

Después de configurar y redesplegar:

1. **Verifica logs del backend**:
   ```bash
   docker logs saas-backend --tail 50
   ```

   Deberías ver:
   - ✅ `Application started successfully`
   - ✅ Sin errores de Redis
   - ✅ Sin errores de PostgreSQL

2. **Verifica conectividad**:
   ```bash
   curl http://localhost:5000/api
   ```

   Debería responder con el mensaje de bienvenida de la API.

3. **Verifica logs en Grafana**:
   - Ve a Grafana → Explore
   - Query: `{app="saas-backend"}`
   - Deberías ver los logs del backend

---

## 🐛 Troubleshooting

### Error: Cannot connect to Redis
- Verifica que `redis-dev` esté en la red `elastika-network`
- Verifica la contraseña en `REDIS_URL`
- Usa puerto `6379` (interno), no `6380`

### Error: Cannot connect to PostgreSQL
- Verifica que `postgres` esté en la red `elastika-network`
- Verifica credenciales en `DATABASE_URL`
- Usa puerto `5432`

### Logs no aparecen en Grafana
- Verifica que el backend esté funcionando sin errores
- Espera 1-2 minutos para que los logs lleguen a Loki
- Verifica en Grafana que el datasource Loki esté configurado
