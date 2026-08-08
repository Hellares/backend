# ⚖️ Configurar un producto que se vende por KG (saco cerrado + granel)

> Cómo dejar listo un producto que se vende **de las dos formas**: el bulto
> cerrado (un saco de 15 kg) y suelto por kilo, con stock y costo separados y
> una operación de apertura que mueve uno al otro.
>
> Escrito el 2026-08-08 después de cargar `ALIMENTO PARA RATON` en beta (24
> variantes: 6 sabores × 2 etapas × saco/granel). Cada ⚠️ y cada 🔴 de este
> documento es un problema que apareció de verdad durante esa carga.

---

## 📐 El modelo, en una línea

**"150 kg" no es una sola cosa.** Un saco cerrado y 15 kg sueltos son dos
artículos con disponibilidad distinta, y abrir un saco es una operación física
que no se deshace sola. Por eso son **dos variantes** del mismo producto:

    ALIMENTO PARA RATON            ← unidad de venta: GRAMO
    ├── ... / SACO 15KG   und      stock 5 sacos      precio S/160    ─┐ abre
    └── ... / GRANEL      g→kg     stock 75 000 g     precio S/11/kg  ←┘ rinde 15000

- El **granel** se guarda en **gramos** (para que el stock entero aguante los
  15 000 de un saco) y se **cobra en kilos** mediante la unidad de presentación.
- El **saco** se vende por **unidad** y tiene su propio precio, no proporcional
  al kilo.
- Al **abrir**, sale 1 saco y entran 15 000 g; el costo viaja con la mercadería
  por promedio ponderado.

---

## 🗺️ Los pasos

### Paso 0 — Los atributos (una vez por empresa)

`/empresa/atributos` (Atributos de producto). Para el caso de alimento:

| Clave | Nombre | Valores |
|---|---|---|
| `etapa` | Etapa | ADULTO · CACHORRO |
| `sabor` | Sabor | CARNE · HIGADO · ZANAHORIA · … |
| `presentacion_venta` | Presentación | **SACO 15KG · SACO 20KG · GRANEL** |

🔴 **El tamaño del saco va como VALOR de "Presentación", no como atributo
aparte.** El generador hace producto cartesiano de todo lo que marques: un
atributo "tamaño" pariría combinaciones como `GRANEL / 20KG`, que no existen. Y
`SACO` a secas tampoco alcanza si un mismo sabor viene en dos tamaños — dos
variantes no pueden compartir combinación de atributos.

Los atributos con `categoriaIds` vacío son **globales** y aparecen en cualquier
categoría.

### Paso 1 — Crear el producto

Unidad de venta: **la chica** (GRAMO). Esa es la unidad en la que se guarda el
stock y se calcula el costo.

⚠️ **El switch "Producto con variantes" solo aparece EDITANDO**
(`producto_tipo_section.dart`). Así que son dos pasos: crear el producto simple
→ guardar → volver a entrar → activar variantes (pide confirmar la conversión).

⚠️ **No configures la unidad de presentación a nivel producto.** El formulario
la esconde para productos con variantes, y el diálogo de precios de la pantalla
de Variantes lee la presentación **propia de la variante**, sin heredar. La
presentación va en cada granel (Paso 3).

### Paso 2 — Generar las variantes, UNA PASADA POR PRESENTACIÓN

Variantes → **Agregar** → **Generar combinaciones**.

| Pasada | Etapa | Sabor | Presentación | Precio base | Costo |
|---|---|---|---|---|---|
| 1 | todas | todos | **solo GRANEL** | vacío | **vacío** |
| 2 | las que apliquen | los que vengan en 15 kg | **solo SACO 15KG** | precio del saco | costo del saco |
| 3 | las que apliquen | los que vengan en 20 kg | **solo SACO 20KG** | precio del saco 20 | su costo |

Por qué en pasadas separadas:

- El precio base **se copia igual a todas las variantes de la pasada y a todas
  las sedes**. Separando, cada grupo nace con su precio correcto.
- No se crean combinaciones que no existen: si POLLO no viene en 20 kg,
  simplemente no lo marcás en la pasada 3.
- Tope de **50 combinaciones por pasada**.

Notas:

- **Precio base es opcional** (desde `24dac46`). Vacío ⇒ la variante nace con
  `precioConfigurado = false` y se muestra como SIN PRECIO, que es lo correcto
  hasta que le pongas el suyo. El piso es `0.000001`: un precio por gramo
  sub-céntimo entra sin problema.
- 🔴 **El costo del granel NO se carga a mano.** Lo escribe la apertura por
  promedio ponderado. Cargarlo a dedo lo mezcla con el real y ensucia el margen.
  Única excepción: que ya tengas granel suelto antes de la primera apertura.
- Stock inicial: **Sin stock**. El reparto equitativo es entero y el granel
  entra por apertura, no a mano.

### Paso 3 — Cada variante GRANEL

- **Unidad de venta: vacía** (hereda el gramo del producto).
- **UNIDAD DE PRESENTACIÓN → kg, factor 1000.**

Con eso el stock se lee `15 kg` en vez de `15000` y el precio se cobra por kilo.
Sin eso, el diálogo de precios te pide el precio **por gramo** en un campo de
moneda de 2 decimales: `0.015` no se puede escribir.

### Paso 4 — Cada variante SACO

- **Unidad de venta: UNIDAD.**
- **AL ABRIR ESTE BULTO** → destino: el granel del **mismo sabor y misma
  etapa**; rendimiento: **15000** (entero obligatorio, en unidad de venta del
  destino).

La vista previa tiene que decir `−1 → +15000 (15 kg)`. **Si no aparece el
"(15 kg)" entre paréntesis, elegiste un destino que no es granel.**

⚠️ Hacé los graneles ANTES que los sacos: ese "(15 kg)" solo se muestra si el
destino ya tiene su presentación, y es la red que atrapa un `15` escrito donde
va `15000`.

🔴 El backend rechaza que un bulto se abra en otro bulto (desde `dcbf617`), pero
igual mirá el nombre completo antes de guardar: con 6 sabores hay 11 hermanas
cuyos nombres solo se diferencian al final.

### Paso 5 — Precios

- **Saco**: precio por unidad. Si lo pusiste en la pasada de generación, ya está.
- **Granel**: acción **Precio** en la card de la variante. Ahora el campo dice
  "(por kg)": escribís `15.00` y guarda `0.015` por gramo.
  El bloque **DE DÓNDE SALE ESTE COSTO** te muestra
  `S/149.00 ÷ 15 kg = S/ 9.93/kg` con un botón **Usar**, para fijar el precio
  con el margen a la vista.

⚠️ El diálogo de precios trabaja **por sede**. Si tenés dos sedes y solo
configurás una, en la otra el granel queda sin precio.

### Paso 6 — Stock mínimo en los graneles

Sin `stockMinimo` la alerta "abrí un saco" **nunca salta** y te enterás de que
no hay suelto con el cliente enfrente. En gramos: `3000` = 3 kg.

### Paso 7 — Comprar

Se compran **sacos**, por unidad. El granel **no se compra**: entra abriendo.

La línea de compra muestra el costo actual, el proyectado, el precio de venta y
el margen de la variante, y prellena el precio con el **costo** (no con el de
venta).

### Paso 8 — Abrir bultos

Menú → Abrir bulto, o desde el POS cuando no alcanza el granel. Sale 1 saco,
entran 15 000 g y el costo se reparte por promedio ponderado.

---

## ✅ Checklist antes de vender

```sql
-- Configuración de las variantes (unidad, presentación, apertura)
SELECT v.nombre,
       COALESCE(uv."simboloPersonalizado", mv.simbolo, '(hereda)') AS unidad,
       COALESCE(up."simboloPersonalizado", mp.simbolo, '-')        AS presentacion,
       v."factorPresentacion" AS factor,
       d.nombre AS abre_en,
       v."rendimientoApertura" AS rinde
FROM "ProductoVariante" v
LEFT JOIN "EmpresaUnidadMedida" uv ON uv.id = v."unidadMedidaId"
LEFT JOIN "UnidadMedidaMaestra"  mv ON mv.id = uv."unidadMaestraId"
LEFT JOIN "EmpresaUnidadMedida" up ON up.id = v."unidadPresentacionId"
LEFT JOIN "UnidadMedidaMaestra"  mp ON mp.id = up."unidadMaestraId"
LEFT JOIN "ProductoVariante"     d  ON d.id  = v."varianteAperturaId"
WHERE v."productoId" = '<productoId>' AND v."deletedAt" IS NULL
ORDER BY v.orden;
```

| Qué mirar | Valor esperado |
|---|---|
| Granel: unidad | `(hereda)` |
| Granel: presentación / factor | `kg` / `1000` |
| Granel: **atributo Presentación** | **`GRANEL`** ← el que más se olvida |
| Saco: unidad | `und` |
| Saco: abre_en | el granel **del mismo sabor y etapa** |
| Saco: rinde | `15000` (entero) |

```sql
-- Atributos de cada variante: los tres tienen que estar en TODAS
SELECT v.nombre, string_agg(a.clave || '=' || av.valor, ' | ' ORDER BY a.clave)
FROM "ProductoVariante" v
JOIN "ProductoAtributoValor" av ON av."varianteId" = v.id
JOIN "ProductoAtributo"      a  ON a.id = av."atributoId"
WHERE v."productoId" = '<productoId>' AND v."deletedAt" IS NULL
GROUP BY v.id, v.nombre, v.orden ORDER BY v.orden;
```

---

## 🔴 Los errores que ya pasaron

### 1. El granel no aparece en el sheet de venta

**Causa**: las variantes granel no tienen el atributo `Presentación = GRANEL`.

Es el error más caro de diagnosticar porque *parece* un problema de stock. El
selector arma sus grupos con los atributos de **todas** las variantes: como los
sacos traen `Presentación`, el grupo existe, pero su única opción es
`SACO 15KG`. Y en `_coincide` una variante **sin** ese atributo nunca matchea:

```dart
final match = v.atributosValores.where((a) => a.atributo.clave == entry.key).map((a) => a.valor);
if (match.isEmpty || match.first != valor) return false;   // ← sin el atributo, fuera
```

Encima `_varianteResuelta` exige un valor elegido en **cada** grupo, así que
tampoco se puede dejar en blanco. **El granel queda inalcanzable, tenga el stock
que tenga.**

**Se evita** generando la pasada 1 con la Presentación marcada en GRANEL. Si ya
pasó, se arregla agregándoles el atributo (12 ediciones a mano, o el SQL de
abajo) y bumpeando `actualizadoEn`.

### 2. Los cambios no llegan al celular

El app sincroniza el catálogo **por delta sobre `Producto.actualizadoEn`**. Un
cambio en `ProductoVariante`, `ProductoAtributoValor` o `ProductoStock` que no
toque la fila `Producto` **no se baja nunca**. Después de cualquier fix por SQL:

```sql
UPDATE "Producto" SET "actualizadoEn" = timezone('UTC', now()) WHERE id = '<productoId>';
```

🔴 **`timezone('UTC', now())`, no `now()`**: el sello local retrocede 5 horas y
el cambio no llega, sin ningún error visible.

Y flushear Redis, porque el listado del catálogo está cacheado:

```bash
ssh root@86.48.26.221 'PASS=$(grep "^REDIS_URL=" /opt/syncronize/deploy/stack.beta.env | sed -E "s|.*default:([^@]+)@.*|\1|"); docker exec redis-beta redis-cli -a "$PASS" --no-auth-warning FLUSHDB'
```

### 3. Un saco abriéndose en otro saco

Pasó con `CACHORRO / POLLO`, que quedó apuntando al **saco** de ADULTO/POLLO en
vez de a su granel. Abrirlo habría sumado **15 000 sacos** al inventario y
dejado el costo del destino en S/0.0099 en vez de S/149.

Hoy el backend lo rechaza en las dos direcciones (`dcbf617`), pero la señal
visual sigue siendo la misma: **si la vista previa no muestra el "(15 kg)", el
destino está mal.**

### 4. El producto aparece en sedes donde no existe

Si se borran **todas** las variantes de un producto, la consulta que deduce las
sedes se queda sin filas (filtra `deletedAt: null`) y el stock nuevo se creaba
en **todas las sedes activas**. Arreglado en `dacdc31`: ahora cae a
`Producto.sedeId` antes de recurrir a "todas".

### 5. Comprar el granel en vez del saco

En el buscador de compras aparecen las 24 variantes. Si elegís un granel, la
cantidad se pide **en gramos** — 15000 por saco. Comprá siempre la variante
SACO.

### 6. El costo del granel se desvía

Se cargó un costo a mano en el granel, o se compró el saco a un precio distinto
del que tenía. Las dos cosas mueven el promedio ponderado. El costo del granel
**debe** salir de la apertura.

---

## 🔧 SQL de reparación: agregar `Presentación = GRANEL` a los graneles

Idempotente (el `NOT EXISTS` respeta el `@@unique([varianteId, atributoId])`) y
con el bump en la misma transacción.

```sql
BEGIN;
INSERT INTO "ProductoAtributoValor"
  (id, "varianteId", "atributoId", valor, "creadoEn", "actualizadoEn")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
       v.id, a.id, 'GRANEL',
       timezone('UTC', now()), timezone('UTC', now())
FROM "ProductoVariante" v
CROSS JOIN (SELECT id FROM "ProductoAtributo" WHERE clave = 'presentacion_venta') a
WHERE v."productoId" = '<productoId>'
  AND v."deletedAt" IS NULL
  AND v.nombre NOT ILIKE '%SACO%'
  AND NOT EXISTS (
    SELECT 1 FROM "ProductoAtributoValor" av
    WHERE av."varianteId" = v.id AND av."atributoId" = a.id
  );
UPDATE "Producto" SET "actualizadoEn" = timezone('UTC', now())
WHERE id = '<productoId>';
COMMIT;
```

Después: **flush de Redis** y cerrar/reabrir la app.

⚠️ **Verificá la clave del atributo antes de correrlo.** El formulario la deriva
del nombre, y una tilde la parte: al renombrar "Presentación" en beta la clave
quedó como **`presentaci_n`**, no `presentacion_venta`. Confirmala con
`SELECT clave, nombre, valores FROM "ProductoAtributo" WHERE nombre ILIKE '%present%';`

⚠️ Agregar el atributo **no cambia el nombre** de la variante, que ya está
guardado. Si querés que el comprobante diga GRANEL hay que editar el nombre
aparte — y ojo, el nombre viaja al comprobante como `PRODUCTO - VARIANTE`.

---

## 📄 Cómo sale en el comprobante

Cada línea se declara en **su** unidad de presentación, y las tres —comprobante,
nota de crédito y guía— tienen que coincidir. Una boleta con las dos formas del
mismo producto sale así:

```
1.000 NIU   SACO 15KG      @ 160.00
5.000 KGM   GRANEL         @  15.00
```

El código SUNAT sale de `unidadMaestra.codigo` de la unidad que corresponda. Sin
la configuración de este documento, el saco saldría declarado como `1 KGM` —
SUNAT lo acepta igual, y el documento queda mal.

---

## 📚 Relacionados

- `backend/docs/DEPLOY_BETA_PROD.md` — deploy y gotchas de infraestructura
- `backend/docs/SISTEMA_STOCK.md` — modelo de stock por sede
- `src/apertura-bulto/` — endpoints `abrir`, `cerrar` y `disponibles`
- `src/common/utils/unidad-presentacion.util.ts` — la regla de qué unidad se
  declara (`presentacionDeProducto` / `presentacionDeVariante`)
