# 📦 Sistema de Gestión de Stock

## Resumen

Sistema completo de gestión de inventario multi-sede con soporte para transferencias, reservas, mermas y preparado para módulos de compras, ventas y devoluciones.

---

## 📊 Campos de Stock

### ProductoStock

| Campo | Tipo | Descripción | Uso |
|-------|------|-------------|-----|
| **stockActual** | `Int` | Stock físico total en almacén | Cantidad real de productos en el almacén |
| **stockReservado** | `Int` | Reservado para transferencias aprobadas | Se incrementa al aprobar transferencia, se decrementa al enviar |
| **stockReservadoVenta** | `Int` | Apartado por clientes (pre-ventas/pedidos) | Para módulo de ventas: apartados, pedidos pendientes |
| **stockDanado** | `Int` | Productos defectuosos/dañados | Productos no vendibles, en espera de devolución o baja |
| **stockEnGarantia** | `Int` | Productos en proceso de garantía/reparación | Productos enviados a reparación o en proceso de garantía |
| **stockMinimo** | `Int?` | Stock mínimo configurado | Alertas de stock bajo |
| **stockMaximo** | `Int?` | Stock máximo configurado | Control de sobre-stock |

---

## 🧮 Fórmulas de Cálculo

### Stock Disponible para Transferencias
```typescript
stockDisponible = stockActual - stockReservado
```
> Se usa para crear nuevas transferencias. Ignora productos dañados y en garantía porque siguen siendo stock físico.

### Stock Disponible para Venta (Principal)
```typescript
stockDisponibleVenta = stockActual
                     - stockReservado
                     - stockReservadoVenta
                     - stockDanado
                     - stockEnGarantia
```
> **Lo más importante** para POS y eCommerce. Es el stock real que se puede vender.

### Stock Comprometido
```typescript
stockComprometido = stockReservado + stockReservadoVenta
```

### Stock No Vendible
```typescript
stockNoVendible = stockDanado + stockEnGarantia
```

---

## 🔄 Flujos de Stock

### 1️⃣ Transferencias Entre Sedes

```
PENDIENTE → APROBAR → ENVIAR → RECIBIR
              ↓          ↓         ↓
   stockReservado++  stockActual--  stockActual++ (destino)
                     stockReservado--

CANCELAR (si está APROBADA):
   stockReservado--  (liberar reserva)
```

**Ejemplo:**
```typescript
// Estado inicial (Sede A)
stockActual = 100
stockReservado = 0
stockDisponibleVenta = 100

// 1. APROBAR transferencia de 10 unidades
stockActual = 100        // No cambia
stockReservado = 10      // +10
stockDisponibleVenta = 90

// 2. ENVIAR transferencia
stockActual = 90         // -10
stockReservado = 0       // -10
stockDisponibleVenta = 90

// 3. RECIBIR en Sede B
// Sede B:
stockActual = 50 + 10 = 60
```

---

### 2️⃣ Compras (Futuro)

```
RECIBIR COMPRA:
   stockActual += cantidad

   Si hay productos dañados:
      stockActual += cantidadTotal
      stockDanado += cantidadDañada

DEVOLVER A PROVEEDOR:
   stockActual -= cantidad
   stockDanado -= cantidad  (si son dañados)
```

**Ejemplo - Compra con productos dañados:**
```typescript
// Recibes 20 teclados, 3 vienen dañados
stockActual = 100 + 20 = 120
stockDanado = 0 + 3 = 3
stockDisponibleVenta = 120 - 3 = 117

// Devuelves los 3 dañados al proveedor
stockActual = 120 - 3 = 117
stockDanado = 3 - 3 = 0
stockDisponibleVenta = 117
```

---

### 3️⃣ Ventas (Futuro)

#### Venta Normal
```
VENDER:
   stockActual -= cantidad
```

#### Apartado/Pre-venta
```
APARTAR:
   stockReservadoVenta += cantidad
   (cliente paga anticipo, producto se reserva)

CONFIRMAR VENTA:
   stockActual -= cantidad
   stockReservadoVenta -= cantidad

CANCELAR APARTADO:
   stockReservadoVenta -= cantidad
```

**Ejemplo - Apartado:**
```typescript
// Cliente aparta 2 laptops
stockActual = 50
stockReservadoVenta = 0 + 2 = 2
stockDisponibleVenta = 50 - 2 = 48

// Cliente confirma y paga
stockActual = 50 - 2 = 48
stockReservadoVenta = 2 - 2 = 0
stockDisponibleVenta = 48
```

---

### 4️⃣ Devoluciones (Futuro)

#### Devolución de Cliente - Producto Bueno
```
RECIBIR:
   stockActual += cantidad
   (vuelve a estar disponible)
```

#### Devolución de Cliente - Producto Dañado
```
RECIBIR:
   stockActual += cantidad
   stockDanado += cantidad
   (físicamente está, pero no vendible)

DEVOLVER A PROVEEDOR:
   stockActual -= cantidad
   stockDanado -= cantidad
```

#### Garantía
```
RECIBIR PARA GARANTÍA:
   stockActual += cantidad
   stockEnGarantia += cantidad

ENVIAR A REPARACIÓN:
   stockActual -= cantidad
   stockEnGarantia -= cantidad

REGRESAR REPARADO:
   stockActual += cantidad
   (listo para vender de nuevo)
```

---

## 📝 Tipos de Movimiento de Stock

### Compras
- `ENTRADA_COMPRA` - Compra a proveedor
- `SALIDA_DEVOLUCION_PROVEEDOR` - Devolución a proveedor
- `AJUSTE_ENTRADA_COMPRA` - Ajuste por diferencia en recepción

### Ventas
- `SALIDA_VENTA` - Venta a cliente
- `ENTRADA_DEVOLUCION_CLIENTE` - Cliente devuelve producto
- `AJUSTE_SALIDA_VENTA` - Ajuste por error en venta
- `RESERVA_VENTA` - Reservar stock para venta (stockReservadoVenta++)
- `LIBERAR_RESERVA_VENTA` - Liberar reserva de venta (stockReservadoVenta--)

### Transferencias
- `ENTRADA_TRANSFERENCIA` - Entrada por transferencia de otra sede
- `SALIDA_TRANSFERENCIA` - Salida por transferencia a otra sede

### Merma y Ajustes
- `AJUSTE_ENTRADA` - Ajuste de inventario (entrada)
- `AJUSTE_SALIDA` - Ajuste de inventario (salida)
- `AJUSTE_MERMA` - Marcar producto como dañado (stockDanado++)
- `AJUSTE_REPARACION` - Producto reparado (stockDanado--)
- `AJUSTE_PERDIDA` - Producto perdido/robado
- `AJUSTE_ENCONTRADO` - Producto encontrado (corrección)
- `SALIDA_BAJA` - Dar de baja definitiva (descarte)

### Garantía
- `ENTRADA_GARANTIA` - Producto recibido para garantía (stockEnGarantia++)
- `SALIDA_GARANTIA` - Enviar producto a reparación/proveedor
- `RETORNO_GARANTIA` - Producto reparado regresa (stockEnGarantia--)

---

## 🎯 Casos de Uso Comunes

### Caso 1: Transferencia Simple
```typescript
// Sede A → Sede B: 10 unidades

// 1. Crear transferencia (PENDIENTE)
// No cambia stock

// 2. Aprobar
Sede A:
  stockReservado += 10

// 3. Enviar
Sede A:
  stockActual -= 10
  stockReservado -= 10

// 4. Recibir
Sede B:
  stockActual += 10
```

### Caso 2: Múltiples Transferencias Simultáneas
```typescript
// Sede A tiene 100 unidades

// Apruebas 3 transferencias: 20, 30, 40 unidades
stockActual = 100
stockReservado = 90
stockDisponibleVenta = 10  ✅ Solo 10 disponibles

// Intentas aprobar otra de 15
❌ Error: Stock disponible insuficiente (disponible: 10, solicitado: 15)
```

### Caso 3: Compra con Productos Dañados
```typescript
// Recibes 50 productos, 5 vienen dañados

stockActual += 50        // 50
stockDanado += 5         // 5
stockDisponibleVenta = 50 - 5 = 45

// Devuelves los 5 dañados al proveedor
stockActual -= 5         // 45
stockDanado -= 5         // 0
stockDisponibleVenta = 45
```

### Caso 4: Cliente Aparta y Luego Compra
```typescript
// Cliente aparta 2 productos
stockReservadoVenta += 2
stockDisponibleVenta = 100 - 2 = 98

// 3 días después, cliente confirma compra
stockActual -= 2
stockReservadoVenta -= 2
stockDisponibleVenta = 98
```

### Caso 5: Devolución con Garantía
```typescript
// Cliente devuelve 1 producto defectuoso
stockActual += 1
stockEnGarantia += 1
stockDisponibleVenta = 100 (no cambia, producto no vendible)

// Envías a reparar
stockActual -= 1
stockEnGarantia -= 1

// Regresa reparado
stockActual += 1
stockDisponibleVenta = 101  ✅ Disponible de nuevo
```

---

## 🚨 Validaciones Importantes

### Al Crear Transferencia
```typescript
if (cantidadSolicitada > stockDisponible) {
  throw new Error('Stock disponible insuficiente');
}
// Usa stockDisponible (no stockActual)
```

### Al Aprobar Transferencia
```typescript
const stockDisponible = stockActual - stockReservado;
if (cantidadSolicitada > stockDisponible) {
  throw new Error('Stock disponible insuficiente');
}
```

### Al Vender (Futuro)
```typescript
if (cantidad > stockDisponibleVenta) {
  throw new Error('Stock insuficiente para venta');
}
// Usa stockDisponibleVenta (el más restrictivo)
```

---

## 📱 UI/UX Recomendaciones

### Tarjeta de Stock
```
┌─────────────────────────────────────┐
│ Laptop HP 15                        │
│                                     │
│ ┌─────────┐ ┌──────────────┐       │
│ │ Físico  │ │ Disponible   │       │
│ │   100   │ │     85       │       │
│ └─────────┘ └──────────────┘       │
│                                     │
│ Transfer: 5 | Apartado: 8 | Dañado: 2 │
└─────────────────────────────────────┘
```

### Colores
- **Verde**: Stock disponible OK
- **Naranja**: Stock bajo mínimo
- **Rojo**: Sin stock / Crítico
- **Morado**: Apartados de clientes
- **Ámbar**: En garantía

---

## 🔧 Migración

### Paso 1: Ejecutar Migración de Prisma
```bash
npm run prisma:migrate
```

### Paso 2: Los nuevos campos tienen valores por defecto
```prisma
stockReservadoVenta Int @default(0)
stockDanado         Int @default(0)
stockEnGarantia     Int @default(0)
```

### Paso 3: Stock existente
- `stockActual`: Se mantiene
- `stockReservado`: Se mantiene
- `stockReservadoVenta`: Inicia en 0
- `stockDanado`: Inicia en 0
- `stockEnGarantia`: Inicia en 0

---

## 📚 Referencias

- [Flujo de Transferencias](./TRANSFERENCIAS.md)
- [API Endpoints](./API_STOCK.md)
- [Casos de Prueba](../tests/stock.test.ts)

---

## 🎉 Estado Actual

✅ **Backend:**
- Campos de stock implementados
- Validaciones de stock disponible
- Flujo de transferencias completo
- Tipos de movimiento actualizados

✅ **Frontend (Flutter):**
- Entity y Model actualizados
- Getters calculados implementados
- UI actualizada con nuevos campos
- Validaciones en formularios

⏳ **Pendiente (Futuros Módulos):**
- [ ] Módulo de Compras
- [ ] Módulo de Ventas
- [ ] Módulo de Devoluciones
- [ ] Reportes de Stock

---

**Última actualización:** 2026-01-25
**Versión del Schema:** 2.0.0
