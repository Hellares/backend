# Documentación de API - Backend SaaS Multi-Empresa

## 🚀 Información General

**Proyecto**: Backend SaaS Multi-Empresa
**Framework**: NestJS con TypeScript
**Base de datos**: PostgreSQL con Prisma ORM
**Autenticación**: JWT con Refresh Tokens
**Documentación**: Swagger/OpenAPI
**Puerto por defecto**: 3001

**URL Base**: `http://localhost:3001/api`
**Documentación Swagger**: `http://localhost:3001/api/docs`

## 🔧 Configuración

### Variables de Entorno Principales
```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/database?schema=public"

# JWT
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"
JWT_EXPIRES_IN="24h"
JWT_REFRESH_SECRET="your-super-secret-refresh-key-change-this-in-production"
JWT_REFRESH_EXPIRES_IN="7d"

# App
PORT=3001
NODE_ENV="development"

# Redis
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_SESSION_TTL=604800
```

## 📚 Endpoints Implementados

### 🔐 Autenticación (`/api/auth`)

#### 1. Registrar Usuario
- **Método**: `POST`
- **URL**: `/api/auth/register`
- **Público**: ✅

**Body:**
```json
{
  "email": "usuario@ejemplo.com",
  "password": "contraseña123",
  "nombres": "Juan",
  "apellidos": "Pérez",
  "telefono": "3211234567"
}
```

**Response (201):**
```json
{
  "user": {
    "id": "uuid",
    "email": "usuario@ejemplo.com",
    "nombres": "Juan",
    "apellidos": "Pérez",
    "emailVerificado": false
  },
  "accessToken": "jwt_token",
  "refreshToken": "refresh_token",
  "expiresIn": "24h"
}
```

#### 2. Login
- **Método**: `POST`
- **URL**: `/api/auth/login`
- **Público**: ✅

**Body:**
```json
{
  "email": "usuario@ejemplo.com",
  "password": "contraseña123"
}
```

**Response (200):**
```json
{
  "user": {
    "id": "uuid",
    "email": "usuario@ejemplo.com",
    "nombres": "Juan",
    "apellidos": "Pérez",
    "emailVerificado": true,
    "rolGlobal": "USER"
  },
  "tenant": {
    "id": "tenant_uuid",
    "name": "Empresa XYZ",
    "role": "ADMIN"
  },
  "accessToken": "jwt_token",
  "refreshToken": "refresh_token",
  "expiresIn": "24h"
}
```

#### 3. Refresh Token
- **Método**: `POST`
- **URL**: `/api/auth/refresh`
- **Público**: ✅

**Body:**
```json
{
  "refreshToken": "refresh_token"
}
```

**Response (200):**
```json
{
  "accessToken": "new_jwt_token",
  "refreshToken": "new_refresh_token",
  "expiresIn": "24h"
}
```

#### 4. Logout
- **Método**: `POST`
- **URL**: `/api/auth/logout`
- **Autenticación**: 🔒 Requiere JWT

**Headers:**
```
Authorization: Bearer <access_token>
```

#### 5. Cambiar Contraseña
- **Método**: `POST`
- **URL**: `/api/auth/change-password`
- **Autenticación**: 🔒 Requiere JWT

**Headers:**
```
Authorization: Bearer <access_token>
```

**Body:**
```json
{
  "currentPassword": "contraseña_actual",
  "newPassword": "contraseña_nueva"
}
```

#### 6. Olvidé Contraseña
- **Método**: `POST`
- **URL**: `/api/auth/forgot-password`
- **Público**: ✅

**Body:**
```json
{
  "email": "usuario@ejemplo.com"
}
```

#### 7. Resetear Contraseña
- **Método**: `POST`
- **URL**: `/api/auth/reset-password`
- **Público**: ✅

**Body:**
```json
{
  "token": "reset_token",
  "newPassword": "contraseña_nueva"
}
```

#### 8. Verificar Email
- **Método**: `GET`
- **URL**: `/api/auth/verify-email/:token`
- **Público**: ✅

#### 9. Obtener Perfil
- **Método**: `GET`
- **URL**: `/api/auth/profile`
- **Autenticación**: 🔒 Requiere JWT

**Headers:**
```
Authorization: Bearer <access_token>
```

#### 10. Sesiones Activas
- **Método**: `GET`
- **URL**: `/api/auth/sessions`
- **Autenticación**: 🔒 Requiere JWT

#### 11. Revocar Sesión Específica
- **Método**: `DELETE`
- **URL**: `/api/auth/sessions/:sessionId`
- **Autenticación**: 🔒 Requiere JWT

#### 12. Revocar Otras Sesiones
- **Método**: `DELETE`
- **URL**: `/api/auth/sessions/others`
- **Autenticación**: 🔒 Requiere JWT

#### 13. Revocar Todas las Sesiones
- **Método**: `DELETE`
- **URL**: `/api/auth/sessions`
- **Autenticación**: 🔒 Requiere JWT

### 👥 Usuarios (`/api/usuarios`)

#### 1. Crear Usuario
- **Método**: `POST`
- **URL**: `/api/usuarios`
- **Autenticación**: 🔒 Requiere JWT

#### 2. Listar Usuarios
- **Método**: `GET`
- **URL**: `/api/usuarios`
- **Autenticación**: 🔒 Requiere JWT

#### 3. Obtener Usuario por ID
- **Método**: `GET`
- **URL**: `/api/usuarios/:id`
- **Autenticación**: 🔒 Requiere JWT

#### 4. Actualizar Usuario
- **Método**: `PATCH`
- **URL**: `/api/usuarios/:id`
- **Autenticación**: 🔒 Requiere JWT

#### 5. Eliminar Usuario
- **Método**: `DELETE`
- **URL**: `/api/usuarios/:id`
- **Autenticación**: 🔒 Requiere JWT

### 🏢 Empresas (`/api/companies`)

#### 1. Crear Empresa
- **Método**: `POST`
- **URL**: `/api/companies`
- **Autenticación**: 🔒 Requiere JWT

**Body:**
```json
{
  "name": "Mi Empresa S.A.S.",
  "subdomain": "mi-empresa",
  "nit": "900123456-7",
  "direccion": "Calle 123 #45-67",
  "telefono": "3211234567",
  "email": "contacto@miempresa.com"
}
```

#### 2. Buscar por Subdominio
- **Método**: `GET`
- **URL**: `/api/companies/subdomain/:subdomain`
- **Autenticación**: 🔒 Requiere JWT

#### 3. Buscar por ID
- **Método**: `GET`
- **URL**: `/api/companies/:id`
- **Autenticación**: 🔒 Requiere JWT

### 🏠 Health Check

#### 1. Health General
- **Método**: `GET`
- **URL**: `/api/`
- **Público**: ✅

## 🧪 Ejemplos para Postman

### Configuración de Ambiente en Postman

**Variables de Entorno:**
```
baseUrl: http://localhost:3001/api
accessToken: {{response from login}}
refreshToken: {{response from login}}
```

### 1. Flujo Completo de Registro y Login

**Request 1: Registrar Usuario**
```http
POST {{baseUrl}}/auth/register
Content-Type: application/json

{
  "email": "test@ejemplo.com",
  "password": "password123",
  "nombres": "Usuario",
  "apellidos": "Test",
  "telefono": "3211234567"
}
```

**Request 2: Login**
```http
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "email": "test@ejemplo.com",
  "password": "password123"
}
```

**Request 3: Obtener Perfil**
```http
GET {{baseUrl}}/auth/profile
Authorization: Bearer {{accessToken}}
```

### 2. Ejemplo de Error 401

**Request sin token:**
```http
GET {{baseUrl}}/auth/profile
```

**Response:**
```json
{
  "message": "Unauthorized",
  "statusCode": 401
}
```

### 3. Ejemplo de Validación de DTO

**Request con datos inválidos:**
```http
POST {{baseUrl}}/auth/register
Content-Type: application/json

{
  "email": "email-invalido",
  "password": "123"
}
```

**Response:**
```json
{
  "message": [
    "email must be an email",
    "password must be longer than or equal to 6 characters"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

## 🚀 Cómo Iniciar el Proyecto

1. **Instalar dependencias:**
```bash
npm install
```

2. **Configurar variables de entorno:**
```bash
cp .env.example .env
# Editar .env con tus credenciales
```

3. **Iniciar base de datos:**
```bash
# Si usas Docker Compose
docker-compose up -d postgres redis
```

4. **Ejecutar migraciones:**
```bash
npx prisma migrate dev
```

5. **Iniciar servidor:**
```bash
npm run start:dev
```

6. **Acceder a Swagger:**
```
http://localhost:3001/api/docs
```

## 📝 Notas Importantes

- Todos los endpoints protegidos requieren el header `Authorization: Bearer <token>`
- Los tokens JWT expiran en 24h por defecto
- Los refresh tokens expiran en 7 días por defecto
- La API incluye validación de DTOs con mensajes de error detallados
- Se incluye interceptores de respuesta para formato consistente
- La documentación Swagger está disponible en `/api/docs`
- El servidor corre en el puerto 3001 por defecto

## 🔒 Códigos de Error Comunes

| Código | Descripción | Causa Común |
|--------|-------------|-------------|
| 400 | Bad Request | Datos inválidos o validación fallida |
| 401 | Unauthorized | Token inválido o expirado |
| 403 | Forbidden | Permisos insuficientes |
| 404 | Not Found | Recurso no encontrado |
| 409 | Conflict | Email ya registrado |
| 422 | Unprocessable Entity | Error de validación de DTO |

## 🏗️ Arquitectura

```
src/
├── auth/                 # Autenticación y autorización
│   ├── controllers/      # Controladores de auth
│   ├── services/        # Lógica de negocio
│   ├── guards/          # Guards de autenticación
│   ├── strategies/      # Estrategias Passport
│   ├── dto/             # Data Transfer Objects
│   └── decorators/      # Decoradores personalizados
├── usuarios/            # Gestión de usuarios
├── empresas/            # Gestión de empresas
├── tenant/              # Lógica multi-tenant
├── common/              # Utilidades compartidas
├── redis/               # Configuración Redis
└── prisma/              # Configuración Prisma
```

## 📊 Estadísticas de la API

- **Total de Endpoints**: 19
- **Endpoints Públicos**: 6
- **Endpoints Protegidos**: 13
- **Módulos**: Auth, Usuarios, Empresas
- **Base de datos**: PostgreSQL
- **Cache**: Redis
- **Documentación**: Swagger/OpenAPI 3.0

---

**Última actualización**: {{date}}
**Versión**: 1.0.0
**Estado**: Desarrollo