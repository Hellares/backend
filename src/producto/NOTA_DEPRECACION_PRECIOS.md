# ⚠️ NOTA IMPORTANTE: Deprecación de Precios en Producto/ProductoVariante

## 📅 Fecha: Enero 2026

## ✅ Cambio Implementado

Los campos de precio han sido **eliminados** de los modelos `Producto` y `ProductoVariante`:

### Campos Eliminados:
- `precio` - Precio de venta
- `precioCosto` - Precio de costo
- `precioOferta` - Precio de oferta
- `enOferta` - Estado de oferta
- `fechaInicioOferta` - Inicio de oferta
- `fechaFinOferta` - Fin de oferta

## 🎯 Nueva Arquitectura

**Los precios ahora se gestionan ÚNICAMENTE en `ProductoStock`** por sede.

### Flujo Nuevo:
```typescript
// 1. Crear producto (sin precio)
const producto = await productoService.create({
  nombre: "Mouse Gamer",
  descripcion: "Mouse RGB"
  // NO incluir campos de precio
});

// 2. Crear stock en sede CON precio
const stock = await productoStockService.crearStock(empresaId, {
  sedeId: "sede-001",
  productoId: producto.id,
  stockActual: 100,
  precio: 99.99,        // ✅ Precio aquí
  precioCosto: 45.00,
  precioOferta: 79.99,
  enOferta: true
}, usuarioId);
```

## 🔧 Funciones Afectadas en ProductoService

### Funciones que Necesitan Actualización:

1. **`create()`** - Eliminar manejo de precios
2. **`update()`** - Eliminar actualización de precios
3. **Ajustes masivos de precios** - Usar `ProductoStockService.actualizarPreciosMasivosPorSede()`
4. **Historial de precios** - Usar `ProductoPrecioHistorialSede` en lugar de `ProductoPrecioHistorial`

### Funciones que Deben Eliminarse/Comentarse:

- Cualquier función que actualice `producto.precio`
- Cualquier función que actualice `producto.precioOferta`
- Cualquier lógica de validación de precios en DTOs

## 📝 Recomendaciones

### Para Operaciones de Precio:

**❌ NO HACER:**
```typescript
// INCORRECTO - Ya no funciona
await prisma.producto.update({
  where: { id },
  data: { precio: 99.99 }
});
```

**✅ HACER:**
```typescript
// CORRECTO - Actualizar precio por sede
await productoStockService.actualizarPreciosSede(
  productoStockId,
  empresaId,
  { precio: 99.99 },
  usuarioId
);
```

### Para Consultas:

**❌ NO HACER:**
```typescript
// INCORRECTO
const productos = await prisma.producto.findMany({
  select: {
    id: true,
    nombre: true,
    precio: true  // ❌ Este campo ya no existe
  }
});
```

**✅ HACER:**
```typescript
// CORRECTO - Obtener productos con precios desde ProductoStock
const productosConPrecio = await productoStockService.getProductosListosVenta(
  sedeId,
  empresaId
);
```

## 🚀 Nuevos Endpoints Disponibles

Ya implementados en `ProductoStockController`:

```
GET    /producto-stock/precio                  # Obtener precio por sede
GET    /producto-stock/validar-venta           # Validar si puede venderse
PATCH  /producto-stock/:id/precios             # Actualizar precios
GET    /producto-stock/sede/:id/pendientes-precio    # Sin precio config
GET    /producto-stock/sede/:id/listos-venta   # Listos para vender
GET    /producto-stock/marketplace             # Para marketplace
GET    /producto-stock/estadisticas-precios    # Métricas
POST   /producto-stock/sedes/:id/precios/ajuste-masivo  # Ajuste masivo
```

## 🔄 Estado de Migración

### ✅ Completado:
- Schema de base de datos actualizado
- ProductoStock con precios opcionales
- Métodos de validación implementados
- Endpoints REST disponibles

### ⚠️ En Proceso:
- ProductoService - Comentar/eliminar lógica de precios
- ProductoVarianteService - Comentar/eliminar lógica de precios
- MarketplaceService - Obtener precios de ProductoStock
- DTOs - Campos de precio comentados

## 📚 Documentación

Ver archivos:
- `IMPLEMENTACION_PRECIOS_POR_SEDE.md` - Guía completa
- `ENDPOINTS_PRECIOS_POR_SEDE.md` - Documentación de API
- `CAMBIOS_NECESARIOS_DEPRECACION.md` - Checklist de actualización
- `RESUMEN_DEPRECACION_PRECIOS.md` - Resumen ejecutivo

## 💡 Ventajas

1. **Precios independientes por sede** - Cada sede maneja sus precios
2. **Una única fuente de verdad** - ProductoStock
3. **Flexibilidad** - Configurar precios cuando sea necesario
4. **Validaciones claras** - Productos vendibles vs no vendibles
5. **Escalabilidad** - Fácil agregar más sedes

---

**IMPORTANTE:** Este servicio contiene código legacy que aún referencia campos de precio deprecados. Este código debe ser actualizado o eliminado antes de usar en producción.
