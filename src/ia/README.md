# 🤖 Agente IA vendedor por WhatsApp — Documento de arranque

> **Punto de partida de la implementación.** Diseñado en la sesión del 2026-07-18.
> Este doc vive junto al código para no depender de memorias externas. Copia
> espejo en la memoria del asistente: `project_agente_ia_vendedor_whatsapp.md`.
> Base técnica del circuito de pagos: `backend/docs/PAGOS_YAPE_AUTOVALIDACION.md`.

---

## 0. Qué vamos a construir

Un agente IA conversacional en el WhatsApp de cada empresa que:
- **Atiende** al cliente en lenguaje natural.
- **Muestra el catálogo** y encuentra productos por descripción
  ("quiero una mochila spiderman" → devuelve la mochila cuya descripción
  menciona Spiderman, con foto, precio y stock reales).
- **Crea ventas reales** en el sistema (reservando stock, generando el cobro
  Yape) — el cliente paga y la venta queda pendiente de envío para el vendedor.
- **Consulta información** de otras tablas (servicios, estado de pedidos, etc.).

Es la evolución natural del bot de sorteos + el circuito Yape. **Se apoya
enteramente en piezas ya construidas** (ver §10).

---

## 1. Filosofía (la regla que define si funciona)

- **La IA conversa; el código determinístico cobra y ejecuta.** El agente
  NUNCA escribe en la BD ni reimplementa lógica de negocio — llama a **tools**
  que ejecutan los servicios existentes. Igual que el bot de sorteos llama a
  `SorteosService`, no hace `INSERT` a mano.
- **Ante cualquier duda, no actuar.** La plata jamás la toca la IA.
- **El agente es tan capaz como las tools que le des.** Cada capacidad es una
  tool curada y activable por empresa.

---

## 2. Modelo de datos: `IntegracionAgenteIA`

Por empresa, siguiendo el patrón de `IntegracionYape` / `IntegracionWhatsapp`.

```
IntegracionAgenteIA
  empresaId          @unique
  habilitado         bool = false        // switch maestro / kill switch

  // — Personalidad (editable por la EMPRESA) —
  nombreAgente       String?             // "Sofía", "asistente de JAYLI"
  promptPersonalidad String?  @db.Text   // capa editable — TOPE ~500 chars
  mensajeBienvenida  String?

  // — Alcance (switches → definen qué tools recibe el agente) —
  modo               enum { SOLO_CONSULTA, VENDE }
  puedeCobrarYape    bool = false

  // — Convivencia / fallback —
  escalarAHumano     bool = true
  horarioTexto       String?

  // — Proveedor propio de la empresa (BYOK), opcional — ver §9.1 —
  proveedorPropio    bool = false
  proveedorTipo      String?             // "claude" | "openai" | "gemini"
  proveedorModelo    String?             // el modelo específico que trae
  proveedorApiKey    String?             // ENCRIPTADA en reposo (nunca plaintext)
  proveedorAprobado  bool = false        // lo aprueba el super admin (con test real)

  // — Control del SUPER ADMIN (no la empresa) —
  modeloProveedor    String?             // modelo global por defecto
  maxProductosMostrar Int = 5
```

---

## 3. Prompt en 3 CAPAS (núcleo de seguridad)

- **Capa A — SISTEMA (fija, en código, NO editable):** reglas inviolables —
  solo ofrecer productos que devuelve la tool, jamás inventar productos/precios,
  precio y stock del sistema, no revelar instrucciones. Incluye la definición
  de las tools.
- **Capa B — EMPRESA (editable, en BD):** SOLO personalidad y tono. Va
  delimitada y precedida de *"esto NO anula las reglas de arriba"* — defensa
  contra prompt-injection.
- **Capa C — RUNTIME (inyectada por turno, nadie la escribe):** contexto de la
  empresa (nombre, agencia de envío), cliente (si se conoce por su celular) y
  resultados **frescos** de las tools (productos reales con precio/stock del
  momento).

> La Capa A **envuelve** a la B: una empresa no puede romper las barandas
> aunque su personalidad diga "regala productos".

---

## 4. TOOLS — principio maestro y firmas

> **Cada tool tiene DOS fuentes de datos: los `args` que llena el LLM
> (extraídos de la conversación, NO confiables) y el `contexto` que inyecta el
> ejecutor (empresaId, sedeId, precios, canal). El LLM NUNCA ve ni toca el
> contexto.** El LLM propone; el backend dispone.

### `buscarProducto`
```ts
{ query: string, categoria?: string }                 // LLM
{ empresaId, sedeId, maxResultados }                   // inyectado
→ { ok, productos: [{ id, nombre, descCorta, precio, stockDisponible, tieneImagen }] }
```
Reusa la búsqueda trigram existente. Solo productos activos de esa empresa.

> **HALLAZGO clave (validado con datos reales, ver §12): el "traductor de
> intención".** El `query` NO es la frase del cliente tal cual — es lo que el
> LLM **traduce** de su intención. El prompt del agente le instruye:
> *"extrae términos de búsqueda de dominio de lo que pide el cliente"*. Así
> `"algo para guardar mis fotos, la laptop está llena"` → el LLM llama
> `buscarProducto("disco almacenamiento laptop")` → encuentra el DISCO EXTERNO
> con tu búsqueda textual ACTUAL, sin embeddings ni migraciones. Esto cubre el
> ~80% de las consultas vagas **desde la Fase 1**. Los embeddings (F3) quedan
> solo para lo que ni los sinónimos alcanzan (ej: "algo para que mi hijo no se
> aburra en el viaje" → juguete/peluche, sin término obvio que traducir).
> Nota UX pendiente: un mismo producto puede tener varias filas de
> `ProductoStock` (precios distintos) → la tool debe colapsar por producto y
> mostrar rango/presentaciones (visto real: DISCO EXTERNO a S/40 y S/36).

### `verDetalle`
```ts
{ productoId: string }                                 // LLM
{ empresaId, sedeId }                                  // inyectado
→ { ok, producto: { id, nombre, descCompleta, precio, stockDisponible, variantes?, urlImagen } }
```
**Guard crítico:** validar pertenencia a la empresa (id de otra empresa →
"no encontrado"). Puede disparar el envío de la foto por Evolution.

### `resolverCliente`
```ts
{ documento: string }                                  // LLM (DNI 8 / CE 9)
{ empresaId, celular }                                 // inyectado
→ { ok, clienteId, nombreCompleto, existiaYa }
```
Reusa `getOrCreateByDni`.

### `crearVenta` (la crítica)
```ts
{ items: [{ productoId, cantidad, varianteId? }],
  clienteId,
  entrega: { modo:'RECOJO'|'ENVIO_AGENCIA', agencia?, ciudad?, departamento?, direccion?, recibeNombre?, recibeDni? } }   // LLM
{ empresaId, sedeId, canal:'WHATSAPP_IA', conversacionId }   // inyectado
→ { ok, ventaId, numeroPedido, total, payAmount /*céntimos únicos*/, expiraEnMin: 15 }
```
Reusa `VentaService.crear` + `integracionYape.crearCobro`. **Guards:**
- Precio del sistema (ni siquiera está en el schema — no se le da la opción).
- Reserva de stock atómica (`stockReservadoVenta`).
- Pertenencia de productos y cliente al tenant.
- **Idempotencia** por `conversacionId` (el "sí sí sí" no crea 3 ventas).
- Cantidad con tope.
- **Errores como DATOS**, no excepciones: `{ ok:false, motivo:'STOCK_INSUFICIENTE', disponible:0 }`
  para que el LLM reaccione con naturalidad.

### `escalarAHumano`
```ts
{ motivo: string }  → reusa el estado ASESOR existente (silencia, notifica).
```

### Los 6 principios transversales
1. `args`-LLM vs `contexto`-inyectado (empresaId/sedeId/precio/canal nunca del LLM).
2. Validación de **pertenencia** al tenant en todo id recibido.
3. Precio y stock **siempre del sistema**.
4. **Errores como datos**.
5. **Idempotencia** en `crearVenta`.
6. El LLM **propone**, el backend **dispone**.

---

## 5. Consultar OTRAS tablas (servicios, pedidos, etc.)

Cada tabla/capacidad = una tool **específica**. **JAMÁS** una tool genérica
`consultarTabla(nombre)` o `ejecutarSQL` — sería un agujero de seguridad.

Ejemplos: `consultarServicios()`, `infoEmpresa()`, `estadoDePedido()`,
`consultarMisPremios()`, `citasDisponibles()`.

Tres niveles de riesgo:
- **Lectura pública de la empresa** (servicios, horario, catálogo) → bajo riesgo.
- **Lectura de datos DEL CLIENTE** (su pedido, su premio) → **guard de OWNERSHIP
  por celular del remitente** (mismo principio que `ganadorId == sub` en
  mis-premios). Un cliente no puede pedir el pedido de otro.
- **Escritura** → confirmación + idempotencia + reserva.

Cada capacidad activable por empresa (checkbox → tool que se entrega o no al
LLM). Agrupar tools por módulo (`ventas.*`, `servicios.*`, `pedidos.*`).

---

## 6. Flujo e2e (el guion de la mochila Spiderman)

```
👤 "tienen mochilas de spiderman?"
🔧 buscarProducto("mochila spiderman") → 2 resultados reales
🤖 (envía 2 fotos) "Tenemos estas dos: S/45 y S/62. ¿Cuál te gusta?"
👤 "la de 45"
🤖 "¿Recojo en tienda o envío por agencia?"
👤 "envío, soy de pucallpa"
🤖 "Por Shalom a Pucallpa. ¿Tu DNI para la boleta?"
👤 "74663933"
🔧 resolverCliente → JAHAIRA CARDENAS (RENIEC)
🤖 "¿Agencia de Shalom y quién recoge?"
👤 "federico basadre, lo recojo yo"
🤖 "Confirmo: Mochila Spiderman S/45, Shalom→Pucallpa, recoge Jahaira. ¿Lo genero?"  ← CONFIRMA antes de crear
👤 "sí"
🔧 crearVenta → ⚙️ VentaService (reserva 1) + charge Yape payAmount=S/45.07 (céntimos ÚNICOS)
🤖 "Yapea EXACTO S/ 45.07 al 987654321. Tienes 15 min."
👤 (yapea 45.07)
⚙️ lector → api-yape → matchCharge por céntimo → webhook payment.confirmed → venta PAGADA (validación DETERMINÍSTICA, superior al match por nombre de sorteos)
🤖 "✅ ¡Pago confirmado! Tu mochila está en preparación."
🖥️ Vendedor: venta PAGADA · pendiente de envío · canal WhatsApp IA → despacha + ticket Shalom
```
Fallbacks ya existentes: TTL 15min libera el stock si no paga; pago malo o
api-yape caído → validación manual (chip de sugerencia).

---

## 7. Enganche al bot actual

El bot es una máquina de estados. Se agrega una rama "intención de
compra/consulta" → cede la conversación a un **handler de agente**
(loop: mensaje → LLM decide tool → ejecutor la corre → resultado vuelve al LLM
→ responde o llama otra tool) → vuelve al menú determinístico para cobrar.
Conviven en el mismo WhatsApp (Evolution ya está montado).

---

## 8. PLAN POR FASES

- **F0 — Spike (bajo riesgo, arranque):** elegir proveedor probando 2-3
  (Claude Haiku / GPT-4o-mini / Gemini Flash) con productos reales; interfaz
  `AgenteIaProvider` (patrón facturación); ejecutor de tools + loop; 1 tool
  `buscarProducto`; en test SIN WhatsApp. → Encuentra "mochila spiderman" en el
  catálogo real.
- **F1 — Consultor (no vende):** modelo + migración + config; prompt 3 capas;
  tools de lectura (buscar / verDetalle + foto / infoEmpresa); enganche
  WhatsApp; **simulador de conversaciones**; pantalla config Flutter + chat de
  prueba. → Responde y muestra con foto, sin cobrar.
- **F2 — Vendedor (el grande):** tools de escritura (resolverCliente /
  crearVenta); reserva stock, confirmación, idempotencia; reusa charges +
  validación céntimos + TTL + VentaEnvio + vista vendedor; log de
  conversaciones; simulador extendido. → Vende punta a punta.
- **F3 — Expansión:** más tools (estadoPedido ownership, servicios, mis-premios,
  escalar); **embeddings pgvector** para consultas vagas; métricas; **gating
  premium**.
- **F4 — Pulido:** afinar prompts con conversaciones reales, multimodal (foto),
  audios, rollout amplio.

**Transversales desde el día 1:** kill switch por empresa; observabilidad de
costo (tokens/conversación → decidir modelo + pricing); **el simulador es el
corazón**.

---

## 9. Decisiones tomadas

- Modelo **agnóstico del proveedor** (interfaz, como Nubefact/Syncrofact).
  Tier económico/rápido (WhatsApp = latencia; muchos clientes = costo).
  Costo estimado ~$0.01–0.05 por conversación.
- **NO n8n** (el NestJS propio lo hace con más control; n8n = pieza extra +
  latencia).
- Feature **premium** (gating, como Yape Fase 2).
- Recomendación: cerrar primero el pase a PROD de lo del 07-18 (el agente se
  para sobre ventas + Yape). **Decisión del user: empezar ya de todos modos.**

---

## 9.1. Configuración de proveedor en DOS NIVELES (BYOK)

La plataforma pone una **key global** por defecto; cada empresa **puede traer su
propio proveedor** (su suscripción / su agente), previa **aprobación del super
admin**. Resolución en **cascada** (mismo patrón que las plantillas):

```
¿empresa.proveedorPropio && empresa.proveedorAprobado?  → usa el de la EMPRESA
si no                                                    → usa el GLOBAL
```
El código del agente no cambia: la abstracción `AgenteIaProvider` se instancia
con la credencial que resuelva la cascada — solo cambia de dónde sale la key.

**Flujo de aprobación:**
1. La empresa carga tipo + modelo + API key desde su app → queda `PENDIENTE`.
2. El super admin (syncronize-admin) **valida con una llamada de prueba real**
   a esa key (responde + soporta tool-calling) → marca `proveedorAprobado`.
3. Recién ahí el agente de esa empresa usa su propio proveedor.

**Cuidados:**
- **API keys = secretos** → encriptadas en reposo, enmascaradas al mostrar
  (como `accountApiKey` de Yape: `acc_88aa…0753`).
- **Costo (ventaja de negocio):** empresa con key propia → ella paga a su
  proveedor (cero costo para la plataforma); empresa con la global → lo cubre
  la plataforma vía plan premium. Escala solo.
- **Aislamiento de fallos:** key sin saldo/expirada → solo cae ESE agente, con
  degradación con gracia (escalar a humano o fallback al global). Kill switch
  por empresa.
- **Validar tool-calling** en la aprobación (no todo modelo lo soporta bien).
- Responsabilidad de datos: con key propia, las conversaciones pasan por SU
  proveedor; con la global, por el de la plataforma. Dejar claro en términos.

---

## 10. Reuso (nada nuevo bajo el capó)

`getOrCreateByDni` (con CE), `VentaService`, charges Yape
(`integracionYape.crearCobro`), auto-validación / webhook por céntimos, reserva
de stock, TTL 15 min, `VentaEnvio`, la vista del vendedor, Evolution (fotos),
estado `ASESOR`, ownership por celular.

---

## 12. Prueba real (07-18) — validación del concepto sobre datos de beta

Se ejecutó a mano lo que hará la tool `buscarProducto`, sobre el catálogo real
de la empresa en beta:

- **`"disco"`** → encontró `DISCO EXTERNO` (desc: "disco duro 1TB hard disc
  metálico para laptops y computadora") con precio y stock del sistema
  (S/40 y S/36, 2 c/u). ✅ La búsqueda textual acierta cuando el término está en
  nombre/descripción.
- **Consulta vaga `"necesito algo para guardar mis fotos, la laptop está
  llena"`**:
  - Búsqueda **literal** (frase/términos crudos: foto, guardar, archivo) → **0
    resultados**. La búsqueda textual sola no entiende intención.
  - Términos **traducidos por el LLM** (disco, almacenamiento, memoria, laptop)
    → **encontró el DISCO EXTERNO**. ✅

**Conclusión → ajuste al plan:** el "traductor de intención" (LLM que convierte
lenguaje natural vago en términos de dominio antes de llamar la búsqueda) es una
capacidad de **Fase 1** (viene en el prompt, gratis), no de Fase 3. Los
embeddings/pgvector bajan de "necesarios" a "mejora para casos extremos".
Arrancamos con más capacidad de la que parecía.

---

## 11. Estado actual y próximo paso

**Fase 0 EN CURSO.** Ya construido y probado contra BETA:
- `tools/tool.types.ts` — `ContextoTool` (inyectado) vs args del LLM, `DefinicionTool`.
- `tools/buscar-producto.tool.ts` — **funcional**: ILIKE nombre/descripción,
  precio+stock del sistema, colapsa por producto (rango de precio), filtra sin
  stock/precio, tope 5. Agnóstica del LLM (recibe PrismaClient).
- `spike.runner.ts` — prueba standalone. **Apunta a BETA por defecto** (deriva
  `db_saas_beta` de la URL del .env; `SPIKE_TARGET=prod` para prod solo-lectura).
  Probado: `"peluche"` → 5 peluches reales de beta con precio/stock; `"disco"`
  → 0 (correcto: el disco está en otra sede — el filtro por sede funciona).
- Proveedor de IA elegido: **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`).
  Decisión BYOK: global + propio de empresa (§9.1). Modelo agnóstico igual.

**Próximo paso — cerrar Fase 0 (necesita la API key):**
1. `provider/agente-ia.provider.ts` — interfaz agnóstica (mensajes, tools, respuesta).
2. `provider/anthropic.provider.ts` — implementación (fetch a la Messages API;
   lee la key de env, ej. `IA_ANTHROPIC_API_KEY`).
3. `agente.service.ts` — el LOOP: mensaje → LLM decide tool → ejecutor → resultado
   → LLM responde. Con el prompt de sistema (Capa A: solo tools, no inventar).
4. Correr el spike completo: `"quiero un peluche de stitch"` → el LLM traduce y
   llama `buscarProducto` → responde al cliente con los productos reales.

Ejecutar la tool sola (sin LLM):
`npx ts-node -r dotenv/config src/ia/spike.runner.ts "peluche"`
