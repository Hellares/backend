/**
 * Spike Fase 0 — dos modos:
 *
 *   TOOL (sin LLM, no necesita key): prueba buscarProducto contra el catálogo.
 *     npx ts-node -r dotenv/config src/ia/spike.runner.ts "peluche"
 *
 *   CHAT (loop completo con el LLM, necesita IA_ANTHROPIC_API_KEY en .env):
 *     npx ts-node -r dotenv/config src/ia/spike.runner.ts --chat "quiero un peluche de stitch"
 *
 * Apunta a BETA por defecto (SPIKE_TARGET=prod para prod, solo lectura).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { crearBuscarProductoTool } from './tools/buscar-producto.tool';
import { crearVerDetalleTool } from './tools/ver-detalle.tool';
import { crearResolverClienteTool } from './tools/resolver-cliente.tool';
import { AnthropicProvider } from './provider/anthropic.provider';
import { EjecutorTools } from './ejecutor-tools';
import { AgenteService } from './agente.service';
import { construirSystemPrompt } from './prompt-sistema';
import { IaAgenteService } from './ia.service';

// Contexto de prueba: empresa BETA (TORRES LEDEZMA, 341 productos). En el
// módulo real llega del webhook de WhatsApp.
const EMPRESA_ID = process.env.SPIKE_EMPRESA_ID ?? 'cmopb5rkv000701nweavtybvt';
const SEDE_ID = process.env.SPIKE_SEDE_ID ?? 'cmopb5ro0000c01nwcpizvmuc';

/**
 * Apunta a BETA por defecto: beta y prod comparten instancia postgres,
 * solo cambia la base (db_saas → db_saas_beta). Deriva la URL del .env
 * sin tocar credenciales. `SPIKE_TARGET=prod` fuerza prod (solo lectura).
 */
function resolverDbUrl(): string {
  const base = process.env.DATABASE_URL ?? '';
  if (process.env.SPIKE_TARGET === 'prod') return base;
  return base.replace(/\/db_saas(?=[?/]|$)/, '/db_saas_beta');
}

async function main() {
  const esChat = process.argv[2] === '--chat';
  const arg = esChat ? process.argv.slice(3).join(' ') : process.argv[2];
  const dbUrl = resolverDbUrl();
  const db = dbUrl.match(/\/([^/?]+)(\?|$)/)?.[1] ?? '(desconocida)';
  // Mismo patrón que PrismaService (Prisma 7 + adapter pg).
  const pool = new Pool({ connectionString: dbUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  console.log(`🗄️  DB: ${db}`);
  const ctx = { empresaId: EMPRESA_ID, sedeId: SEDE_ID };
  const buscar = crearBuscarProductoTool(prisma);
  const detalle = crearVerDetalleTool(prisma);
  const cliente = crearResolverClienteTool(prisma);
  try {
    if (process.argv[2] === '--detalle') {
      // ── Modo VER DETALLE (sin LLM) ──
      const productoId = process.argv[3] ?? '';
      console.log(`\n🔧 ${detalle.nombre}("${productoId}")\n`);
      console.log(
        JSON.stringify(await detalle.ejecutar({ productoId }, ctx), null, 2),
      );
      return;
    }
    if (process.argv[2] === '--cliente') {
      // ── Modo RESOLVER CLIENTE (sin LLM) ──
      const documento = process.argv[3] ?? '';
      console.log(`\n🔧 ${cliente.nombre}("${documento}")\n`);
      console.log(
        JSON.stringify(await cliente.ejecutar({ documento }, ctx), null, 2),
      );
      return;
    }
    if (process.argv[2] === '--config') {
      // ── Modo CONFIG: prueba el cableado config→runtime vía IaAgenteService ──
      // Hace upsert de la config de la empresa beta y llama atender(). Prueba
      // el gate `habilitado`, la personalidad (Capa B) y el tope de productos.
      // VentaService va stub: en SOLO_CONSULTA nunca se invoca.
      const onOff = process.argv[3] === 'off' ? false : true;
      const mensaje = process.argv.slice(4).join(' ') || 'muéstrame peluches';
      await prisma.integracionAgenteIA.upsert({
        where: { empresaId: EMPRESA_ID },
        create: {
          empresaId: EMPRESA_ID,
          habilitado: onOff,
          nombreAgente: 'Sofía',
          promptPersonalidad:
            'Responde MUY breve. Trata de tú. Termina siempre con una pregunta.',
          modo: 'SOLO_CONSULTA',
          maxProductosMostrar: 3,
        },
        update: { habilitado: onOff },
      });

      const ia = new IaAgenteService(prisma as any, {} as any, {} as any);
      console.log(`\n⚙️  config: habilitado=${onOff}, tope=3, nombre=Sofía`);
      console.log(`👤 ${mensaje}\n`);
      const r = await ia.atender({
        empresaId: EMPRESA_ID,
        sedeId: SEDE_ID,
        mensaje,
      });
      if (!r.atendido) {
        console.log(`🚫 atendido=false (motivo: ${r.motivo}) → el bot no responde`);
        return;
      }
      for (const t of r.resultado!.trazas) {
        for (const tl of t.tools) {
          const prods = (tl.resultado as any)?.productos?.length ?? 0;
          console.log(
            `   🔧 ${tl.nombre}(${JSON.stringify(tl.args)}) → ${prods} productos`,
          );
        }
      }
      console.log(
        `\n🤖 ${r.resultado!.texto}\n   (${r.resultado!.iteraciones} iteración/es)`,
      );
      return;
    }

    if (!esChat) {
      // ── Modo TOOL: buscarProducto (sin LLM). 2º arg opcional = página ──
      const query = arg ?? 'peluche';
      const pagina = Number(process.argv[3] ?? 1) || 1;
      console.log(`\n🔧 ${buscar.nombre}("${query}", pagina ${pagina})\n`);
      console.log(
        JSON.stringify(await buscar.ejecutar({ query, pagina }, ctx), null, 2),
      );
      return;
    }

    // ── Modo CHAT (loop completo con el LLM) ──
    const apiKey = process.env.IA_ANTHROPIC_API_KEY ?? '';
    if (!apiKey) {
      console.error(
        '\n❌ Falta IA_ANTHROPIC_API_KEY en el .env para el modo --chat.\n' +
          '   (El modo tool funciona sin key: corre sin --chat.)',
      );
      return;
    }
    const mensaje = arg || 'quiero un peluche de stitch';
    const provider = new AnthropicProvider({ apiKey });
    const ejecutor = new EjecutorTools().registrar(buscar, detalle, cliente);
    const agente = new AgenteService(provider, ejecutor);
    const system = construirSystemPrompt(ctx, {
      empresaNombre: 'Importaciones JAYLI',
      agenciaEnvio: 'SHALOM',
    });

    console.log(`\n👤 ${mensaje}\n`);
    const r = await agente.responder({ system, mensajeCliente: mensaje, ctx });
    for (const t of r.trazas) {
      for (const tl of t.tools) {
        const prods = (tl.resultado as any)?.productos?.length ?? 0;
        console.log(
          `   🔧 ${tl.nombre}(${JSON.stringify(tl.args)}) → ${prods} productos`,
        );
      }
    }
    console.log(`\n🤖 ${r.texto}\n   (${r.iteraciones} iteración/es)`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('SPIKE ERROR:', e);
  process.exit(1);
});
