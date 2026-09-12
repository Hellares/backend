# Lotes que se consumen de verdad (FEFO) + vencimientos

> Fase 1: el motor de consumo. Fase 2: el control de vencimientos.
> Escrito 2026-09-12.

## El problema que arregla

`consumirLotesFIFO` existía en `lote/lote.service.ts` y **no la llamaba nadie**.
Consecuencia: `Lote.cantidadActual` nunca bajaba al vender. En prod, los 122
lotes estaban en `cantidadActual = cantidadInicial`, el 100%.

Dos daños concretos:

1. No se podía saber de qué lote salió una unidad → **imposible controlar
   vencimientos**, que es a dónde vamos.
2. `compra.service.ts:881` bloquea anular una compra si
   `cantidadActual < cantidadInicial` ("X unidades vendidas/consumidas"). Como
   nunca bajaban, **ese candado no protegía de nada**: dejaba anular una compra
   cuya mercadería ya se había vendido.

## Qué se construyó

| pieza | dónde |
|---|---|
| Tabla puente `MovimientoStockLote` | `prisma/schema/stock.prisma` |
| Motor FEFO + devolución + lote de entrada | `src/producto-stock/lote-consumo.helper.ts` |
| Enganche | `src/producto-stock/movimiento-stock.helper.ts` |
| Conciliación de una vez | `scripts/conciliar-lotes.ts` |
| Tests | `src/producto-stock/lote-consumo.spec.ts` |

### Por qué una tabla puente y no un `loteId`

Una sola salida puede comer de **varios** lotes: se venden 5, el lote nuevo
tiene 3 y las otras 2 salen del anterior. Con una columna suelta habría que
partir el movimiento o mentir sobre el origen de la mitad.

Es también lo que permite revertir con exactitud: una devolución vuelve a los
lotes de los que salió, **con su vencimiento y su costo**.

### Un solo punto de enganche

Los 43 call sites del sistema pasan por
`crearMovimientoStockConValoracion` — venta, devolución, transferencia, merma,
ajuste, apertura de bulto, combos, marketplace, sorteos. Ninguno se tocó.

(La única excepción, `producto-variante.service.ts:1668`, mueve `cantidad: 0`:
es un registro de auditoría de migración, no mercadería.)

### FEFO, no FIFO

*First Expired, First Out*: sale primero lo que **vence** antes. En perecederos
el FIFO puro es incorrecto — deja adentro el que caduca la semana que viene
solo porque llegó después. Entre lotes sin vencimiento el desempate es por
antigüedad, o sea que ahí FEFO degenera en FIFO, que es lo correcto.

### 🔴 Lo que NO cambia: el costeo

El kardex valora TODA salida con el **costo promedio ponderado** del
`ProductoStock`. Acá solo se mueven cantidades. Si algún día se costea por
lote, el COGS histórico deja de poder sumarse con el nuevo.

### La invariante

Para cada `ProductoStock`: **Σ `cantidadActual` de sus lotes PRESENTES
(ACTIVO + VENCIDO) = `stockActual`**. Todo el diseño existe para sostenerla — por eso una entrada
sin lote al que volver **crea** uno (código `AJU-<movimientoId>`).

---

## 🔴 Encendido — el orden NO es negociable

El motor arranca **apagado** (`LOTES_FEFO_ENABLED`). Encenderlo antes de
conciliar haría que el consumo reparta mercadería que ya se vendió, porque los
lotes históricos tienen `cantidadActual` inflado.

```bash
# 1. Deploy del código (el motor queda APAGADO: la env todavía no existe)
ssh root@86.48.26.221 "/opt/syncronize/deploy/deploy.sh beta"
ssh root@86.48.26.221 "docker exec syncronize-backend-beta npx prisma migrate deploy"

# 2. SIMULACRO de la conciliación — no escribe nada, imprime el antes/después
ssh root@86.48.26.221 "docker exec syncronize-backend-beta npx ts-node scripts/conciliar-lotes.ts"

# 3. Revisar la tabla. Recién si cuadra:
ssh root@86.48.26.221 "docker exec syncronize-backend-beta npx ts-node scripts/conciliar-lotes.ts --aplicar"

# 4. AHORA sí, prender: agregar a /opt/syncronize/deploy/stack.beta.env
#      LOTES_FEFO_ENABLED=true
#    y recrear el contenedor (la env se toma al recrear, ver gotcha 5 del runbook)

# 5. Verificar con una venta real: los lotes tienen que BAJAR
```

### Qué hace la conciliación

- **Lotes de MÁS que el stock** → descuenta el excedente en orden FEFO. Son las
  ventas pasadas que nunca se descontaron.
- **Lotes de MENOS** → crea un **lote de apertura** por la diferencia, al costo
  promedio. Es el stock que entró por ajuste o carga masiva.

🔴 El lote de apertura se crea con `fechaIngreso` **un día ANTERIOR** al lote
más viejo del producto. Si quedara como el más reciente **rompería "vender a
costo"**, que lee el último lote para cobrar el costo de la última factura:
pasaría a cobrar el promedio.

No toca `stockActual` ni `precioCosto`: el stock y el costeo son la verdad, los
lotes se acomodan a ellos.

## ⚠️ Cambio de comportamiento al encender

**Anular una compra cuya mercadería ya se vendió va a empezar a fallar** — que
es lo correcto y era el objetivo, pero es distinto de lo que pasaba ayer. Si
alguien lo reporta como bug, no lo es.

## Apagar

`LOTES_FEFO_ENABLED=false` y recrear. Los lotes quedan donde estén; al volver a
prender conviene correr la conciliación otra vez, porque las ventas hechas con
el motor apagado no descontaron lotes.

## Fase 2 — vencimientos (hecha)

| pieza | dónde |
|---|---|
| `TipoVencimiento` + campos de política | `Producto` |
| La FECHA, por entrega | `CompraDetalle.fechaVencimiento` → `Lote` al confirmar |
| Guard de la venta | `venta.service.validarVencimientos` |
| Tests | `venta-vencimientos.spec.ts` |

🔑 **La fecha NO vive en `Producto`**: vive en el LOTE. Un producto no vence,
vence cada lote — dos compras de la misma leche vencen distinto. En `Producto`
va solo la política: `tipoVencimiento`, `diasVidaUtil` (sugiere la fecha al
recibir) y `diasAlertaVencimiento`.

🔴 **El corte no es "perecedero sí/no"**, es la distinción de DIGESA/INDECOPI:

- **CADUCIDAD** ("no consumir después de"): **bloqueo duro, SIN autorización**.
  No es una decisión comercial que un gerente pueda tomar, y una puerta abierta
  "por si acaso" se usa un viernes a la noche. La salida es dar de baja por
  merma o corregir la fecha del lote.
- **CONSUMO_PREFERENTE** ("mejor antes de"): **autorización gerencial**, igual
  que la venta bajo costo.

El guard corre en los **cuatro** flujos de venta (create, crearYCobrar,
cotización→venta y edición de borrador) y usa el mismo `planificarFefo` que
consume: mira las unidades que VAN A SALIR, no "si el producto tiene algún
lote vencido por ahí".

### 🔴 VENCIDO cuenta para la invariante

Ya existía un cron que marca lotes `VENCIDO` (`marcarLotesVencidos`). Si el
consumo excluyera ese estado, el stock vencido quedaría sin lote que lo
respalde y `Σ lotes = stockActual` se rompería sola el día que se carguen
fechas. Por eso el pool de consumo es **ACTIVO + VENCIDO**
(`ESTADOS_LOTE_PRESENTE`): la mercadería sigue en el estante, y si se vende o
no lo decide la política, no el estado del lote.

Corolario: una devolución **no resucita** un lote VENCIDO a ACTIVO. Solo lo
AGOTADO vuelve.

## Revisión del 12-09 — cuatro arreglos de fondo

**Un vencimiento es un DÍA, no un instante.** Se guarda como medianoche UTC
del día del envase; compararlo contra `new Date()` lo daba por vencido desde
las 19:00 del día ANTERIOR en Lima. Todo pasa por `date-utils`:
`aFechaCalendario` (normaliza lo que manda cada cliente), `estaVencido`
(juzga por día en Perú) e `inicioDeHoyCalendario` (umbral para queries). En la
web, `diasParaVencer` y `formatearDiaCalendario`. 🔴 Nunca `new Date(iso)`
sobre una fecha de vencimiento.

**Mover stock entre sedes hereda el lote.** `Lote.loteOrigenId` (migración
`20260912100000_lote_origen`, aditiva). La distribución de una compra copia
vencimiento y número de lote al lote destino; una transferencia recibida
replica en destino las asignaciones de la salida (`heredarLotesDeTransferencia`):
un lote por lote de origen, con su fecha, costo y proveedor, código
`<origen>/<sede>`. Una segunda recepción SUMA al ya heredado; una transferencia
que vuelve a origen es una devolución. Si la salida no dejó asignaciones (se
envió con el motor apagado), entra como `AJU-` igual que antes.

**El costo se cotiza por LÍNEA (producto + lote).** `claveDeLinea`. Dos líneas
del mismo producto con lotes distintos son dos costos. Lo elegido a mano se
sirve primero, lo automático toma lo que queda, y la venta consume en ese
mismo orden (`pendingUpdates` ordenado con los lotes elegidos adelante).

**Si el lote elegido ya no está, 409 `LOTE_NO_DISPONIBLE`.** Nunca se cae a
FEFO en silencio: ni en el precio (`resolverLineaACosto`, si el lote no
encabeza el plan) ni en el consumo (si el lote no existe o no tiene unidades,
también a precio de lista). La web devuelve la línea a automático y recotiza.

## Fase 3 — lo que pasa solo cada día (hecha)

`VencimientoTasksService` (`producto-stock/vencimiento-tasks.service.ts`),
cron a las **05:10 UTC = 00:10 Lima**, solo con `LOTES_FEFO_ENABLED=true` y
solo para las empresas con algún producto que controle vencimiento:

1. **Marca VENCIDO** el lote ACTIVO cuyo día ya pasó (por calendario en
   Perú). Sigue contando para el stock; sacarlo es dar de baja.
2. **Liquidación automática**: si el producto tiene
   `descuentoVencimientoPct` (nuevo, migración
   `20260912120000_producto_descuento_vencimiento`) y el primer lote de la
   fila entra en la ventana de alerta (`diasAlertaVencimiento`, 30 por
   defecto), el stock de esa sede pasa a liquidación con ese % sobre el
   precio de venta, motivo `PROXIMO_A_VENCER` y **sin autorizador** — eso la
   distingue de una manual con el mismo motivo, que nunca se toca. Se cierra
   sola cuando ya no queda lote en la ventana (se vendió, se dio de baja, se
   corrigió la fecha). No pisa una liquidación que ya está. Sin % solo avisa.
   ⚠️ No escribe `ProductoPrecioHistorialSede` (exige usuario); el rastro va
   en `observacionesLiquidacion`.
3. **Avisa** a EMPRESA_ADMIN / SEDE_ADMIN (notificación SISTEMA), una vez por
   día y solo si hubo algo.

Para probar sin esperar a la medianoche: `POST /producto-stock/vencimientos/procesar`
(MANAGE_PRODUCTS) corre lo mismo para la empresa del tenant y devuelve el
resumen. Es idempotente.

El % se configura en la ficha del producto (web y app), al lado de "Avisar
(días antes)".

⚠️ Tensión conocida: `enLiquidacion`/`precioLiquidacion` viven en
`ProductoStock` (producto + sede), **no en el lote**. Con dos lotes y uno por
vencer, se rebajan los dos. Se decidió convivir con eso — con FEFO el que vence
sale primero igual; moverlo a `Lote.precioLiquidacion` obligaría a tocar
`calcularPrecioSegunCantidad`, que es donde vive el 409.
