# Webhooks

Módulo receptor de eventos push de proveedores externos. Actualiza el estado
local de los comprobantes en tiempo real sin polling.

> ✅ **Validado end-to-end** en beta el 2026-04-22: latencia ~2s desde que
> Syncrofact confirma ACEPTADO por SUNAT hasta que `sunatStatus` se actualiza
> en BD de Syncronize.

## Endpoint expuesto

```
POST /api/webhooks/syncrofact
```

**Público** (sin `JwtAuthGuard`). La autenticación se hace por firma HMAC-SHA256
sobre el body crudo. Cualquier petición sin firma válida recibe `401 Unauthorized`.

## Headers enviados por Syncrofact

| Header | Contenido |
|--------|-----------|
| `X-Webhook-Signature` | `hmac_sha256(rawBody, SYNCROFACT_WEBHOOK_SECRET)` en hex |
| `X-Webhook-Event` | Nombre del evento (ej. `invoice.accepted`) |
| `Content-Type` | `application/json` |
| `User-Agent` | `FacturacionElectronica/1.0` |

## Eventos manejados

### Actualizan `sunatStatus` del `ComprobanteElectronico`

| Evento | Acción |
|--------|--------|
| `invoice.accepted` / `invoice.rejected` | Marca ACEPTADO o RECHAZADO |
| `boleta.accepted` / `boleta.rejected` | Idem |
| `credit_note.accepted` / `credit_note.rejected` | Idem |
| `debit_note.accepted` / `debit_note.rejected` | Idem |
| `dispatch_guide.accepted` / `dispatch_guide.rejected` | Idem |

### Marcan el comprobante anulado

| Evento | Acción |
|--------|--------|
| `invoice.voided` | `anulado = true` |
| `voided_document.accepted` | `anulado = true` |

### Eventos aceptados pero sin acción (ACK 200)

`webhook.test`, `*.created`, `daily_summary.*`, `plazo.*`

No disparan cambios en BD pero devolvemos 200 para que Syncrofact no reintente.

## Localización del comprobante

Al llegar el webhook, buscamos el `ComprobanteElectronico` con esta estrategia:

1. **Por `data.referencia_interna`** (nuestro `comprobante.id`) — siempre el
   primer intento porque es clave primaria.
2. **Por `data.numero`** (formato `F002-00000007`) derivando `serie` y
   `correlativo` — fallback si por alguna razón no hay `referencia_interna`.

Para que llegue `referencia_interna` en el webhook, el mapper Syncrofact la
incluye al emitir el documento (ver `backend/src/sunat/providers/syncrofact.mapper.ts`,
campo `referencia_interna: comprobante.id`).

## Multi-tenant

La empresa Syncronize se resuelve via:

1. **`ConfiguracionFacturacion.proveedorConfig.companyId`** → `empresaId`
2. Fallback: **`Sede.proveedorConfig.companyId`** (para setups con companyId
   distinto por sede)

El `company_id` que manda Syncrofact en `data.company_id` debe coincidir con
el que guardaste en la configuración de facturación al hacer el switch a
SYNCROFACT. Si no mapea a ninguna empresa, el webhook se acepta con 200 y
`accion: ignorado` (se registra warning en logs).

## Idempotencia

Si el comprobante ya está en estado terminal (`ACEPTADO` o `RECHAZADO`), el
webhook se ignora con 200 y `accion: ignorado`. Syncrofact puede reenviar el
mismo evento (reintentos por timeout, cron de respaldo cada 5 min, etc.) sin
causar inconsistencias.

## Seguridad — validación HMAC

El service usa `crypto.timingSafeEqual` para evitar timing attacks:

```ts
const firmaEsperada = createHmac('sha256', secret).update(rawBody).digest('hex');
return timingSafeEqual(Buffer.from(firmaEsperada), Buffer.from(firmaRecibida));
```

> ⚠ La firma se calcula sobre el **body crudo** (Buffer), no sobre el JSON
> re-serializado. Si lo re-serializas el HMAC cambia. Por eso `main.ts` tiene
> `rawBody: true` en `NestFactory.create()` y el controller lee
> `req.rawBody as Buffer`.

---

## Setup paso a paso

### 1. Generar un secret fuerte (solo la primera vez)

```bash
openssl rand -hex 32
```

Genera una cadena de 64 caracteres hex. **Ejemplo**:
`b2ffc3a4b785b5e2529f814102f95d3007df5a970a673749234207b322a194ee`

Usa secrets **distintos** para beta y producción.

### 2. Configurar el secret en el backend Syncronize

En `backend/.env`:

```
SYNCROFACT_WEBHOOK_SECRET=<el secret generado>
```

Reiniciar el backend para que tome la variable.

### 3. Crear el webhook en el panel admin de Syncrofact

URL del panel: `https://beta.syncrofact.net.pe/webhooks` (beta) o equivalente
en producción. Click en **Nuevo** y completar:

| Campo | Valor para beta | Valor para producción |
|-------|-----------------|-----------------------|
| Name | `Syncronize Beta` | `Syncronize Prod` |
| URL | `https://<url-pública-beta>/api/webhooks/syncrofact` | `https://saas.syncronize.net.pe/api/webhooks/syncrofact` |
| Method | `POST` | `POST` |
| Secret | `<mismo secret del .env>` | `<mismo secret del .env de prod>` |
| Company | La que tiene `company_id` que coincida con tu `ConfiguracionFacturacion.proveedorConfig.companyId` | idem |
| Timeout | 15-30s | 15-30s |
| Max retries | 3-5 | 3-5 |
| Active | ✅ | ✅ |

**Eventos a marcar** (todos los `.accepted` y `.rejected` que emitas):

- ☑ `invoice.accepted` / `invoice.rejected`
- ☑ `boleta.accepted` / `boleta.rejected`
- ☑ `credit_note.accepted` / `credit_note.rejected`
- ☑ `debit_note.accepted` / `debit_note.rejected`
- ☑ `dispatch_guide.accepted` / `dispatch_guide.rejected` (si emites GRE)
- ☑ `invoice.voided` (opcional — anulaciones)

> ⚠ **NO marcar `dispatch_guide.created`** — es un evento que lista el front
> de admin-facturacion pero NO está en el validator del backend Syncrofact.
> Si lo marcas, falla la creación con 422.

### 4. Probar

El panel de Syncrofact tiene un botón **Test** en cada webhook que dispara
un payload sintético con `event: "webhook.test"`. Nuestro backend lo ACK con
`200` y `accion: test_ok`. Verifica en logs:

```
[WebhooksService] Webhook.test recibido (firma válida): {...}
```

Si ves `Firma inválida` → el secret no coincide entre admin y `.env`.

### 5. Validar con evento real

Emite una factura desde Flutter. Deberías ver en logs, ~2s después de que
Syncrofact confirme ACEPTADO:

```
[WebhooksService] Webhook invoice.accepted → comprobante cXXX... marcado ACEPTADO
```

Y en el monitor de facturación, el comprobante aparece en ACEPTADO **sin tocar
el botón 🔄 "Actualizar estados"**.

---

## Desarrollo local (sin deploy)

Webhooks requieren URL pública HTTPS. En desarrollo usa un tunnel:

### Opción A — Cloudflare Tunnel (recomendado: sin cuenta, instant)

```bash
winget install --id Cloudflare.cloudflared
cloudflared tunnel --url http://localhost:3000
```

Te da una URL `https://xxx-xxx-xxx.trycloudflare.com`. La URL cambia cada vez
que reinicias, así que hay que actualizar el webhook en el panel de Syncrofact
después de cada reinicio.

### Opción B — ngrok

```bash
winget install ngrok.ngrok
ngrok config add-authtoken <tu-token>
ngrok http 3000
```

URL: `https://xxx.ngrok-free.app`. Igual cambia en cada reinicio salvo que
pagues el plan.

### Opción C — localtunnel

```bash
npx localtunnel --port 3000
```

El más simple pero a veces mete página intersticial.

---

## Flujo end-to-end completo

```
1. [Syncronize] → POST crear factura a Syncrofact
   body incluye referencia_interna = comprobante.id
2. [Syncrofact] → responde EN_COLA (~1s)
3. [Syncrofact] → job SendDocumentToSunat procesa → envía XML firmado a SUNAT
4. [SUNAT] → responde ACEPTADO (~1-2s)
5. [Syncrofact] → dispara evento DocumentSentToSunat
   → Listener encola ProcessWebhook job en queue `webhooks`
6. [Syncrofact worker] → queue:work procesa el job
   → HTTP POST a tu URL con HMAC firmado
7. [Syncronize backend] → /api/webhooks/syncrofact
   → valida HMAC → resuelve empresa → busca comprobante → UPDATE
8. [Usuario] → abre monitor → ve el comprobante ACEPTADO

Total: ~2-5 segundos desde emitir hasta ver ACEPTADO en el monitor.
```

---

## Troubleshooting

| Problema | Causa probable | Solución |
|----------|----------------|----------|
| `401 Firma inválida` | Secret no coincide | Copiar el secret idéntico en `.env` y panel (64 chars, sin espacios) |
| `400 Raw body no disponible` | Falta `rawBody: true` en `NestFactory.create` | Ya está configurado en `main.ts`. Verificar que no se haya sobreescrito |
| Webhook llega pero no actualiza | `company_id` del payload no mapea | Revisar `ConfiguracionFacturacion.proveedorConfig.companyId` — debe ser un **number**, no string |
| `accion: "no_encontrado"` en logs | El comprobante no existe en BD local con ese `referencia_interna` o `numero` | Verificar que el comprobante se creó antes de emitir |
| Eventos duplicados | Normal. Syncrofact reintenta por 5xx/timeout + cron de respaldo | Idempotencia natural los absorbe |
| Panel de Syncrofact muestra delivery `failed` | Tu endpoint respondió ≠ 2xx o timeout | Revisar logs del backend, revisar que la URL tunnel/prod esté viva |
| Webhook NO se dispara aunque SUNAT ya aceptó | Queue `webhooks` no tiene worker corriendo en Syncrofact | En `docker/supervisord.conf` de Syncrofact, el comando `queue:work` debe incluir `webhooks` en `--queue=default,sunat-send,notifications,webhooks` |
| Botón Test da error | Tu endpoint devuelve 400 porque falta `data.company_id` | Ya manejado: `webhook.test` se ACK con 200 sin requerir `company_id` |
| Crear webhook en panel da 422 | Marcaste `dispatch_guide.created` | Desmarcar — es un evento inválido en el backend Syncrofact |

---

## Estructura del payload de Syncrofact

Referencia completa en `Facturacion Electronica/API-GO-Facturacion-Electronica-sunat-peru/documentacion/webhooks.md`.

### Payload de `invoice.accepted`

```json
{
  "event": "invoice.accepted",
  "timestamp": "2026-04-22T04:05:54-05:00",
  "data": {
    "company_id": 3,
    "referencia_interna": "cmo9lamqb000wgkudgyxq9r5d",
    "document_id": 285,
    "numero": "F002-00000008",
    "serie": "F002",
    "correlativo": "00000008",
    "fecha_emision": "2026-04-22T05:05:53.000000Z",
    "estado_sunat": "ACEPTADO",
    "monto": 200.00,
    "moneda": "PEN",
    "cliente": {
      "razon_social": "CHIMU AGROPECUARIA S.A.",
      "num_doc": "20132373958"
    }
  }
}
```

### Payload de `webhook.test`

```json
{
  "event": "webhook.test",
  "timestamp": "2026-04-22T...",
  "data": {
    "message": "Test webhook delivery",
    "webhook_id": 1,
    "webhook_name": "Syncronize Beta"
  }
}
```

---

## Relación con Opción B (`/consultar-pendientes`)

El endpoint `POST /sunat/comprobantes/consultar-pendientes` (Opción B del plan
original) sigue existiendo y funciona como **fallback complementario**:

- Si cae el backend Syncronize y Syncrofact acumula deliveries fallidos más
  allá del `max_retries`, el usuario puede tocar 🔄 en el monitor para
  reconciliar manualmente via `batch-status`.
- El cron de respaldo de Syncrofact (cada 5 min) reintenta entregas `pending`
  que quedaron fallidas, pero después de cierto tiempo se marcan como
  permanentemente fallidas. El botón manual es el safety net.

Tener ambos mecanismos (push + pull) da resiliencia mayor:

| Escenario | Webhook | Botón 🔄 |
|-----------|---------|----------|
| Uso normal | Auto-update en ~2s | No se usa |
| Backend local caído < 5 min | Syncrofact reintenta, funciona al volver | No hace falta |
| Backend caído > 5 min con eventos perdidos | Cron Syncrofact reintenta `pending` | Reconcilia lo que aún esté en PROCESANDO |
| URL tunnel cambió y webhook quedó con URL vieja | No llega nada | Permite reconciliar hasta arreglar el webhook |
