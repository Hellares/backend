import { EntidadTipo, PrismaClient } from '@prisma/client';
import { ContextoTool, DefinicionTool, ResultadoTool } from './tool.types';
import {
  stockDisponible,
  recordarCatalogo,
  emparejarCatalogo,
} from './stock.util';

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
      const rawId = String(args.productoId ?? '').trim();
      if (!rawId) return { ok: false, motivo: 'FALTA_PRODUCTO_ID' };
      // Haiku a veces manda el NOMBRE en vez del id (pasó en beta: "LAPICERO
      // GEL BOIL" → NO_ENCONTRADO → "no tiene imagen"). Resolver contra el
      // catálogo mostrado y, si no, por nombre en BD. emparejarCatalogo
      // además trae el varianteId si pidió UNA variante ("edredón alianza
      // lima") → su foto propia tiene prioridad.
      const emp = emparejarCatalogo(ctx, rawId);
      let productoId = emp.match?.id ?? rawId;
      const varianteIdPedida = emp.match?.varianteId ?? null;
      if (productoId === rawId && rawId.length < 20) {
        // No parece cuid: buscar por nombre (único match para no adivinar).
        const porNombre = await prisma.producto.findMany({
          where: {
            empresaId: ctx.empresaId,
            deletedAt: null,
            nombre: { contains: rawId, mode: 'insensitive' },
          },
          select: { id: true },
          take: 2,
        });
        if (porNombre.length === 1) productoId = porNombre[0].id;
      }

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

      // Imágenes (Archivo polimórfico): del PRODUCTO y de sus VARIANTES —
      // muchos catálogos cargan la foto SOLO en la variante (EDREDON: el
      // producto no tiene Archivo, "Cristal"/"alianza lima" sí). Prioridad:
      // variante pedida → producto → primera variante con foto.
      const vIds = p.variantes.map((v) => v.id);
      const imgs = await prisma.archivo.findMany({
        where: {
          isActive: true,
          deletedAt: null,
          // Solo IMÁGENES: el primer Archivo puede ser un video (mp4) y
          // Evolution no lo acepta como imagen.
          mimeType: { startsWith: 'image/' },
          OR: [
            { entidadTipo: EntidadTipo.PRODUCTO, entidadId: productoId },
            ...(vIds.length
              ? [
                  {
                    entidadTipo: EntidadTipo.PRODUCTO_VARIANTE,
                    entidadId: { in: vIds },
                  },
                ]
              : []),
          ],
        },
        orderBy: { orden: 'asc' },
        select: {
          url: true,
          urlThumbnail: true,
          entidadTipo: true,
          entidadId: true,
        },
      });
      const imgDeVariante = (id: string) =>
        imgs.find(
          (a) => a.entidadTipo === 'PRODUCTO_VARIANTE' && a.entidadId === id,
        );
      const img =
        (varianteIdPedida ? imgDeVariante(varianteIdPedida) : undefined) ??
        imgs.find((a) => a.entidadTipo === 'PRODUCTO') ??
        imgs[0] ??
        null;

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
              // Foto propia de la variante (si la tiene) — el bot puede
              // mandarla y el agente sabe qué variantes tienen imagen.
              urlImagen: imgDeVariante(v.id)?.url ?? null,
            };
          }),
        },
      };
    },
  };
}
