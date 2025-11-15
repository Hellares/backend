# 📊 Sistema de Logging Profesional

Este documento describe el sistema de logging implementado en el backend.

## 🎯 Características

- ✅ **Logs estructurados en JSON** (producción)
- ✅ **Logs coloreados en consola** (desarrollo)
- ✅ **Rotación automática de archivos** (diaria)
- ✅ **Múltiples niveles de log** (error, warn, info, http, audit, debug)
- ✅ **Request ID tracking** (correlación de requests)
- ✅ **Contexto automático** (usuario, tenant, IP)
- ✅ **Logs de auditoría** para acciones críticas
- ✅ **Filtrado de datos sensibles** (passwords, tokens)

## 📁 Estructura de Archivos de Log

Los logs se almacenan en el directorio `./logs/`:

```
logs/
├── error-2025-11-14.log          # Solo errores
├── combined-2025-11-14.log       # Todos los logs
├── audit-2025-11-14.log          # Auditoría (30 días)
├── exceptions-2025-11-14.log     # Excepciones no capturadas
└── rejections-2025-11-14.log     # Promesas rechazadas
```

**Retención:**
- Errores: 14 días
- Combined: 7 días
- Auditoría: 30 días

## 🎨 Niveles de Log

| Nivel | Uso | Ejemplo |
|-------|-----|---------|
| `error` | Errores críticos | Fallo de BD, excepciones |
| `warn` | Advertencias | Operación lenta, configuración faltante |
| `info` | Información importante | Usuario registrado, login exitoso |
| `http` | Requests HTTP | GET /api/users 200 |
| `audit` | Auditoría | Cambio de rol, eliminación de datos |
| `debug` | Debugging | Variables, estados internos |

## 💻 Uso en el Código

### 1. Logger Básico

```typescript
import { Injectable } from '@nestjs/common';
import { AppLoggerService } from './common/logger/logger.service';

@Injectable()
export class MiService {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext('MiService');
  }

  async miMetodo() {
    // Info
    this.logger.info('Operación iniciada', { userId: '123' });

    // Con metadata
    this.logger.info('Usuario creado', {
      userId: '123',
      email: 'user@example.com',
      tenantId: 'empresa-abc',
    });

    // Error
    try {
      // ...
    } catch (error) {
      this.logger.error('Error en operación', error.stack, {
        userId: '123',
        operation: 'createUser',
      });
    }

    // Success (info con ✓)
    this.logger.success('Operación completada');

    // Warning
    this.logger.warn('Operación lenta detectada', { duration: 2500 });

    // Debug (solo en desarrollo)
    this.logger.debug('Estado interno', { state: someState });
  }
}
```

### 2. Logger de Auditoría

```typescript
import { AuditLoggerService } from './common/logger/audit-logger.service';

@Injectable()
export class MiService {
  constructor(private readonly auditLogger: AuditLoggerService) {}

  async cambiarRol(actorId: string, targetId: string, newRole: string) {
    // Métodos de conveniencia
    this.auditLogger.logRoleChanged(
      actorId,
      'admin@example.com',
      targetId,
      'user@example.com',
      'USUARIO',
      newRole,
    );

    // Log personalizado
    this.auditLogger.log({
      action: AuditAction.SENSITIVE_DATA_ACCESSED,
      actor: {
        userId: actorId,
        ip: '192.168.1.100',
      },
      target: {
        type: 'Document',
        id: 'doc-123',
      },
      success: true,
    });
  }
}
```

### 3. Performance Monitoring

```typescript
async metodoLento() {
  const startTime = Date.now();

  // ... operación ...

  // Log automático de performance
  this.logger.performance('metodoLento', startTime, {
    itemsProcessed: 1000,
  });
  // Si duration > 1000ms, se genera un warn automático
}
```

## 🔍 Request Context (Automático)

El middleware `RequestContextMiddleware` captura automáticamente:

- ✅ Request ID (X-Request-ID)
- ✅ IP del cliente
- ✅ User-Agent
- ✅ Usuario autenticado (después de login)
- ✅ Tenant ID

Estos datos se incluyen **automáticamente** en todos los logs.

### Ejemplo de Log con Contexto:

```json
{
  "timestamp": "2025-11-14T17:56:17.234Z",
  "level": "info",
  "context": "AuthService",
  "message": "User logged in successfully",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "cm3h8k9l20000...",
  "email": "user@example.com",
  "tenantId": "empresa-abc",
  "ip": "192.168.1.100",
  "userAgent": "Mozilla/5.0..."
}
```

## 🔒 Seguridad

### Datos Sensibles Filtrados Automáticamente:

- `password`
- `passwordHash`
- `salt`
- `token`
- `refreshToken`
- `accessToken`
- `resetToken`

Estos campos se reemplazan por `[REDACTED]` en los logs.

## 📊 Acciones de Auditoría Disponibles

```typescript
enum AuditAction {
  // Autenticación
  USER_REGISTERED
  USER_LOGIN
  USER_LOGOUT
  USER_LOGIN_FAILED
  EMAIL_VERIFIED
  PASSWORD_CHANGED
  PASSWORD_RESET_REQUESTED
  PASSWORD_RESET_COMPLETED

  // Gestión de usuarios
  USER_CREATED
  USER_UPDATED
  USER_DELETED
  USER_ACTIVATED
  USER_DEACTIVATED
  USER_ROLE_CHANGED

  // Gestión de empresas/tenants
  TENANT_CREATED
  TENANT_UPDATED
  TENANT_DELETED
  TENANT_USER_ADDED
  TENANT_USER_REMOVED

  // Seguridad
  ACCOUNT_LOCKED
  ACCOUNT_UNLOCKED
  SESSION_REVOKED
  UNAUTHORIZED_ACCESS_ATTEMPT

  // Datos sensibles
  SENSITIVE_DATA_ACCESSED
  SENSITIVE_DATA_MODIFIED
  SENSITIVE_DATA_DELETED

  // Configuración
  SETTINGS_CHANGED
  PERMISSION_CHANGED
}
```

## ⚙️ Configuración

### Variables de Entorno:

```env
# Nivel de log (error, warn, info, http, audit, debug)
LOG_LEVEL=info  # desarrollo: debug, producción: info
```

## 📈 Integración con Herramientas Externas

Los logs en formato JSON pueden integrarse fácilmente con:

### ELK Stack (Elasticsearch, Logstash, Kibana)

```bash
# Logstash config
input {
  file {
    path => "/path/to/logs/combined-*.log"
    codec => json
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "app-logs-%{+YYYY.MM.dd}"
  }
}
```

### Datadog

```javascript
// Winston transport para Datadog
import { datadog } from 'winston-datadog';

transports.push(
  new datadog({
    apiKey: process.env.DATADOG_API_KEY,
    hostname: 'backend-api',
    service: 'saas-backend',
  })
);
```

### CloudWatch (AWS)

```javascript
import CloudWatchTransport from 'winston-cloudwatch';

transports.push(
  new CloudWatchTransport({
    logGroupName: '/aws/backend/logs',
    logStreamName: 'production',
    awsRegion: 'us-east-1',
  })
);
```

## 📝 Ejemplos de Logs

### Consola (Desarrollo):

```
2025-11-14 17:56:17 [info] [AuthService] [ReqID: 550e8400] [User: cm3h8k9l] [Tenant: empresa-abc] User registered successfully {"userId":"cm3h8k9l...","email":"user@example.com"}
```

### Archivo JSON (Producción):

```json
{
  "timestamp": "2025-11-14T17:56:17.234Z",
  "level": "info",
  "context": "AuthService",
  "message": "User registered successfully",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "cm3h8k9l20000...",
  "email": "user@example.com",
  "tenantId": "empresa-abc",
  "ip": "192.168.1.100",
  "metadata": {
    "duration": 234
  }
}
```

### Audit Log:

```json
{
  "timestamp": "2025-11-14T18:00:00.000Z",
  "level": "audit",
  "context": "AuditLog",
  "message": "USER_ROLE_CHANGED - SUCCESS",
  "action": "USER_ROLE_CHANGED",
  "actor": {
    "userId": "cm3h8k9l20000...",
    "email": "admin@empresa.com",
    "role": "EMPRESA_ADMIN"
  },
  "target": {
    "type": "User",
    "id": "cm3h8k9l20001...",
    "email": "user@empresa.com"
  },
  "changes": {
    "before": { "role": "CLIENTE" },
    "after": { "role": "VENDEDOR" }
  },
  "success": true
}
```

## 🚀 Mejores Prácticas

1. **Usa el nivel apropiado:**
   - `error`: Solo para errores que requieren atención inmediata
   - `warn`: Situaciones anormales pero no críticas
   - `info`: Flujo normal de la aplicación
   - `debug`: Solo para desarrollo

2. **Incluye contexto útil:**
   ```typescript
   // ❌ Malo
   this.logger.info('Error');

   // ✅ Bueno
   this.logger.error('Failed to create user', error.stack, {
     email: 'user@example.com',
     reason: 'Database connection timeout',
   });
   ```

3. **No loguees datos sensibles:**
   El sistema filtra automáticamente, pero evita loguear:
   - Contraseñas completas
   - Tokens completos
   - Números de tarjeta
   - Datos personales innecesarios

4. **Usa audit logs para acciones críticas:**
   - Cambios de permisos
   - Eliminación de datos
   - Acceso a información sensible
   - Cambios de configuración

## 🔧 Troubleshooting

### Los logs no aparecen en archivos:

Verifica que el directorio `logs/` exista:
```bash
mkdir logs
```

### Performance lento:

En producción, usa `LOG_LEVEL=info` o `warn` para reducir I/O.

### Logs no se rotan:

Verifica la configuración de `maxSize` y `maxFiles` en `winston.config.ts`.

---

**Documentación creada:** 2025-11-14
**Sistema:** Logging Profesional con Winston + CLS
**Versión:** 1.0
