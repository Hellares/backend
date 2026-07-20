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

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Tokens alfanuméricos (separa también dígito↔letra: "2m" → ["2","m"]). */
function tokenizar(s: string): string[] {
  return norm(s)
    .replace(/([0-9])([a-z])/g, '$1 $2')
    .replace(/([a-z])([0-9])/g, '$1 $2')
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 0);
}

/**
 * Empareja el `productoId` que mandó el LLM con un ítem del CATÁLOGO mostrado.
 * Haiku manda el NOMBRE ("LAPICERO GEL BOIL"), un código inventado ("LAP001")
 * o un id abreviado con guiones ("ALMOHADA_ROJA_RELLENO_2M"). Estrategia:
 *   1) id exacto → nombre exacto
 *   2) TOKENS: todos los tokens del rawId aparecen en el nombre del ítem;
 *      único → match; empate (ej. "con"/"sin" relleno) → `opciones` para que
 *      el agente desambigüe (NO adivinar con plata de por medio).
 *   3) substring / letras (compatibilidad con casos previos).
 * Devuelve el ítem, o las `opciones` empatadas, o nada.
 */
export function emparejarCatalogo(
  ctx: ContextoTool,
  rawId: string,
): { match?: CatalogoItem; opciones?: CatalogoItem[] } {
  const cat = ctx.catalogoReciente ?? [];
  if (cat.length === 0) return {};
  const low = rawId.toLowerCase();

  let hit =
    cat.find((c) => c.id === rawId) ||
    cat.find((c) => norm(c.nombre) === norm(low));
  if (hit) return { match: hit };

  // TOKENS: el nombre del ítem contiene TODOS los tokens del rawId.
  const tks = tokenizar(rawId);
  if (tks.length >= 2) {
    const cubren = cat.filter((c) => {
      const n = norm(c.nombre);
      return tks.every((t) => n.includes(t));
    });
    if (cubren.length === 1) return { match: cubren[0] };
    if (cubren.length > 1) {
      // Empate real (query ambigua): que el agente elija.
      const unicos = [...new Map(cubren.map((c) => [c.varianteId ?? c.id, c])).values()];
      return { opciones: unicos.slice(0, 6) };
    }
  }

  // Substring directo (nombre corto contenido, o al revés).
  if (low.length >= 3) {
    const parciales = cat.filter(
      (c) =>
        norm(c.nombre).includes(norm(low)) ||
        norm(low).includes(norm(c.nombre)),
    );
    if (parciales.length === 1) return { match: parciales[0] };
  }
  // Letras del código ("LAP001" → "lap" ⊂ "lapicero…").
  const letras = norm(low).replace(/[^a-zñ]/g, '');
  if (letras.length >= 3) {
    const porLetras = cat.filter((c) =>
      norm(c.nombre).replace(/[^a-zñ]/g, '').includes(letras),
    );
    if (porLetras.length === 1) return { match: porLetras[0] };
  }
  return {};
}

/**
 * Versión simple para verDetalle: devuelve solo el id resuelto (o el original
 * si no hubo match único).
 */
export function resolverIdPorCatalogo(
  ctx: ContextoTool,
  rawId: string,
): string {
  return emparejarCatalogo(ctx, rawId).match?.id ?? rawId;
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
