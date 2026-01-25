# 🔄 Guía de Migración - Sistema de Stock v2.0

## Resumen

Esta migración agrega nuevos campos al modelo `ProductoStock` para soportar:
- Stock reservado para ventas (apartados, pedidos)
- Stock de productos dañados
- Stock en proceso de garantía/reparación

---

## ⚠️ Antes de Migrar

### Prerrequisitos
- [x] Backup completo de la base de datos
- [x] Verificar que no haya transferencias en proceso crítico
- [x] Notificar al equipo sobre el mantenimiento
- [x] Tener acceso a rollback si es necesario

### Impacto
- ✅ **Sin downtime**: Los nuevos campos tienen valores por defecto
- ✅ **Retrocompatible**: Stock existente no se ve afectado
- ✅ **Seguro**: No se modifican datos existentes

---

## 📝 Pasos de Migración

### 1. Backend - Base de Datos

#### 1.1. Revisar el Schema de Prisma
```bash
cd backend
cat prisma/schema.prisma | grep -A 30 "model ProductoStock"
```

Deberías ver:
```prisma
model ProductoStock {
  // ...
  stockActual         Int
  stockReservado      Int @default(0)
  stockReservadoVenta Int @default(0)  // 🆕
  stockDanado         Int @default(0)  // 🆕
  stockEnGarantia     Int @default(0)  // 🆕
  // ...
}
```

#### 1.2. Crear Migración
```bash
npx prisma migrate dev --name add_stock_reservado_venta_danado_garantia
```

Esto genera:
- Archivo de migración SQL en `prisma/migrations/`
- Actualiza el cliente de Prisma

#### 1.3. Revisar SQL Generado
```bash
cat prisma/migrations/XXXXXX_add_stock_reservado_venta_danado_garantia/migration.sql
```

Debería contener algo como:
```sql
-- AlterTable
ALTER TABLE "ProductoStock"
ADD COLUMN "stockReservadoVenta" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stockDanado" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stockEnGarantia" INTEGER NOT NULL DEFAULT 0;
```

#### 1.4. Aplicar en Producción
```bash
# En producción
npx prisma migrate deploy
```

---

### 2. Backend - Código

#### 2.1. Verificar Servicios Actualizados

Archivos ya actualizados:
- ✅ `transferencia-stock.service.ts`
- ✅ Schema de Prisma

#### 2.2. Regenerar Cliente Prisma
```bash
npx prisma generate
```

#### 2.3. Reiniciar Servidor
```bash
npm run build
pm2 restart saas-backend  # O tu método de deploy
```

---

### 3. Frontend - Flutter

#### 3.1. Actualizar Dependencias
```bash
cd ../syncronize
flutter pub get
```

#### 3.2. Verificar Modelos Actualizados

Archivos ya modificados:
- ✅ `producto_stock.dart` (Entity)
- ✅ `producto_stock_model.dart` (Model)
- ✅ `stock_card.dart` (Widget)
- ✅ `crear_transferencia_page.dart`
- ✅ `crear_transferencia_multiple_page.dart`

#### 3.3. Compilar y Probar
```bash
flutter clean
flutter pub get
flutter run
```

---

## ✅ Verificación Post-Migración

### 1. Verificar Base de Datos

```sql
-- Verificar que los nuevos campos existan
SELECT
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_name = 'ProductoStock'
AND column_name IN ('stockReservadoVenta', 'stockDanado', 'stockEnGarantia');

-- Debería retornar:
-- stockReservadoVenta | integer | 0
-- stockDanado         | integer | 0
-- stockEnGarantia     | integer | 0
```

### 2. Verificar Datos Existentes

```sql
-- Todos los registros existentes deben tener valores en 0
SELECT
    COUNT(*) as total_registros,
    COUNT(*) FILTER (WHERE stockReservadoVenta = 0) as con_reserva_venta_cero,
    COUNT(*) FILTER (WHERE stockDanado = 0) as con_danado_cero,
    COUNT(*) FILTER (WHERE stockEnGarantia = 0) as con_garantia_cero
FROM "ProductoStock";

-- Los 4 contadores deberían ser iguales
```

### 3. Probar API

#### 3.1. Obtener Stock
```bash
curl -X GET "https://tu-api.com/api/producto-stock/sede/SEDE_ID" \
  -H "Authorization: Bearer TOKEN"
```

Respuesta esperada:
```json
{
  "id": "...",
  "stockActual": 100,
  "stockReservado": 5,
  "stockReservadoVenta": 0,    // 🆕 Debe aparecer
  "stockDanado": 0,            // 🆕 Debe aparecer
  "stockEnGarantia": 0,        // 🆕 Debe aparecer
  ...
}
```

#### 3.2. Crear Transferencia
```bash
# Debe seguir funcionando normalmente
curl -X POST "https://tu-api.com/api/transferencias-stock" \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sedeOrigenId": "...",
    "sedeDestinoId": "...",
    "productoId": "...",
    "cantidad": 5
  }'
```

### 4. Probar Flutter

#### 4.1. Ver Stock
- Abrir lista de productos
- Verificar que se muestre "Stock Disponible" correctamente
- Si hay transferencias aprobadas, debe mostrar chip "Transfer: X"

#### 4.2. Crear Transferencia
- Intentar crear transferencia
- Validación debe usar `stockDisponible` (no `stockActual`)
- Debe prevenir crear transferencia si excede stock disponible

---

## 🔙 Rollback (Si es Necesario)

### Opción 1: Rollback de Migración (Recomendado)

```bash
# Backend
cd backend
npx prisma migrate resolve --rolled-back XXXXXX_add_stock_reservado_venta_danado_garantia

# Restaurar versión anterior del código
git revert HEAD
npm run build
pm2 restart saas-backend
```

### Opción 2: Rollback Manual de Base de Datos

```sql
-- CUIDADO: Solo si la migración de Prisma no funciona
ALTER TABLE "ProductoStock"
DROP COLUMN IF EXISTS "stockReservadoVenta",
DROP COLUMN IF EXISTS "stockDanado",
DROP COLUMN IF EXISTS "stockEnGarantia";
```

Luego:
```bash
# Restaurar código anterior
git revert HEAD
npx prisma db pull  # Sincronizar schema con BD
npx prisma generate
npm run build
pm2 restart saas-backend
```

---

## 📊 Monitoreo Post-Migración

### Primeras 24 Horas

Monitorear:
- ✅ Logs del backend (errores relacionados con stock)
- ✅ Reportes de usuarios (problemas al crear transferencias)
- ✅ Performance de consultas de stock

### Consultas Útiles

```sql
-- Stock con inconsistencias (no debería haber ninguno)
SELECT * FROM "ProductoStock"
WHERE stockReservadoVenta < 0
   OR stockDanado < 0
   OR stockEnGarantia < 0;

-- Stock con valores inusuales (para revisar)
SELECT * FROM "ProductoStock"
WHERE stockReservadoVenta > stockActual
   OR stockDanado > stockActual
   OR stockEnGarantia > stockActual;
```

---

## 📝 Notas Adicionales

### Compatibilidad

#### Clientes Flutter Antiguos (No Actualizados)
- ✅ **Funcionarán normalmente**: Ignorarán los nuevos campos
- ✅ **No hay breaking changes**: Campos existentes no cambiaron
- ⚠️ **Recomendación**: Actualizar ASAP para ver información completa

#### APIs Externas
Si tienes integraciones:
- Los nuevos campos aparecerán en las respuestas JSON
- Son opcionales y con valor `0` por defecto
- No rompen contratos de API existentes

### Próximos Pasos

Una vez migrado:
1. ✅ Sistema listo para módulo de **Ventas**
2. ✅ Sistema listo para módulo de **Compras**
3. ✅ Sistema listo para módulo de **Devoluciones**
4. ✅ Sistema listo para gestión de **Garantías**

---

## 🆘 Soporte

### Errores Comunes

#### Error: "Column does not exist"
**Causa:** Migración no aplicada
**Solución:**
```bash
npx prisma migrate deploy
npx prisma generate
```

#### Error: "Type mismatch" en Flutter
**Causa:** Modelo no actualizado
**Solución:**
```bash
flutter clean
flutter pub get
```

#### Stock Negativo
**Causa:** Error en lógica de negocio
**Solución:**
```sql
-- Resetear valores negativos (temporal)
UPDATE "ProductoStock"
SET stockReservadoVenta = 0
WHERE stockReservadoVenta < 0;
```

---

## ✅ Checklist Final

- [ ] Backup de base de datos realizado
- [ ] Migración aplicada en desarrollo
- [ ] Tests realizados en desarrollo
- [ ] Migración aplicada en staging
- [ ] Tests realizados en staging
- [ ] Migración aplicada en producción
- [ ] Backend reiniciado
- [ ] Frontend actualizado y compilado
- [ ] Verificaciones post-migración completadas
- [ ] Equipo notificado de migración exitosa
- [ ] Documentación actualizada
- [ ] Monitoreo configurado

---

**Tiempo Estimado Total:** 30-45 minutos
**Downtime:** 0 minutos (migración en caliente)
**Riesgo:** Bajo (cambios aditivos, no destructivos)

---

**Fecha de Migración:** _________
**Ejecutado por:** _________
**Estado:** [ ] Exitoso [ ] Con issues [ ] Rollback

**Notas:**
_________________________________________________
_________________________________________________
