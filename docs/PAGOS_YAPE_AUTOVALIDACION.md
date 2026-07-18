# Pagos Yape/Plin: detección, match y auto-validación

> Sistema construido el 2026-07-18 para SORTEOS (participaciones del bot de
> WhatsApp). Documentado como **patrón reusable** para el flujo de ventas y
> compras online. Código: `sorteos.service.ts` (match/auto-validación),
> `nombre-match.util.ts` (matcher), `whatsapp-bot.service.ts` (captura),
> `webhooks.service.ts` (entrada), api-yape (`service.ts`/`webhook.ts`).

---

## 1. Filosofía: capas que aceleran, nunca reemplazan

```
Capa 0  VALIDACIÓN MANUAL          ← siempre disponible, siempre manda
Capa 1  CHIP DE SUGERENCIA         ← "este pago parece de este cliente"
Capa 2  AUTO-VALIDACIÓN            ← si TODO calza sin ambigüedad, actúa solo
Capa 3  CONSUMO                    ← un pago usado jamás se reutiliza
```

Regla de oro: **ante cualquier duda, no actuar**. Lo automático solo opera
sobre pendientes y nunca pisa una decisión manual. El peor caso posible es un
falso *negativo* (validas a mano con un tap), jamás un falso positivo.

## 2. Arquitectura

```
[Celular lector]  --POST /api/payments (dev_ key)-->  [api-yape]
   (lee notificaciones Yape/Plin;                        │ parsea texto crudo
    cola local si no hay red)                            │ (parser.ts)
                                                         │
                     ┌── match con CHARGE (monto único con céntimos)
                     │        └─> webhook `payment.confirmed` → VENTAS (ya existía)
                     └── SIN charge (yape "suelto"): status=received
                              └─> webhook `payment.received` → SORTEOS (nuevo)
                                        │ HMAC X-Yape-Signature
                                        ▼
                              [SaaS webhooks.service] → SorteosService.autoValidarPorPagoYape
```

- **api-yape** guarda TODO pago entrante (`payments`, status `received` |
  `confirmed`). Los "sueltos" ahora también avisan al SaaS (`payment.received`,
  mismo canal firmado, `charge: null`). Worker con reintentos/backoff.
- **El SaaS** además puede CONSULTAR pagos on-demand:
  `GET {apiBaseUrl}/api/payments?limit=100&status=received` (account key) —
  usado por las sugerencias (`IntegracionYapeService.listarPagosRecientes`,
  ventana 24 h, resiliente → `[]` si api-yape no responde).

## 3. Qué trae (y qué NO trae) una notificación

| Dato | ¿Viene? | Detalle |
|---|---|---|
| Nombre del titular | ✅ parcial | Yape: nombres + INICIAL del primer apellido ("Sebastiana C."). Plin: a veces completo. |
| Monto | ✅ | El monto del TEXTO manda sobre el parseado del celular. |
| Celular del pagador | ❌ | Ni un dígito. El teléfono NO identifica al pagador. |
| Código de operación | ❌ casi nunca | Solo si viene con etiqueta explícita. |

Consecuencia de diseño: la identidad se resuelve por **nombre + monto +
tiempo**, y por eso conviene capturar el nombre OFICIAL del pagador (por DNI →
RENIEC) cuando un tercero paga.

## 4. Matcher de nombres (`nombre-match.util.ts`)

`nombreCoincideYape(sender, completo)` — cada token del sender debe calzar EN
ORDEN contra las palabras del nombre registrado:
- **Palabra completa**: puede saltar palabras intermedias (segundo nombre omitido).
- **Inicial (1 letra)**: debe calzar con la palabra INMEDIATA (si saltara,
  "R." matchearía el apellido materno de otra persona).
- Solo iniciales → nunca matchea. Tildes/mayúsculas normalizadas (NFD).

`nombresCoinciden(sender, registrado)` — **bidireccional**: cualquiera de los
dos lados puede traer palabras de más (Yape mandó "James Johel Torres Ledezma"
y el bot guardó "James Torres Ledezma"). El sentido inverso exige ≥2 palabras
registradas (un solo nombre de pila no identifica a nadie).

Casos canónicos (testeados):
```
"Sebastiana C."               vs SEBASTIANA CACERES VALENZUELA   → ✓
"Juan Carlos R."              vs JUAN CARLOS RAMOS VEGA          → ✓
"Juan Carlos R."              vs JUAN CARLOS PEREZ RIOS          → ✗ (R ≠ PEREZ)
"Rosa Torres"                 vs ROSA MARIA TORRES DIAZ          → ✓ (salta MARIA)
"James Johel Torres Ledezma"  vs JAMES TORRES LEDEZMA (pagador)  → ✓ (inverso)
"S."                          vs SEBASTIANA CACERES              → ✗
```

## 5. Auto-validación (`autoValidarPorPagoYape`) — los 5 filtros

Un pago auto-valida una participación **solo si pasa TODOS**:

1. **Nombre**: `nombresCoinciden` con el titular O con el `pagadorNombre`
   declarado (capturado por DNI → nombre oficial RENIEC/Migraciones).
2. **Monto EXACTO**: `unidades × precio` al céntimo (compras multi-ticket
   suman). Sin precio configurado → nunca auto.
3. **Tiempo**: pago POSTERIOR al registro (tolerancia 5 min de reloj). El
   flujo legítimo siempre es registrarse → pagar.
4. **Unicidad**: exactamente UNA pendiente calza. Dos homónimos → `ambiguo`,
   nadie se valida, ambos conservan su chip.
5. **No consumido**: `pago.id` no vinculado ya a otra participación
   (`pago-ya-usado`, anti-replay).

Si pasa: `cambiarEstadoParticipante(ACTIVO)` con `registradoPor` = rol STAFF
activo más antiguo de la empresa (**nunca** rol CLIENTE) → ticket correlativo,
confirmación del bot por WhatsApp y (en dinámicas) auto-premio con cuenta del
ganador. Todo el camino es idempotente.

## 6. Consumo (`SorteoParticipante.yapePaymentId`)

Al ACTIVAR (auto o manual), `vincularPagoYape` busca el mejor pago que calce
(preferencia: monto exacto; respeta la ventana del anticipado; excluye ya
usados) y lo estampa en la fila (y sus hermanas de compra). Desde entonces ese
`payment.id` desaparece de sugerencias y auto-validación. **Un yape = una
participación, para siempre.** Best-effort: si api-yape no responde, la
validación no se bloquea (hasta 8 s de espera, luego sigue).

## 7. "Yape en el aire" (pagó ANTES de registrarse)

Flujo del bot (opción **3** tras las instrucciones de pago):
1. Marca `yapeAnticipadoEn` (por compra completa).
2. Pregunta **"¿Quién hizo ese yape?"** — *1 yo mismo* / *2 otra persona*
   (→ número + DNI/CE del pagador → nombre oficial). Texto libre = silencio
   (suele ser la captura).
3. Feedback inmediato: "✅ Encontré tu yape de S/ X" o "buscaré tu yape".

Efecto: las **sugerencias** abren la ventana a pagos ANTERIORES al registro
solo para esa participación, con flag `anticipado` → chip "⚠️ previo al
registro". **JAMÁS se auto-valida** un pago previo: cualquiera pudo ver el
monto en el live y reclamarlo — decisión del admin, siempre.

## 8. Datos

`SorteoParticipante` (columnas del circuito):
- `pagadorNombre` / `pagadorCelular` — tercero que yapea (nombre oficial por DNI).
- `yapeAnticipadoEn DateTime?` — declaró pago previo (mig `20260718230000`).
- `yapePaymentId String?` — pago consumido (mig `20260718233000`, índice
  `[empresaId, yapePaymentId]`).
- `activadoEn`, `direccionConfirmadaEn` — completan el historial visual.

api-yape `payments`: `senderName, amount, provider, status(received|confirmed),
dedupeKey(único), receivedAt, message(crudo)`.

## 9. Superficie de API

| Qué | Dónde |
|---|---|
| Sugerencias para la cola | `GET /sorteos/pagos-yape/sugerencias` (VIEW_VENTAS) → `{sugerencias:[{participanteId, compraId, senderName, amount, provider, receivedAt, montoEsperado, montoCoincide, anticipado}]}` |
| Webhook entrante | `POST /api/webhooks/yape` + `X-Yape-Signature: sha256=hmac(webhookSecret, rawBody)` — eventos `payment.confirmed` (ventas/pedidos/cotizaciones por `charge.reference`) y `payment.received` (sorteos) |
| Pagos on-demand | api-yape `GET /api/payments?status=received&limit=100` (account key) |
| App (chips + historial) | `SorteoDetailCubit._cargarPagosYape` best-effort → `_chipYape` + `_HistorialParticipante` (vive en card de participante Y de premio — en dinámicas el validado se renderiza como premio) |

## 10. 🔁 Cómo reusar esto en VENTAS / COMPRAS ONLINE

Hoy conviven DOS mecanismos complementarios — elegir según el caso:

| | **Charges (monto único con céntimos)** — ya en ventas | **Match por nombre** — nuevo |
|---|---|---|
| Identificación | Determinística (céntimos = token de ruteo) | Probabilística (nombre+monto+tiempo) |
| Requiere | Crear el charge ANTES de que el cliente pague | Nada — el cliente paga el monto "natural" |
| Auto-confirmación | Inmediata y 100 % segura | Solo con match único y exacto |
| Caso ideal | Checkout online, pedido marketplace, cotización (el sistema dicta el monto) | Pago espontáneo, monto redondo, cliente que "ya pagó" |

Recetas concretas:
- **Pedido online abandona el checkout y paga después el monto redondo**: hoy
  el charge expira (TTL 15 min) y el pago queda `received` invisible → aplicar
  la Capa 1: sugerir en el pedido pendiente "💸 Yape de {nombre} por el total
  exacto" (mismo matcher + posterior-a-creación + no-consumido) para confirmar
  con un tap. Auto-confirmar solo si se quiere asumir la política de sorteos.
- **CxC / ventas a crédito**: cuotas suelen ser montos conocidos + cliente con
  nombre RENIEC en BD → match por nombre para sugerir "este yape parece la
  cuota de X" en la cola de cobranzas.
- **Compras/proveedores (nosotros pagamos)**: el parser ya detecta pagos
  SALIENTES (`looksLikeIncomingPayment=false`, hoy descartados) — capturarlos
  sería la base para conciliar egresos. Requiere cambio en api-yape.
- **Reglas NO negociables al reusar**: pago posterior a la intención de
  cobro · monto exacto · match único · consumo del payment.id · manual manda.
  El consumo debería centralizarse (hoy vive en SorteoParticipante; para
  ventas convendría una tabla `pago_conciliado(paymentId único, entidadTipo,
  entidadId)` cross-módulo).

## 11. Resiliencia (por qué no se atasca nada)

- Lector sin red → cola local en el celular, reenvía solo.
- api-yape caído → sugerencias `[]`, validación manual intacta, vinculación
  best-effort.
- SaaS caído al disparar el webhook → worker de api-yape reintenta con backoff.
- Webhook tardío → si la pendiente sigue viva, auto-valida tarde; si ya se
  validó a mano, `sin-pendientes`/`pago-ya-usado` (no-op).
- Carrera manual vs webhook → activación idempotente (ticket conservado,
  auto-premio con check de existencia); peor caso: WhatsApp duplicado.

## 12. Límites conocidos (aceptados)

- Homónimos con mismo monto y ventana → SIEMPRE manual (por diseño).
- El chip se refresca al abrir/recargar el detalle (sin push en vivo — v2
  posible: FCM al recibir `payment.received`).
- El nombre es el que Yape decida mostrar; el matcher tolera variantes pero no
  apodos ("Pepe" ≠ JOSÉ).
- Cobro DENTRO de la plataforma para sorteos (charges + auto-validación
  integral) = Fase B con **gate legal ONAGI** sin resolver.

## 13. Tests que protegen todo esto

- `whatsapp-bot.simulacion.spec.ts` — 35 escenarios e2e del bot (correr ante
  CUALQUIER cambio del bot).
- `sorteos-yape-match.stress.spec.ts` — 10 empresas / 100 participantes / 110
  pagos: 80 auto ✓, 10 ambiguos frenados, 0 cruces.
- `webhooks-yape.service.spec.ts` — 16 casos del webhook (incluye
  `payment.received`).
