import { CatalogoItem, ContextoTool } from './tool.types';

/**
 * Registra en `ctx.catalogoReciente` los productos que el agente acaba de
 * mostrar (buscarProducto/verDetalle), para que crearVenta resuelva el id real
 * aunque el LLM luego mande el nombre. Deduplica por id+varianteId, tope 40.
 */
export function recordarCatalogo(
  ctx: ContextoTool,
  items: CatalogoItem[],
): void {
  if (!ctx.catalogoReciente) ctx.catalogoReciente = [];
  const cat = ctx.catalogoReciente;
  for (const it of items) {
    if (!it?.id || !it?.nombre) continue;
    const vid = it.varianteId ?? null;
    const i = cat.findIndex((c) => c.id === it.id && (c.varianteId ?? null) === vid);
    if (i >= 0) cat.splice(i, 1); // mover al final (más reciente)
    cat.push({ id: it.id, varianteId: vid, nombre: it.nombre });
  }
  if (cat.length > 40) cat.splice(0, cat.length - 40);
}

/** Fila de ProductoStock con los campos que afectan lo vendible. */
export interface FilaStock {
  stockActual: number;
  stockReservado: number;
  stockReservadoVenta: number;
  stockReservadoCombo: number;
  stockReservadoCotizacion: number;
  stockDanado: number;
  stockEnGarantia: number;
}

/**
 * Stock realmente VENDIBLE de una fila ProductoStock (mismo cálculo que
 * documenta stock.prisma: stockActual menos todas las reservas y no-vendibles).
 */
export function stockDisponible(s: FilaStock): number {
  return (
    s.stockActual -
    s.stockReservado -
    s.stockReservadoVenta -
    s.stockReservadoCombo -
    s.stockReservadoCotizacion -
    s.stockDanado -
    s.stockEnGarantia
  );
}
