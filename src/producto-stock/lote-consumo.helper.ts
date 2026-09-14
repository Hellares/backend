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
 * Para cada `ProductoStock`: **Σ `cantidadActual` de sus lotes PRESENTES
 * (ACTIVO + VENCIDO) = `stockActual`**. Todo lo de acá existe para mantenerla. Cuando una entrada
 * no tiene lote al que volver, se crea uno; si no, la suma se despegaría del
 * stock y el motor empezaría a leer lotes fantasma — que es exactamente el
 * estado del que venimos.
 */

/**
 * Estados en los que el lote está FÍSICAMENTE PRESENTE: la mercadería sigue en
 * el depósito y cuenta para `stockActual`.
 *
 * 🔴 `VENCIDO` entra acá a propósito. Un cron lo marca cuando pasa la fecha
 * (`marcarLotesVencidos`), pero la caja no desaparece del estante: si el
 * consumo lo excluyera, ese stock quedaría sin lote que lo respalde y la
 * invariante `Σ lotes = stockActual` se rompería sola el día que se carguen
 * vencimientos.
 *
 * Que se PUEDA vender lo decide la política del producto
 * (`Producto.tipoVencimiento`) en el guard de la venta, no el estado del lote.
 * Para sacarlo del inventario hay que darlo de baja por merma, que es una
 * decisión de una persona.
 */
export const ESTADOS_LOTE_PRESENTE = ['ACTIVO', 'VENCIDO'] as const;

/** Lo mínimo que se necesita de un lote para decidir el orden de consumo. */
export type LoteConsumible = {
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
 * Reparte [cantidad] entre los lotes en orden FEFO, SIN escribir nada.
 *
 * 🔑 Es la misma función que usa el consumo real: el "vender a costo" del POS
 * previsualiza con ESTE reparto, así que lo que el cajero ve es lo que
 * después va a salir. Si fueran dos implementaciones, se despegarían.
 *
 * Recibe los lotes ya cargados para poder reusarse desde una lectura pura (el
 * endpoint de costos) sin volver a consultarlos.
 */
export function planificarFefo<T extends LoteConsumible>(
  lotes: T[],
  cantidad: number,
  /**
   * Lote ELEGIDO a mano: se sirve de él primero, y solo el resto sigue el
   * orden FEFO.
   *
   * 🔑 Existe para la mercadería comprada POR ENCARGO. FEFO parte de que una
   * unidad es intercambiable con otra; cuando se le compró a un proveedor
   * puntual para un cliente puntual, esa caja tiene dueño y su costo es otro.
   * Sin esto, al cliente de la compra cara se le cobraría el costo de la
   * barata y se descontaría la mercadería del otro.
   *
   * No es un permiso para saltear vencimientos: quien elige asume el cambio,
   * y la UI avisa cuando deja atrás algo que caduca antes.
   */
  lotePreferidoId?: string | null,
): { plan: Array<{ lote: T; cantidad: number }>; sinCubrir: number } {
  if (cantidad <= 0) return { plan: [], sinCubrir: 0 };
  const preferido = lotePreferidoId
    ? lotes.find((l) => l.id === lotePreferidoId)
    : undefined;
  const orden = [
    ...(preferido ? [preferido] : []),
    ...[...lotes].sort(ordenFefo).filter((l) => l.id !== preferido?.id),
  ];
  const plan: Array<{ lote: T; cantidad: number }> = [];
  let restante = cantidad;
  for (const lote of orden) {
    if (restante <= 0) break;
    const toma = Math.min(lote.cantidadActual, restante);
    if (toma <= 0) continue;
    plan.push({ lote, cantidad: toma });
    restante -= toma;
  }
  return { plan, sinCubrir: restante };
}

/**
 * Ordena por FEFO: primero los que vencen, del más próximo al más lejano;
 * después los sin vencimiento, del más viejo al más nuevo.
 *
 * 🔑 Los sin vencimiento van AL FINAL, no mezclados por fecha de ingreso. Un
 * lote que caduca en 3 días tiene que salir antes que uno eterno que llegó
 * hace un año: la mercadería que se puede perder se mueve primero.
 */
export function ordenFefo(a: LoteConsumible, b: LoteConsumible): number {
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
  /** Lote elegido a mano; el resto sigue FEFO. Ver `planificarFefo`. */
  lotePreferidoId?: string | null,
): Promise<{ asignaciones: AsignacionLote[]; sinCubrir: number }> {
  if (cantidad <= 0) return { asignaciones: [], sinCubrir: 0 };

  const lotes = await tx.lote.findMany({
    where: {
      productoStockId,
      estado: { in: [...ESTADOS_LOTE_PRESENTE] },
      cantidadActual: { gt: 0 },
    },
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

  // 🔑 El MISMO planificador que usa la previsualización del POS: lo que el
  // cajero vio al cobrar es lo que efectivamente sale de acá.
  const { plan, sinCubrir } = planificarFefo(lotes, cantidad, lotePreferidoId);

  const asignaciones: AsignacionLote[] = [];

  for (const { lote, cantidad: toma } of plan) {
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
  }

  return { asignaciones, sinCubrir };
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

  // Lo ya devuelto por reversas ANTERIORES DEL MISMO DOCUMENTO, para no
  // reponer dos veces la misma unidad si se devuelve en tandas.
  //
  // 🔴 Acotado a la misma venta (o transferencia). Antes sumaba TODA
  // asignación negativa del lote, y la CREACIÓN de un lote `AJU-` se registra
  // en negativo: anular una venta que salió de un AJU- de 7 veía "ya se
  // devolvieron 7" y mandaba la unidad a un lote nuevo (ventas 917 y 918 de
  // beta, 13-09). Por lo mismo contaba las devoluciones de OTRAS ventas.
  const origenes = await tx.movimientoStock.findMany({
    where: { id: { in: movimientosOrigenIds } },
    select: { ventaId: true, transferenciaId: true },
  });
  const ventaIds = [
    ...new Set(origenes.map((o) => o.ventaId).filter((x): x is string => !!x)),
  ];
  const transferenciaIds = [
    ...new Set(
      origenes.map((o) => o.transferenciaId).filter((x): x is string => !!x),
    ),
  ];
  const mismoDocumento: Prisma.MovimientoStockWhereInput[] = [
    // La venta Y sus devoluciones: el movimiento de una devolución lleva
    // `devolucionId`, no `ventaId`, y también es una reversa de esa salida.
    ...(ventaIds.length
      ? [
          { ventaId: { in: ventaIds } },
          { devolucion: { ventaId: { in: ventaIds } } },
        ]
      : []),
    ...(transferenciaIds.length
      ? [{ transferenciaId: { in: transferenciaIds } }]
      : []),
  ];

  // Sin documento no hay tandas anteriores que se puedan reconocer.
  const devueltoPorLote = new Map<string, number>();
  if (mismoDocumento.length) {
    const yaDevuelto = await tx.movimientoStockLote.groupBy({
      by: ['loteId'],
      where: {
        loteId: { in: consumos.map((c) => c.loteId) },
        cantidad: { lt: 0 },
        movimiento: { id: { notIn: movimientosOrigenIds }, OR: mismoDocumento },
      },
      _sum: { cantidad: true },
    });
    for (const r of yaDevuelto) {
      devueltoPorLote.set(r.loteId, Math.abs(r._sum.cantidad ?? 0));
    }
  }

  const asignaciones: AsignacionLote[] = [];
  let restante = cantidad;

  for (const c of consumos) {
    if (restante <= 0) break;
    const disponible = c.cantidad - (devueltoPorLote.get(c.loteId) ?? 0);
    if (disponible <= 0) continue;
    const repone = Math.min(disponible, restante);

    // Un lote al que no se pudo reponer no cuenta como devuelto: esas unidades
    // quedan en `sinCubrir` y quien llama les crea un lote, en vez de registrar
    // una asignación que no pasó.
    if (!(await reponerEnLote(tx, c.loteId, repone))) continue;

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
 * Deshace EXACTAMENTE lo que ciertos movimientos consumieron de sus lotes, para
 * cuando esos movimientos se BORRAN en vez de revertirse con otro.
 *
 * 🔑 El caso: la venta Yape diferida que se cancela o vence sin pagar. No se
 * anula —nunca existió fiscalmente—, se borra con sus movimientos, y la cascada
 * se lleva las asignaciones: sin esto el stock volvía y los lotes quedaban
 * descontados para siempre (Σ lotes < stockActual).
 *
 * No usa `devolverALotesDeOrigen` a propósito: esa descuenta "lo ya devuelto"
 * mirando las OTRAS asignaciones negativas del lote, y la creación de un lote
 * `AJU-` se registra en negativo, así que nunca repondría a uno de esos. Acá no
 * hay devolución parcial que proteger: vuelve todo lo que salió.
 *
 * Llamar ANTES de borrar los movimientos. Devuelve las unidades que no se
 * pudieron reponer (0 con la invariante sana).
 */
export async function revertirConsumoDeLotes(
  tx: Prisma.TransactionClient,
  movimientoIds: string[],
): Promise<number> {
  if (!movimientoIds.length) return 0;

  const consumos = await tx.movimientoStockLote.findMany({
    where: { movimientoStockId: { in: movimientoIds }, cantidad: { gt: 0 } },
    select: { loteId: true, cantidad: true },
  });

  const porLote = new Map<string, number>();
  for (const c of consumos) {
    porLote.set(c.loteId, (porLote.get(c.loteId) ?? 0) + c.cantidad);
  }

  let sinReponer = 0;
  for (const [loteId, cantidad] of porLote) {
    if (!(await reponerEnLote(tx, loteId, cantidad))) sinReponer += cantidad;
  }
  return sinReponer;
}

/**
 * Para las SALIDAS que se van a BORRAR (la venta Yape diferida que se cancela
 * o vence): repone a sus lotes lo que consumieron y, con el motor prendido,
 * cubre con un lote de ajuste lo que ningún lote respaldó.
 *
 * 🔴 El caso: una venta diferida creada ANTES de prender el motor y cancelada
 * DESPUÉS. Descontó stock cuando no había lotes, así que no tiene
 * asignaciones: el stock vuelve igual y, sin lote al que volver, quedaría
 * stock sin respaldo (Σ lotes < stockActual). Lo mismo si al venderse los
 * lotes no alcanzaron.
 *
 * `motorActivo` lo pasa quien llama: este archivo no puede importar el helper
 * de movimientos sin armar una dependencia circular.
 *
 * Llamar ANTES de borrar los movimientos.
 */
export async function reponerLotesDeSalidasBorradas(
  tx: Prisma.TransactionClient,
  movimientos: Array<{
    id: string;
    productoStockId: string;
    empresaId: string;
    sedeId: string;
    cantidad: number;
    precioCostoUnitario: Prisma.Decimal | null;
    usuarioId: string;
  }>,
  motorActivo: boolean,
): Promise<{ sinReponer: number; enLoteNuevo: number }> {
  const salidas = movimientos.filter((m) => m.cantidad < 0);
  if (!salidas.length) return { sinReponer: 0, enLoteNuevo: 0 };
  const ids = salidas.map((m) => m.id);

  // Lo que cada salida tomó de lotes, leído ANTES de reponerlo.
  const tomado = await tx.movimientoStockLote.groupBy({
    by: ['movimientoStockId'],
    where: { movimientoStockId: { in: ids }, cantidad: { gt: 0 } },
    _sum: { cantidad: true },
  });
  const tomadoPorSalida = new Map<string, number>();
  for (const t of tomado) {
    tomadoPorSalida.set(t.movimientoStockId, t._sum.cantidad ?? 0);
  }

  const sinReponer = await revertirConsumoDeLotes(tx, ids);

  let enLoteNuevo = 0;
  if (motorActivo) {
    for (const s of salidas) {
      const faltante = Math.abs(s.cantidad) - (tomadoPorSalida.get(s.id) ?? 0);
      if (faltante <= 0) continue;
      const stock = await tx.productoStock.findUnique({
        where: { id: s.productoStockId },
        select: { productoId: true, varianteId: true },
      });
      const nuevo = await crearLoteDeEntrada(tx, {
        productoStockId: s.productoStockId,
        empresaId: s.empresaId,
        sedeId: s.sedeId,
        productoId: stock?.productoId ?? null,
        varianteId: stock?.varianteId ?? null,
        cantidad: faltante,
        costoUnitario: s.precioCostoUnitario,
        // Único: el id de la salida lo es (y la salida se borra enseguida).
        codigo: `AJU-${s.id}`,
        motivo:
          'Cancelación de un cobro diferido: unidades que no habían salido de ningún lote',
        usuarioId: s.usuarioId,
      });
      if (nuevo) enLoteNuevo += faltante;
    }
  }
  return { sinReponer, enLoteNuevo };
}

/**
 * Le suma [cantidad] a un lote que vuelve a tener mercadería. Devuelve si lo
 * encontró en un estado al que se le puede reponer.
 *
 * 🔴 Dos `updateMany` EXCLUYENTES, y el ORDEN importa: primero el lote que ya
 * está presente, recién después el AGOTADO. Al revés —como estaba— el primero
 * pasaba el AGOTADO a ACTIVO y el segundo, que filtra por ACTIVO, lo volvía a
 * encontrar y sumaba OTRA VEZ: anular la venta que agotó un lote de 3 lo
 * dejaba en 6.
 *
 * Solo se reactiva lo que estaba AGOTADO. Un lote VENCIDO suma sin volver a
 * ACTIVO: que la mercadería regrese no la hace vendible, y resucitarlo la
 * pondría a la venta sin que nadie lo decida. No es un `update` porque exige un
 * `where` único y el estado no se puede condicionar ahí.
 */
async function reponerEnLote(
  tx: Prisma.TransactionClient,
  loteId: string,
  cantidad: number,
): Promise<boolean> {
  const presente = await tx.lote.updateMany({
    where: { id: loteId, estado: { in: [...ESTADOS_LOTE_PRESENTE] } },
    data: { cantidadActual: { increment: cantidad } },
  });
  if (presente.count > 0) return true;

  const agotado = await tx.lote.updateMany({
    where: { id: loteId, estado: 'AGOTADO' },
    data: { cantidadActual: { increment: cantidad }, estado: 'ACTIVO' },
  });
  return agotado.count > 0;
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

/**
 * Una transferencia RECIBIDA hereda los lotes de los que salió en origen.
 *
 * 🔴 Sin esto, la entrada creaba un lote `AJU-` sin vencimiento ni proveedor:
 * la leche que viajaba a la sucursal llegaba "eterna", FEFO la mandaba al
 * final de la fila y el guard nunca la veía. Para un sistema que existe para
 * controlar vencimientos, ese era el agujero más grande.
 *
 * Cómo: se buscan las SALIDAS de la misma transferencia para el mismo
 * producto, se leen sus asignaciones (de qué lote salió cada unidad) y se
 * replican en destino — un lote por lote de origen, con su vencimiento, su
 * costo y su proveedor, enlazado por `loteOrigenId`. Una segunda recepción de
 * la misma transferencia SUMA al lote ya creado en vez de duplicarlo.
 *
 * Si la salida no tiene asignaciones (se envió con el motor apagado) no hay
 * nada que heredar: quien llama crea el lote de ajuste como siempre.
 */
export async function heredarLotesDeTransferencia(
  tx: Prisma.TransactionClient,
  movimiento: {
    id: string;
    productoStockId: string;
    empresaId: string;
    sedeId: string;
    transferenciaId: string;
    usuarioId: string;
  },
  cantidad: number,
  destino: { productoId: string | null; varianteId: string | null },
): Promise<{ asignaciones: AsignacionLote[]; sinCubrir: number }> {
  if (cantidad <= 0) return { asignaciones: [], sinCubrir: 0 };

  const salidas = await tx.movimientoStock.findMany({
    where: {
      transferenciaId: movimiento.transferenciaId,
      cantidad: { lt: 0 },
      productoStock: {
        productoId: destino.productoId,
        varianteId: destino.varianteId,
      },
    },
    select: { id: true, productoStockId: true },
  });
  if (!salidas.length) return { asignaciones: [], sinCubrir: cantidad };

  // Entra en la MISMA sede de la que salió (una transferencia rechazada que
  // vuelve): eso es una devolución, y vuelve a los lotes de origen.
  const propias = salidas.filter(
    (s) => s.productoStockId === movimiento.productoStockId,
  );
  if (propias.length) {
    return devolverALotesDeOrigen(
      tx,
      propias.map((s) => s.id),
      cantidad,
    );
  }

  const consumos = await tx.movimientoStockLote.findMany({
    where: {
      movimientoStockId: { in: salidas.map((s) => s.id) },
      cantidad: { gt: 0 },
    },
    select: {
      cantidad: true,
      lote: {
        select: {
          id: true,
          codigo: true,
          numeroLote: true,
          precioCosto: true,
          fechaVencimiento: true,
          fechaProduccion: true,
          proveedorId: true,
          nombreProveedor: true,
          compraId: true,
        },
      },
    },
    orderBy: { creadoEn: 'asc' },
  });
  if (!consumos.length) return { asignaciones: [], sinCubrir: cantidad };

  // Lo que recepciones ANTERIORES de esta misma transferencia ya heredaron de
  // cada lote de origen, para no duplicar unidades si llega en dos tandas.
  // Se acota a ESTA transferencia: otra que mueva el mismo lote no cuenta.
  const previas = await tx.movimientoStockLote.findMany({
    where: {
      cantidad: { lt: 0 },
      movimiento: {
        transferenciaId: movimiento.transferenciaId,
        productoStockId: movimiento.productoStockId,
        id: { not: movimiento.id },
      },
      lote: { loteOrigenId: { in: consumos.map((c) => c.lote.id) } },
    },
    select: { cantidad: true, lote: { select: { loteOrigenId: true } } },
  });
  const yaHeredado = new Map<string, number>();
  for (const p of previas) {
    const k = p.lote.loteOrigenId!;
    yaHeredado.set(k, (yaHeredado.get(k) ?? 0) + Math.abs(p.cantidad));
  }

  const asignaciones: AsignacionLote[] = [];
  let restante = cantidad;

  for (const c of consumos) {
    if (restante <= 0) break;
    const origen = c.lote;
    const disponible = c.cantidad - (yaHeredado.get(origen.id) ?? 0);
    if (disponible <= 0) continue;
    const toma = Math.min(disponible, restante);

    // Uno por (lote de origen, stock de destino): la segunda tanda suma.
    const existente = await tx.lote.findFirst({
      where: {
        productoStockId: movimiento.productoStockId,
        loteOrigenId: origen.id,
      },
      select: { id: true },
    });

    let loteId: string;
    if (existente) {
      loteId = existente.id;
      // Como en la devolución: se reactiva solo lo AGOTADO. Un VENCIDO no
      // resucita porque le llegue mercadería.
      await tx.lote.updateMany({
        where: { id: existente.id, estado: 'AGOTADO' },
        data: {
          cantidadActual: { increment: toma },
          cantidadInicial: { increment: toma },
          estado: 'ACTIVO',
        },
      });
      await tx.lote.updateMany({
        where: { id: existente.id, estado: { in: [...ESTADOS_LOTE_PRESENTE] } },
        data: {
          cantidadActual: { increment: toma },
          cantidadInicial: { increment: toma },
        },
      });
    } else {
      const nuevo = await tx.lote.create({
        data: {
          empresaId: movimiento.empresaId,
          sedeId: movimiento.sedeId,
          productoStockId: movimiento.productoStockId,
          productoId: destino.productoId,
          varianteId: destino.varianteId,
          compraId: origen.compraId,
          loteOrigenId: origen.id,
          // El código de origen con la sede pegada: se lee de dónde viene, y
          // es único por construcción (un origen, un destino, un solo lote).
          codigo: `${origen.codigo}/${movimiento.sedeId.slice(-4).toUpperCase()}`,
          numeroLote: origen.numeroLote,
          precioCosto: origen.precioCosto,
          moneda: 'PEN',
          cantidadInicial: toma,
          cantidadActual: toma,
          fechaVencimiento: origen.fechaVencimiento,
          fechaProduccion: origen.fechaProduccion,
          proveedorId: origen.proveedorId,
          nombreProveedor: origen.nombreProveedor,
          observaciones: `Transferencia: hereda el lote ${origen.codigo}`,
          creadoPor: movimiento.usuarioId,
        },
        select: { id: true },
      });
      loteId = nuevo.id;
    }

    asignaciones.push({
      loteId,
      cantidad: -toma,
      costoUnitario: origen.precioCosto,
    });
    yaHeredado.set(origen.id, (yaHeredado.get(origen.id) ?? 0) + toma);
    restante -= toma;
  }

  return { asignaciones, sinCubrir: restante };
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
