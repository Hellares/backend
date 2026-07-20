/**
 * Harness E2E del agente IA vendedor — corre DENTRO del container beta:
 *
 *   docker cp e2e-beta.harness.js syncronize-backend-beta:/app/dist/src/ia/
 *   docker exec syncronize-backend-beta node dist/src/ia/e2e-beta.harness.js
 *
 * Bootea el AppModule REAL (mismo env del container = BD beta, key IA beta),
 * PARCHEA EvolutionApiService para capturar los mensajes salientes en vez de
 * mandarlos a WhatsApp, detiene los crons (el container real ya los corre) y
 * simula clientes ficticios + pagos Yape por la MISMA ruta del webhook
 * (sorteos primero, ventas después — fiel a payment.received).
 *
 * Cada escenario usa un celular ficticio propio. Las ventas creadas quedan en
 * beta (se listan al final para anularlas).
 *
 * Filtro opcional: node ... e2e-beta.harness.js E4   (solo ese escenario)
 */
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionApiService } from '../whatsapp/evolution-api.service';
import { WhatsappBotService } from '../whatsapp/whatsapp-bot.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { SorteosService } from '../sorteos/sorteos.service';

const EMPRESA_ID = 'cmopb5rkv000701nweavtybvt'; // TORRES LEDEZMA (beta)
const DNI_JAMES = '44885296';
const YAPE_JAMES = 'James Johel Torres Ledezma';

// ── infra ────────────────────────────────────────────────────────────────
const capturados = new Map<string, string[]>(); // celular → mensajes salientes
let refSeq = 0;

function log(linea: string) {
  console.log(linea);
}

const resultados: { caso: string; ok: boolean; detalle: string }[] = [];
function check(caso: string, cond: boolean, detalle: string) {
  resultados.push({ caso, ok: cond, detalle });
  log(`   ${cond ? '✅' : '❌'} ${detalle}`);
}

async function main() {
  const filtro = process.argv[2]?.toUpperCase();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const prisma = app.get(PrismaService);
  const evo = app.get(EvolutionApiService);
  const bot = app.get(WhatsappBotService);
  const webhooks = app.get(WebhooksService);
  const sorteos = app.get(SorteosService);

  // Seguridad: SOLO beta.
  const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>(
    'SELECT current_database() AS db',
  );
  if (db !== 'db_saas_beta') {
    console.error(`ABORT: la BD es '${db}', no db_saas_beta.`);
    await app.close();
    process.exit(1);
  }

  // El container REAL ya corre los crons — este proceso no debe duplicarlos.
  const registry = app.get(SchedulerRegistry);
  registry.getCronJobs().forEach((job) => job.stop());
  registry.getIntervals().forEach((n) => registry.deleteInterval(n));
  registry.getTimeouts().forEach((n) => registry.deleteTimeout(n));

  // Parche: capturar salientes en vez de mandarlos a WhatsApp real.
  const captura = (number: string, texto: string) => {
    const cel = String(number).replace(/\D/g, '');
    if (!capturados.has(cel)) capturados.set(cel, []);
    capturados.get(cel)!.push(texto);
    return Promise.resolve({ key: { id: `harness-${Date.now()}` } } as any);
  };
  (evo as any).sendText = (a: any) => captura(a.number, a.text);
  (evo as any).sendImage = (a: any) => captura(a.number, `[IMG] ${a.caption}`);
  (evo as any).sendDocument = (a: any) =>
    captura(a.number, `[DOC] ${a.fileName}`);

  const wpp = await prisma.integracionWhatsapp.findUnique({
    where: { empresaId: EMPRESA_ID },
    select: { instanceName: true, habilitado: true },
  });
  if (!wpp?.habilitado) {
    console.error('ABORT: IntegracionWhatsapp de la empresa no habilitada.');
    await app.close();
    process.exit(1);
  }
  const instanceName = wpp.instanceName!;

  // ── helpers de escenario ──────────────────────────────────────────────
  const enviar = async (cel: string, texto: string): Promise<string[]> => {
    const antes = capturados.get(cel)?.length ?? 0;
    log(`   → cliente: ${texto}`);
    try {
      await bot.procesarMensaje(instanceName, cel, texto);
    } catch (e) {
      log(`   ⚠️ procesarMensaje lanzó: ${(e as Error).message}`);
    }
    const nuevos = (capturados.get(cel) ?? []).slice(antes);
    for (const n of nuevos) log(`   ← agente: ${n.replace(/\n/g, ' ⏎ ')}`);
    return nuevos;
  };

  /** Pago Yape simulado — MISMA prioridad que el webhook payment.received. */
  const pagarYape = async (senderName: string, amount: number) => {
    const pago = {
      senderName,
      amount,
      operationCode: `harness-${Date.now()}-${refSeq++}`,
      provider: 'yape',
    };
    const r1 = await sorteos.autoValidarPorPagoYape(EMPRESA_ID, pago as any);
    if (r1.accion === 'participante-auto-validado') {
      log(`   💸 pago ${amount} "${senderName}" → SORTEO lo tomó (${r1.accion})`);
      return r1.accion;
    }
    const r2 = await (webhooks as any).autoValidarVentaPorPagoYape(
      EMPRESA_ID,
      pago,
    );
    log(`   💸 pago ${amount} "${senderName}" → ${r2.accion}`);
    // notificarVentaPagada es fire-and-forget: darle aire antes de seguir.
    await new Promise((r) => setTimeout(r, 2000));
    return r2.accion as string;
  };

  const ultimaVenta = (cel: string) =>
    prisma.venta.findFirst({
      where: { empresaId: EMPRESA_ID, telefonoCliente: cel },
      orderBy: { creadoEn: 'desc' },
    });

  const resetConv = (cel: string) =>
    prisma.conversacionWhatsapp.deleteMany({
      where: { empresaId: EMPRESA_ID, celular: cel },
    });

  const comprar = async (cel: string, pedido: string) => {
    await enviar(cel, pedido);
    await enviar(cel, '1');
    await enviar(cel, DNI_JAMES);
    await enviar(cel, 'si');
    return ultimaVenta(cel);
  };

  const corre = (id: string) => !filtro || filtro === id;
  const ventasCreadas: string[] = [];
  const registrar = (v: any) => v?.codigo && ventasCreadas.push(v.codigo);

  // ═══ E1: compra simple + pago exacto + RECOJO ═════════════════════════
  if (corre('E1')) {
    log('\n━━ E1: compra simple → pago exacto → recojo ━━');
    const cel = '51900000001';
    await resetConv(cel);
    const v = await comprar(cel, 'quiero un lapicero');
    registrar(v);
    check('E1', !!v && v.estado === 'CONFIRMADA', `venta creada pendiente (${v?.codigo ?? 'NO CREADA'})`);
    if (v) {
      const accion = await pagarYape(YAPE_JAMES, Number(v.total));
      const v2 = await prisma.venta.findUnique({ where: { id: v.id } });
      check('E1', accion === 'venta-auto-validada', `pago exacto auto-valida (${accion})`);
      check('E1', v2?.estado === 'PAGADA_COMPLETA', `estado final ${v2?.estado}`);
      const confirmado = (capturados.get(cel) ?? []).some((m) => m.includes(v.codigo));
      check('E1', confirmado, 'confirmación WhatsApp menciona el código de venta');
      await enviar(cel, 'recojo');
      const envio = await prisma.ventaEnvio.findUnique({ where: { ventaId: v.id } });
      check('E1', !envio, 'recojo NO crea VentaEnvio');
    }
  }

  // ═══ E2: compra + ENVÍO con dirección nueva ═══════════════════════════
  if (corre('E2')) {
    log('\n━━ E2: compra → pago → envío con dirección nueva ━━');
    const cel = '51900000002';
    await resetConv(cel);
    const v = await comprar(cel, 'quiero un lapicero azul');
    registrar(v);
    if (v) {
      await pagarYape(YAPE_JAMES, Number(v.total));
      await enviar(cel, 'envío');
      await enviar(cel, 'Chiclayo');
      await enviar(cel, 'Lambayeque');
      await enviar(cel, 'la sucursal de Av. Balta 123');
      await enviar(cel, 'yo mismo');
      const e = await prisma.ventaEnvio.findUnique({ where: { ventaId: v.id } });
      check('E2', !!e, `VentaEnvio registrado (${v.codigo})`);
      check('E2', e?.destinoProvincia === 'CHICLAYO', `provincia=${e?.destinoProvincia}`);
      check('E2', e?.destinoDepartamento === 'LAMBAYEQUE', `departamento=${e?.destinoDepartamento}`);
      check('E2', !!e?.agenciaDireccion?.includes('BALTA'), `sucursal=${e?.agenciaDireccion}`);
      check('E2', !!e?.destinatarioNombre?.includes('JAMES'), `destinatario=${e?.destinatarioNombre}`);
    } else {
      check('E2', false, 'venta no creada');
    }
  }

  // ═══ E3: envío recogido por OTRA persona ══════════════════════════════
  if (corre('E3')) {
    log('\n━━ E3: compra → pago → envío, recoge OTRA persona ━━');
    const cel = '51900000003';
    await resetConv(cel);
    const v = await comprar(cel, 'dame un lapicero por favor');
    registrar(v);
    if (v) {
      await pagarYape(YAPE_JAMES, Number(v.total));
      await enviar(cel, 'envío');
      await enviar(cel, 'a Piura, departamento Piura');
      await enviar(cel, 'no sé la dirección de la agencia');
      await enviar(cel, 'lo recoge mi hermana MONICA, su DNI es 44885298');
      const e = await prisma.ventaEnvio.findUnique({ where: { ventaId: v.id } });
      check('E3', !!e, `VentaEnvio registrado (${v.codigo})`);
      check('E3', !!e?.destinatarioNombre?.toUpperCase().includes('MONICA'), `destinatario=${e?.destinatarioNombre}`);
      check('E3', e?.destinatarioDni === '44885298', `dni destinatario=${e?.destinatarioDni}`);
      check('E3', e?.destinoProvincia === 'PIURA', `provincia=${e?.destinoProvincia}`);
    } else {
      check('E3', false, 'venta no creada');
    }
  }

  // ═══ E4: pago con NOMBRE incorrecto (tercero) → NO valida ═════════════
  let ventaE4: any = null;
  if (corre('E4') || corre('E6')) {
    log('\n━━ E4: pago de un TERCERO (nombre distinto) → NO valida ━━');
    const cel = '51900000004';
    await resetConv(cel);
    ventaE4 = await comprar(cel, 'véndeme un lapicero');
    registrar(ventaE4);
    if (ventaE4) {
      const accion = await pagarYape('Pedro Suarez Vertiz', Number(ventaE4.total));
      const v2 = await prisma.venta.findUnique({ where: { id: ventaE4.id } });
      check('E4', accion === 'venta-sin-match', `pago de tercero rechazado (${accion})`);
      check('E4', v2?.estado === 'CONFIRMADA', `venta sigue pendiente (${v2?.estado})`);
    } else {
      check('E4', false, 'venta no creada');
    }
  }

  // ═══ E5: pago con MONTO incorrecto → NO valida ════════════════════════
  let ventaE5: any = null;
  if (corre('E5') || corre('E6')) {
    log('\n━━ E5: pago con monto DISTINTO → NO valida ━━');
    const cel = '51900000005';
    await resetConv(cel);
    ventaE5 = await comprar(cel, 'quiero comprar un lapicero');
    registrar(ventaE5);
    if (ventaE5) {
      const accion = await pagarYape(YAPE_JAMES, Number(ventaE5.total) + 1);
      const v2 = await prisma.venta.findUnique({ where: { id: ventaE5.id } });
      check('E5', accion === 'venta-sin-match', `monto distinto rechazado (${accion})`);
      check('E5', v2?.estado === 'CONFIRMADA', `venta sigue pendiente (${v2?.estado})`);
    } else {
      check('E5', false, 'venta no creada');
    }
  }

  // ═══ E6: DOS ventas pendientes mismo monto+nombre → AMBIGUO → manual ══
  if (corre('E6')) {
    log('\n━━ E6: dos pendientes de igual monto → pago correcto → AMBIGUO ━━');
    if (ventaE4 && ventaE5 && Number(ventaE4.total) === Number(ventaE5.total)) {
      const accion = await pagarYape(YAPE_JAMES, Number(ventaE4.total));
      const [a, b] = await Promise.all([
        prisma.venta.findUnique({ where: { id: ventaE4.id } }),
        prisma.venta.findUnique({ where: { id: ventaE5.id } }),
      ]);
      check('E6', accion === 'venta-ambigua', `pago ambiguo va a validación manual (${accion})`);
      check('E6', a?.estado === 'CONFIRMADA' && b?.estado === 'CONFIRMADA', 'NINGUNA se auto-validó');
    } else {
      check('E6', false, 'requiere E4 y E5 con el mismo total');
    }
  }

  // ═══ E7: producto con VARIANTE e2e ════════════════════════════════════
  if (corre('E7')) {
    log('\n━━ E7: producto con variante (edredón) e2e ━━');
    const cel = '51900000007';
    await resetConv(cel);
    await enviar(cel, 'quiero un edredón');
    await enviar(cel, 'el de cristal');
    await enviar(cel, '1');
    await enviar(cel, DNI_JAMES);
    await enviar(cel, 'si');
    const v = await ultimaVenta(cel);
    registrar(v);
    if (v) {
      const det = await prisma.ventaDetalle.findFirst({ where: { ventaId: v.id } });
      check('E7', !!det?.varianteId, `detalle con varianteId (${det?.descripcion})`);
      const accion = await pagarYape(YAPE_JAMES, Number(v.total));
      const v2 = await prisma.venta.findUnique({ where: { id: v.id } });
      check('E7', accion === 'venta-auto-validada' && v2?.estado === 'PAGADA_COMPLETA', `pagada (${accion}, total ${v.total})`);
    } else {
      check('E7', false, 'venta no creada');
    }
  }

  // ═══ E8: cantidad mayor al stock → el agente NO vende de más ══════════
  if (corre('E8')) {
    log('\n━━ E8: pedir más que el stock ━━');
    const cel = '51900000008';
    await resetConv(cel);
    await enviar(cel, 'quiero 5000 lapiceros');
    await enviar(cel, DNI_JAMES);
    await enviar(cel, 'si');
    const v = await ultimaVenta(cel);
    if (v) {
      const det = await prisma.ventaDetalle.findFirst({ where: { ventaId: v.id } });
      registrar(v);
      check('E8', Number(det?.cantidad ?? 0) < 5000, `si vendió, fue cantidad real (${det?.cantidad})`);
    } else {
      check('E8', true, 'no creó venta imposible (correcto)');
    }
  }

  // ── resumen ───────────────────────────────────────────────────────────
  log('\n══════════ RESUMEN ══════════');
  const porCaso = new Map<string, { ok: number; total: number }>();
  for (const r of resultados) {
    const c = porCaso.get(r.caso) ?? { ok: 0, total: 0 };
    c.total++;
    if (r.ok) c.ok++;
    porCaso.set(r.caso, c);
  }
  porCaso.forEach((c, caso) =>
    log(`${c.ok === c.total ? '✅' : '❌'} ${caso}: ${c.ok}/${c.total}`),
  );
  const fallos = resultados.filter((r) => !r.ok);
  if (fallos.length) {
    log('\nFALLOS:');
    fallos.forEach((f) => log(` - [${f.caso}] ${f.detalle}`));
  }
  log(`\n🧹 Ventas de prueba creadas (anular luego): ${ventasCreadas.join(', ') || 'ninguna'}`);
  await app.close();
  process.exit(fallos.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Harness reventó:', e);
  process.exit(1);
});
