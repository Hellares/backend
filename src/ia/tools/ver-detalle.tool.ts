import { PrismaClient } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';
import { stockDisponible, recordarCatalogo } from './stock.util';

/**
 * Tool `verDetalle` — detalle completo de UN producto: descripción,
 * precio, stock, imagen y variantes. Se usa con el `productoId` de un
 * resultado previo de `buscarProducto`.
 *
 * GUARD de pertenencia: aunque el LLM mande un id de otra empresa, la
 * query filtra por `empresaId` del tenant → "no encontrado". Precio y
 * stock SIEMPRE del sistema.
 */
export function crearVerDetalleTool(prisma: PrismaClient): DefinicionTool {
  return {
    nombre: 'verDetalle',
    descripcion:
      'Muestra el detalle completo de un producto (descripción, precio, ' +
      'stock, imagen y variantes). Usa el productoId de un resultado previo ' +
      'de buscarProducto. Precio y stock son del sistema, no los inventes.',
    parametros: {
      type: 'object',
      properties: {
        productoId: {
          type: 'string',
          description: 'ID del producto (obtenido de buscarProducto).',
        },
      },
      required: ['productoId'],
    },

    async ejecutar(args, ctx: ContextoTool): Promise<ResultadoTool> {
      const productoId = String(args.productoId ?? '').trim();
      if (!productoId) return { ok: false, motivo: 'FALTA_PRODUCTO_ID' };

      const p = await prisma.producto.findFirst({
        where: {
          id: productoId,
          empresaId: ctx.empresaId, // pertenencia al tenant
          deletedAt: null,
        },
        include: {
          stocksPorSede: {
            where: {
              precio: { not: null },
              ...(ctx.sedeId ? { sedeId: ctx.sedeId } : {}),
            },
          },
          variantes: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true,
              nombre: true,
              sku: true,
              // Precio/stock POR VARIANTE (edredón "3 piezas", "carnero"...).
              stocksPorSede: {
                where: {
                  precio: { not: null },
                  ...(ctx.sedeId ? { sedeId: ctx.sedeId } : {}),
                },
              },
            },
          },
        },
      });
      if (!p) return { ok: false, motivo: 'NO_ENCONTRADO' };

      // Precio/stock agregado = producto + variantes (igual que buscarProducto).
      const stocks = [
        ...p.stocksPorSede,
        ...p.variantes.flatMap((v) => v.stocksPorSede),
      ].filter((s) => s.precio != null);
      if (stocks.length === 0) return { ok: false, motivo: 'SIN_STOCK_EN_SEDE' };

      const precios = stocks.map((s) => Number(s.precio));
      const stockTotal = stocks.reduce(
        (a, s) => a + Math.max(0, stockDisponible(s)),
        0,
      );
      const min = Math.min(...precios);
      const max = Math.max(...precios);

      // Imagen principal (Archivo polimórfico entidadTipo=PRODUCTO).
      const img = await prisma.archivo.findFirst({
        where: {
          entidadTipo: 'PRODUCTO',
          entidadId: productoId,
          isActive: true,
          deletedAt: null,
        },
        orderBy: { orden: 'asc' },
        select: { url: true, urlThumbnail: true },
      });

      // Recordar el producto y sus variantes (id+varianteId) para crearVenta.
      recordarCatalogo(ctx, [
        { id: p.id, varianteId: null, nombre: p.nombre },
        ...p.variantes.map((v) => ({
          id: p.id,
          varianteId: v.id,
          nombre: `${p.nombre} ${v.nombre}`.trim(),
        })),
      ]);

      return {
        ok: true,
        producto: {
          id: p.id,
          nombre: p.nombre,
          descripcion: p.descripcion ?? '',
          precio: min === max ? min : { desde: min, hasta: max },
          stockDisponible: stockTotal,
          urlImagen: img?.url ?? null,
          urlThumbnail: img?.urlThumbnail ?? null,
          variantes: p.variantes.map((v) => {
            const vs = v.stocksPorSede.filter((s) => s.precio != null);
            const vprecios = vs.map((s) => Number(s.precio));
            return {
              id: v.id,
              nombre: v.nombre,
              sku: v.sku,
              precio: vprecios.length ? Math.min(...vprecios) : null,
              stockDisponible: vs.reduce(
                (a, s) => a + Math.max(0, stockDisponible(s)),
                0,
              ),
            };
          }),
        },
      };
    },
  };
}
