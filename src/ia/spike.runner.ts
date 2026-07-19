/**
 * Spike Fase 0 — prueba la tool `buscarProducto` contra el catálogo REAL,
 * SIN LLM todavía (esa parte necesita la API key). Valida que la pieza que
 * no depende de IA funciona de punta a punta.
 *
 * Ejecutar (usa la DATABASE_URL del .env del backend):
 *   npx ts-node -r dotenv/config src/ia/spike.runner.ts "oso stich"
 *   npx ts-node -r dotenv/config src/ia/spike.runner.ts "peluche"
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { crearBuscarProductoTool } from './tools/buscar-producto.tool';

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
  const query = process.argv[2] ?? 'peluche';
  const dbUrl = resolverDbUrl();
  const db = dbUrl.match(/\/([^/?]+)(\?|$)/)?.[1] ?? '(desconocida)';
  // Mismo patrón que PrismaService (Prisma 7 + adapter pg).
  const pool = new Pool({ connectionString: dbUrl });
  console.log(`🗄️  DB: ${db}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const tool = crearBuscarProductoTool(prisma);
    console.log(
      `\n🔧 ${tool.nombre}("${query}")  · empresa …${EMPRESA_ID.slice(-6)}\n`,
    );
    const r = await tool.ejecutar(
      { query },
      { empresaId: EMPRESA_ID, sedeId: SEDE_ID },
    );
    console.log(JSON.stringify(r, null, 2));
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('SPIKE ERROR:', e);
  process.exit(1);
});
