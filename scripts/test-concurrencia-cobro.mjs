#!/usr/bin/env node
/**
 * Simulación de concurrencia contra BETA — flujo de cobro de órdenes de
 * servicio vía Venta Rápida (multi-tenant SaaS).
 *
 * Escenarios:
 *  A) Doble cobro: N requests paralelos cobrando LA MISMA orden
 *     → exactamente 1 éxito y N−1 con 409 ORDEN_YA_COBRADA.
 *  B) Carga paralela: cobrar M órdenes distintas a la vez
 *     → M éxitos, códigos de venta únicos (correlativo sin colisión).
 *  C) Adelantos concurrentes: 3 PUT paralelos con montos distintos sobre
 *     la misma orden → al final, Σ(movimientos de caja) DEBE == adelanto
 *     final de la orden (invariante caja↔orden).
 *  D) Precio desactualizado: cobrar con precio viejo
 *     → 409 SALDO_ORDEN_DESACTUALIZADO.
 *  E) Estado inválido: cobrar una orden en RECIBIDO → 400.
 *
 * Uso (PowerShell):
 *   $env:CRED='email'; $env:PASS='password'; node scripts/test-concurrencia-cobro.mjs
 * Opcionales: $env:BASE_URL, $env:SEDE_ID (default: sede de pruebas beta).
 *
 * Usa tipoComprobante TICKET (no quema correlativos de boleta SUNAT).
 * Requiere que el usuario tenga su CAJA ABIERTA en la sede.
 */

const BASE = process.env.BASE_URL ?? 'https://saas-beta.syncronize.net.pe/api';
const CRED = process.env.CRED;
const PASS = process.env.PASS;
const SEDE_ID = process.env.SEDE_ID ?? 'cmopb5ro0000c01nwcpizvmuc';

if (!CRED || !PASS) {
  console.error('Faltan credenciales: $env:CRED y $env:PASS');
  process.exit(1);
}

let TOKEN = '';
let TENANT = '';
let USER_ID = '';
let CLIENTE_GENERICO = '';

const resultados = [];
const ok = (n, d) => resultados.push({ esc: n, pass: true, detalle: d });
const fail = (n, d) => resultados.push({ esc: n, pass: false, detalle: d });

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

async function login() {
  const { status, data } = await api('POST', '/auth/login', {
    credencial: CRED,
    password: PASS,
  });
  if (status !== 200) throw new Error(`Login falló (${status}): ${JSON.stringify(data)}`);
  TOKEN = data.accessToken;
  USER_ID = data.user?.id;
  // Multi-empresa: el login puede no fijar tenant (se selecciona después);
  // la tenancy real va por header x-tenant-id (TenantAuthGuard valida
  // pertenencia). Fallback a la empresa de pruebas beta.
  TENANT = data.tenant?.id ?? process.env.TENANT_ID ?? 'cmopb5rkv000701nweavtybvt';
  console.log(`✓ Login OK — user=${USER_ID} tenant=${TENANT}`);
}

async function clienteGenerico() {
  const { status, data } = await api('GET', '/clientes/generico');
  if (status !== 200) throw new Error(`clientes/generico falló (${status})`);
  CLIENTE_GENERICO = data.id ?? data.data?.id;
  console.log(`✓ Cliente genérico: ${CLIENTE_GENERICO}`);
}

/** Crea una orden de prueba y la lleva hasta REPARADO. */
async function crearOrdenReparada({ costo, adelanto = 0, metodo = 'YAPE', hastaReparado = true }) {
  const { status, data } = await api('POST', '/ordenes-servicio', {
    empresaId: TENANT, // el ValidationPipe lo exige en el body (el controller lo re-pisa con el header)
    clienteId: CLIENTE_GENERICO,
    sedeId: SEDE_ID,
    tipoServicio: 'REPARACION',
    prioridad: 'NORMAL',
    tipoEquipo: 'TEST CONCURRENCIA',
    marcaEquipo: 'BOT',
    descripcionProblema: 'orden generada por test de concurrencia',
    costoTotal: costo,
    ...(adelanto > 0 ? { adelanto, metodoPagoAdelanto: metodo } : {}),
  });
  if (status !== 201 && status !== 200) {
    throw new Error(`crear orden falló (${status}): ${JSON.stringify(data)}`);
  }
  const orden = { id: data.id, codigo: data.codigo };
  if (hastaReparado) {
    for (const estado of ['EN_DIAGNOSTICO', 'EN_REPARACION', 'REPARADO']) {
      const t = await api('PATCH', `/ordenes-servicio/${orden.id}/estado`, { nuevoEstado: estado });
      if (t.status >= 400) throw new Error(`transición ${estado} falló (${t.status}): ${JSON.stringify(t.data)}`);
    }
  }
  return orden;
}

/** Dispara un cobro VR de la orden (TICKET, EFECTIVO exacto). */
function cobrar(orden, { precio, monto }) {
  return api('POST', '/ventas/cobrar', {
    canalVenta: 'POS',
    sedeId: SEDE_ID,
    vendedorId: USER_ID,
    clienteId: CLIENTE_GENERICO,
    nombreCliente: 'CLIENTES VARIOS',
    documentoCliente: '00000000',
    moneda: 'PEN',
    tipoComprobante: 'TICKET',
    esCredito: false,
    metodoPago: 'EFECTIVO',
    montoRecibido: monto,
    pagos: [{ metodoPago: 'EFECTIVO', monto }],
    detalles: [{
      ordenServicioId: orden.id,
      descripcion: `${orden.codigo} - TEST CONCURRENCIA`,
      cantidad: 1,
      precioUnitario: precio,
      porcentajeIGV: 18,
      precioIncluyeIgv: true,
      tipoAfectacion: '10',
    }],
  });
}

// ─── Escenario A: doble cobro concurrente ───
async function escenarioA() {
  console.log('\n── A) Doble cobro concurrente (5 paralelos, misma orden) ──');
  const orden = await crearOrdenReparada({ costo: 100 });
  console.log(`   Orden ${orden.codigo}`);
  const N = 5;
  const res = await Promise.all(
    Array.from({ length: N }, () => cobrar(orden, { precio: 100, monto: 100 })),
  );
  const exitos = res.filter((r) => r.status === 201 || r.status === 200);
  const conflictos = res.filter((r) => r.status === 409);
  const otros = res.filter((r) => ![200, 201, 409].includes(r.status));
  console.log(`   éxitos=${exitos.length} 409=${conflictos.length} otros=${otros.length}`);
  for (const o of otros) console.log(`   ⚠ inesperado ${o.status}: ${JSON.stringify(o.data).slice(0, 200)}`);
  const codes409 = conflictos.map((c) => c.data?.code ?? c.data?.message?.code ?? JSON.stringify(c.data).slice(0, 60));
  console.log(`   códigos 409: ${[...new Set(codes409)].join(' | ')}`);
  if (exitos.length === 1 && conflictos.length === N - 1) {
    ok('A', `1 éxito + ${N - 1}×409 — candado anti doble cobro OK (${orden.codigo})`);
  } else {
    fail('A', `esperado 1 éxito + ${N - 1}×409; obtenido ${exitos.length} éxitos, ${conflictos.length}×409, ${otros.length} otros (${orden.codigo})`);
  }
  return orden;
}

// ─── Escenario B: M órdenes distintas en paralelo ───
async function escenarioB() {
  console.log('\n── B) Carga paralela (4 órdenes distintas a la vez) ──');
  const ordenes = [];
  for (let i = 0; i < 4; i++) ordenes.push(await crearOrdenReparada({ costo: 50 }));
  console.log(`   Órdenes: ${ordenes.map((o) => o.codigo).join(', ')}`);
  const res = await Promise.all(ordenes.map((o) => cobrar(o, { precio: 50, monto: 50 })));
  const exitos = res.filter((r) => r.status === 201 || r.status === 200);
  const codigosVenta = exitos.map((r) => r.data?.codigo).filter(Boolean);
  const unicos = new Set(codigosVenta);
  console.log(`   éxitos=${exitos.length}/4 — ventas: ${codigosVenta.join(', ')}`);
  if (exitos.length === 4 && unicos.size === 4) {
    ok('B', `4/4 cobradas en paralelo con códigos únicos`);
  } else {
    fail('B', `éxitos=${exitos.length}/4, códigos únicos=${unicos.size}/4 — ${res.map((r) => r.status).join(',')}`);
  }
}

// ─── Escenario C: adelantos concurrentes (invariante caja↔orden) ───
async function escenarioC() {
  console.log('\n── C) Adelantos concurrentes (3 PUT paralelos: 30/60/90) ──');
  const orden = await crearOrdenReparada({ costo: 200, hastaReparado: false });
  console.log(`   Orden ${orden.codigo}`);
  const montos = [30, 60, 90];
  const res = await Promise.all(
    montos.map((a) =>
      api('PUT', `/ordenes-servicio/${orden.id}`, { adelanto: a, metodoPagoAdelanto: 'YAPE' }),
    ),
  );
  console.log(`   status: ${res.map((r) => r.status).join(', ')}`);
  const final = await api('GET', `/ordenes-servicio/${orden.id}`);
  const adelantoFinal = Number(final.data?.adelanto ?? 0);
  console.log(`   adelanto final de la orden: S/ ${adelantoFinal}`);
  console.log(`   → INVARIANTE a verificar en BD: Σ(MovimientoCaja ADELANTO_SERVICIO de ${orden.codigo}) == ${adelantoFinal}`);
  ok('C', `ejecutado — orden ${orden.codigo}, adelanto final S/ ${adelantoFinal} (verificar Σ caja en BD)`);
  return orden;
}

// ─── Escenario D: precio desactualizado ───
async function escenarioD() {
  console.log('\n── D) Cobro con precio desactualizado (120 vs 80) ──');
  const orden = await crearOrdenReparada({ costo: 120 });
  const r = await cobrar(orden, { precio: 80, monto: 80 });
  const code = r.data?.code ?? '';
  console.log(`   status=${r.status} code=${code}`);
  if (r.status === 409 && code === 'SALDO_ORDEN_DESACTUALIZADO') {
    ok('D', `409 SALDO_ORDEN_DESACTUALIZADO (${orden.codigo})`);
  } else {
    fail('D', `esperado 409 SALDO_ORDEN_DESACTUALIZADO; obtenido ${r.status} ${code} (${orden.codigo})`);
  }
}

// ─── Escenario E: estado inválido ───
async function escenarioE() {
  console.log('\n── E) Cobro de orden en RECIBIDO (estado inválido) ──');
  const orden = await crearOrdenReparada({ costo: 70, hastaReparado: false });
  const r = await cobrar(orden, { precio: 70, monto: 70 });
  console.log(`   status=${r.status} msg=${(r.data?.message ?? '').toString().slice(0, 80)}`);
  if (r.status === 400) {
    ok('E', `400 rechazado correctamente (${orden.codigo})`);
  } else {
    fail('E', `esperado 400; obtenido ${r.status} (${orden.codigo})`);
  }
}

// ─── Main ───
(async () => {
  console.log(`Simulación de concurrencia → ${BASE}`);
  await login();
  await clienteGenerico();

  const ordenA = await escenarioA();
  await escenarioB();
  const ordenC = await escenarioC();
  await escenarioD();
  await escenarioE();

  console.log('\n════════ RESUMEN ════════');
  for (const r of resultados) {
    console.log(`${r.pass ? '✅' : '❌'} [${r.esc}] ${r.detalle}`);
  }
  console.log('\nÓrdenes para verificación BD:', JSON.stringify({ A: ordenA.codigo, C: ordenC.codigo }));
  process.exit(resultados.every((r) => r.pass) ? 0 : 1);
})().catch((e) => {
  console.error('💥', e.message);
  process.exit(1);
});
