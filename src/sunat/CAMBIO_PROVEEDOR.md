# Guía: Cambio de Proveedor de Facturación Electrónica

## Arquitectura actual

El sistema usa el **patrón Strategy** para desacoplar la lógica de negocio del proveedor específico.

```
FacturacionProvider (interfaz)
    │
    ├── NubefactProvider  ← Proveedor actual
    ├── EfactProvider     ← Futuro
    └── BizlinksProvider  ← Futuro
```

### Archivos clave

| Archivo | Propósito |
|---------|-----------|
| `facturacion-provider.interface.ts` | Interfaz que todo proveedor debe implementar |
| `facturacion.service.ts` | Lógica de negocio (estados, BD, auditoría) — NO tocar |
| `sunat.module.ts` | Donde se registra el proveedor activo |
| `providers/nubefact.provider.ts` | Implementación actual (Nubefact) |
| `providers/nubefact.mapper.ts` | Mapeo de datos al formato JSON de Nubefact |
| `providers/nubefact.types.ts` | Tipos/constantes específicas de Nubefact |

---

## Pasos para cambiar de proveedor

### Paso 1: Crear el provider

Crear archivo `providers/nuevo-proveedor.provider.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { AppLoggerService } from '../../common/logger/logger.service';
import { FacturacionProvider, EnvioResult } from '../facturacion-provider.interface';

@Injectable()
export class NuevoProveedorProvider implements FacturacionProvider {
  constructor(private readonly logger: AppLoggerService) {
    this.logger.setContext('NuevoProveedorProvider');
  }

  async enviar(comprobante: any, config: any, comprobanteOrigen?: any): Promise<EnvioResult> {
    // 1. Mapear 'comprobante' al formato JSON/XML del nuevo proveedor
    // 2. Llamar su API con config.proveedorRuta y config.proveedorToken
    // 3. Interpretar respuesta y retornar EnvioResult
    
    const body = this.mapearRequest(comprobante, config, comprobanteOrigen);
    const response = await this.callApi(config.proveedorRuta, config.proveedorToken, body);
    
    return {
      aceptado: response.fueAceptado,        // boolean
      procesando: response.enProceso,          // boolean (opcional)
      yaExiste: false,                         // boolean (opcional)
      hash: response.codigoHash,               // string | null
      xmlUrl: response.urlXml,                 // string | null
      pdfUrl: response.urlPdf,                 // string | null
      cdrUrl: response.urlCdr,                 // string | null
      cadenaQR: response.qr,                   // string | null
      enlace: response.urlComprobante,         // string | null
      error: response.mensajeError,            // string | null
      rawResponse: response,                   // any (respuesta completa)
    };
  }

  async consultar(comprobante: any, config: any): Promise<EnvioResult> {
    // Consultar estado de un comprobante ya enviado
    // Retornar EnvioResult con aceptado=true si SUNAT confirmó
  }

  async anular(comprobante: any, motivo: string, config: any): Promise<EnvioResult> {
    // Enviar comunicación de baja
    // Retornar EnvioResult
  }

  async consultarAnulacion(comprobante: any, config: any): Promise<any> {
    // Consultar estado de la anulación
  }

  // --- Métodos privados del proveedor ---

  private mapearRequest(comprobante: any, config: any, origen?: any): any {
    // Transformar datos internos al formato del proveedor
  }

  private async callApi(ruta: string, token: string, body: any): Promise<any> {
    // HTTP POST al proveedor
  }
}
```

### Paso 2: Registrar en el módulo

Editar `sunat.module.ts`:

```typescript
// import { NubefactProvider } from './providers/nubefact.provider';
import { NuevoProveedorProvider } from './providers/nuevo-proveedor.provider';

@Module({
  providers: [
    { provide: FACTURACION_PROVIDER, useClass: NuevoProveedorProvider },
    FacturacionService,
  ],
})
```

### Paso 3: Configurar credenciales

En la BD, actualizar los campos de configuración (ya son genéricos):

- `ConfiguracionFacturacion.proveedorRuta` → URL API del nuevo proveedor
- `ConfiguracionFacturacion.proveedorToken` → Token/credencial del nuevo proveedor
- `ConfiguracionFacturacion.facturacionActiva` → true
- `ConfiguracionFacturacion.entorno` → 'BETA' o 'PRODUCCION'

Lo mismo aplica por sede si usa multi-RUC:
- `Sede.proveedorRuta`
- `Sede.proveedorToken`
- `Sede.facturacionActiva`

---

## Interfaz EnvioResult (contrato)

Todos los métodos del provider retornan `EnvioResult`:

```typescript
interface EnvioResult {
  aceptado: boolean;       // SUNAT aceptó el comprobante
  procesando?: boolean;    // Enviado pero SUNAT no confirma aún
  yaExiste?: boolean;      // El comprobante ya existía en el proveedor
  hash?: string | null;    // Código hash SUNAT
  xmlUrl?: string | null;  // URL del XML firmado
  pdfUrl?: string | null;  // URL del PDF generado
  cdrUrl?: string | null;  // URL del CDR (constancia)
  cadenaQR?: string | null;// Cadena para código QR SUNAT
  enlace?: string | null;  // Enlace web al comprobante
  error?: string | null;   // Mensaje de error si fue rechazado
  rawResponse?: any;       // Respuesta completa del proveedor (para debug)
}
```

## Datos disponibles en `comprobante` (parámetro de entrada)

El objeto `comprobante` que recibe el provider contiene:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | ID interno del comprobante |
| `tipoComprobante` | string | FACTURA, BOLETA, NOTA_CREDITO, NOTA_DEBITO |
| `serie` | string | Ej: F001, B001 |
| `correlativo` | string | Ej: 00000001 |
| `tipoDocumento` | string | Tipo doc cliente (6=RUC, 1=DNI) |
| `numeroDocumento` | string | RUC o DNI del cliente |
| `nombreCliente` | string | Razón social o nombre |
| `direccionCliente` | string | Dirección del cliente |
| `emailCliente` | string | Email del cliente |
| `fechaEmision` | Date | Fecha de emisión |
| `moneda` | string | PEN, USD |
| `gravada` | Decimal | Total operaciones gravadas |
| `exonerada` | Decimal | Total operaciones exoneradas |
| `inafecta` | Decimal | Total operaciones inafectas |
| `igv` | Decimal | Total IGV |
| `icbper` | Decimal | Total ICBPER |
| `total` | Decimal | Total del comprobante |
| `detalles[]` | Array | Items del comprobante |
| `venta.descuento` | Decimal | Descuento global |
| `venta.esCredito` | boolean | Si es venta a crédito |
| `venta.cuotas[]` | Array | Cuotas si es crédito |

## Datos en `config` (configuración efectiva)

| Campo | Descripción |
|-------|-------------|
| `proveedorRuta` | URL API del proveedor |
| `proveedorToken` | Token de autenticación |
| `facturacionActiva` | Switch maestro |
| `entorno` | 'BETA' o 'PRODUCCION' |
| `porcentajeIGV` | Porcentaje IGV (18%) |
| `ruc` | RUC del emisor |
| `razonSocial` | Razón social del emisor |
| `direccionFiscal` | Dirección fiscal del emisor |

---

## Lo que NO se toca al cambiar proveedor

- `facturacion.service.ts` — Lógica de estados, BD, auditoría
- `sunat.controller.ts` — Endpoints REST
- Base de datos — Campos genéricos (proveedorRuta, etc.)
- Flutter — Toda la app móvil/web
- DTOs — Validaciones de entrada
- Modelos Prisma — Schema de ComprobanteElectronico

---

## Proveedores de facturación en Perú

| Proveedor | Web | Formato |
|-----------|-----|---------|
| Nubefact | nubefact.com | JSON REST |
| Efact | efact.pe | JSON/XML REST |
| Bizlinks | bizlinks.com.pe | XML SOAP |
| PSE.pe | pse.pe | JSON REST |
| Digiflow | digiflow.pe | JSON REST |
