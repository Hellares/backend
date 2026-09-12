import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';

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

export interface CostosDeItem {
  productoId: string | null;
  varianteId: string | null;
  /** `ProductoStock.precioCosto`: la mezcla de todas las compras. Es el que valora el kardex. */
  costoPromedio: number | null;
  /** `Lote.precioCosto` de la última compra: lo que costó esa unidad, flete adentro. */
  costoLote: number | null;
  /** El neto de la factura de esa misma compra, sin el flete prorrateado. */
  costoLoteSinFlete: number | null;
  origen: OrigenCostoLote | null;
}

/**
 * Los tres costos con los que se puede vender "a lo que me costó", y de qué
 * compra salió cada uno.
 *
 * 🔑 Los tres son CON IGV, igual que el precio de venta. Si la compra vino con
 * factura, vender a costo es neutro (el crédito fiscal tapa el débito); si el
 * proveedor no dio factura, ese IGV sale del bolsillo del vendedor.
 *
 * 🔴 El lote es "la última compra", NO el FIFO. `consumirLotesFIFO` existe pero
 * no la llama nadie, así que `Lote.cantidadActual` nunca baja por una venta y
 * "el lote más antiguo con stock" es una ficción que nunca avanza. La última
 * compra es el único dato que es un hecho — y para un revendedor, "a costo"
 * significa lo que costó ESTA vez, no hace ocho meses.
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
      ...new Set(items.map((i) => i.varianteId).filter((v): v is string => !!v)),
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

    // Última compra por ítem. Dos pasos a propósito: el primero trae filas
    // flacas (los lotes de un producto que se compra seguido son muchos,
    // porque ninguno se consume al vender) y el segundo hidrata solo los que
    // ganaron.
    const stockIds = stocks.map((s) => s.id);
    const ultimos = await this.prisma.lote.findMany({
      where: { empresaId, productoStockId: { in: stockIds }, estado: 'ACTIVO' },
      select: { id: true, productoStockId: true },
      orderBy: [{ fechaIngreso: 'desc' }, { creadoEn: 'desc' }],
      distinct: ['productoStockId'],
    });

    const lotes = ultimos.length
      ? await this.prisma.lote.findMany({
          where: { id: { in: ultimos.map((l) => l.id) } },
          select: {
            id: true,
            productoStockId: true,
            codigo: true,
            precioCosto: true,
            fechaIngreso: true,
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
        })
      : [];
    const lotePorStock = new Map(lotes.map((l) => [l.productoStockId, l]));

    for (const s of stocks) {
      const clave = CostoVentaService.clave(s.productoId, s.varianteId);
      const lote = lotePorStock.get(s.id);
      const costoPromedio = s.precioCosto != null ? Number(s.precioCosto) : null;

      if (!lote) {
        out.set(clave, {
          productoId: s.productoId,
          varianteId: s.varianteId,
          costoPromedio,
          costoLote: null,
          costoLoteSinFlete: null,
          origen: null,
        });
        continue;
      }

      // El tipo de cambio de la compra está CONGELADO: el costo del inventario
      // se fijó en soles el día que entró y no se mueve más (lo que se mueve
      // es la deuda). Por eso el neto sin flete se reconstruye con ESE tipo de
      // cambio y no con el de hoy.
      const tc =
        lote.compra && lote.compra.moneda !== 'PEN' && lote.compra.tipoCambio
          ? Number(lote.compra.tipoCambio)
          : 1;
      const detalle = lote.detallesCompra[0] ?? null;
      const costoLote = Number(lote.precioCosto);
      // 🔴 El neto de la factura NO es `precioUnitario`: ese es el de LISTA.
      // `total` ya viene con el descuento aplicado y se divide por la cantidad
      // COMPLETA (las bonificadas incluidas), que es exactamente como se
      // calculó el costo del lote — solo que sin el flete.
      const costoLoteSinFlete =
        detalle && detalle.cantidad > 0
          ? (Number(detalle.total) / detalle.cantidad) * tc
          : null;
      const fleteUnitario =
        detalle && detalle.cantidad > 0 && detalle.gastoProrrateado != null
          ? (Number(detalle.gastoProrrateado) / detalle.cantidad) * tc
          : null;

      const doc = lote.compra
        ? [lote.compra.serieDocumentoProveedor, lote.compra.numeroDocumentoProveedor]
            .filter(Boolean)
            .join('-') || null
        : null;

      out.set(clave, {
        productoId: s.productoId,
        varianteId: s.varianteId,
        costoPromedio,
        costoLote,
        costoLoteSinFlete,
        origen: {
          loteId: lote.id,
          loteCodigo: lote.codigo,
          fechaIngreso: lote.fechaIngreso,
          proveedorNombre: lote.nombreProveedor,
          compraId: lote.compra?.id ?? null,
          compraCodigo: lote.compra?.codigo ?? null,
          documentoProveedor: doc,
          monedaCompra: lote.compra?.moneda ?? null,
          tipoCambio: lote.compra?.tipoCambio ? Number(lote.compra.tipoCambio) : null,
          fleteUnitario,
          cantidadBonificada: detalle?.cantidadBonificada ?? 0,
        },
      });
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
