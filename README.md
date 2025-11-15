# 🚀 SaaS Backend - NestJS + Observabilidad

Backend empresarial SaaS construido con NestJS, PostgreSQL, Redis y stack completo de observabilidad (Grafana + Loki + Promtail).

## 📋 Características

### Backend
- ✅ **NestJS** - Framework escalable y modular
- ✅ **PostgreSQL** - Base de datos relacional con Prisma ORM
- ✅ **Redis** - Gestión de sesiones y caché
- ✅ **JWT** - Autenticación con tokens de acceso y refresh
- ✅ **Multi-tenant** - Arquitectura preparada para múltiples empresas
- ✅ **Email** - Verificación de email y recuperación de contraseña
- ✅ **Rate Limiting** - Protección contra fuerza bruta
- ✅ **Security** - Bcrypt, CORS, sanitización de datos sensibles

### Observabilidad
- 📊 **Grafana** - Visualización de logs y métricas
- 📝 **Loki** - Agregador de logs (retención 31 días)
- 📤 **Promtail** - Recolector de logs en tiempo real
- 🔍 **Logs estructurados** - JSON con metadata completa (requestId, userId, tenantId)
- 🔐 **Auditoría** - Logs de acciones críticas (30 días de retención)

## 🛠️ Stack Tecnológico

| Tecnología | Versión | Uso |
|------------|---------|-----|
| Node.js | 20 Alpine | Runtime |
| NestJS | 10.x | Framework |
| PostgreSQL | 15+ | Base de datos |
| Redis | 7+ | Sesiones y caché |
| Prisma | 6.x | ORM |
| Winston | 3.x | Logging |
| Grafana | 10.2 | Visualización |
| Loki | 2.9 | Logs |
| Docker | Latest | Contenedorización |

## 🚀 Inicio Rápido

### Prerequisitos

- Docker y Docker Compose instalados
- PostgreSQL corriendo (externo o contenedor)
- Redis corriendo (externo o contenedor)

### Instalación Local

1. **Clonar el repositorio:**
```bash
git clone <tu-repositorio>
cd backend
```

2. **Instalar dependencias:**
```bash
npm install
```

3. **Configurar variables de entorno:**
```bash
cp .env.example .env
```

4. **Ejecutar migraciones de Prisma:**
```bash
npx prisma generate
npx prisma migrate dev
```

5. **Iniciar en modo desarrollo:**
```bash
npm run start:dev
```

### Despliegue con Docker

1. **Configurar .env:**
```bash
cp .env.example .env
nano .env
```

2. **Desplegar stack completo:**
```bash
docker-compose up -d
```

3. **Verificar servicios:**
```bash
docker-compose ps
```

## 📡 Endpoints

### API Backend
```
http://localhost:5000/api
```

### Documentación Swagger
```
http://localhost:5000/api/docs
```

### Grafana (Observabilidad)
```
http://localhost:3001
Usuario: admin
Password: (configurado en .env)
```

## 🔍 Consultas en Grafana

### Ver todos los logs:
```logql
{job="backend"}
```

### Solo errores:
```logql
{job="backend", level="error"}
```

### Trazar un request completo:
```logql
{job="backend"} |= "requestId-aqui"
```

### Auditoría de logins:
```logql
{job="backend", log_type="audit"} |= "USER_LOGIN"
```

### Logs de un tenant específico:
```logql
{job="backend", tenantId="tenant-id"}
```

## 📚 Documentación Adicional

- [Guía de Despliegue en Portainer](./DEPLOYMENT.md)
- [Documentación de API](./API_DOCUMENTATION.md)
- [Sistema de Logging](./LOGGING.md)

## 🏗️ Estructura del Proyecto

```
backend/
├── src/
│   ├── auth/              # Autenticación y autorización
│   ├── common/
│   │   ├── logger/        # Sistema de logging
│   │   └── middleware/    # Middlewares globales
│   ├── empresa/           # Gestión de empresas (multi-tenant)
│   ├── usuarios/          # Gestión de usuarios
│   └── main.ts            # Punto de entrada
├── prisma/                # Schema y migraciones de Prisma
├── grafana/               # Configuración de Grafana
│   └── provisioning/      # Datasources y dashboards
├── logs/                  # Archivos de logs (gitignored)
├── Dockerfile             # Build multi-stage optimizado
├── docker-compose.yml     # Stack completo
├── loki-config.yml        # Configuración de Loki
└── promtail-config.yml    # Configuración de Promtail
```

## 🔐 Seguridad

- ✅ Contraseñas hasheadas con bcrypt (12 rounds)
- ✅ Tokens JWT con refresh tokens
- ✅ Rate limiting en endpoints críticos
- ✅ Bloqueo de cuenta tras intentos fallidos
- ✅ Sanitización de datos sensibles en logs
- ✅ CORS configurado
- ✅ Helmet para headers de seguridad
- ✅ Validación de datos con class-validator

## 📊 Monitoreo

### Health Check
```bash
curl http://localhost:5000/api
```

### Ver logs en tiempo real
```bash
docker logs -f saas-backend
```

### Espacio usado por volúmenes
```bash
docker system df -v
```

## 🚢 Despliegue en Producción

Ver [DEPLOYMENT.md](./DEPLOYMENT.md) para instrucciones detalladas de despliegue en VPS con Portainer.

**Checklist de producción:**
- [ ] Cambiar `JWT_SECRET` y `JWT_REFRESH_SECRET`
- [ ] Cambiar `GRAFANA_ADMIN_PASSWORD`
- [ ] Configurar `NODE_ENV=production`
- [ ] Ajustar `LOG_LEVEL=info` o `warn`
- [ ] Configurar CORS con dominios reales
- [ ] Configurar reverse proxy (Traefik/Nginx)
- [ ] Configurar SSL/TLS
- [ ] Backup automático de Grafana

## 📝 Scripts Disponibles

```bash
# Desarrollo
npm run start:dev        # Modo watch
npm run start:debug      # Con debugger

# Producción
npm run build           # Compilar TypeScript
npm run start:prod      # Ejecutar versión compilada

# Prisma
npx prisma generate     # Generar cliente
npx prisma migrate dev  # Crear migración
npx prisma studio       # GUI de base de datos

# Testing
npm run test           # Unit tests
npm run test:e2e       # End-to-end tests
npm run test:cov       # Coverage
```
