import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import {
  crearMovimientoStockConValoracion,
  lotesActivos,
} from '../producto-stock/movimiento-stock.helper';
import {
  crearLoteDeEntrada,
  heredarLotesDeSalida,
  registrarAsignaciones,
} from '../producto-stock/lote-consumo.helper';
import {
  construirNombreVariante,
  nombreEsAutogenerado,
} from './utils/nombre-variante.util';
import { TextoBusquedaService } from './texto-busqueda.service';
import { SepararPorDisenoDto } from './dto/separar-por-diseno.dto';

/**
 * Clave del atributo que distingue un diseño de otro dentro de la misma
 * colección. Fija a propósito: el servicio lo busca por clave y lo crea la
 * primera vez, así ninguna empresa tiene que configurarlo a mano.
 *
 * 🔴 NO es `dise_o`: ésa es la del atributo que JAYLI llamó "Diseño" y en
 * realidad guarda la COLECCIÓN (ALIANZA, KITTY…). Se renombró a "Colección".
 */
export const CLAVE_ATRIBUTO_DISENO = 'diseno';

/** El valor del atributo: "D1", "D2"… Corto porque va al nombre y al ticket. */
const PREFIJO_DISENO = 'D';

/**
 * Separa una variante en DISEÑOS: una foto = un diseño = una variante nueva
 * con su propio stock.
 *
 * El caso: "EDREDÓN 2 PLAZAS / KITTY" tiene 10 unidades y 8 fotos, porque cada
 * edredón tiene un estampado distinto. Vender "un KITTY" no alcanza: el
 * cliente elige ESE diseño y el catálogo tiene que dejar de mostrarlo cuando
 * se acaba. Se resuelve con lo que el sistema ya sabe hacer —variantes— en vez
 * de darle stock a las imágenes, que obligaría a tocar venta, compra, kardex,
 * transferencias, devoluciones y lotes.
 *
 * Cada diseño hereda de la original los atributos, la unidad, el precio y el
 * costo por sede y los precios por mayor, y se lleva su foto y sus unidades.
 * Las unidades salen de la original con un movimiento de kardex por lado y
 * **conservan su lote** (costo, proveedor, compra): el edredón no cambió de
 * factura por cambiar de nombre.
 */
@Injectable()
export class VarianteDisenoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly realtime: RealtimeInvalidationService,
    private readonly configCodigos: ConfiguracionCodigosService,
    private readonly textoBusqueda: TextoBusquedaService,
  ) {}

  async separar(
    empresaId: string,
    varianteId: string,
    dto: SepararPorDisenoDto,
    usuarioId: string,
  ) {
    const archivoIds = dto.disenos.map((d) => d.archivoId);
    if (new Set(archivoIds).size !== archivoIds.length) {
      throw new BadRequestException('Hay una foto repetida: cada foto es un diseño.');
    }

    const origen = await this.prisma.productoVariante.findFirst({
      where: { id: varianteId, empresaId, deletedAt: null },
      include: {
        atributosValores: {
          include: {
            atributo: {
              select: {
                id: true,
                clave: true,
                orden: true,
                usarEnNombreVariante: true,
              },
            },
          },
        },
        preciosNivel: { where: { isActive: true } },
        archivos: {
          where: { deletedAt: null, isActive: true },
          select: { id: true },
        },
      },
    });
    if (!origen) throw new NotFoundException('Variante no encontrada');

    if (origen.atributosValores.some((v) => v.atributo.clave === CLAVE_ATRIBUTO_DISENO)) {
      throw new BadRequestException(
        'Esta variante ya es un diseño. Para separarla, subí las fotos a la variante de la colección.',
      );
    }

    const fotosDeLaVariante = new Set(origen.archivos.map((a) => a.id));
    if (archivoIds.some((id) => !fotosDeLaVariante.has(id))) {
      throw new BadRequestException(
        'Alguna de las fotos no pertenece a esta variante (¿se borró o se movió?). Recargá y volvé a intentar.',
      );
    }

    const atributoDiseno = await this.asegurarAtributoDiseno(empresaId);
    const numeroInicial = await this.siguienteNumeroDeDiseno(
      origen.productoId,
      origen.atributosValores,
      atributoDiseno.id,
    );

    const etiquetaAtributos = origen.atributosValores.map((v) => ({
      valor: v.valor,
      orden: v.atributo.orden,
      usarEnNombreVariante: v.atributo.usarEnNombreVariante,
    }));
    // Si el nombre lo puso una persona se respeta y se le agrega el diseño al
    // final; si era el autogenerado, se arma de nuevo con el atributo sumado.
    const nombreAutogenerado =
      etiquetaAtributos.length > 0 && nombreEsAutogenerado(origen.nombre, etiquetaAtributos);
    const nombreDe = (valorDiseno: string) =>
      nombreAutogenerado
        ? construirNombreVariante([
            ...etiquetaAtributos,
            {
              valor: valorDiseno,
              orden: atributoDiseno.orden,
              usarEnNombreVariante: true,
            },
          ])
        : `${origen.nombre} / ${valorDiseno}`;

    const creadas = await this.prisma.$transaction(
      async (tx) => {
        // Lock del stock de la original en TODAS sus sedes: se copian sus
        // precios a las nuevas, y en la sede que se separa se descuenta.
        const stocks = await tx.$queryRaw<Array<{ id: string; sedeId: string }>>`
          SELECT id, "sedeId" FROM "ProductoStock"
          WHERE "varianteId" = ${origen.id}
          ORDER BY id
          FOR UPDATE`;
        const stockFilas = await tx.productoStock.findMany({
          where: { id: { in: stocks.map((s) => s.id) } },
        });
        const stockSede = stockFilas.find((s) => s.sedeId === dto.sedeId);
        if (!stockSede) {
          throw new BadRequestException('La variante no tiene stock registrado en esa sede.');
        }

        const total = dto.disenos.reduce((acc, d) => acc + d.cantidad, 0);
        const disponible =
          stockSede.stockActual -
          stockSede.stockReservado -
          stockSede.stockReservadoVenta -
          stockSede.stockReservadoCombo -
          stockSede.stockReservadoCotizacion -
          stockSede.stockDanado -
          stockSede.stockEnGarantia;
        if (total > disponible) {
          throw new BadRequestException({
            code: 'STOCK_INSUFICIENTE',
            message: `Asignaste ${total} unidades y hay ${disponible} disponibles para separar.`,
            disponible,
            requerido: total,
          });
        }

        let stockOrigen = stockSede.stockActual;
        const resultado: Array<{ id: string; nombre: string; cantidad: number }> = [];

        for (const [i, diseno] of dto.disenos.entries()) {
          const valorDiseno = `${PREFIJO_DISENO}${numeroInicial + i}`;
          const nombre = nombreDe(valorDiseno);
          const sku = await this.skuLibre(tx, empresaId, `${origen.sku}-${valorDiseno}`);
          const { codigoEmpresa } = await this.configCodigos.generarCodigoVariante(empresaId, tx);

          const nueva = await tx.productoVariante.create({
            data: {
              productoId: origen.productoId,
              empresaId,
              nombre,
              sku,
              codigoEmpresa,
              unidadMedidaId: origen.unidadMedidaId,
              unidadPresentacionId: origen.unidadPresentacionId,
              factorPresentacion: origen.factorPresentacion,
              peso: origen.peso,
              dimensiones: origen.dimensiones ?? Prisma.JsonNull,
              isActive: true,
              orden: origen.orden,
            },
            select: { id: true },
          });

          await tx.productoAtributoValor.createMany({
            data: [
              ...origen.atributosValores.map((v) => ({
                varianteId: nueva.id,
                atributoId: v.atributoId,
                valor: v.valor,
              })),
              { varianteId: nueva.id, atributoId: atributoDiseno.id, valor: valorDiseno },
            ],
          });

          if (origen.preciosNivel.length) {
            await tx.precioNivel.createMany({
              data: origen.preciosNivel.map((n) => ({
                varianteId: nueva.id,
                nombre: n.nombre,
                cantidadMinima: n.cantidadMinima,
                cantidadMaxima: n.cantidadMaxima,
                tipoPrecio: n.tipoPrecio,
                precio: n.precio,
                porcentajeDesc: n.porcentajeDesc,
                descripcion: n.descripcion,
                orden: n.orden,
                isActive: true,
              })),
            });
          }

          await tx.archivo.update({
            where: { id: diseno.archivoId },
            data: {
              varianteId: nueva.id,
              entidadTipo: 'PRODUCTO_VARIANTE',
              entidadId: nueva.id,
              orden: 0,
            },
          });

          // El stock en las MISMAS sedes que la original, con sus precios: un
          // diseño se vende al precio de su colección.
          let stockDestinoId = '';
          for (const s of stockFilas) {
            const creado = await tx.productoStock.create({
              data: {
                sedeId: s.sedeId,
                empresaId,
                varianteId: nueva.id,
                stockActual: 0,
                stockMinimo: null,
                ubicacion: s.ubicacion,
                precio: s.precio,
                precioCosto: s.precioCosto,
                precioOferta: s.precioOferta,
                enOferta: s.enOferta,
                fechaInicioOferta: s.fechaInicioOferta,
                fechaFinOferta: s.fechaFinOferta,
                precioConfigurado: s.precioConfigurado,
                precioIncluyeIgv: s.precioIncluyeIgv,
                envioGratis: s.envioGratis,
              },
              select: { id: true },
            });
            if (s.id === stockSede.id) stockDestinoId = creado.id;
          }

          const motivo = `Separación por diseño: ${origen.nombre} → ${nombre}`;
          const costo = stockSede.precioCosto ?? null;

          const salida = await crearMovimientoStockConValoracion(tx, {
            productoStockId: stockSede.id,
            empresaId,
            sedeId: dto.sedeId,
            tipo: 'PRODUCCION_SALIDA',
            cantidad: -diseno.cantidad,
            cantidadAnterior: stockOrigen,
            cantidadNueva: stockOrigen - diseno.cantidad,
            usuarioId,
            motivo,
            precioCostoUnitario: costo,
          });
          stockOrigen -= diseno.cantidad;

          const entrada = await crearMovimientoStockConValoracion(tx, {
            productoStockId: stockDestinoId,
            empresaId,
            sedeId: dto.sedeId,
            tipo: 'PRODUCCION_ENTRADA',
            cantidad: diseno.cantidad,
            cantidadAnterior: 0,
            cantidadNueva: diseno.cantidad,
            usuarioId,
            motivo,
            precioCostoUnitario: costo,
            // Los lotes los replica esto de abajo desde los que consumió la
            // salida; si el helper además creara uno, se duplicarían.
            lotesGestionadosPorElLlamador: true,
          });

          const destinoLote = {
            productoStockId: stockDestinoId,
            empresaId,
            sedeId: dto.sedeId,
            productoId: null,
            varianteId: nueva.id,
            usuarioId,
          };
          const { asignaciones, sinCubrir } = await heredarLotesDeSalida(
            tx,
            salida.id,
            diseno.cantidad,
            { ...destinoLote, observaciones: 'Separación por diseño' },
          );
          // Unidades de la original que no tenían lote: la entrada igual
          // necesita respaldo, como cualquier ajuste. Con el motor apagado no
          // se crea ninguno, igual que en un ajuste común.
          if (sinCubrir > 0 && lotesActivos()) {
            const aju = await crearLoteDeEntrada(tx, {
              ...destinoLote,
              cantidad: sinCubrir,
              costoUnitario: costo != null ? new Prisma.Decimal(costo) : null,
              codigo: `AJU-${entrada.id}`,
              motivo,
            });
            if (aju) asignaciones.push(aju);
          }
          await registrarAsignaciones(tx, entrada.id, asignaciones);

          await tx.productoStock.update({
            where: { id: stockDestinoId },
            data: { stockActual: diseno.cantidad },
          });

          resultado.push({ id: nueva.id, nombre, cantidad: diseno.cantidad });
        }

        await tx.productoStock.update({
          where: { id: stockSede.id },
          data: { stockActual: stockOrigen },
        });

        // Si ya no le queda nada en ninguna sede, la original deja de
        // ofrecerse: sus unidades viven ahora en los diseños.
        const quedaEnOtras = stockFilas
          .filter((s) => s.id !== stockSede.id)
          .reduce((acc, s) => acc + s.stockActual, 0);
        const origenDesactivada = stockOrigen + quedaEnOtras === 0;
        if (origenDesactivada) {
          await tx.productoVariante.update({
            where: { id: origen.id },
            data: { isActive: false },
          });
        }

        return { disenos: resultado, stockRestante: stockOrigen, origenDesactivada };
      },
      { timeout: 30000 },
    );

    await this.textoBusqueda.recalcularProducto(origen.productoId);
    await this.cache.invalidateProductosLists(empresaId);
    this.realtime.notifyProductoActualizado({ empresaId, productoId: origen.productoId });

    return creadas;
  }

  /**
   * El atributo "Diseño" de la empresa; se crea la primera vez.
   *
   * TEXTO y no SELECT: los valores (D1, D2…) salen solos y no hace falta
   * mantener una lista de opciones. No sirve para filtrar —nadie busca "D3"—
   * pero sí entra al nombre, que es lo que distingue un diseño en el ticket.
   */
  private async asegurarAtributoDiseno(empresaId: string) {
    const existente = await this.prisma.productoAtributo.findUnique({
      where: { empresaId_clave: { empresaId, clave: CLAVE_ATRIBUTO_DISENO } },
      select: { id: true, orden: true, isActive: true },
    });
    if (existente) {
      if (!existente.isActive) {
        await this.prisma.productoAtributo.update({
          where: { id: existente.id },
          data: { isActive: true },
        });
      }
      return existente;
    }

    // Al final de todos: en el nombre va después de la colección.
    const ultimo = await this.prisma.productoAtributo.aggregate({
      where: { empresaId },
      _max: { orden: true },
    });
    return this.prisma.productoAtributo.upsert({
      where: { empresaId_clave: { empresaId, clave: CLAVE_ATRIBUTO_DISENO } },
      update: {},
      create: {
        empresaId,
        nombre: 'Diseño',
        clave: CLAVE_ATRIBUTO_DISENO,
        tipo: 'TEXTO',
        descripcion: 'Cada foto de la colección es un diseño con su propio stock.',
        orden: (ultimo._max.orden ?? 0) + 1,
        usarEnNombreVariante: true,
        usarParaFiltros: false,
        mostrarEnListado: true,
        mostrarEnMarketplace: false,
        categoriaIds: [],
      },
      select: { id: true, orden: true },
    });
  }

  /**
   * Los diseños se numeran POR COLECCIÓN: las variantes del producto que
   * tienen los mismos atributos que la original (sin contar el diseño).
   * Separar de nuevo cuando llega mercadería sigue en D9, no repite D1.
   */
  private async siguienteNumeroDeDiseno(
    productoId: string,
    valoresOrigen: Array<{ atributoId: string; valor: string }>,
    atributoDisenoId: string,
  ): Promise<number> {
    const clave = (vals: Array<{ atributoId: string; valor: string }>) =>
      vals
        .filter((v) => v.atributoId !== atributoDisenoId)
        .map((v) => `${v.atributoId}=${v.valor.trim().toUpperCase()}`)
        .sort()
        .join('|');
    const claveOrigen = clave(valoresOrigen);

    const hermanas = await this.prisma.productoVariante.findMany({
      where: {
        productoId,
        atributosValores: { some: { atributoId: atributoDisenoId } },
      },
      select: { atributosValores: { select: { atributoId: true, valor: true } } },
    });

    let max = 0;
    for (const h of hermanas) {
      if (clave(h.atributosValores) !== claveOrigen) continue;
      const valor = h.atributosValores.find((v) => v.atributoId === atributoDisenoId)?.valor ?? '';
      const n = Number(valor.replace(/^\D+/, ''));
      if (Number.isInteger(n) && n > max) max = n;
    }
    return max + 1;
  }

  private async skuLibre(
    tx: Prisma.TransactionClient,
    empresaId: string,
    base: string,
  ): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const sku = i === 0 ? base : `${base}-${i + 1}`;
      const usado = await tx.productoVariante.findFirst({
        where: { empresaId, sku },
        select: { id: true },
      });
      if (!usado) return sku;
    }
    throw new BadRequestException(`No se encontró un SKU libre para ${base}`);
  }
}
