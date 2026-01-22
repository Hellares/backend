# 🔄 Migración del Sistema de Inventario

## 📋 Resumen

Este documento describe la migración del sistema de inventario **legacy** (campos `stock` en tablas `Producto` y `ProductoVariante`) al **nuevo sistema** basado en la tabla `ProductoStock` que soporta inventario multi-sede.

---

## ❌ Sistema Legacy (Deprecado)

### Problemas del Sistema Anterior

1. **Sin separación por sede**: Stock global sin distinguir ubicaciones físicas
2. **Sin trazabilidad**: No registra movimientos de entrada/salida
3. **Sin auditoría**: No se sabe quién modificó el stock ni cuándo
4. **Sin transferencias**: No permite mover stock entre sedes
5. **Sin alertas**: Difícil detectar productos bajo mínimo

### Campos Deprecados

```prisma
model Producto {
  stock       Int  @default(0)  // @deprecated
  stockMinimo Int?              // @deprecated
}

model ProductoVariante {
  stock       Int  @default(0)  // @deprecated
  stockMinimo Int?              // @deprecated
}
```

**⚠️ IMPORTANTE**: Estos campos se mantienen temporalmente por compatibilidad pero **NO deben usarse** en código nuevo.

---

## ✅ Sistema Nuevo (ProductoStock)

### Ventajas

1. ✅ **Stock por sede**: Cada sede tiene su propio inventario
2. ✅ **Trazabilidad completa**: Cada movimiento se registra en `MovimientoStock`
3. ✅ **Transferencias entre sedes**: Sistema robusto de transferencias
4. ✅ **Auditoría detallada**: Usuario, fecha, motivo de cada cambio
5. ✅ **Alertas automáticas**: Detecta productos bajo stock mínimo
6. ✅ **Validación de combos**: Verifica stock de componentes

### Modelos Involucrados

```prisma
model ProductoStock {
  id         String @id @default(cuid())
  sedeId     String
  productoId String?
  varianteId String?
  empresaId  String

  stockActual  Int
  stockMinimo  Int?
  stockMaximo  Int?
  ubicacion    String?

  movimientos MovimientoStock[]
}

model MovimientoStock {
  id              String @id @default(cuid())
  productoStockId String
  tipo            TipoMovimientoStock
  cantidadAnterior Int
  cantidad         Int
  cantidadNueva    Int
  motivo           String?
  usuarioId        String
}

model TransferenciaStock {
  id             String @id @default(cuid())
  sedeOrigenId   String
  sedeDestinoId  String
  productoId     String?
  varianteId     String?
  cantidad       Int
  estado         EstadoTransferencia
}
```

---

## 🚀 Proceso de Migración

### Paso 1: Ejecutar Script de Migración

```bash
cd backend
npx ts-node scripts/migrar-stock-legacy.ts
```

**¿Qué hace el script?**
- Migra `Producto.stock` → `ProductoStock.stockActual`
- Migra `ProductoVariante.stock` → `ProductoStock.stockActual`
- Crea `MovimientoStock` inicial para cada producto
- Asigna productos a sede principal si no tienen sede
- Solo migra productos/variantes activos con stock > 0

**Ejemplo de salida:**
```
═══════════════════════════════════════════════════════
  MIGRACIÓN DE STOCK LEGACY A PRODUCTOSTOCK
═══════════════════════════════════════════════════════

📦 PASO 1: Migrando productos sin variantes...
   Encontrados 150 productos sin variantes
   ✅ Producto abc123 (Teclado USB): 50 unidades migradas
   ✅ Producto def456 (Mouse Inalámbrico): 120 unidades migradas
   ...

🎨 PASO 2: Migrando variantes de productos...
   Encontradas 320 variantes
   ✅ Variante xyz789 (Teclado USB - Negro): 30 unidades migradas
   ...

═══════════════════════════════════════════════════════
  RESUMEN DE MIGRACIÓN
═══════════════════════════════════════════════════════
  📦 Productos con stock:      145
  🎨 Variantes con stock:      310
  ✅ ProductoStock creados:    455
  ⏭️  Productos omitidos:       5
  ⏭️  Variantes omitidas:       10
  ❌ Errores:                  0

✅ Migración completada exitosamente
```

### Paso 2: Verificar Migración

```bash
npx ts-node scripts/verificar-migracion-stock.ts
```

**¿Qué verifica?**
- Compara `Producto.stock` vs suma de `ProductoStock.stockActual`
- Compara `ProductoVariante.stock` vs suma de `ProductoStock.stockActual`
- Detecta discrepancias

**Ejemplo de salida OK:**
```
═══════════════════════════════════════════════════════
  VERIFICACIÓN DE MIGRACIÓN DE STOCK
═══════════════════════════════════════════════════════

✅ MIGRACIÓN EXITOSA - SIN DISCREPANCIAS

  📦 Productos verificados:  145
  🎨 Variantes verificadas:  310

✅ ES SEGURO DEPRECAR LOS CAMPOS LEGACY
```

### Paso 3: Aplicar Cambios en Base de Datos

```bash
npx prisma db push
```

Esto actualiza la base de datos con los comentarios de deprecación.

---

## 📝 Actualización de Código

### ProductoInventoryService

**❌ ANTES (Legacy):**
```typescript
async updateStock(
  id: string,
  empresaId: string,
  cantidad: number,
  operacion: 'agregar' | 'quitar',
) {
  const producto = await this.prisma.producto.update({
    where: { id },
    data: { stock: nuevoStock }
  });

  return { stock: producto.stock };
}
```

**✅ AHORA (ProductoStock):**
```typescript
async updateStock(
  id: string,
  empresaId: string,
  sedeId: string,      // 🆕 Ahora requiere sede
  cantidad: number,
  operacion: 'agregar' | 'quitar',
  usuarioId: string,   // 🆕 Para auditoría
) {
  const productoStock = await this.prisma.productoStock.findFirst({
    where: { productoId: id, sedeId, empresaId }
  });

  // Actualiza en transacción
  await this.prisma.$transaction(async (tx) => {
    await tx.productoStock.update({
      where: { id: productoStock.id },
      data: { stockActual: nuevoStock }
    });

    // Registra movimiento
    await tx.movimientoStock.create({
      data: {
        productoStockId: productoStock.id,
        tipo: 'ENTRADA_AJUSTE',
        cantidadAnterior: productoStock.stockActual,
        cantidad: cantidadAjuste,
        cantidadNueva: nuevoStock,
        usuarioId
      }
    });
  });

  return { stock: nuevoStock, stockTotal: totalTodasSedes };
}
```

### Calcular Stock Total

**❌ ANTES (Legacy):**
```typescript
async getStockTotal(productoId: string) {
  const producto = await this.prisma.producto.findUnique({
    where: { id: productoId }
  });

  return producto.stock;
}
```

**✅ AHORA (ProductoStock):**
```typescript
async getStockTotal(productoId: string, empresaId: string) {
  // Suma stock de TODAS las sedes
  const result = await this.prisma.productoStock.aggregate({
    where: { productoId, empresaId },
    _sum: { stockActual: true }
  });

  return result._sum.stockActual || 0;
}
```

---

## 🎯 Nuevas Funcionalidades

### 1. Validar Stock de Combo

```typescript
const validacion = await productoStockService.validarStockCombo(
  comboId,
  sedeId,
  empresaId,
  cantidad
);

if (!validacion.valido) {
  console.log('Componentes faltantes:', validacion.faltantes);
  // [
  //   {
  //     componenteNombre: "Teclado USB",
  //     cantidadNecesaria: 10,
  //     cantidadDisponible: 5,
  //     faltante: 5
  //   }
  // ]
}
```

### 2. Descontar Stock de Combo

```typescript
// Al vender un combo, descuenta automáticamente todos los componentes
await productoStockService.descontarStockCombo(
  comboId,
  sedeId,
  empresaId,
  cantidad,
  usuarioId,
  'VENTA',
  'VT-2026-001'
);
```

### 3. Stock en Todas las Sedes

```typescript
const stockGlobal = await productoStockService.getStockEnTodasSedes(
  empresaId,
  productoId
);

// {
//   stocks: [
//     { sedeId: 'sede1', stockActual: 50, sede: { nombre: 'Matriz' } },
//     { sedeId: 'sede2', stockActual: 30, sede: { nombre: 'Sucursal A' } }
//   ],
//   resumen: {
//     totalSedes: 2,
//     stockTotal: 80,
//     sedesConStock: 2,
//     sedesSinStock: 0
//   }
// }
```

### 4. Alertas de Stock Bajo

```typescript
const alertas = await productoStockService.getProductosBajoMinimo(
  empresaId,
  sedeId // opcional
);

// {
//   productos: [...],
//   total: 12,
//   criticos: 3  // Con stock = 0
// }
```

---

## 🔗 Endpoints de API

### Stock por Sede

```http
# Crear stock inicial en sede
POST /producto-stock
{
  "sedeId": "sede-123",
  "productoId": "producto-456",
  "stockActual": 100,
  "stockMinimo": 10,
  "ubicacion": "Pasillo 3, Estante B"
}

# Ajustar stock
PUT /producto-stock/:id/ajustar
{
  "tipo": "ENTRADA_COMPRA",
  "cantidad": 50,
  "motivo": "Compra a proveedor XYZ",
  "tipoDocumento": "COMPRA",
  "numeroDocumento": "FC-2026-001"
}

# Listar stock de sede
GET /producto-stock/sede/:sedeId?page=1&limit=50

# Stock en todas las sedes
GET /producto-stock/producto/:productoId/todas-sedes

# Alertas de stock bajo
GET /producto-stock/alertas/bajo-minimo?sedeId=xxx

# Historial de movimientos
GET /producto-stock/:id/movimientos?limit=50
```

### Combos

```http
# Validar stock de combo
POST /producto-stock/combo/validar-stock
{
  "comboId": "combo-123",
  "sedeId": "sede-456",
  "cantidad": 5
}

# Descontar stock de combo (al vender)
POST /producto-stock/combo/descontar-stock
{
  "comboId": "combo-123",
  "sedeId": "sede-456",
  "cantidad": 2,
  "tipoDocumento": "VENTA",
  "numeroDocumento": "VT-2026-001"
}
```

### Transferencias

```http
# Crear transferencia
POST /transferencias-stock
{
  "sedeOrigenId": "sede-1",
  "sedeDestinoId": "sede-2",
  "productoId": "producto-123",
  "cantidad": 50,
  "motivo": "Reposición de stock"
}

# Flujo completo
PUT /transferencias-stock/:id/aprobar
PUT /transferencias-stock/:id/enviar      # Descuenta stock origen
PUT /transferencias-stock/:id/recibir     # Incrementa stock destino
{
  "cantidadRecibida": 48,
  "ubicacion": "Pasillo 5",
  "observaciones": "2 unidades con daño menor"
}
```

---

## ⚠️ Consideraciones Importantes

### 1. Compatibilidad Temporal

Los campos legacy (`Producto.stock`, `ProductoVariante.stock`) **NO se eliminan inmediatamente** para evitar romper código existente.

**Plan de deprecación:**
1. ✅ **Fase 1 (actual)**: Marcar como `@deprecated`, migrar datos
2. 🔄 **Fase 2 (próximo mes)**: Actualizar todo el código para usar `ProductoStock`
3. ⏳ **Fase 3 (futuro)**: Eliminar campos legacy del schema

### 2. Crear Stock Inicial

Si un producto no tiene `ProductoStock` en una sede, **debe crearse explícitamente**:

```typescript
// ❌ NO funciona automáticamente
await productoStockService.ajustarStock(...) // Error: Stock no encontrado

// ✅ Primero crear stock
await productoStockService.crearStock({
  sedeId: 'sede-123',
  productoId: 'producto-456',
  stockActual: 0,
  stockMinimo: 10
});

// ✅ Ahora sí se puede ajustar
await productoStockService.ajustarStock(...)
```

**Excepción**: Las transferencias auto-crean `ProductoStock` en sede destino si no existe.

### 3. Transacciones Atómicas

Todas las operaciones de stock usan transacciones para garantizar consistencia:

```typescript
await this.prisma.$transaction(async (tx) => {
  // 1. Actualizar stock
  await tx.productoStock.update(...)

  // 2. Registrar movimiento
  await tx.movimientoStock.create(...)
});
```

Si alguna operación falla, **todo se revierte**.

### 4. Validaciones

El sistema valida automáticamente:
- ✅ Producto/variante activo
- ✅ Sede activa
- ✅ Stock no negativo
- ✅ Cantidades válidas

---

## 📊 Comparación de Operaciones

| Operación | Legacy | ProductoStock |
|-----------|--------|---------------|
| **Consultar stock** | `producto.stock` | `SUM(productoStock.stockActual)` |
| **Actualizar stock** | `UPDATE producto` | `UPDATE + INSERT movimiento` |
| **Stock por sede** | ❌ No soportado | ✅ `WHERE sedeId = X` |
| **Historial** | ❌ No existe | ✅ `movimientoStock[]` |
| **Transferencias** | ❌ No soportado | ✅ `TransferenciaStock` |
| **Alertas** | ⚠️ Manual | ✅ Automático |
| **Combos** | ❌ Sin validación | ✅ Valida componentes |

---

## 🐛 Solución de Problemas

### Error: "Stock no encontrado en sede"

**Causa**: El producto no tiene `ProductoStock` en esa sede.

**Solución**:
```typescript
// Opción 1: Crear stock inicial
POST /producto-stock
{
  "sedeId": "...",
  "productoId": "...",
  "stockActual": 0
}

// Opción 2: Usar transferencia (auto-crea en destino)
POST /transferencias-stock
```

### Error: "Stock insuficiente para combo"

**Causa**: Uno o más componentes no tienen stock suficiente.

**Solución**:
```typescript
// 1. Validar primero
const validacion = await validarStockCombo(...)

// 2. Ver qué falta
console.log(validacion.faltantes)

// 3. Reponer stock de componentes faltantes
```

### Discrepancias en Verificación

**Causa**: Datos modificados después de la migración.

**Solución**:
```bash
# Re-ejecutar migración
npx ts-node scripts/migrar-stock-legacy.ts

# Verificar nuevamente
npx ts-node scripts/verificar-migracion-stock.ts
```

---

## ✅ Checklist de Migración

- [ ] Ejecutar script de migración
- [ ] Verificar resultados sin discrepancias
- [ ] Aplicar `prisma db push`
- [ ] Actualizar código para usar `ProductoStock`
- [ ] Probar endpoints en Postman/Swagger
- [ ] Actualizar documentación de API
- [ ] Notificar al equipo de frontend
- [ ] Monitorear logs de producción
- [ ] Programar eliminación de campos legacy (Fase 3)

---

## 📞 Soporte

Si tienes dudas o problemas con la migración:
1. Revisa este documento
2. Consulta los scripts en `backend/scripts/`
3. Revisa los tests en `backend/src/producto-stock/`
4. Contacta al equipo de backend

---

**Última actualización**: 2026-01-21
**Responsable**: Sistema de Inventarios
**Estado**: ✅ Migración completada
