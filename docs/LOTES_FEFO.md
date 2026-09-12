# Lotes que se consumen de verdad (FEFO) — Fase 1

> Motor de consumo de lotes. Base para el control de VENCIMIENTOS (Fase 2).
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

Para cada `ProductoStock`: **Σ `cantidadActual` de sus lotes ACTIVO =
`stockActual`**. Todo el diseño existe para sostenerla — por eso una entrada
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

## Lo que falta (Fase 2)

- `Producto.tipoVencimiento`: `NINGUNO` | `CONSUMO_PREFERENTE` | `CADUCIDAD`
- `Producto.diasVidaUtil`, `Producto.diasAlertaVencimiento`
- Capturar `Lote.fechaVencimiento` en la línea de compra
- **CADUCIDAD → bloqueo duro, sin autorización** (decisión del 12-09: vender
  vencido no es una decisión comercial que un gerente pueda tomar; la única
  salida es corregir la fecha del lote, que es otro permiso y deja rastro)
- **CONSUMO_PREFERENTE → autorización gerencial**, como la venta bajo costo
- Fase 3: cron que marque `MotivoLiquidacion.PROXIMO_A_VENCER` — el enum y la
  exención del guard de bajo costo **ya existen**
