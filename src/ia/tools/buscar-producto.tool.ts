import { PrismaClient } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';
import { stockDisponible } from './stock.util';

/** Palabras vacías que no aportan a la búsqueda (no deben ampliar el OR). */
const STOPWORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'para', 'con',
  'y', 'o', 'mi', 'tu', 'que', 'por', 'del', 'al', 'en', 'algo', 'tienes',
  'tienen', 'tiene', 'hay', 'busco', 'quiero', 'necesito', 'me', 'se', 'su',
  'sus', 'lo', 'sobre', 'tipo', 'clase',
]);

/**
 * Normaliza el query (minúsculas, SIN tildes) y genera términos tolerantes a
 * plural: la frase completa + cada palabra significativa + su raíz singular.
 * Corrige el falso negativo real "edredones"/"edredón" → catálogo "EDREDON"
 * (ILIKE es case-insensitive pero NO ignora tildes ni plural).
 * OJO: normaliza el LADO DEL QUERY; si el PRODUCTO tuviera tildes en el nombre
 * el ILIKE aún fallaría → mejora futura (columna normalizada / unaccent).
 */
function construirTerminos(query: string): string[] {
  const norm = query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes (marcas diacríticas)
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim();
  const terminos = new Set<string>();
  if (norm.length >= 2) terminos.add(norm);
  for (const w of norm.split(/\s+/)) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    terminos.add(w);
    if (w.length >= 5 && w.endsWith('es')) terminos.add(w.slice(0, -2));
    else if (w.length >= 4 && w.endsWith('s')) terminos.add(w.slice(0, -1));
  }
  return [...terminos];
}

/**
 * Tool `buscarProducto` — envuelve la búsqueda del catálogo (ILIKE en
 * nombre/descripción, mismo criterio que producto-catalog.buildWhereClause)
 * y devuelve productos REALES con precio y stock del sistema.
 *
 * "Traductor de intención" (ver README §4): el `query` NO es la frase cruda
 * del cliente — es lo que el LLM traduce de su intención ("algo para guardar
 * fotos" → "disco almacenamiento"). Validado sobre datos reales (§12).
 *
 * Precio y stock SIEMPRE del sistema. Un producto puede tener varias filas
 * de ProductoStock (precios/presentaciones distintas) → se colapsan por
 * producto mostrando rango de precio y stock total disponible.
 *
 * Recibe un PrismaClient (compatible con PrismaService de Nest, que lo
 * extiende) para que el spike corra standalone y el módulo real lo inyecte.
 * `maxResultados` sale de la config por empresa (IntegracionAgenteIA.
 * maxProductosMostrar); por defecto 5.
 */
export function crearBuscarProductoTool(
  prisma: PrismaClient,
  maxResultados = 5,
): DefinicionTool {
  const MAX_RESULTADOS = maxResultados > 0 ? maxResultados : 5;

  return {
    nombre: 'buscarProducto',
    descripcion:
      'Busca productos del catálogo de la empresa por nombre o descripción. ' +
      'IMPORTANTE: traduce lo que pide el cliente a TÉRMINOS DE BÚSQUEDA de ' +
      'dominio antes de llamar (ej. "algo para guardar fotos, la laptop está ' +
      'llena" → query "disco almacenamiento"). Devuelve SOLO productos reales ' +
      'con su precio y stock actuales del sistema — jamás inventes productos ' +
      'ni precios; si no hay resultados, dilo y ofrece buscar otra cosa.',
    parametros: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Términos de búsqueda de dominio (1 a 4 palabras) derivados de la ' +
            'intención del cliente. Ej: "mochila spiderman", "disco", "peluche stitch".',
        },
      },
      required: ['query'],
    },

    async ejecutar(args, ctx: ContextoTool): Promise<ResultadoTool> {
      const query = String(args.query ?? '').trim();
      if (query.length < 2) {
        return { ok: false, motivo: 'QUERY_MUY_CORTA' };
      }
      const terminos = construirTerminos(query);
      if (terminos.length === 0) {
        return { ok: false, motivo: 'QUERY_MUY_CORTA' };
      }

      const productos = await prisma.producto.findMany({
        where: {
          empresaId: ctx.empresaId,
          deletedAt: null,
          OR: terminos.flatMap((t) => [
            { nombre: { contains: t, mode: 'insensitive' as const } },
            { descripcion: { contains: t, mode: 'insensitive' as const } },
          ]),
        },
        include: {
          stocksPorSede: {
            where: {
              precio: { not: null },
              ...(ctx.sedeId ? { sedeId: ctx.sedeId } : {}),
            },
          },
        },
        take: MAX_RESULTADOS * 4, // margen para descartar los sin stock/precio
      });

      const items = productos
        .map((p) => {
          const stocks = p.stocksPorSede.filter((s) => s.precio != null);
          if (stocks.length === 0) return null;
          const precios = stocks.map((s) => Number(s.precio));
          const stockTotal = stocks.reduce(
            (a, s) => a + Math.max(0, stockDisponible(s)),
            0,
          );
          const precioMin = Math.min(...precios);
          const precioMax = Math.max(...precios);
          return {
            id: p.id,
            nombre: p.nombre,
            descCorta: (p.descripcion ?? '').slice(0, 90),
            precio:
              precioMin === precioMax
                ? precioMin
                : { desde: precioMin, hasta: precioMax },
            stockDisponible: stockTotal,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .filter((x) => x.stockDisponible > 0)
        .slice(0, MAX_RESULTADOS);

      return { ok: true, productos: items };
    },
  };
}
