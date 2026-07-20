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

/**
 * Resuelve el `productoId` que mandó el LLM al ID REAL: Haiku a veces manda
 * el NOMBRE ("LAPICERO GEL BOIL") o un código inventado ("LAP001") en vez del
 * cuid. Orden: id exacto en catálogo → nombre exacto → parcial único →
 * LETRAS del código único ("LAP001"→"lap" ⊂ "lapicero..."). Devuelve el id
 * del catálogo o el valor original (que puede ser un cuid válido no mostrado).
 */
export function resolverIdPorCatalogo(
  ctx: ContextoTool,
  rawId: string,
): string {
  const cat = ctx.catalogoReciente ?? [];
  const low = rawId.toLowerCase();
  let hit =
    cat.find((c) => c.id === rawId) ||
    cat.find((c) => c.nombre.toLowerCase() === low);
  if (!hit && low.length >= 3) {
    const parciales = cat.filter(
      (c) =>
        c.nombre.toLowerCase().includes(low) ||
        low.includes(c.nombre.toLowerCase()),
    );
    if (parciales.length === 1) hit = parciales[0];
  }
  if (!hit) {
    const letras = low.replace(/[^a-záéíóúñ]/g, '');
    if (letras.length >= 3) {
      const porLetras = cat.filter((c) =>
        c.nombre.toLowerCase().includes(letras),
      );
      if (porLetras.length === 1) hit = porLetras[0];
    }
  }
  return hit?.id ?? rawId;
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
