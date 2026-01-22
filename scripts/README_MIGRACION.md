# 📋 Guía de Ejecución de Migración de Inventario

## ⚠️ IMPORTANTE: Leer antes de ejecutar

Esta migración es **irreversible** una vez que se deprecan los campos legacy. Sigue estos pasos cuidadosamente.

---

## 🔍 Pre-requisitos

1. ✅ Backup de la base de datos
2. ✅ Entorno de desarrollo/staging (NO ejecutar directamente en producción)
3. ✅ Node.js y dependencias instaladas
4. ✅ Acceso a la base de datos

---

## 🚀 Pasos de Ejecución

### 1. Backup de Base de Datos

```bash
# PostgreSQL
pg_dump -h localhost -U usuario -d db_saas > backup_antes_migracion_$(date +%Y%m%d_%H%M%S).sql

# MySQL
mysqldump -u usuario -p db_saas > backup_antes_migracion_$(date +%Y%m%d_%H%M%S).sql
```

### 2. Compilar Scripts TypeScript

```bash
cd backend

# Instalar ts-node si no lo tienes
npm install -g ts-node

# O usar npx (recomendado)
```

### 3. Ejecutar Migración

```bash
# Migrar datos del sistema legacy a ProductoStock
npx ts-node scripts/migrar-stock-legacy.ts
```

**Espera a que termine** y revisa la salida cuidadosamente.

**Ejemplo de salida exitosa:**
```
═══════════════════════════════════════════════════════
  RESUMEN DE MIGRACIÓN
═══════════════════════════════════════════════════════
  📦 Productos con stock:      145
  🎨 Variantes con stock:      310
  ✅ ProductoStock creados:    455
  ❌ Errores:                  0

✅ Migración completada exitosamente
```

**Si hay errores:**
- Revisa los mensajes de error
- Corrige el problema
- Restaura el backup
- Ejecuta nuevamente

### 4. Verificar Resultados

```bash
# Verificar que los datos se migraron correctamente
npx ts-node scripts/verificar-migracion-stock.ts
```

**Salida esperada:**
```
✅ MIGRACIÓN EXITOSA - SIN DISCREPANCIAS

  📦 Productos verificados:  145
  🎨 Variantes verificadas:  310

✅ ES SEGURO DEPRECAR LOS CAMPOS LEGACY
```

**Si hay discrepancias:**
```
❌ SE ENCONTRARON DISCREPANCIAS

  Productos con discrepancias:
    - Teclado USB (ID: abc123): Legacy=50, Nuevo=48

⚠️  NO ES SEGURO DEPRECAR LOS CAMPOS LEGACY
```

**Acción:** Investiga las discrepancias antes de continuar.

### 5. Aplicar Cambios en Schema

```bash
# Aplicar los comentarios de deprecación y nuevos índices
npx prisma db push
```

### 6. Reiniciar Aplicación

```bash
# Recompilar
npm run build

# Reiniciar servidor
pm2 restart backend
# o
npm run start:prod
```

### 7. Probar Endpoints

```bash
# Probar que los nuevos endpoints funcionan

# 1. Listar stock de una sede
curl -X GET "http://localhost:3000/producto-stock/sede/SEDE_ID" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-tenant-id: EMPRESA_ID"

# 2. Crear stock inicial (si es necesario)
curl -X POST "http://localhost:3000/producto-stock" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-tenant-id: EMPRESA_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "sedeId": "SEDE_ID",
    "productoId": "PRODUCTO_ID",
    "stockActual": 100,
    "stockMinimo": 10
  }'

# 3. Ajustar stock
curl -X PUT "http://localhost:3000/producto-stock/STOCK_ID/ajustar" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-tenant-id: EMPRESA_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "tipo": "ENTRADA_COMPRA",
    "cantidad": 50,
    "motivo": "Compra de inventario"
  }'

# 4. Ver stock total (endpoint actualizado)
curl -X GET "http://localhost:3000/productos/PRODUCTO_ID/stock-total" \
  -H "Authorization: Bearer TOKEN" \
  -H "x-tenant-id: EMPRESA_ID"
```

---

## ✅ Checklist Post-Migración

- [ ] Todos los scripts ejecutados sin errores
- [ ] Verificación exitosa (sin discrepancias)
- [ ] Base de datos actualizada (`prisma db push`)
- [ ] Aplicación reiniciada
- [ ] Endpoints probados manualmente
- [ ] Tests automatizados pasando
- [ ] Logs de aplicación sin errores
- [ ] Frontend notificado de cambios en API
- [ ] Documentación actualizada

---

## 🔄 En caso de problemas

### Opción 1: Restaurar Backup

```bash
# PostgreSQL
psql -h localhost -U usuario -d db_saas < backup_antes_migracion_TIMESTAMP.sql

# MySQL
mysql -u usuario -p db_saas < backup_antes_migracion_TIMESTAMP.sql
```

### Opción 2: Ejecutar Migración Nuevamente

Si el problema fue menor (ej: sede no encontrada), puedes:

1. Corregir el problema
2. Ejecutar nuevamente el script (es idempotente)

El script **NO duplica datos** porque verifica antes de crear:

```typescript
const existente = await prisma.productoStock.findFirst({
  where: { productoId, sedeId }
});

if (existente) {
  // OMITIR
}
```

---

## 📊 Monitoreo Post-Migración

### Queries Útiles

```sql
-- Verificar total de ProductoStock creados
SELECT COUNT(*) FROM "ProductoStock";

-- Productos sin ProductoStock pero con stock > 0
SELECT p.id, p.nombre, p.stock
FROM "Producto" p
LEFT JOIN "ProductoStock" ps ON ps."productoId" = p.id
WHERE p.stock > 0
  AND p."tieneVariantes" = false
  AND ps.id IS NULL;

-- Variantes sin ProductoStock pero con stock > 0
SELECT v.id, v.nombre, v.stock
FROM "ProductoVariante" v
LEFT JOIN "ProductoStock" ps ON ps."varianteId" = v.id
WHERE v.stock > 0
  AND ps.id IS NULL;

-- Comparar stock legacy vs nuevo (por producto)
SELECT
  p.id,
  p.nombre,
  p.stock AS stock_legacy,
  COALESCE(SUM(ps."stockActual"), 0) AS stock_nuevo,
  p.stock - COALESCE(SUM(ps."stockActual"), 0) AS diferencia
FROM "Producto" p
LEFT JOIN "ProductoStock" ps ON ps."productoId" = p.id
WHERE p."tieneVariantes" = false
GROUP BY p.id, p.nombre, p.stock
HAVING p.stock != COALESCE(SUM(ps."stockActual"), 0);
```

### Métricas a Vigilar

1. **Tiempo de respuesta de endpoints** (debe ser similar o mejor)
2. **Errores en logs** (buscar "Stock no encontrado")
3. **Alertas de stock bajo** (verificar que funcionen)
4. **Transferencias entre sedes** (probar flujo completo)

---

## 📞 Contacto de Soporte

Si encuentras problemas:

1. Revisa la documentación: `MIGRACION_INVENTARIO_STOCK.md`
2. Consulta los logs: `backend/logs/`
3. Ejecuta queries de diagnóstico (arriba)
4. Contacta al equipo de backend

---

## 🔮 Próximos Pasos

Después de validar que la migración funciona correctamente:

1. **Semana 1-2**: Monitorear en staging
2. **Semana 3**: Ejecutar en producción (horario de baja actividad)
3. **Semana 4**: Deprecar completamente campos legacy
4. **Mes 2**: Eliminar campos legacy del schema

---

**Última actualización**: 2026-01-21
**Versión**: 1.0
**Estado**: ✅ Scripts listos para ejecución
