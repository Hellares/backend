# Plan de Escalabilidad — Base de Datos

## Proyecciones de crecimiento

| Métrica | Año 1 | Año 3 | Año 5 |
|---------|-------|-------|-------|
| Empresas | 500 | 1,500 | 3,000 |
| Ventas/mes | 100K | 300K | 600K |
| Ventas acumuladas | 1.2M | 5.4M | 14.4M |
| Comprobantes acumulados | 960K | 4.3M | 11.5M |
| VentaDetalle acumulados | 4.8M | 21.6M | 57.6M |
| DetalleComprobante acumulados | 3.8M | 17.2M | 46M |

---

## Estado actual (implementado)

### Índices compuestos optimizados
Aplicados en migración `20260405030000_add_performance_indexes`:

**Venta:**
- `(empresaId, fechaVenta)` — reportes por período
- `(empresaId, sedeId, fechaVenta)` — reportes por sede
- `(empresaId, esCredito, estado)` — créditos pendientes
- `(empresaId, canalVenta, fechaVenta)` — filtro por canal
- `(empresaId, documentoCliente)` — búsqueda por RUC/DNI

**ComprobanteElectronico:**
- `(ventaId)` — JOIN venta↔comprobante
- `(empresaId, sunatStatus)` — monitor por status
- `(empresaId, tipoComprobante, fechaEmision)` — monitor tipo+fecha
- `(sunatStatus, estado, intentosEnvio)` — reenvío masivo
- `(empresaId, serie)` — reporte correlativos
- `(empresaId, numeroDocumento)` — búsqueda por documento

**Capacidad actual:** hasta 5-10 millones de registros sin degradación.

---

## Fase 1: Archivado automático (cuando > 5M registros)

### Qué hacer
Mover registros de más de 2 años a tablas históricas. La tabla activa se mantiene pequeña.

### Implementación
```sql
-- Crear tablas de archivo
CREATE TABLE "Venta_historico" (LIKE "Venta" INCLUDING ALL);
CREATE TABLE "ComprobanteElectronico_historico" (LIKE "ComprobanteElectronico" INCLUDING ALL);

-- Mover registros antiguos (ejecutar mensualmente con cron)
WITH moved AS (
  DELETE FROM "Venta"
  WHERE "fechaVenta" < NOW() - INTERVAL '2 years'
  AND "estado" IN ('PAGADA', 'ANULADA')
  RETURNING *
)
INSERT INTO "Venta_historico" SELECT * FROM moved;
```

### Backend
- Crear servicio `ArchivingService` con cron mensual (ya existe el patrón en `archiving.service.ts`)
- Reportes históricos consultan tabla de archivo
- Reportes operativos consultan tabla activa

### Impacto
- Tabla activa: ~10M filas (últimos 2 años)
- Tabla histórica: crece sin impactar rendimiento operativo

---

## Fase 2: Particionamiento por fecha (cuando > 10M registros)

### Qué hacer
Dividir tablas grandes en particiones mensuales. PostgreSQL solo escanea la partición relevante.

### Implementación
```sql
-- Convertir Venta a tabla particionada por rango de fecha
CREATE TABLE "Venta_partitioned" (LIKE "Venta" INCLUDING ALL)
  PARTITION BY RANGE ("fechaVenta");

-- Crear particiones mensuales
CREATE TABLE "Venta_2026_01" PARTITION OF "Venta_partitioned"
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE "Venta_2026_02" PARTITION OF "Venta_partitioned"
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
-- ... etc

-- Automatizar creación de particiones futuras
-- con pg_partman o cron job mensual
```

### Beneficio
Un query de "ventas de marzo 2028" escanea ~400K filas en vez de 50M.

### Consideraciones
- Los UNIQUE constraints deben incluir la columna de partición
- Las FK a Venta necesitan ajuste
- Prisma no soporta particionamiento nativo — manejar con SQL raw o migraciones

---

## Fase 3: Réplicas de lectura (cuando > 500 empresas concurrentes)

### Qué hacer
PostgreSQL secundario (read-only) para reportes y analytics. El primario solo atiende operaciones de escritura (ventas POS).

### Arquitectura
```
                    ┌─── PostgreSQL Primario (escritura)
App POS ───────────►│    - crearYCobrar
                    │    - generarComprobante
                    │    - enviarANubefact
                    │
                    └─── PostgreSQL Réplica (lectura)
App Reportes ──────►     - listarVentas
Dashboard ─────────►     - analytics
Monitor ───────────►     - reporteCorrelativos
```

### Implementación en NestJS
```typescript
// prisma.service.ts
@Injectable()
export class PrismaService {
  readonly write: PrismaClient;  // primario
  readonly read: PrismaClient;   // réplica

  constructor() {
    this.write = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    this.read = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_READ_URL } } });
  }
}
```

### En Portainer/Docker
- Agregar container PostgreSQL réplica con streaming replication
- Variable de entorno `DATABASE_READ_URL` apuntando a la réplica

---

## Fase 4: Connection Pooling (cuando > 500 conexiones simultáneas)

### Qué hacer
PgBouncer entre la app y PostgreSQL para reutilizar conexiones.

### Docker Compose
```yaml
pgbouncer:
  image: edoburu/pgbouncer
  environment:
    DATABASE_URL: postgres://user:pass@postgres:5432/db_saas
    POOL_MODE: transaction
    MAX_CLIENT_CONN: 1000
    DEFAULT_POOL_SIZE: 50
```

### Backend
Cambiar `DATABASE_URL` para apuntar a PgBouncer en vez de PostgreSQL directo.

---

## Fase 5: Caché de queries frecuentes (cuando > 1000 req/s)

### Qué hacer
Redis ya está en el stack. Cachear queries pesados:

| Query | TTL | Key |
|-------|-----|-----|
| Dashboard stats por empresa | 5 min | `stats:empresa:{id}` |
| Listado de productos | 10 min | `productos:empresa:{id}` |
| Config facturación | 30 min | `config:facturacion:{id}` |
| Tipo cambio del día | 1 hora | `tipocambio:fecha:{date}` |

Ya implementado parcialmente en `CacheService`.

---

## Orden de implementación por volumen

| Registros | Acción | Complejidad |
|-----------|--------|-------------|
| < 5M | Índices actuales (ya implementados) | Hecho |
| 5-10M | Archivado automático de registros > 2 años | Baja |
| 10-20M | Particionamiento por fecha | Media |
| 20-50M | Réplica de lectura | Media |
| > 50M | PgBouncer + caché agresivo | Baja |

## Monitoreo

Para saber cuándo actuar, monitorear:
```sql
-- Tamaño de tablas
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 10;

-- Queries lentos (habilitar pg_stat_statements)
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

Habilitar `log_min_duration_statement = 100` en PostgreSQL para loguear queries que tarden más de 100ms.
