import { PrismaClient } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';
import { stockDisponible, recordarCatalogo } from './stock.util';

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
        pagina: {
          type: 'number',
          description:
            'Página de resultados (1 = primera). Si el resultado anterior ' +
            'trajo hayMas:true y el cliente pide VER MÁS modelos, repite la ' +
            'MISMA query con la página siguiente. NUNCA inventes productos ' +
            'para completar una lista.',
        },
      },
      required: ['query'],
    },

    async ejecutar(args, ctx: ContextoTool): Promise<ResultadoTool> {
      const query = String(args.query ?? '').trim();
      const pagina = Math.max(1, Math.floor(Number(args.pagina ?? 1) || 1));
      if (query.length < 2) {
        return { ok: false, motivo: 'QUERY_MUY_CORTA' };
      }
      const terminos = construirTerminos(query);
      if (terminos.length === 0) {
        return { ok: false, motivo: 'QUERY_MUY_CORTA' };
      }

      const buscarEnBd = (where: Record<string, unknown>) =>
        prisma.producto.findMany({
        where: {
          empresaId: ctx.empresaId,
          deletedAt: null,
          ...where,
        },
        include: {
          // Stock a nivel producto (varianteId null).
          stocksPorSede: {
            where: {
              precio: { not: null },
              ...(ctx.sedeId ? { sedeId: ctx.sedeId } : {}),
            },
          },
          // Stock a nivel VARIANTE: productos "EDREDON → variante" guardan su
          // precio/stock aquí, no en el producto. Sin esto, un producto con
          // variantes se descartaba por "sin stock" (falso negativo real).
          variantes: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true,
              nombre: true,
              stocksPorSede: {
                where: {
                  precio: { not: null },
                  ...(ctx.sedeId ? { sedeId: ctx.sedeId } : {}),
                },
              },
            },
          },
        },
        // margen para descartar sin stock/precio; crece con la página pedida
        take: (pagina + 1) * MAX_RESULTADOS * 4,
      });
      let productos = await buscarEnBd({
        OR: terminos.flatMap((t) => [
          { nombre: { contains: t, mode: 'insensitive' as const } },
          { descripcion: { contains: t, mode: 'insensitive' as const } },
        ]),
      });

      // El cliente ve UNIDADES COMPRABLES, no la estructura interna: un producto
      // con variantes se EXPANDE en un ítem por variante ("EDREDON Cristal",
      // "EDREDON alianza lima"), cada uno con su precio y stock. Un producto
      // simple = un solo ítem. crearVenta recibe productoId (+ varianteId).
      const precioYStock = (
        rows: { precio: unknown; [k: string]: unknown }[],
      ) => {
        const s = rows.filter((r) => r.precio != null);
        if (s.length === 0) return null;
        const stock = s.reduce((a, r) => a + Math.max(0, stockDisponible(r as any)), 0);
        if (stock <= 0) return null;
        const precios = s.map((r) => Number(r.precio));
        const min = Math.min(...precios);
        const max = Math.max(...precios);
        return { precio: min === max ? min : { desde: min, hasta: max }, stock };
      };

      const armarItems = (prods: typeof productos) => {
        const out: Record<string, unknown>[] = [];
        for (const p of prods) {
          const desc = (p.descripcion ?? '').slice(0, 90);
          const variantesConStock = p.variantes
            .map((v) => ({ v, ps: precioYStock(v.stocksPorSede) }))
            .filter((x): x is { v: (typeof p.variantes)[number]; ps: NonNullable<ReturnType<typeof precioYStock>> } => x.ps !== null);

          if (variantesConStock.length > 0) {
            for (const { v, ps } of variantesConStock) {
              out.push({
                id: p.id,
                varianteId: v.id,
                nombre: `${p.nombre} ${v.nombre}`.trim(),
                descCorta: desc,
                precio: ps.precio,
                stockDisponible: ps.stock,
              });
            }
          } else {
            const ps = precioYStock(p.stocksPorSede);
            if (!ps) continue;
            out.push({
              id: p.id,
              nombre: p.nombre,
              descCorta: desc,
              precio: ps.precio,
              stockDisponible: ps.stock,
            });
          }
        }
        return out;
      };
      let items = armarItems(productos);

      // Fallback FUZZY (pg_trgm): "estevia"→ESTEBIA, "almuhada"→ALMOHADA…
      // typos y variantes ortográficas que `contains` no matchea. Umbral 0.35
      // (medido: typos reales ≈0.45-0.5; palabras distintas quedan fuera).
      if (items.length === 0) {
        const parecidos = await prisma.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Producto"
          WHERE "empresaId" = ${ctx.empresaId} AND "deletedAt" IS NULL
            AND similarity(nombre, ${query}) > 0.35
          ORDER BY similarity(nombre, ${query}) DESC
          LIMIT 10`;
        if (parecidos.length > 0) {
          productos = await buscarEnBd({
            id: { in: parecidos.map((r) => r.id) },
          });
          items = armarItems(productos);
        }
      }

      // ¿Quedaron productos FUERA del tope? El agente debe decirlo (y ofrecer
      // afinar o pedir la página siguiente), no fingir que esto es todo — con
      // tope corto la gente creía que no había más modelos.
      const totalItems = items.length;
      const desde = (pagina - 1) * MAX_RESULTADOS;
      const salida = items.slice(desde, desde + MAX_RESULTADOS);
      // Recordar id+varianteId de lo mostrado → crearVenta lo resuelve luego.
      recordarCatalogo(
        ctx,
        salida.map((p) => ({
          id: p.id as string,
          varianteId: (p.varianteId as string | undefined) ?? null,
          nombre: p.nombre as string,
        })),
      );
      const hayMas = totalItems > desde + salida.length;
      // Memoria de búsqueda: el bot la persiste entre turnos → la Capa C
      // instruye paginar cuando el cliente pida "más".
      ctx.ultimaBusqueda = { query, pagina, hayMas };
      return {
        ok: true,
        productos: salida,
        pagina,
        // Señal para el agente: hay más modelos → puede pedir pagina+1.
        hayMas,
        ...(hayMas ? { totalCoincidencias: totalItems } : {}),
      };
    },
  };
}
