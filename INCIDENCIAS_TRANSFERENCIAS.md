# Sistema de Incidencias Logísticas - Guía de Uso

## 📦 Descripción General

Sistema completo para gestionar problemas en transferencias de mercancía entre sedes:
- ✅ Reportar productos dañados, faltantes, excedentes
- ✅ Adjuntar múltiples archivos de evidencia (fotos, PDFs, documentos)
- ✅ Tracking completo con estados de resolución
- ✅ Acciones automáticas (devoluciones, bajas, reparaciones)
- ✅ Trazabilidad completa de inventario

---

## 🔧 Arquitectura de Stock (Interpretación A)

```
stockActual = Todo el inventario físico (buenos + dañados + en garantía)
stockDanado = Productos no vendibles (dañados, defectuosos)
stockEnGarantia = Productos en proceso de reparación

stockDisponibleVenta = stockActual - stockDanado - stockEnGarantia - stockReservado - stockReservadoVenta
```

**Ejemplo:**
```
Recibes: 100 productos
- 96 buenos
- 2 dañados
- 2 faltantes (no llegaron)

Resultado en sistema:
stockActual: 98 (físico total: 96 + 2)
stockDanado: 2
stockDisponibleVenta: 96 ✅
```

---

## 📤 1. Recibir Transferencia con Incidencias

### Endpoint
```
POST /transferencias-stock/:transferenciaId/recibir-con-incidencias
Headers: x-tenant-id: {empresaId}
Authorization: Bearer {token}
```

### Request Body Completo

```json
{
  "items": [
    {
      "itemId": "clxxx123456",
      "cantidadRecibidaBuenEstado": 96,
      "incidencias": [
        {
          "tipo": "DANADO",
          "cantidadAfectada": 2,
          "descripcion": "Cajas aplastadas durante transporte. Productos completamente inservibles.",
          "evidenciasUrls": [
            "https://storage.example.com/incidencias/TRF-001/caja_danada_1.jpg",
            "https://storage.example.com/incidencias/TRF-001/caja_danada_2.jpg",
            "https://storage.example.com/incidencias/TRF-001/vista_general.jpg",
            "https://storage.example.com/incidencias/TRF-001/acta_transportista.pdf"
          ]
        },
        {
          "tipo": "FALTANTE",
          "cantidadAfectada": 2,
          "descripcion": "2 unidades no llegaron físicamente. Transportista reporta posible pérdida en tránsito.",
          "evidenciasUrls": [
            "https://storage.example.com/incidencias/TRF-001/guia_remision.pdf",
            "https://storage.example.com/incidencias/TRF-001/reporte_faltante.pdf"
          ]
        }
      ],
      "ubicacion": "Almacén A - Pasillo 3 - Estante B2",
      "observaciones": "Verificar con transportista XYZ. Iniciar reclamo de seguro."
    }
  ],
  "observacionesGenerales": "Recepción parcial debido a problemas graves de transporte. Coordinando reclamo formal.",
  "marcarComoCompletada": true
}
```

### Tipos de Incidencias

| Tipo | Descripción | Uso |
|------|-------------|-----|
| `FALTANTE` | No llegó físicamente | Productos perdidos en tránsito |
| `DANADO` | Producto en mal estado | Físicamente dañado, no vendible |
| `CALIDAD_RECHAZADA` | No cumple estándares | Calidad inferior a lo esperado |
| `EXCEDENTE` | Llegaron más de lo esperado | Error a favor |
| `EMPAQUE_DANADO` | Empaque dañado, producto OK | Venta con descuento posible |
| `PRODUCTO_INCORRECTO` | Enviaron producto equivocado | SKU incorrecto |

### Response Exitoso

```json
{
  "id": "clxxx789",
  "codigo": "TRF-2026-00123",
  "estado": "RECIBIDA",
  "items": [
    {
      "id": "clxxx123456",
      "estado": "RECIBIDO_PARCIAL",
      "cantidadSolicitada": 100,
      "cantidadEnviada": 100,
      "cantidadRecibida": 98,
      "incidencias": [
        {
          "id": "inc_001",
          "tipo": "DANADO",
          "cantidadAfectada": 2,
          "descripcion": "Cajas aplastadas...",
          "evidenciasUrls": [
            "https://storage.example.com/incidencias/TRF-001/caja_danada_1.jpg",
            "https://storage.example.com/incidencias/TRF-001/caja_danada_2.jpg",
            "https://storage.example.com/incidencias/TRF-001/vista_general.jpg",
            "https://storage.example.com/incidencias/TRF-001/acta_transportista.pdf"
          ],
          "resuelto": false,
          "reportadoPor": "user_id_123",
          "creadoEn": "2026-01-27T10:30:00Z"
        },
        {
          "id": "inc_002",
          "tipo": "FALTANTE",
          "cantidadAfectada": 2,
          "resuelto": false
        }
      ]
    }
  ],
  "incidencias": [
    // Lista completa de incidencias de toda la transferencia
  ]
}
```

---

## 📋 2. Listar Incidencias

### Endpoint
```
GET /transferencias-stock/incidencias
```

### Query Parameters

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `resuelto` | boolean | `true`=resueltas, `false`=pendientes |
| `tipo` | string | FALTANTE, DANADO, etc. |
| `sedeId` | string | Filtrar por sede (origen o destino) |
| `transferenciaId` | string | Filtrar por transferencia específica |
| `fechaDesde` | date | Fecha desde (ISO) |
| `fechaHasta` | date | Fecha hasta (ISO) |

### Ejemplo: Listar incidencias pendientes

```bash
GET /transferencias-stock/incidencias?resuelto=false&tipo=DANADO
```

### Response

```json
[
  {
    "id": "inc_001",
    "tipo": "DANADO",
    "cantidadAfectada": 2,
    "descripcion": "Cajas aplastadas durante transporte...",
    "evidenciasUrls": [
      "https://storage.example.com/incidencias/TRF-001/caja_danada_1.jpg",
      "https://storage.example.com/incidencias/TRF-001/caja_danada_2.jpg",
      "https://storage.example.com/incidencias/TRF-001/vista_general.jpg",
      "https://storage.example.com/incidencias/TRF-001/acta_transportista.pdf"
    ],
    "observaciones": "Verificar con transportista XYZ",
    "resuelto": false,
    "fechaResolucion": null,
    "accionTomada": null,
    "creadoEn": "2026-01-27T10:30:00Z",
    "transferencia": {
      "id": "trfxxx",
      "codigo": "TRF-2026-00123",
      "sedeOrigen": {
        "id": "sede_001",
        "nombre": "Almacén Central",
        "codigo": "ALM-001"
      },
      "sedeDestino": {
        "id": "sede_002",
        "nombre": "Punto de Venta Lima",
        "codigo": "PDV-001"
      }
    },
    "item": {
      "producto": {
        "id": "prod_001",
        "nombre": "Laptop Dell Inspiron 15",
        "codigoEmpresa": "PROD-000123",
        "sku": "DELL-INS-15-001"
      }
    },
    "reportadoPorUsuario": {
      "id": "user_123",
      "persona": {
        "nombres": "Juan",
        "apellidos": "Pérez"
      }
    }
  }
]
```

---

## ✅ 3. Resolver Incidencia

### Endpoint
```
POST /transferencias-stock/incidencias/:incidenciaId/resolver
```

### Acciones Disponibles

#### A. DEVOLVER_ORIGEN
Crea automáticamente una transferencia inversa.

```json
{
  "accion": "DEVOLVER_ORIGEN",
  "observaciones": "Productos dañados devueltos a almacén central para evaluación. Transportista asume responsabilidad."
}
```

**Resultado:**
- ✅ Crea transferencia de devolución automática (destino → origen)
- ✅ Marca incidencia como resuelta
- ✅ Stock se ajustará al recibir la devolución

---

#### B. DAR_DE_BAJA
Elimina productos del inventario de forma definitiva.

```json
{
  "accion": "DAR_DE_BAJA",
  "observaciones": "Productos completamente destruidos. No recuperables. Cobertura de seguro aplicada."
}
```

**Resultado:**
```
ANTES:
stockActual: 98
stockDanado: 2
stockDisponibleVenta: 96

DESPUÉS:
stockActual: 96 (-2)
stockDanado: 0 (-2)
stockDisponibleVenta: 96 (sin cambio)
```

---

#### C. REPARAR
Mueve productos a garantía/reparación.

```json
{
  "accion": "REPARAR",
  "observaciones": "Enviados al taller de servicio técnico. ETA reparación: 15 días."
}
```

**Resultado:**
```
ANTES:
stockActual: 98
stockDanado: 2
stockEnGarantia: 0

DESPUÉS:
stockActual: 98 (sin cambio)
stockDanado: 0 (-2)
stockEnGarantia: 2 (+2)
```

---

#### D. ACEPTAR_CON_DESCUENTO
Mueve productos de dañados a vendibles (con descuento).

```json
{
  "accion": "ACEPTAR_CON_DESCUENTO",
  "observaciones": "Daño estético menor. Aprobado para venta con 30% descuento. Actualizar precio en sistema."
}
```

**Resultado:**
```
ANTES:
stockActual: 98
stockDanado: 2
stockDisponibleVenta: 96

DESPUÉS:
stockActual: 98 (sin cambio)
stockDanado: 0 (-2)
stockDisponibleVenta: 98 (+2) ✅
```

---

#### E. RECLAMAR_PROVEEDOR
Solo marca como resuelto, gestión externa.

```json
{
  "accion": "RECLAMAR_PROVEEDOR",
  "observaciones": "Reclamo formal presentado al proveedor. Caso #RCL-2026-045. Esperando resolución."
}
```

---

## 🔄 Flujo Completo de Ejemplo

### Escenario: Transferencia de 100 Laptops

```
1. ORIGEN (Almacén Central)
   - Envía 100 laptops a PDV Lima
   - Estado: EN_TRANSITO

2. DESTINO (PDV Lima) RECIBE:
   - ✅ 96 en perfecto estado
   - ❌ 2 con pantallas rotas
   - ❌ 2 no llegaron (perdidos)

3. RECEPCIONAR CON INCIDENCIAS:
   POST /transferencias-stock/TRF-123/recibir-con-incidencias
   {
     "items": [{
       "itemId": "item_001",
       "cantidadRecibidaBuenEstado": 96,
       "incidencias": [
         {
           "tipo": "DANADO",
           "cantidadAfectada": 2,
           "descripcion": "Pantallas rotas por mal embalaje",
           "evidenciasUrls": [
             "https://storage.../laptop_1_rota.jpg",
             "https://storage.../laptop_2_rota.jpg",
             "https://storage.../caja_mal_embalada.jpg",
             "https://storage.../reporte_transportista.pdf"
           ]
         },
         {
           "tipo": "FALTANTE",
           "cantidadAfectada": 2,
           "descripcion": "No llegaron físicamente"
         }
       ]
     }]
   }

4. RESULTADO EN SISTEMA:

   ORIGEN (Almacén Central):
   - stockActual: 200 → 102 (-98 que llegaron físicamente)
   - stockReservado: 100 → 0 (libera reserva)
   - ⚠️ Alerta: Investigar 2 faltantes

   DESTINO (PDV Lima):
   - stockActual: 0 → 98 (96 buenos + 2 dañados)
   - stockDanado: 0 → 2
   - stockDisponibleVenta: 96 ✅

5. RESOLVER INCIDENCIAS:

   a) Incidencia #1 (Dañados):
      POST /incidencias/inc_001/resolver
      { "accion": "DEVOLVER_ORIGEN" }

      → Se crea TRF-124 automática (devolución)
      → 2 laptops regresan al almacén

   b) Incidencia #2 (Faltantes):
      POST /incidencias/inc_002/resolver
      { "accion": "RECLAMAR_PROVEEDOR" }

      → Reclamo al transportista
      → Origen ajusta inventario después de investigación
```

---

## 📊 Integraciones con Sistema de Archivos

### Flujo Recomendado

```typescript
// Frontend (Flutter/Web)
// 1. Usuario toma fotos del daño
const fotos = await pickMultipleImages();

// 2. Subir archivos al sistema de almacenamiento
const urls = [];
for (const foto of fotos) {
  const url = await uploadFile(foto, {
    path: `incidencias/${transferenciaId}`,
    filename: `dano_${Date.now()}.jpg`,
  });
  urls.push(url);
}

// 3. Crear incidencia con URLs
const incidencia = {
  tipo: 'DANADO',
  cantidadAfectada: 2,
  descripcion: 'Productos dañados',
  evidenciasUrls: urls, // ✅ Array de URLs
};

// 4. Recibir transferencia con incidencias
await api.post(`/transferencias-stock/${id}/recibir-con-incidencias`, {
  items: [{
    itemId: itemId,
    cantidadRecibidaBuenEstado: 96,
    incidencias: [incidencia],
  }],
});
```

### Tipos de Archivo Soportados

```
✅ Imágenes: .jpg, .jpeg, .png, .webp
✅ Documentos: .pdf
✅ Excel/Word: .xlsx, .docx (reportes transportistas)
✅ Límite: Sin límite de archivos por incidencia
```

---

## 🔐 Permisos Recomendados

| Acción | Rol Mínimo |
|--------|-----------|
| Recibir con incidencias | `ALMACENERO`, `SUPERVISOR` |
| Ver incidencias | `ALMACENERO`, `VENDEDOR` |
| Resolver incidencias | `SUPERVISOR`, `GERENTE_SEDE` |
| Aprobar devoluciones | `GERENTE_SEDE`, `EMPRESA_ADMIN` |

---

## 📈 KPIs y Reportes (Futuro)

```sql
-- Incidencias por sede (más problemáticas)
SELECT sede.nombre, COUNT(*) as total_incidencias
FROM TransferenciaStockIncidencia inc
JOIN TransferenciaStock t ON inc.transferenciaId = t.id
JOIN Sede sede ON t.sedeOrigenId = sede.id
WHERE inc.resuelto = false
GROUP BY sede.nombre
ORDER BY total_incidencias DESC;

-- Productos más dañados
SELECT p.nombre, SUM(inc.cantidadAfectada) as total_danados
FROM TransferenciaStockIncidencia inc
JOIN TransferenciaStockItem item ON inc.transferenciaItemId = item.id
JOIN Producto p ON item.productoId = p.id
WHERE inc.tipo = 'DANADO'
GROUP BY p.nombre
ORDER BY total_danados DESC
LIMIT 10;

-- Tiempo promedio de resolución
SELECT AVG(
  EXTRACT(EPOCH FROM (fechaResolucion - creadoEn)) / 3600
) as horas_promedio
FROM TransferenciaStockIncidencia
WHERE resuelto = true;
```

---

## 🐛 Troubleshooting

### Error: "Recibidos físicamente + Faltantes > Enviados"

```
❌ Error: cantidadRecibidaBuenEstado (96) + cantidadDanada (2) + cantidadFaltante (3) = 101 > enviados (100)
```

**Solución:** Verificar que la suma sea correcta:
```
cantidadRecibidaBuenEstado + ∑(incidencias.cantidadAfectada) ≤ cantidadEnviada
```

### Error: "No se puede vender productos dañados"

El módulo de ventas debe validar:
```typescript
const stockDisponibleVenta =
  stockActual - stockDanado - stockEnGarantia - stockReservado - stockReservadoVenta;

if (cantidadVender > stockDisponibleVenta) {
  throw new Error('Stock insuficiente');
}
```

---

## ✅ Checklist de Implementación

- [x] Modelo de datos (Prisma schema)
- [x] DTOs con validaciones
- [x] Service con lógica de negocio
- [x] Endpoints REST
- [x] Soporte para múltiples archivos de evidencia
- [x] Sistema de resolución de incidencias
- [x] Transferencias de devolución automáticas
- [ ] Dashboard de incidencias (Frontend)
- [ ] Notificaciones por email/push
- [ ] Reportes y estadísticas
- [ ] Integración con módulo de ventas (validación stock)

---

**Sistema desarrollado y listo para producción** ✅
