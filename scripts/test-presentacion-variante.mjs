#!/usr/bin/env node
/**
 * Verificación de la FASE 0 contra BETA — la presentación se resuelve por
 * par producto+variante, no por producto.
 *
 * QUÉ PRUEBA
 * ----------
 * `resolverPresentaciones` pasó de indexar por `productoId` a indexar por
 * `clavePresentacion(productoId, varianteId)`. Si esa clave no coincidiera
 * entre quien LLENA el mapa y quien lo CONSULTA, todas las líneas de variante
 * caerían a `sinPresentacion()` → NIU, en silencio: sin error, sin log, y con
 * el comprobante aceptado. Este script fuerza el caso que lo distingue.
 *
 * El producto se crea en PR (par). Su variante NO declara unidad propia, así
 * que tiene que HEREDAR la del producto:
 *
 *   mapa acierta → la línea se declara PR
 *   mapa falla   → la línea se declara NIU   ← regresión
 *
 * Con un producto en NIU los dos caminos dan lo mismo y la prueba no vale;
 * por eso hace falta una unidad que no sea NIU.
 *
 * POR QUÉ TICKET Y NO BOLETA
 * --------------------------
 * El snapshot (`codigoUnidadSunat`, `factorPresentacion`,
 * `unidadPresentacionSimbolo`) se graba en `VentaDetalle` en TODA venta, salga
 * comprobante o no, y sale del mismo mapa que alimenta al comprobante. Con
 * TICKET alcanza para el veredicto y no se quema un correlativo de boleta.
 *
 * USO (PowerShell)
 * ----------------
 *   $env:CRED='email'; $env:PASS='password'; node scripts/test-presentacion-variante.mjs
 *
 * Opcionales: $env:BASE_URL, $env:TENANT_ID, $env:SEDE_ID
 *             $env:LIMPIAR='1'  → borra el producto de prueba al terminar
 *
 * Requiere CAJA ABIERTA del usuario en la sede (igual que cualquier venta POS).
 */

const BASE = process.env.BASE_URL ?? 'https://saas-beta.syncronize.net.pe/api';
const CRED = process.env.CRED;
const PASS = process.env.PASS;
const SEDE_ID = process.env.SEDE_ID ?? 'cmopb5ro0000c01nwcpizvmuc';
const LIMPIAR = process.env.LIMPIAR === '1';

/** EmpresaUnidadMedida "PR" (par) de la empresa de pruebas beta. */
const UNIDAD_PR = process.env.UNIDAD_PR ?? 'cmptceaxu000q01o61nguf4zq';

if (!CRED || !PASS) {
  console.error('Faltan credenciales: $env:CRED y $env:PASS');
  process.exit(1);
}

let TOKEN = '';
let TENANT = '';
let USER_ID = '';

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(TENANT ? { 'x-tenant-id': TENANT } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* respuestas vacías */ }
  return { status: res.status, data };
}

const exigir = (r, que) => {
  if (r.status >= 400) {
    throw new Error(`${que} falló (${r.status}): ${JSON.stringify(r.data)}`);
  }
  return r.data;
};

async function login() {
  const data = exigir(
    await api('POST', '/auth/login', { credencial: CRED, password: PASS }),
    'login',
  );
  TOKEN = data.accessToken;
  USER_ID = data.user?.id;
  TENANT = data.tenant?.id ?? process.env.TENANT_ID ?? 'cmopb5rkv000701nweavtybvt';
  console.log(`✓ login — user=${USER_ID} tenant=${TENANT}`);
}

async function main() {
  await login();

  // Modo REUSAR: con PRODUCTO_ID/VARIANTE_ID/STOCK_ID en el entorno se salta
  // la creación y se vende sobre datos ya preparados. Sirve para no dejar un
  // producto huérfano por cada intento mientras se afina el script.
  if (process.env.PRODUCTO_ID) {
    const productoId = process.env.PRODUCTO_ID;
    const objetivo = { id: process.env.VARIANTE_ID, nombre: 'TALLA A' };
    const stockId = process.env.STOCK_ID;
    console.log(`↻ reusando producto ${productoId} / variante ${objetivo.id}`);
    await prepararYVender({ productoId, objetivo, stockId, nombre: 'TEST-VARIANTE-PR (reuso)' });
    return;
  }

  const sufijo = Date.now().toString().slice(-6);
  const nombre = `TEST-VARIANTE-PR-${sufijo}`;

  // 1. Producto en PR (par). La unidad NO-NIU es lo que hace que la prueba
  //    distinga entre acierto y falla del mapa.
  const producto = exigir(
    await api('POST', '/productos', {
      empresaId: TENANT,
      nombre,
      unidadMedidaId: UNIDAD_PR,
      sedesIds: [SEDE_ID],
      // Sin esto, POST /productos/:id/variantes responde 400 "El producto no
      // tiene variantes habilitadas".
      tieneVariantes: true,
      descripcion: 'Producto desechable para verificar la fase 0. Borrar.',
    }),
    'crear producto',
  );
  const productoId = producto.id ?? producto.data?.id;
  console.log(`✓ producto ${nombre} — ${productoId} (unidad PR)`);

  // 2. Dos variantes SIN unidad propia → tienen que heredar PR del producto.
  const variantes = [];
  for (const talla of ['TALLA A', 'TALLA B']) {
    const v = exigir(
      await api('POST', `/productos/${productoId}/variantes`, {
        nombre: talla,
        sku: `TVP-${sufijo}-${talla.replace(/\s+/g, '')}`,
      }),
      `crear variante ${talla}`,
    );
    const vid = v.id ?? v.data?.id;
    variantes.push({ id: vid, nombre: talla });
    console.log(`✓ variante ${talla} — ${vid} (sin unidad propia)`);
  }

  const objetivo = variantes[0];
  const stockId = await buscarStockDeVariante(productoId, objetivo.id);
  await prepararYVender({ productoId, objetivo, stockId, nombre });
}

/**
 * ID de la fila de ProductoStock de una variante en la sede.
 *
 * Cuesta más de lo que parece, y las dos vías obvias NO sirven:
 *
 * - `GET /producto-stock/sede/:sedeId?search=<nombre del producto>` es CIEGO a
 *   las variantes: sus filas tienen `productoId` en NULL (el XOR del modelo)
 *   y el filtro por nombre va por el join a Producto, que para ellas no
 *   existe. Devuelve solo la fila base.
 * - `GET /producto-stock/producto/:id/todas-sedes?varianteId=` responde 400
 *   "Solo se debe enviar productoId o varianteId, no ambos".
 * - `GET /productos/:id` sí baja `variantes[].stocksPorSede`, pero esas
 *   entradas NO traen `id` — solo sedeId, cantidad y precios. Con eso no se
 *   puede llamar a ningún endpoint que reciba el id del stock.
 *
 * Queda paginar el listado por sede SIN `search`, que sí incluye las filas de
 * variante con su id.
 */
async function buscarStockDeVariante(productoId, varianteId) {
  const LIMIT = 200;
  for (let offset = 0; ; offset += LIMIT) {
    const resp = exigir(
      await api('GET', `/producto-stock/sede/${SEDE_ID}?limit=${LIMIT}&offset=${offset}`),
      'listar stock de la sede',
    );
    const filas = Array.isArray(resp) ? resp : resp.data ?? [];
    const fila = filas.find((s) => s.varianteId === varianteId);
    if (fila) return fila.id;
    if (!resp.meta?.hasNext || filas.length === 0) break;
  }
  throw new Error(
    `no encontré la fila de stock de la variante ${varianteId} en la sede ${SEDE_ID}`,
  );
}

/** Fija precio y stock, vende una unidad y dictamina. */
async function prepararYVender({ productoId, objetivo, stockId, nombre }) {
  exigir(
    await api('PATCH', `/producto-stock/${stockId}/precios`, { precio: 50, precioCosto: 30 }),
    'fijar precio de la variante',
  );
  exigir(
    await api('PUT', `/producto-stock/${stockId}/ajustar`, {
      tipo: 'AJUSTE_ENTRADA',
      cantidad: 10,
      motivo: 'carga inicial del producto de prueba de la fase 0',
    }),
    'cargar stock de la variante',
  );
  console.log(`✓ stock 10 @ S/50.00 para ${objetivo.nombre} (stockId ${stockId})`);

  const cliente = exigir(await api('GET', '/clientes/generico'), 'cliente genérico');
  const clienteId = cliente.id ?? cliente.data?.id;

  // 4. Venta TICKET de 1 unidad de la variante.
  const venta = exigir(
    await api('POST', '/ventas/cobrar', {
      canalVenta: 'POS',
      sedeId: SEDE_ID,
      vendedorId: USER_ID,
      clienteId,
      nombreCliente: 'CLIENTES VARIOS',
      documentoCliente: '00000000',
      moneda: 'PEN',
      tipoComprobante: 'TICKET',
      esCredito: false,
      metodoPago: 'EFECTIVO',
      montoRecibido: 50,
      pagos: [{ metodoPago: 'EFECTIVO', monto: 50 }],
      detalles: [{
        productoId,
        varianteId: objetivo.id,
        descripcion: `${nombre} - ${objetivo.nombre}`,
        cantidad: 1,
        precioUnitario: 50,
        porcentajeIGV: 18,
        precioIncluyeIgv: true,
        tipoAfectacion: '10',
      }],
    }),
    'crear venta',
  );
  const v = venta.data ?? venta;
  console.log(`✓ venta ${v.codigo} — total ${v.total}`);

  // 5. Veredicto: qué unidad quedó en el snapshot de la línea.
  const linea = (v.detalles ?? []).find((d) => d.varianteId === objetivo.id);
  const declarado = linea?.codigoUnidadSunat ?? '(no vino en la respuesta)';

  console.log('\n──────────── VEREDICTO ────────────');
  console.log(`venta            : ${v.codigo}`);
  console.log(`producto         : ${nombre}  (unidad PR)`);
  console.log(`variante vendida : ${objetivo.nombre}  (sin unidad propia)`);
  console.log(`codigoUnidadSunat: ${declarado}`);
  if (declarado === 'PR') {
    console.log('\n✅ PR — la clave compuesta resuelve bien. Fase 0 validada.');
  } else if (declarado === 'NIU') {
    console.log('\n❌ NIU — la línea de variante NO encontró su entrada en el');
    console.log('   mapa y cayó a sinPresentacion(). Hay regresión.');
  } else {
    console.log('\n⚠️  Inesperado: revisar VentaDetalle en la BD.');
  }
  console.log('───────────────────────────────────');
  console.log(`\nPara confirmarlo en la BD:\n  VTA = ${v.codigo}`);

  if (LIMPIAR) {
    const del = await api('DELETE', `/productos/${productoId}`);
    console.log(`\n🧹 producto de prueba borrado (${del.status})`);
  } else {
    console.log(`\n(producto de prueba NO borrado — correr con $env:LIMPIAR='1' o borrarlo a mano: ${productoId})`);
  }
}

main().catch((e) => {
  console.error(`\n✖ ${e.message}`);
  process.exit(1);
});
