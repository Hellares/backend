import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import {
  ESTADOS_LOTE_PRESENTE,
  ordenFefo,
  planificarFefo,
} from '../producto-stock/lote-consumo.helper';

/**
 * Modos de "vender a costo".
 *
 * 🔴 NO son un nivel de precio más. `calcularPrecioSegunCantidad` elige el
 * MENOR entre sus candidatos, y el costo siempre ganaría: todo se vendería a
 * costo sin que nadie lo pida. Por eso esto es un cortocircuito explícito y
 * OPT-IN por línea, que el cajero prende a mano.
 */
export const PRECIO_MODOS_COSTO = [
  'COSTO_LOTE',
  'COSTO_LOTE_SIN_FLETE',
  'COSTO_PROMEDIO',
] as const;

export type PrecioModoCosto = (typeof PRECIO_MODOS_COSTO)[number];

/**
 * Etiqueta que se sella en `VentaDetalle.nivelAplicadoSnapshot`, al lado de
 * "Por Mayor" / "Oferta" / "Liquidación". Es lo que después le permite al
 * reporte decir POR QUÉ esa venta no dejó margen.
 */
export const ETIQUETA_MODO_COSTO: Record<PrecioModoCosto, string> = {
  COSTO_LOTE: 'Costo lote',
  COSTO_LOTE_SIN_FLETE: 'Costo lote s/flete',
  COSTO_PROMEDIO: 'Costo promedio',
};

/** Un ítem del carrito por el que se preguntan los costos. */
export interface ItemCostoRef {
  productoId?: string | null;
  varianteId?: string | null;
  /**
   * Cuántas unidades se van a vender. Manda: de ella depende DE QUÉ LOTES sale
   * la mercadería y, por lo tanto, cuánto costó de verdad. Vender 3 puede
   * salir todo del lote barato; vender 5 arrastra 2 del caro.
   *
   * Sin cantidad se asume 1 — el comportamiento útil para una consulta suelta.
   */
  cantidad?: number;
  /**
   * Vender de ESTE lote en vez del que elegiría FEFO. Ver
   * `planificarFefo`: la mercadería comprada por encargo tiene dueño.
   */
  loteId?: string | null;
}

/** Una porción del pedido que sale de un lote concreto. */
export interface TramoCosto {
  loteId: string;
  loteCodigo: string;
  cantidad: number;
  costoUnitario: number;
  fechaVencimiento: Date | null;
  /** El neto de la factura de ESE lote, sin su flete prorrateado. */
  costoUnitarioSinFlete: number | null;
  proveedorNombre: string | null;
  documentoProveedor: string | null;
}

/** De qué compra salió el costo del lote. Es lo que la UI muestra al cajero. */
export interface OrigenCostoLote {
  loteId: string;
  loteCodigo: string;
  fechaIngreso: Date;
  proveedorNombre: string | null;
  compraId: string | null;
  compraCodigo: string | null;
  /** "F001-88214" armado con el documento del proveedor, si lo cargaron. */
  documentoProveedor: string | null;
  /** Moneda de la FACTURA (el costo ya viene convertido a soles). */
  monedaCompra: string | null;
  tipoCambio: number | null;
  /** Flete prorrateado que le tocó a la unidad, en soles. 0 si no hubo. */
  fleteUnitario: number | null;
  /** Unidades de regalo de esa línea de compra (promo 10+1). */
  cantidadBonificada: number;
}

/**
 * Un lote del que se PUEDE vender esta línea, para que el cajero elija.
 *
 * Vienen en el orden en que FEFO los tomaría: el primero es el que sale si
 * nadie elige nada. Se mandan todos los presentes (ACTIVO y VENCIDO) porque un
 * lote vencido sigue siendo mercadería del estante, y esconderlo acá dejaría
 * al cajero sin entender por qué la venta le pide autorización.
 */
export interface LoteVendible {
  loteId: string;
  codigo: string;
  /** Lo que QUEDA: el tope de lo que ese lote puede cubrir. */
  cantidadActual: number;
  costoUnitario: number;
  costoUnitarioSinFlete: number | null;
  fechaIngreso: Date;
  fechaVencimiento: Date | null;
  proveedorNombre: string | null;
  compraId: string | null;
  compraCodigo: string | null;
  documentoProveedor: string | null;
  cantidadBonificada: number;
}

export interface CostosDeItem {
  productoId: string | null;
  varianteId: string | null;
  /**
   * El lote elegido a mano para esta línea, o null si va en automático. Forma
   * parte de la clave: dos líneas del mismo producto con lotes distintos son
   * dos costos distintos.
   */
  loteId: string | null;
  /** Unidades sobre las que se calculó. */
  cantidad: number;
  /** `ProductoStock.precioCosto`: la mezcla de todas las compras. Es el que valora el kardex. */
  costoPromedio: number | null;
  /**
   * Lo que costaron LAS UNIDADES QUE VAN A SALIR, por unidad, flete adentro.
   *
   * 🔑 Es el promedio ponderado de los lotes que el consumo FEFO va a tomar,
   * no "el costo de la última compra". Vendiendo 5 cuando el lote nuevo tiene
   * 3 a S/ 11.80 y el viejo 2 a S/ 24.36, esto da 16.824 — que multiplicado
   * por 5 devuelve exactamente lo que esas cinco unidades costaron.
   */
  costoLote: number | null;
  /** Lo mismo, descontando el flete prorrateado de cada lote. */
  costoLoteSinFlete: number | null;
  /** De qué lotes sale, en orden de consumo. Es lo que la UI muestra desglosado. */
  tramos: TramoCosto[];
  /**
   * Unidades pedidas que NINGÚN lote cubre. Con la invariante sana esto es 0;
   * si no lo es, hay stock sin respaldo de lote y la UI tiene que decirlo en
   * vez de cobrar un costo inventado.
   */
  sinCubrir: number;
  /** El lote que ENCABEZA el consumo (el primer tramo). */
  origen: OrigenCostoLote | null;
  /**
   * Todos los lotes de los que se puede sacar esta línea, en orden FEFO.
   *
   * Es lo que alimenta el selector de lote del POS. Viaja con el costo y no en
   * un endpoint aparte porque elegir un lote ES elegir un costo: pedirlos por
   * separado los dejaría desincronizados justo cuando importa.
   */
  lotesDisponibles: LoteVendible[];
}

/**
 * Los tres costos con los que se puede vender "a lo que me costó", y de qué
 * compra salió cada uno.
 *
 * 🔑 Los tres son CON IGV, igual que el precio de venta. Si la compra vino con
 * factura, vender a costo es neutro (el crédito fiscal tapa el débito); si el
 * proveedor no dio factura, ese IGV sale del bolsillo del vendedor.
 *
 * 🔑 "El costo del lote" es el de LAS UNIDADES QUE VAN A SALIR, resuelto con
 * el mismo planificador FEFO que usa el consumo real (`planificarFefo`). No es
 * "el costo de la última compra": si se venden más unidades de las que trajo
 * esa compra, las de más costaron otra cosa y el precio lo refleja.
 *
 * Antes SÍ era "la última compra", porque los lotes no se consumían y no había
 * forma de saber de cuál salía cada unidad. Con el motor FEFO encendido el dato
 * es exacto, y esta es la diferencia entre cobrar un promedio plausible y
 * cobrar lo que costó.
 */
@Injectable()
export class CostoVentaService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CostoVentaService.name);
  }

  /**
   * Clave de un ítem del carrito. La variante MANDA sobre el producto: cuando
   * hay variante, el stock (y por lo tanto el costo) vive en la fila de la
   * variante, no en la del padre — `ProductoStock` es XOR.
   */
  static clave(productoId?: string | null, varianteId?: string | null): string {
    return varianteId ? `v:${varianteId}` : `p:${productoId ?? ''}`;
  }

  /**
   * Clave de una LÍNEA: el producto más el lote elegido.
   *
   * 🔴 Dos líneas del mismo producto con lotes distintos son dos costos
   * distintos y se cotizan aparte. Agruparlas por producto —como se hacía—
   * las mezclaba en un promedio y les ponía el lote de la primera a las dos:
   * la compra de CETI y la de DELTRON en el mismo carrito salían al mismo
   * precio. Las líneas en automático sí comparten la fila FEFO y se suman.
   */
  static claveDeLinea(
    productoId?: string | null,
    varianteId?: string | null,
    loteId?: string | null,
  ): string {
    return `${CostoVentaService.clave(productoId, varianteId)}@${loteId ?? ''}`;
  }

  /**
   * Resuelve los tres costos para varios ítems de una, porque el carrito
   * pregunta por todas sus líneas juntas: uno por uno serían N requests al
   * prender el interruptor.
   */
  async costosDeItems(
    items: ItemCostoRef[],
    sedeId: string,
    empresaId: string,
  ): Promise<Map<string, CostosDeItem>> {
    const out = new Map<string, CostosDeItem>();
    if (!items.length) return out;

    const varianteIds = [
      ...new Set(
        items.map((i) => i.varianteId).filter((v): v is string => !!v),
      ),
    ];
    // Solo los productos SIN variante: si la línea trae variante, su costo es
    // el de la variante y el del padre no se consulta.
    const productoIds = [
      ...new Set(
        items
          .filter((i) => !i.varianteId)
          .map((i) => i.productoId)
          .filter((p): p is string => !!p),
      ),
    ];
    if (!varianteIds.length && !productoIds.length) return out;

    const stocks = await this.prisma.productoStock.findMany({
      where: {
        empresaId,
        sedeId,
        OR: [
          ...(varianteIds.length ? [{ varianteId: { in: varianteIds } }] : []),
          ...(productoIds.length
            ? [{ productoId: { in: productoIds }, varianteId: null }]
            : []),
        ],
      },
      select: {
        id: true,
        productoId: true,
        varianteId: true,
        precioCosto: true,
      },
    });
    if (!stocks.length) return out;

    // TODOS los lotes vivos de los ítems del carrito, no solo el último: para
    // saber qué costó la mercadería hay que saber de qué lotes sale, y eso
    // depende de cuántas unidades se llevan. Va en una sola consulta, acotada
    // a los productos que están en el carrito.
    const stockIds = stocks.map((s) => s.id);
    const lotes = await this.prisma.lote.findMany({
      where: {
        empresaId,
        productoStockId: { in: stockIds },
        // PRESENTES, no solo ACTIVO: un lote VENCIDO sigue siendo mercadería
        // en el estante y el consumo FEFO lo va a tomar. Excluirlo acá haría
        // que la previsualización mostrara un costo distinto al que se cobra.
        estado: { in: [...ESTADOS_LOTE_PRESENTE] },
        cantidadActual: { gt: 0 },
      },
      select: {
        id: true,
        productoStockId: true,
        codigo: true,
        precioCosto: true,
        cantidadActual: true,
        fechaIngreso: true,
        fechaVencimiento: true,
        nombreProveedor: true,
        compra: {
          select: {
            id: true,
            codigo: true,
            moneda: true,
            tipoCambio: true,
            tipoDocumentoProveedor: true,
            serieDocumentoProveedor: true,
            numeroDocumentoProveedor: true,
          },
        },
        detallesCompra: {
          select: {
            cantidad: true,
            total: true,
            gastoProrrateado: true,
            cantidadBonificada: true,
          },
        },
      },
      // El desempate de los "sin vencimiento"; `planificarFefo` adelanta a los
      // que sí vencen.
      orderBy: [{ fechaIngreso: 'asc' }, { creadoEn: 'asc' }],
    });

    const lotesPorStock = new Map<string, typeof lotes>();
    for (const l of lotes) {
      const arr = lotesPorStock.get(l.productoStockId);
      if (arr) arr.push(l);
      else lotesPorStock.set(l.productoStockId, [l]);
    }

    // Un GRUPO por (producto, lote elegido). Las líneas en automático del mismo
    // producto se suman —comparten la fila FEFO—; cada lote elegido a mano va
    // aparte, porque su costo es el de ESE lote.
    type Grupo = { clave: string; loteId: string | null; cantidad: number };
    const grupos = new Map<string, Grupo>();
    for (const i of items) {
      const loteId = i.loteId ?? null;
      const k = CostoVentaService.claveDeLinea(
        i.productoId,
        i.varianteId,
        loteId,
      );
      const cant = Math.max(1, Math.ceil(i.cantidad ?? 1));
      const g = grupos.get(k);
      if (g) g.cantidad += cant;
      else {
        grupos.set(k, {
          clave: CostoVentaService.clave(i.productoId, i.varianteId),
          loteId,
          cantidad: cant,
        });
      }
    }
    const gruposPorClave = new Map<string, Grupo[]>();
    for (const g of grupos.values()) {
      const arr = gruposPorClave.get(g.clave);
      if (arr) arr.push(g);
      else gruposPorClave.set(g.clave, [g]);
    }

    type LoteVivo = (typeof lotes)[number];
    // El tipo de cambio de la compra está CONGELADO: el costo se fijó en soles
    // el día que entró y no se mueve (lo que se mueve es la deuda).
    const tcDe = (lote: LoteVivo): number =>
      lote.compra && lote.compra.moneda !== 'PEN' && lote.compra.tipoCambio
        ? Number(lote.compra.tipoCambio)
        : 1;
    // El neto de la factura por unidad NO es `precioUnitario`: ese es el de
    // LISTA. `total` ya trae el descuento y se divide por la cantidad COMPLETA
    // (bonificadas incluidas), igual que el costo del lote pero sin el flete.
    // Sin compra detrás (lote de apertura o de ajuste) no hay flete que sacar:
    // el neto ES el costo del lote.
    const netoDe = (lote: LoteVivo): number => {
      const d = lote.detallesCompra[0] ?? null;
      return d && d.cantidad > 0
        ? (Number(d.total) / d.cantidad) * tcDe(lote)
        : Number(lote.precioCosto);
    };
    const docDe = (lote: LoteVivo): string | null =>
      lote.compra
        ? [
            lote.compra.serieDocumentoProveedor,
            lote.compra.numeroDocumentoProveedor,
          ]
            .filter(Boolean)
            .join('-') || null
        : null;

    for (const s of stocks) {
      const clave = CostoVentaService.clave(s.productoId, s.varianteId);
      const costoPromedio =
        s.precioCosto != null ? Number(s.precioCosto) : null;
      const suyos = lotesPorStock.get(s.id) ?? [];

      // TODOS los que hay, no solo los que este pedido consume: el selector
      // ofrece justamente los que FEFO no habría elegido. Es el mismo listado
      // para todas las líneas del producto.
      const lotesDisponibles: LoteVendible[] = [...suyos]
        .sort(ordenFefo)
        .map((lote) => ({
          loteId: lote.id,
          codigo: lote.codigo,
          cantidadActual: lote.cantidadActual,
          costoUnitario: Number(lote.precioCosto),
          costoUnitarioSinFlete: netoDe(lote),
          fechaIngreso: lote.fechaIngreso,
          fechaVencimiento: lote.fechaVencimiento,
          proveedorNombre: lote.nombreProveedor,
          compraId: lote.compra?.id ?? null,
          compraCodigo: lote.compra?.codigo ?? null,
          documentoProveedor: docDe(lote),
          cantidadBonificada: lote.detallesCompra[0]?.cantidadBonificada ?? 0,
        }));

      // 🔑 Lo elegido a mano se sirve PRIMERO y lo automático toma lo que
      // queda; la venta consume en ese mismo orden. Cada grupo descuenta de
      // una copia lo que se lleva, para que el siguiente cotice sobre lo que
      // de verdad va a quedar — como si ya se hubiera cobrado el anterior.
      const ordenados = [...(gruposPorClave.get(clave) ?? [])].sort(
        (a, b) => Number(!a.loteId) - Number(!b.loteId),
      );
      const restantes = suyos.map((l) => ({ ...l }));

      for (const g of ordenados) {
        const cantidad = g.cantidad;

        // MISMO planificador que el consumo real: lo que se muestra acá es lo
        // que después va a salir del stock.
        const { plan, sinCubrir } = planificarFefo(
          restantes,
          cantidad,
          g.loteId,
        );
        for (const { lote, cantidad: qty } of plan) lote.cantidadActual -= qty;

        const tramos: TramoCosto[] = plan.map(({ lote, cantidad: qty }) => ({
          loteId: lote.id,
          loteCodigo: lote.codigo,
          cantidad: qty,
          costoUnitario: Number(lote.precioCosto),
          fechaVencimiento: lote.fechaVencimiento,
          costoUnitarioSinFlete: netoDe(lote),
          proveedorNombre: lote.nombreProveedor,
          documentoProveedor: docDe(lote),
        }));

        // Promedio PONDERADO de lo que sale: × cantidad devuelve exactamente lo
        // que esas unidades costaron. Se pondera solo sobre lo cubierto — las
        // unidades sin lote no tienen costo que promediar y se informan aparte.
        const cubiertas = tramos.reduce((a, t) => a + t.cantidad, 0);
        const costoLote = cubiertas
          ? tramos.reduce((a, t) => a + t.costoUnitario * t.cantidad, 0) /
            cubiertas
          : null;
        const costoLoteSinFlete = cubiertas
          ? tramos.reduce(
              (a, t) =>
                a + (t.costoUnitarioSinFlete ?? t.costoUnitario) * t.cantidad,
              0,
            ) / cubiertas
          : null;

        // El lote que ENCABEZA el consumo: es el que la línea nombra cuando no
        // se despliega el desglose.
        const primero = plan[0]?.lote ?? null;
        const detallePrimero = primero?.detallesCompra[0] ?? null;
        const tcPrimero = primero ? tcDe(primero) : 1;

        out.set(
          CostoVentaService.claveDeLinea(s.productoId, s.varianteId, g.loteId),
          {
            productoId: s.productoId,
            varianteId: s.varianteId,
            loteId: g.loteId,
            cantidad,
            costoPromedio,
            costoLote,
            costoLoteSinFlete,
            tramos,
            sinCubrir,
            lotesDisponibles,
            origen: primero
              ? {
                  loteId: primero.id,
                  loteCodigo: primero.codigo,
                  fechaIngreso: primero.fechaIngreso,
                  proveedorNombre: primero.nombreProveedor,
                  compraId: primero.compra?.id ?? null,
                  compraCodigo: primero.compra?.codigo ?? null,
                  documentoProveedor: primero.compra
                    ? [
                        primero.compra.serieDocumentoProveedor,
                        primero.compra.numeroDocumentoProveedor,
                      ]
                        .filter(Boolean)
                        .join('-') || null
                    : null,
                  monedaCompra: primero.compra?.moneda ?? null,
                  tipoCambio: primero.compra?.tipoCambio
                    ? Number(primero.compra.tipoCambio)
                    : null,
                  fleteUnitario:
                    detallePrimero && detallePrimero.cantidad > 0
                      ? (Number(detallePrimero.gastoProrrateado) /
                          detallePrimero.cantidad) *
                        tcPrimero
                      : null,
                  cantidadBonificada: detallePrimero?.cantidadBonificada ?? 0,
                }
              : null,
          },
        );
      }
    }

    return out;
  }

  /**
   * El número que efectivamente se va a cobrar en ese modo, o null si el modo
   * no se puede resolver para ese ítem (sin compras registradas, sin costo
   * cargado). Null NO se degrada al precio de lista en ningún lado: quien
   * llama tiene que abortar con un error explícito.
   */
  static precioDelModo(
    costos: CostosDeItem | undefined,
    modo: PrecioModoCosto,
  ): number | null {
    if (!costos) return null;
    const valor =
      modo === 'COSTO_LOTE'
        ? costos.costoLote
        : modo === 'COSTO_LOTE_SIN_FLETE'
          ? costos.costoLoteSinFlete
          : costos.costoPromedio;
    // Un costo en cero es "no cargado", no "gratis": vender a 0 por un dato
    // faltante es peor que no vender.
    return valor != null && valor > 0 ? valor : null;
  }
}
