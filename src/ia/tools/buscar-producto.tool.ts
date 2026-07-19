import { PrismaClient } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';
import { stockDisponible } from './stock.util';

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

      const productos = await prisma.producto.findMany({
        where: {
          empresaId: ctx.empresaId,
          deletedAt: null,
          OR: [
            { nombre: { contains: query, mode: 'insensitive' } },
            { descripcion: { contains: query, mode: 'insensitive' } },
          ],
        },
        include: {
          stocksPorSede: {
            where: {
              precio: { not: null },
              ...(ctx.sedeId ? { sedeId: ctx.sedeId } : {}),
            },
          },
        },
        take: MAX_RESULTADOS * 3, // margen para descartar los sin stock/precio
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
