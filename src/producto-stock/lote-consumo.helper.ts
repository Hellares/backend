import { Prisma } from '@prisma/client';

/**
 * Consumo y devolución de LOTES, enganchado al único embudo por el que pasan
 * todos los movimientos de stock del sistema.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 QUÉ NO HACE ESTO: cambiar el método de costeo.
 *
 * El kardex valora TODA salida con el costo promedio ponderado del
 * `ProductoStock`, y eso no se toca. Acá se mueven CANTIDADES por lote, para
 * trazabilidad y vencimientos. Si algún día se mezclan las dos cosas —costear
 * por lote— el COGS histórico deja de poder sumarse con el nuevo.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ## Por qué FEFO y no FIFO
 *
 * *First Expired, First Out*: sale primero lo que VENCE antes, no lo que
 * llegó antes. En perecederos el FIFO puro es incorrecto — deja adentro el
 * que caduca la semana que viene solo porque llegó después. Entre lotes sin
 * vencimiento, el desempate SÍ es por antigüedad (ahí FEFO degenera en FIFO,
 * que es lo correcto).
 *
 * ## La invariante que sostiene todo
 *
 * Para cada `ProductoStock`: **Σ `cantidadActual` de sus lotes ACTIVO =
 * `stockActual`**. Todo lo de acá existe para mantenerla. Cuando una entrada
 * no tiene lote al que volver, se crea uno; si no, la suma se despegaría del
 * stock y el motor empezaría a leer lotes fantasma — que es exactamente el
 * estado del que venimos.
 */

/** Lo mínimo que se necesita de un lote para decidir el orden de consumo. */
type LoteConsumible = {
  id: string;
  cantidadActual: number;
  precioCosto: Prisma.Decimal;
  fechaVencimiento: Date | null;
};

/** Una unidad de asignación: cuántas salieron (o volvieron) de qué lote. */
export interface AsignacionLote {
  loteId: string;
  cantidad: number;
  costoUnitario: Prisma.Decimal | null;
}

/**
 * Ordena por FEFO: primero los que vencen, del más próximo al más lejano;
 * después los sin vencimiento, del más viejo al más nuevo.
 *
 * 🔑 Los sin vencimiento van AL FINAL, no mezclados por fecha de ingreso. Un
 * lote que caduca en 3 días tiene que salir antes que uno eterno que llegó
 * hace un año: la mercadería que se puede perder se mueve primero.
 */
function ordenFefo(a: LoteConsumible, b: LoteConsumible): number {
  const va = a.fechaVencimiento;
  const vb = b.fechaVencimiento;
  if (va && vb) return va.getTime() - vb.getTime();
  if (va) return -1;
  if (vb) return 1;
  return 0; // el desempate por antigüedad ya viene del orderBy de la query
}

/**
 * Descuenta [cantidad] unidades de los lotes del ProductoStock, en orden FEFO.
 *
 * Devuelve cómo quedó repartido. Si los lotes no alcanzan, consume lo que hay
 * y devuelve el faltante en `sinCubrir` — **no lanza**: el stock ya se validó
 * antes (el guard de stock vive en la venta), y frenar acá abortaría una venta
 * legítima por una inconsistencia de lotes que el usuario no puede resolver en
 * el mostrador. El faltante queda para que quien llama lo logee.
 */
export async function consumirLotesFefo(
  tx: Prisma.TransactionClient,
  productoStockId: string,
  cantidad: number,
): Promise<{ asignaciones: AsignacionLote[]; sinCubrir: number }> {
  if (cantidad <= 0) return { asignaciones: [], sinCubrir: 0 };

  const lotes = await tx.lote.findMany({
    where: { productoStockId, estado: 'ACTIVO', cantidadActual: { gt: 0 } },
    select: {
      id: true,
      cantidadActual: true,
      precioCosto: true,
      fechaVencimiento: true,
    },
    // El desempate de los "sin vencimiento" sale de acá; `ordenFefo` solo
    // adelanta a los que sí vencen.
    orderBy: [{ fechaIngreso: 'asc' }, { creadoEn: 'asc' }],
  });
  lotes.sort(ordenFefo);

  const asignaciones: AsignacionLote[] = [];
  let restante = cantidad;

  for (const lote of lotes) {
    if (restante <= 0) break;
    const toma = Math.min(lote.cantidadActual, restante);
    if (toma <= 0) continue;

    const queda = lote.cantidadActual - toma;
    await tx.lote.update({
      where: { id: lote.id },
      data: {
        cantidadActual: queda,
        // AGOTADO al llegar a cero: saca al lote de las próximas búsquedas y
        // es lo que hace que el candado de anular compra vuelva a significar
        // algo ("tiene unidades vendidas").
        ...(queda === 0 ? { estado: 'AGOTADO' as const } : {}),
      },
    });

    asignaciones.push({
      loteId: lote.id,
      cantidad: toma,
      costoUnitario: lote.precioCosto,
    });
    restante -= toma;
  }

  return { asignaciones, sinCubrir: restante };
}

/**
 * Devuelve unidades a los lotes de los que SALIERON, leyendo las asignaciones
 * del movimiento original.
 *
 * Es lo que hace que una devolución o la anulación de una venta reponga la
 * mercadería con SU vencimiento y SU costo, en vez de inventar un lote nuevo
 * y perder la trazabilidad justo cuando más importa: la leche devuelta sigue
 * venciendo el día que vencía.
 *
 * Devuelve cuántas unidades NO se pudieron reponer así (porque se devuelven
 * más de las que ese movimiento sacó); quien llama decide qué hacer con ellas.
 */
export async function devolverALotesDeOrigen(
  tx: Prisma.TransactionClient,
  movimientosOrigenIds: string[],
  cantidad: number,
): Promise<{ asignaciones: AsignacionLote[]; sinCubrir: number }> {
  if (cantidad <= 0 || !movimientosOrigenIds.length) {
    return { asignaciones: [], sinCubrir: cantidad };
  }

  const consumos = await tx.movimientoStockLote.findMany({
    where: { movimientoStockId: { in: movimientosOrigenIds }, cantidad: { gt: 0 } },
    select: { loteId: true, cantidad: true, costoUnitario: true },
    // Se repone en orden INVERSO al consumo: lo último que salió es lo
    // primero que vuelve.
    orderBy: { creadoEn: 'desc' },
  });
  if (!consumos.length) return { asignaciones: [], sinCubrir: cantidad };

  // Lo ya devuelto por reversas anteriores, para no reponer dos veces la
  // misma unidad si se devuelve en tandas.
  const yaDevuelto = await tx.movimientoStockLote.groupBy({
    by: ['loteId'],
    where: {
      loteId: { in: consumos.map((c) => c.loteId) },
      cantidad: { lt: 0 },
      movimiento: { id: { notIn: movimientosOrigenIds } },
    },
    _sum: { cantidad: true },
  });
  const devueltoPorLote = new Map(
    yaDevuelto.map((r) => [r.loteId, Math.abs(r._sum.cantidad ?? 0)]),
  );

  const asignaciones: AsignacionLote[] = [];
  let restante = cantidad;

  for (const c of consumos) {
    if (restante <= 0) break;
    const disponible = c.cantidad - (devueltoPorLote.get(c.loteId) ?? 0);
    if (disponible <= 0) continue;
    const repone = Math.min(disponible, restante);

    await tx.lote.update({
      where: { id: c.loteId },
      data: {
        cantidadActual: { increment: repone },
        // Vuelve a ACTIVO: se había agotado y ahora tiene mercadería otra vez.
        // Un lote VENCIDO o BLOQUEADO NO se reactiva — que la unidad vuelva no
        // la hace vendible.
        estado: 'ACTIVO',
      },
    });

    asignaciones.push({
      loteId: c.loteId,
      cantidad: -repone,
      costoUnitario: c.costoUnitario,
    });
    devueltoPorLote.set(c.loteId, (devueltoPorLote.get(c.loteId) ?? 0) + repone);
    restante -= repone;
  }

  return { asignaciones, sinCubrir: restante };
}

/**
 * Crea un lote para una entrada que NO viene de una compra y no tiene lote al
 * que volver: ajuste de inventario, producción, transferencia recibida,
 * devolución sin origen rastreable.
 *
 * Existe para sostener la invariante `Σ lotes = stockActual`. Sin esto, cada
 * entrada por ajuste dejaría stock sin respaldo de lote y el consumo FEFO se
 * quedaría corto justo cuando hace falta.
 *
 * Sin `fechaVencimiento`: nadie la declaró. Un vencimiento inventado es peor
 * que ninguno — haría que el FEFO priorice una fecha que nadie verificó.
 */
export async function crearLoteDeEntrada(
  tx: Prisma.TransactionClient,
  params: {
    productoStockId: string;
    empresaId: string;
    sedeId: string;
    productoId: string | null;
    varianteId: string | null;
    cantidad: number;
    costoUnitario: Prisma.Decimal | null;
    codigo: string;
    motivo: string;
    usuarioId: string;
  },
): Promise<AsignacionLote | null> {
  if (params.cantidad <= 0) return null;

  const lote = await tx.lote.create({
    data: {
      empresaId: params.empresaId,
      sedeId: params.sedeId,
      productoStockId: params.productoStockId,
      productoId: params.productoId,
      varianteId: params.varianteId,
      codigo: params.codigo,
      precioCosto: params.costoUnitario ?? new Prisma.Decimal(0),
      moneda: 'PEN',
      cantidadInicial: params.cantidad,
      cantidadActual: params.cantidad,
      observaciones: params.motivo,
      creadoPor: params.usuarioId,
    },
    select: { id: true },
  });

  return {
    loteId: lote.id,
    cantidad: -params.cantidad,
    costoUnitario: params.costoUnitario,
  };
}

/** Persiste el reparto en la tabla puente. */
export async function registrarAsignaciones(
  tx: Prisma.TransactionClient,
  movimientoStockId: string,
  asignaciones: AsignacionLote[],
): Promise<void> {
  if (!asignaciones.length) return;
  await tx.movimientoStockLote.createMany({
    data: asignaciones.map((a) => ({
      movimientoStockId,
      loteId: a.loteId,
      cantidad: a.cantidad,
      costoUnitario: a.costoUnitario,
    })),
  });
}
