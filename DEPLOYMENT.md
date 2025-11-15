# 🚀 Guía de Despliegue en Portainer

Esta guía te ayudará a desplegar el backend SaaS con observabilidad completa (Grafana + Loki + Promtail) en tu VPS usando Portainer.

## 📋 Prerequisitos

- ✅ PostgreSQL corriendo en tu VPS (ya configurado)
- ✅ Redis corriendo en tu VPS (ya configurado)
- ✅ Portainer instalado y configurado
- ✅ Acceso SSH a tu VPS
- ✅ Git instalado en el VPS

---

## 📦 Estructura del Stack

```
saas-backend/
├── backend          # API NestJS (Puerto 3000)
├── loki            # Agregador de logs (Puerto 3100)
├── promtail        # Recolector de logs
└── grafana         # Visualización (Puerto 3001)
```

---

## 🔧 Paso 1: Preparar el Repositorio

### Opción A: Desde tu VPS

1. **Conectar por SSH a tu VPS:**
```bash
ssh tu-usuario@86.48.26.221
```

2. **Clonar o copiar el proyecto:**
```bash
cd /opt  # o la carpeta donde guardes tus proyectos
git clone <tu-repositorio> saas-backend
cd saas-backend
```

3. **Configurar variables de entorno:**
```bash
cp .env.example .env
nano .env
```

Actualiza estas variables:
```env
DATABASE_URL="postgresql://postgres:jtorres159.@86.48.26.221:5432/db_saas"
REDIS_URL="redis://default:JTORRES159.@86.48.26.221:6380"
NODE_ENV="production"
LOG_LEVEL="info"

# Cambiar en producción
JWT_SECRET="tu-secret-super-seguro-minimo-64-caracteres"
JWT_REFRESH_SECRET="otro-secret-diferente-minimo-64-caracteres"

# Grafana
GRAFANA_ADMIN_USER="admin"
GRAFANA_ADMIN_PASSWORD="tu-password-seguro"
```

---

## 🐳 Paso 2: Desplegar con Portainer

### Método 1: Stack desde Portainer UI

1. **Acceder a Portainer:**
   - Ir a: `https://tu-vps:9443` (o el puerto que uses)
   - Login con tus credenciales

2. **Crear nuevo Stack:**
   - Click en **Stacks** en el menú lateral
   - Click en **+ Add stack**
   - Nombre: `saas-backend`

3. **Elegir método:**

   **Opción A: Git Repository (Recomendado)**
   - Seleccionar "Git Repository"
   - Repository URL: `<tu-repositorio-git>`
   - Compose path: `docker-compose.yml`
   - Agregar variables de entorno desde tu `.env`

   **Opción B: Web editor**
   - Seleccionar "Web editor"
   - Copiar todo el contenido de `docker-compose.yml`
   - En la sección "Environment variables", agregar:

   ```
   DATABASE_URL=postgresql://postgres:jtorres159.@86.48.26.221:5432/db_saas
   REDIS_URL=redis://default:JTORRES159.@86.48.26.221:6380
   NODE_ENV=production
   LOG_LEVEL=info
   JWT_SECRET=tu-secret-aqui
   JWT_REFRESH_SECRET=otro-secret-aqui
   GRAFANA_ADMIN_USER=admin
   GRAFANA_ADMIN_PASSWORD=tu-password
   CORS_ORIGIN=https://tudominio.com
   BACKEND_URL=https://api.tudominio.com
   EMAIL_HOST=mail.syncronize.net.pe
   EMAIL_PORT=587
   EMAIL_USER=soporte@syncronize.net.pe
   EMAIL_PASS=jtorres159
   EMAIL_FROM=noreply@tudominio.com
   MAX_LOGIN_ATTEMPTS=5
   LOCKOUT_DURATION_MINUTES=15
   BCRYPT_ROUNDS=12
   REDIS_SESSION_TTL=604800
   DEBUG=false
   ```

4. **Deploy el Stack:**
   - Click en **Deploy the stack**
   - Esperar a que se construya la imagen (primera vez puede tardar 2-3 min)

---

## ✅ Paso 3: Verificar el Despliegue

### Verificar contenedores corriendo:

En Portainer:
- Ir a **Containers**
- Deberías ver 4 contenedores corriendo:
  - `saas-backend` ✅
  - `saas-loki` ✅
  - `saas-promtail` ✅
  - `saas-grafana` ✅

### Verificar logs:

1. **Backend:**
   - Click en `saas-backend`
   - Pestaña **Logs**
   - Deberías ver: `Nest application successfully started`

2. **Loki:**
   - Click en `saas-loki`
   - Verificar que esté `ready`

3. **Grafana:**
   - Click en `saas-grafana`
   - Verificar que esté corriendo

---

## 🌐 Paso 4: Acceder a los Servicios

### Backend API:
```
http://86.48.26.221:3000/api
```

**Verificar:**
```bash
curl http://86.48.26.221:3000/api
```

### Grafana:
```
http://86.48.26.221:3001
```

**Login inicial:**
- Usuario: `admin` (o el que configuraste)
- Password: `admin` (o el que configuraste en GRAFANA_ADMIN_PASSWORD)

**Cambiar password en primer login**

### Loki API (solo para debugging):
```
http://86.48.26.221:3100/ready
```

---

## 📊 Paso 5: Configurar Grafana

### 5.1. Verificar Datasource

1. **Login a Grafana:** `http://86.48.26.221:3001`

2. **Ir a Configuration → Data sources**
   - Deberías ver **Loki** ya configurado (auto-provisioned)
   - Click en **Loki** → **Test** → Debería decir "Data source is working"

### 5.2. Explorar Logs

1. **Ir a Explore** (icono de brújula)

2. **Consultas útiles:**

   **Ver todos los logs:**
   ```logql
   {job="backend"}
   ```

   **Solo errores:**
   ```logql
   {job="backend", level="error"}
   ```

   **Logs de un tenant específico:**
   ```logql
   {job="backend", tenantId="<id>"}
   ```

   **Buscar por requestId:**
   ```logql
   {job="backend"} |= "abc123"
   ```

   **Ver auditoría:**
   ```logql
   {job="backend", log_type="audit"}
   ```

   **Operaciones lentas:**
   ```logql
   {job="backend"} |= "Slow operation"
   ```

### 5.3. Crear Dashboard Básico

1. **Ir a Dashboards → New → New Dashboard**

2. **Agregar panel "Errores por hora":**
   ```logql
   sum(count_over_time({job="backend", level="error"}[1h]))
   ```

3. **Agregar panel "Logs por nivel":**
   ```logql
   sum by(level) (count_over_time({job="backend"}[5m]))
   ```

4. **Agregar panel "Requests por tenant":**
   ```logql
   sum by(tenantId) (count_over_time({job="backend"}[5m]))
   ```

5. **Guardar el dashboard**

---

## 🔒 Paso 6: Configurar Reverse Proxy (Opcional pero Recomendado)

Si usas **Traefik** o **Nginx Proxy Manager** en Portainer:

### Backend API:
```
api.tudominio.com → saas-backend:3000
```

### Grafana:
```
grafana.tudominio.com → saas-grafana:3000
```

**Actualizar labels en docker-compose.yml:**
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.backend.rule=Host(`api.tudominio.com`)"
```

---

## 🛠️ Comandos Útiles

### Ver logs en tiempo real desde SSH:

**Backend:**
```bash
docker logs -f saas-backend
```

**Loki:**
```bash
docker logs -f saas-loki
```

**Promtail:**
```bash
docker logs -f saas-promtail
```

### Reiniciar un servicio:
```bash
docker restart saas-backend
```

### Ver volúmenes:
```bash
docker volume ls | grep saas
```

### Backup de Grafana:
```bash
docker run --rm --volumes-from saas-grafana \
  -v $(pwd):/backup alpine \
  tar czf /backup/grafana-backup.tar.gz /var/lib/grafana
```

---

## 🔍 Troubleshooting

### Backend no inicia:

1. **Ver logs:**
```bash
docker logs saas-backend
```

2. **Verificar conexión a DB:**
```bash
docker exec -it saas-backend node -e "console.log(process.env.DATABASE_URL)"
```

3. **Verificar que Prisma generó el cliente:**
```bash
docker exec -it saas-backend ls node_modules/.prisma/client
```

### Promtail no envía logs a Loki:

1. **Ver logs de Promtail:**
```bash
docker logs saas-promtail
```

2. **Verificar que lee los archivos:**
```bash
docker exec -it saas-promtail cat /tmp/positions.yaml
```

3. **Verificar conectividad con Loki:**
```bash
docker exec -it saas-promtail wget -O- http://loki:3100/ready
```

### Grafana no muestra logs:

1. **Verificar datasource:**
   - Configuration → Data sources → Loki → Test

2. **Verificar que Loki recibe logs:**
```bash
curl http://86.48.26.221:3100/loki/api/v1/label
```

3. **Ver stats de Loki:**
```bash
curl http://86.48.26.221:3100/metrics | grep loki_ingester
```

---

## 📈 Monitoreo y Mantenimiento

### Limpieza de logs viejos:

Los logs se rotan automáticamente:
- **Errores**: 14 días
- **Combined**: 7 días
- **Audit**: 30 días

### Espacio en disco:

```bash
# Ver espacio usado por volúmenes
docker system df -v

# Limpiar logs viejos de Docker
docker system prune -a --volumes
```

### Actualizar el stack:

1. **Desde Portainer:**
   - Ir a Stacks → saas-backend
   - Click en **Pull and redeploy**

2. **Desde SSH:**
```bash
cd /opt/saas-backend
git pull
docker-compose build --no-cache
docker-compose up -d
```

---

## 🎯 Próximos Pasos

- [ ] Configurar alertas en Grafana
- [ ] Crear dashboards personalizados
- [ ] Configurar SSL/TLS con reverse proxy
- [ ] Implementar backup automático de Grafana
- [ ] Agregar Prometheus para métricas de sistema

---

## 📞 Soporte

Si tienes problemas, revisa:
1. Logs de los contenedores
2. Configuración de `.env`
3. Conectividad de red entre contenedores
4. Puertos abiertos en el firewall

**Logs útiles:**
```bash
docker-compose logs -f
```
