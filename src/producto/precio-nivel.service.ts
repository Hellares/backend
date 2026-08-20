import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CreatePrecioNivelDto } from './dto/create-precio-nivel.dto';
import { UpdatePrecioNivelDto } from './dto/update-precio-nivel.dto';
import { PrecioNivelResponseDto } from './dto/precio-nivel-response.dto';
import { TipoPrecioNivel, Prisma } from '@prisma/client';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';

// Usar Prisma.Decimal para los valores decimales
const Decimal = Prisma.Decimal;

/** Redondea a 6 decimales (igual que el storage Decimal(14,6)). */
const round6 = (v: number): number => Math.round(v * 1_000_000) / 1_000_000;

/**
 * Contexto de precio especial de un cliente VIP, resuelto por VentaService a
 * partir de la política aplicable a la línea. PrecioNivelService es agnóstico
 * del dominio de descuentos: solo recibe la intención de precio ya resuelta.
 */
export interface VipPrecioContexto {
  politicaId: string;
  /** Etiqueta para el snapshot de la línea, ej. "VIP: Mayoristas". */
  etiqueta: string;
  modo:
    | 'PRECIO_COSTO'
    | 'PRECIO_MAYOR_DESDE_UNIDAD'
    | 'PORCENTAJE'
    | 'MONTO_FIJO';
  /** % o monto fijo, según modo PORCENTAJE / MONTO_FIJO. */
  valor?: number;
  /** % sobre costo (modo PRECIO_COSTO). null/0 = costo puro. */
  markupSobreCosto?: number;
  /** Estrategia de escalón (modo PRECIO_MAYOR_DESDE_UNIDAD). */
  estrategiaMayor?: 'PRIMER_NIVEL' | 'MEJOR_NIVEL';
  /** Tope de descuento en monto (modos PORCENTAJE / MONTO_FIJO). */
  descuentoMaximo?: number | null;
}

@Injectable()
export class PrecioNivelService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
    private readonly realtimeInvalidation: RealtimeInvalidationService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(PrecioNivelService.name);
  }

  /**
   * Crear un nivel de precio para un producto o variante
   */
  async create(
    empresaId: string,
    productoId?: string,
    varianteId?: string,
    dto?: CreatePrecioNivelDto,
  ): Promise<PrecioNivelResponseDto> {
    this.logger.info('Creating precio nivel', { productoId, varianteId, dto });

    // Validar que se proporcione al menos productoId o varianteId
    if (!productoId && !varianteId) {
      throw new BadRequestException(
        'Debe proporcionar productoId o varianteId',
      );
    }

    // Validar que no se proporcionen ambos
    if (productoId && varianteId) {
      throw new BadRequestException(
        'No puede proporcionar productoId y varianteId al mismo tiempo',
      );
    }

    // Validar que el producto o variante existe
    if (productoId) {
      const producto = await this.prisma.producto.findFirst({
        where: {
          id: productoId,
          empresaId,
          deletedAt: null,
        },
      });

      if (!producto) {
        throw new NotFoundException(`Producto ${productoId} no encontrado`);
      }
    }

    if (varianteId) {
      const variante = await this.prisma.productoVariante.findFirst({
        where: {
          id: varianteId,
          empresaId,
          deletedAt: null,
        },
      });

      if (!variante) {
        throw new NotFoundException(`Variante ${varianteId} no encontrada`);
      }
    }

    // Validar que cantidadMaxima sea mayor que cantidadMinima
    if (dto.cantidadMaxima && dto.cantidadMaxima <= dto.cantidadMinima) {
      throw new BadRequestException(
        'La cantidad máxima debe ser mayor que la cantidad mínima',
      );
    }

    // Validar que se proporcione precio o porcentajeDesc según el tipo
    if (
      dto.tipoPrecio === TipoPrecioNivel.PRECIO_FIJO &&
      (dto.precio === undefined || dto.precio === null)
    ) {
      throw new BadRequestException(
        'Debe proporcionar un precio para tipo PRECIO_FIJO',
      );
    }

    if (
      dto.tipoPrecio === TipoPrecioNivel.PORCENTAJE_DESCUENTO &&
      (dto.porcentajeDesc === undefined || dto.porcentajeDesc === null)
    ) {
      throw new BadRequestException(
        'Debe proporcionar un porcentaje de descuento para tipo PORCENTAJE_DESCUENTO',
      );
    }

    // Validar que no exista solapamiento de rangos
    await this.validateNoOverlap(
      productoId,
      varianteId,
      dto.cantidadMinima,
      dto.cantidadMaxima,
    );

    // Crear (o REACTIVAR) el nivel de precio. `remove` hace soft-delete
    // (isActive=false) y existe @@unique([productoId/varianteId, cantidadMinima]).
    // Si quedó una fila inactiva con esa misma cantidadMinima, un `create`
    // chocaría con el unique → 500. En su lugar la reactivamos/actualizamos.
    const dataNivel = {
      nombre: dto.nombre,
      cantidadMaxima: dto.cantidadMaxima,
      tipoPrecio: dto.tipoPrecio,
      precio: dto.precio ? new Decimal(dto.precio) : null,
      porcentajeDesc: dto.porcentajeDesc
        ? new Decimal(dto.porcentajeDesc)
        : null,
      descripcion: dto.descripcion,
      orden: dto.orden ?? 0,
      isActive: true,
    };

    const existente = await this.prisma.precioNivel.findFirst({
      where: {
        ...(productoId ? { productoId } : {}),
        ...(varianteId ? { varianteId } : {}),
        cantidadMinima: dto.cantidadMinima,
      },
    });

    const precioNivel = existente
      ? await this.prisma.precioNivel.update({
          where: { id: existente.id },
          data: dataNivel,
        })
      : await this.prisma.precioNivel.create({
          data: {
            productoId,
            varianteId,
            cantidadMinima: dto.cantidadMinima,
            ...dataNivel,
          },
        });

    this.logger.info('Precio nivel created successfully', {
      id: precioNivel.id,
    });

    // Notificar realtime: clientes con app abierta invalidan su cache
    // de niveles para este producto y vuelven a fetchearlos.
    this.realtimeInvalidation.notifyNivelesCambiados({
      empresaId,
      productoId: precioNivel.productoId,
      varianteId: precioNivel.varianteId,
    });

    return this.mapToResponseDto(precioNivel);
  }

  /**
   * Obtener todos los niveles de precio de un producto o variante
   */
  async findAll(
    productoId?: string,
    varianteId?: string,
  ): Promise<PrecioNivelResponseDto[]> {
    this.logger.info('Finding all precio niveles', { productoId, varianteId });

    const niveles = await this.prisma.precioNivel.findMany({
      where: {
        ...(productoId && { productoId }),
        ...(varianteId && { varianteId }),
        isActive: true,
      },
      orderBy: [{ orden: 'asc' }, { cantidadMinima: 'asc' }],
    });

    return niveles.map((nivel) => this.mapToResponseDto(nivel));
  }

  /**
   * Obtener un nivel de precio por ID
   */
  async findOne(id: string): Promise<PrecioNivelResponseDto> {
    this.logger.info('Finding precio nivel by id', { id });

    const nivel = await this.prisma.precioNivel.findUnique({
      where: { id },
    });

    if (!nivel) {
      throw new NotFoundException(`Nivel de precio ${id} no encontrado`);
    }

    return this.mapToResponseDto(nivel);
  }

  /**
   * Actualizar un nivel de precio
   */
  async update(
    id: string,
    dto: UpdatePrecioNivelDto,
  ): Promise<PrecioNivelResponseDto> {
    this.logger.info('Updating precio nivel', { id, dto });

    // Verificar que el nivel existe
    const nivelExistente = await this.prisma.precioNivel.findUnique({
      where: { id },
    });

    if (!nivelExistente) {
      throw new NotFoundException(`Nivel de precio ${id} no encontrado`);
    }

    // Validar cantidadMaxima si se está actualizando
    const cantidadMinima = dto.cantidadMinima ?? nivelExistente.cantidadMinima;
    const cantidadMaxima = dto.cantidadMaxima !== undefined
      ? dto.cantidadMaxima
      : nivelExistente.cantidadMaxima;

    if (cantidadMaxima && cantidadMaxima <= cantidadMinima) {
      throw new BadRequestException(
        'La cantidad máxima debe ser mayor que la cantidad mínima',
      );
    }

    // Validar tipo de precio y campos requeridos
    const tipoPrecio = dto.tipoPrecio ?? nivelExistente.tipoPrecio;

    if (
      tipoPrecio === TipoPrecioNivel.PRECIO_FIJO &&
      dto.precio === undefined &&
      !nivelExistente.precio
    ) {
      throw new BadRequestException(
        'Debe proporcionar un precio para tipo PRECIO_FIJO',
      );
    }

    if (
      tipoPrecio === TipoPrecioNivel.PORCENTAJE_DESCUENTO &&
      dto.porcentajeDesc === undefined &&
      !nivelExistente.porcentajeDesc
    ) {
      throw new BadRequestException(
        'Debe proporcionar un porcentaje de descuento para tipo PORCENTAJE_DESCUENTO',
      );
    }

    // Validar solapamiento si se están cambiando las cantidades
    if (dto.cantidadMinima !== undefined || dto.cantidadMaxima !== undefined) {
      await this.validateNoOverlap(
        nivelExistente.productoId,
        nivelExistente.varianteId,
        cantidadMinima,
        cantidadMaxima,
        id,
      );
    }

    // Actualizar el nivel
    const updated = await this.prisma.precioNivel.update({
      where: { id },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.cantidadMinima !== undefined && {
          cantidadMinima: dto.cantidadMinima,
        }),
        ...(dto.cantidadMaxima !== undefined && {
          cantidadMaxima: dto.cantidadMaxima,
        }),
        ...(dto.tipoPrecio && { tipoPrecio: dto.tipoPrecio }),
        ...(dto.precio !== undefined && {
          precio: dto.precio ? new Decimal(dto.precio) : null,
        }),
        ...(dto.porcentajeDesc !== undefined && {
          porcentajeDesc: dto.porcentajeDesc
            ? new Decimal(dto.porcentajeDesc)
            : null,
        }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.orden !== undefined && { orden: dto.orden }),
      },
    });

    this.logger.info('Precio nivel updated successfully', { id });

    // Notificar realtime. El nivel está vinculado a un producto o variante;
    // resolvemos el empresaId por la entidad asociada para enviar al
    // topic correcto.
    await this._notifyNivelChange(updated.productoId, updated.varianteId);

    return this.mapToResponseDto(updated);
  }

  /**
   * Eliminar un nivel de precio (soft delete)
   */
  async remove(id: string): Promise<void> {
    this.logger.info('Removing precio nivel', { id });

    const nivel = await this.prisma.precioNivel.findUnique({
      where: { id },
    });

    if (!nivel) {
      throw new NotFoundException(`Nivel de precio ${id} no encontrado`);
    }

    await this.prisma.precioNivel.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.info('Precio nivel removed successfully', { id });

    // Notificar realtime.
    await this._notifyNivelChange(nivel.productoId, nivel.varianteId);
  }

  /// Resuelve el `empresaId` de un producto/variante y emite el evento
  /// realtime `NIVELES_CAMBIADOS`. Si no se puede resolver (datos
  /// inconsistentes), simplemente no se emite — el rechazo 409 al cobrar
  /// sigue cubriendo el caso.
  private async _notifyNivelChange(
    productoId: string | null,
    varianteId: string | null,
  ): Promise<void> {
    try {
      let empresaId: string | null = null;
      if (productoId) {
        const p = await this.prisma.producto.findUnique({
          where: { id: productoId },
          select: { empresaId: true },
        });
        empresaId = p?.empresaId ?? null;
      } else if (varianteId) {
        const v = await this.prisma.productoVariante.findUnique({
          where: { id: varianteId },
          select: { empresaId: true },
        });
        empresaId = v?.empresaId ?? null;
      }
      if (!empresaId) return;
      this.realtimeInvalidation.notifyNivelesCambiados({
        empresaId,
        productoId,
        varianteId,
      });
    } catch (err) {
      // Silencioso — fire-and-forget.
    }
  }

  /**
   * Llave del GRUPO DE MAYOREO al que pertenece un nivel.
   *
   * Dos variantes del MISMO producto caen en el mismo grupo cuando tienen un
   * nivel equivalente: igual mínimo, igual máximo, igual tipo e igual valor.
   * Ese es todo el criterio — no hay tabla ni configuración que mantener.
   *
   * 🔴 El `nombre` del nivel NO entra en la llave a propósito: "Por Mayor" y
   * "Mayorista" con el mismo mínimo y el mismo precio son el mismo trato
   * comercial, y hacer que el rótulo los separe sería una trampa invisible.
   *
   * El `productoId` sí entra: el mayoreo combinado se acumula DENTRO de un
   * producto. Dos productos distintos con el mismo precio por mayor no suman
   * entre sí, y al estar la llave scopeada eso queda garantizado por
   * construcción, sin filtros extra en el llamador.
   */
  private static claveGrupoMayoreo(
    productoId: string,
    nivel: {
      cantidadMinima: number;
      cantidadMaxima: number | null;
      tipoPrecio: TipoPrecioNivel;
      precio: Prisma.Decimal | null;
      porcentajeDesc: Prisma.Decimal | null;
    },
  ): string {
    const valor =
      nivel.tipoPrecio === TipoPrecioNivel.PRECIO_FIJO
        ? nivel.precio?.toFixed(6) ?? 'sin-precio'
        : nivel.porcentajeDesc?.toFixed(2) ?? 'sin-pct';
    return [
      productoId,
      nivel.cantidadMinima,
      nivel.cantidadMaxima ?? 'inf',
      nivel.tipoPrecio,
      valor,
    ].join('|');
  }

  /**
   * MAYOREO COMBINADO: cuántas unidades acumula cada grupo de mayoreo del
   * carrito.
   *
   * El problema que resuelve: el mínimo de un nivel se evaluaba contra la
   * cantidad de SU línea, así que quien se llevaba 3 edredones de tres diseños
   * distintos —1 + 1 + 1— pagaba precio de lista aunque los tres compartieran
   * el mismo "Por Mayor ≥ 3". El cliente ve tres edredones; el sistema veía
   * tres líneas de uno.
   *
   * Devuelve un mapa `clave de grupo → unidades del carrito`, que
   * `calcularPrecioSegunCantidad` usa para decidir si un nivel aplica. Sin
   * mapa (o con un ítem que no está en ningún grupo) el comportamiento es el
   * de siempre: manda la cantidad de la línea.
   *
   * Qué NO acumula:
   * - Los componentes de un combo expandido (`ignorarNiveles`): el combo es su
   *   propio deal de precio y no debe empujar el mayoreo del resto.
   * - Las líneas sin variante. Los niveles de un producto SIN variantes son
   *   los del producto y no hay con quién combinarlos.
   *
   * Qué SÍ acumula, aunque sorprenda: una línea en liquidación. Esa línea
   * nunca recibe nivel (la liquidación gana), pero sus unidades son unidades
   * que el cliente se está llevando, así que cuentan para el mínimo de las
   * demás.
   */
  async calcularCantidadesGrupoMayoreo(
    items: Array<{
      varianteId?: string | null;
      cantidad: number;
      ignorarNiveles?: boolean;
    }>,
  ): Promise<Map<string, number>> {
    const totales = new Map<string, number>();

    const itemsQueAcumulan = items.filter(
      (i) => i.varianteId && !i.ignorarNiveles,
    );
    // Una sola línea no puede combinar con nadie: ahorramos las dos queries y
    // devolvemos el mapa vacío (= comportamiento de siempre).
    //
    // 🔴 Se cuentan LÍNEAS, no variantes distintas: la misma variante cargada
    // en dos líneas de 1 también tiene que sumar 2. Filtrar por ids únicos acá
    // dejaba ese carrito sin mayoreo.
    if (itemsQueAcumulan.length < 2) return totales;

    const varianteIds = [
      ...new Set(itemsQueAcumulan.map((i) => i.varianteId as string)),
    ];

    const [variantes, niveles] = await Promise.all([
      this.prisma.productoVariante.findMany({
        where: { id: { in: varianteIds } },
        select: { id: true, productoId: true },
      }),
      this.prisma.precioNivel.findMany({
        where: { varianteId: { in: varianteIds }, isActive: true },
      }),
    ]);

    const productoPorVariante = new Map(
      variantes.map((v) => [v.id, v.productoId]),
    );

    // varianteId → llaves de los grupos a los que pertenece. Una variante
    // puede estar en varios (un "≥2" y un "≥3" son grupos distintos), y el
    // unique (varianteId, cantidadMinima) garantiza que nunca aparezca dos
    // veces en la misma llave.
    const clavesPorVariante = new Map<string, string[]>();
    for (const nivel of niveles) {
      if (!nivel.varianteId) continue;
      const productoId = productoPorVariante.get(nivel.varianteId);
      if (!productoId) continue;
      const clave = PrecioNivelService.claveGrupoMayoreo(productoId, nivel);
      const previas = clavesPorVariante.get(nivel.varianteId) ?? [];
      previas.push(clave);
      clavesPorVariante.set(nivel.varianteId, previas);
    }

    for (const item of items) {
      if (!item.varianteId || item.ignorarNiveles) continue;
      const claves = clavesPorVariante.get(item.varianteId);
      if (!claves) continue;
      for (const clave of claves) {
        totales.set(clave, (totales.get(clave) ?? 0) + item.cantidad);
      }
    }

    return totales;
  }

  /**
   * MONITOR DE MAYOREO COMBINADO: cómo quedan agrupadas las variantes de un
   * producto según su configuración de niveles.
   *
   * Existe porque el grupo es IMPLÍCITO —sale de que dos variantes tengan el
   * mismo nivel, no de una tabla que alguien mantiene— y eso lo vuelve
   * invisible: nadie puede saber, mirando la pantalla de variantes, cuáles van
   * a combinar entre sí. Peor, cambiarle S/1 el mayor a una variante la saca
   * del grupo sin avisar.
   *
   * 🔴 Agrupa con `claveGrupoMayoreo`, la MISMA que usa el cálculo de precio.
   * Si el monitor agrupara por su cuenta podría mostrar algo distinto de lo que
   * el POS va a cobrar, que es exactamente el problema que viene a resolver.
   *
   * `sedeId` es opcional y solo sirve para traer el precio de lista y el stock
   * (que sí son por sede); la agrupación no depende de la sede.
   */
  async obtenerGruposMayoreo(productoId: string, sedeId?: string) {
    const producto = await this.prisma.producto.findUnique({
      where: { id: productoId },
      select: { id: true, nombre: true },
    });
    if (!producto) {
      throw new NotFoundException(`Producto ${productoId} no encontrado`);
    }

    const variantes = await this.prisma.productoVariante.findMany({
      where: { productoId, deletedAt: null },
      select: {
        id: true,
        nombre: true,
        sku: true,
        isActive: true,
        preciosNivel: { where: { isActive: true } },
        ...(sedeId
          ? {
              stocksPorSede: {
                where: { sedeId },
                select: { precio: true, stockActual: true },
              },
            }
          : {}),
      },
      orderBy: { nombre: 'asc' },
    });

    type VarianteFila = (typeof variantes)[number] & {
      stocksPorSede?: Array<{
        precio: Prisma.Decimal | null;
        stockActual: number;
      }>;
    };

    const datosDeVenta = (v: VarianteFila) => {
      const stock = v.stocksPorSede?.[0];
      return {
        precioVenta: stock?.precio ? stock.precio.toNumber() : null,
        stockActual: stock?.stockActual ?? null,
      };
    };

    const grupos = new Map<
      string,
      {
        clave: string;
        nombreNivel: string;
        cantidadMinima: number;
        cantidadMaxima: number | null;
        tipoPrecio: TipoPrecioNivel;
        precio: number | null;
        porcentajeDesc: number | null;
        variantes: Array<{
          varianteId: string;
          nombre: string;
          sku: string;
          isActive: boolean;
          precioVenta: number | null;
          stockActual: number | null;
          precioConNivel: number | null;
          ahorroUnitario: number | null;
        }>;
      }
    >();
    const sinNivel: Array<{
      varianteId: string;
      nombre: string;
      sku: string;
      isActive: boolean;
      precioVenta: number | null;
      stockActual: number | null;
    }> = [];

    for (const v of variantes as VarianteFila[]) {
      const venta = datosDeVenta(v);
      if (!v.preciosNivel.length) {
        sinNivel.push({
          varianteId: v.id,
          nombre: v.nombre,
          sku: v.sku,
          isActive: v.isActive,
          ...venta,
        });
        continue;
      }
      for (const nivel of v.preciosNivel) {
        const clave = PrecioNivelService.claveGrupoMayoreo(productoId, nivel);
        if (!grupos.has(clave)) {
          grupos.set(clave, {
            clave,
            nombreNivel: nivel.nombre,
            cantidadMinima: nivel.cantidadMinima,
            cantidadMaxima: nivel.cantidadMaxima,
            tipoPrecio: nivel.tipoPrecio,
            precio: nivel.precio ? nivel.precio.toNumber() : null,
            porcentajeDesc: nivel.porcentajeDesc
              ? nivel.porcentajeDesc.toNumber()
              : null,
            variantes: [],
          });
        }
        // Un nivel PORCENTAJE deja un precio distinto en cada variante (se
        // aplica sobre SU precio de lista), así que se resuelve por variante.
        const precioConNivel =
          nivel.tipoPrecio === TipoPrecioNivel.PRECIO_FIJO
            ? nivel.precio?.toNumber() ?? null
            : venta.precioVenta != null
              ? round6(
                  venta.precioVenta *
                    (1 - (nivel.porcentajeDesc?.toNumber() ?? 0) / 100),
                )
              : null;
        grupos.get(clave)!.variantes.push({
          varianteId: v.id,
          nombre: v.nombre,
          sku: v.sku,
          isActive: v.isActive,
          ...venta,
          precioConNivel,
          ahorroUnitario:
            venta.precioVenta != null && precioConNivel != null
              ? round6(venta.precioVenta - precioConNivel)
              : null,
        });
      }
    }

    const lista = [...grupos.values()]
      .map((g) => {
        const precios = g.variantes
          .map((v) => v.precioVenta)
          .filter((p): p is number => p != null);
        const distintos = new Set(precios);
        return {
          ...g,
          // Dos variantes en el mismo grupo pero con precio de lista distinto
          // reciben descuentos distintos por la misma rebaja. No es un error,
          // pero casi siempre es un precio mal cargado.
          preciosVentaDispares: distintos.size > 1,
          // Un nivel que no baja el precio nunca va a aplicar: el motor
          // descarta el nivel que no mejora la base.
          nivelSinEfecto: g.variantes.some(
            (v) =>
              v.precioVenta != null &&
              v.precioConNivel != null &&
              v.precioConNivel >= v.precioVenta,
          ),
        };
      })
      // Los grupos grandes primero: son los que más mueven la aguja.
      .sort((a, b) => b.variantes.length - a.variantes.length);

    return {
      productoId: producto.id,
      productoNombre: producto.nombre,
      sedeId: sedeId ?? null,
      totalVariantes: variantes.length,
      /** Variantes que SÍ pueden combinar (están en al menos un grupo). */
      variantesEnGrupo: variantes.length - sinNivel.length,
      grupos: lista,
      /** Estas nunca van a hacer mayoreo: no tienen ningún nivel cargado. */
      sinNivel,
    };
  }

  /**
   * Calcular el precio según la cantidad para un producto o variante
   * @param sedeId - Requerido para obtener el precio base desde ProductoStock
   */
  async calcularPrecioSegunCantidad(
    productoId: string | null,
    varianteId: string | null,
    sedeId: string,
    cantidad: number,
    opts?: {
      ignorarNiveles?: boolean;
      vips?: VipPrecioContexto[];
      /**
       * Unidades acumuladas por grupo de mayoreo en el carrito, de
       * `calcularCantidadesGrupoMayoreo`. Un nivel se evalúa contra el total
       * de SU grupo cuando ese total es mayor que la cantidad de la línea.
       * Sin este mapa, cada nivel se evalúa contra la línea, como siempre.
       */
      cantidadesGrupo?: Map<string, number>;
    },
  ): Promise<{
    precioUnitario: number;
    nivelAplicado: string;
    descuentoAplicado: number;
    precioBase: number;
    /** Estado de liquidación si se aplicó (para snapshot de motivo en VentaDetalle). */
    motivoLiquidacion?: string | null;
    /** Costo del producto en la sede al momento del cálculo. Usado por VentaService para snapshot de margen. */
    precioCosto?: number | null;
    /** true si el precio ganador vino de una política de precio especial (VIP). */
    vipAplicado?: boolean;
    /** ID de la política VIP que ganó (null si no aplicó/ no ganó). */
    vipPoliticaId?: string | null;
    /**
     * Precio PÚBLICO vigente (mínimo entre base, oferta y liquidación
     * activas): lo que pagaría cualquier cliente SIN nivel/VIP. Referencia
     * para mostrar el ahorro por precio especial sin contar las ofertas
     * públicas como "descuento".
     */
    precioPublico?: number;
  }> {
    this.logger.info('Calculating price by quantity', {
      productoId,
      varianteId,
      sedeId,
      cantidad,
    });

    // Obtener el stock con precios completos (base, oferta, liquidación, costo).
    let stock:
      | {
          precio: Prisma.Decimal | null;
          precioCosto: Prisma.Decimal | null;
          precioOferta: Prisma.Decimal | null;
          precioLiquidacion: Prisma.Decimal | null;
          enOferta: boolean;
          enLiquidacion: boolean;
          motivoLiquidacion: string | null;
          fechaInicioOferta: Date | null;
          fechaFinOferta: Date | null;
          fechaInicioLiquidacion: Date | null;
          fechaFinLiquidacion: Date | null;
        }
      | null = null;
    let itemNombre: string;
    /**
     * Producto al que pertenece el ítem: en una variante es el del padre, y es
     * el que scopea la llave del grupo de mayoreo. Null en un producto suelto,
     * que no combina con nadie.
     */
    let productoIdDelGrupo: string | null = null;

    if (varianteId) {
      const variante = await this.prisma.productoVariante.findUnique({
        where: { id: varianteId },
        include: { stocksPorSede: { where: { sedeId } } },
      });
      if (!variante) throw new NotFoundException(`Variante ${varianteId} no encontrada`);
      const s = variante.stocksPorSede[0];
      if (!s || !s.precio) {
        throw new BadRequestException(
          `No se ha configurado precio para la variante ${variante.nombre} en esta sede`,
        );
      }
      stock = s;
      itemNombre = variante.nombre;
      productoIdDelGrupo = variante.productoId;
    } else if (productoId) {
      const producto = await this.prisma.producto.findUnique({
        where: { id: productoId },
        include: { stocksPorSede: { where: { sedeId } } },
      });
      if (!producto) throw new NotFoundException(`Producto ${productoId} no encontrado`);
      const s = producto.stocksPorSede[0];
      if (!s || !s.precio) {
        throw new BadRequestException(
          `No se ha configurado precio para el producto ${producto.nombre} en esta sede`,
        );
      }
      stock = s;
      itemNombre = producto.nombre;
    } else {
      throw new BadRequestException('Debe proporcionar productoId o varianteId');
    }

    const precioBaseDecimal = stock.precio as Prisma.Decimal;
    const precioBase = precioBaseDecimal.toNumber();
    const precioCosto = stock.precioCosto ? stock.precioCosto.toNumber() : null;

    // Calcular precio según niveles (si aplica).
    // VARIANTE: sus niveles se guardan con productoId NULL + varianteId, así
    // que se filtra SOLO por varianteId. Exigir ambos (productoId AND
    // varianteId) nunca matcheaba y las variantes quedaban sin nivel/VIP.
    //
    // 🔴 El rango (cantidadMinima/cantidadMaxima) ya NO se filtra en SQL: con
    // mayoreo combinado, cada nivel se evalúa contra la cantidad de SU grupo,
    // que solo se conoce acá con el mapa en la mano. Se traen los niveles
    // activos del ítem —son un puñado— y el rango se resuelve en memoria.
    const niveles = await this.prisma.precioNivel.findMany({
      where: {
        ...(varianteId ? { varianteId } : { productoId }),
        isActive: true,
      },
      orderBy: { cantidadMinima: 'desc' },
    });

    /**
     * Cantidad contra la que se mide un nivel: la de su grupo de mayoreo si el
     * carrito acumuló más que esta línea, y si no la de la línea. El `max` es
     * lo que garantiza que esto nunca EMPEORE un precio existente — una línea
     * de 10 unidades sigue midiéndose por sus 10 aunque el grupo sume menos.
     */
    const cantidadParaNivel = (nivel: (typeof niveles)[number]): number => {
      if (!productoIdDelGrupo || !opts?.cantidadesGrupo) return cantidad;
      const clave = PrecioNivelService.claveGrupoMayoreo(
        productoIdDelGrupo,
        nivel,
      );
      const delGrupo = opts.cantidadesGrupo.get(clave);
      return delGrupo != null && delGrupo > cantidad ? delGrupo : cantidad;
    };

    const nivelesAplicables = niveles.filter((n) => {
      const efectiva = cantidadParaNivel(n);
      return (
        n.cantidadMinima <= efectiva &&
        (n.cantidadMaxima == null || n.cantidadMaxima >= efectiva)
      );
    });

    let precioConNivel: number | null = null;
    let nivelNombre: string | null = null;
    if (nivelesAplicables.length) {
      // El más específico = mayor cantidadMinima (el orderBy ya los dejó así).
      const nivel = nivelesAplicables[0];
      if (nivel.tipoPrecio === TipoPrecioNivel.PRECIO_FIJO) {
        precioConNivel = nivel.precio!.toNumber();
      } else {
        precioConNivel = precioBase * (1 - nivel.porcentajeDesc!.toNumber() / 100);
      }
      nivelNombre = nivel.nombre;
    }

    // Verificar oferta activa por fechas
    const now = new Date();
    const ofertaVigente =
      stock.enOferta &&
      stock.precioOferta != null &&
      (!stock.fechaInicioOferta || stock.fechaInicioOferta <= now) &&
      (!stock.fechaFinOferta || stock.fechaFinOferta >= now);
    const precioOferta = ofertaVigente ? stock.precioOferta!.toNumber() : null;

    // Verificar liquidación activa por fechas
    const liquidacionVigente =
      stock.enLiquidacion &&
      stock.precioLiquidacion != null &&
      (!stock.fechaInicioLiquidacion || stock.fechaInicioLiquidacion <= now) &&
      (!stock.fechaFinLiquidacion || stock.fechaFinLiquidacion >= now);
    const precioLiquidacion = liquidacionVigente ? stock.precioLiquidacion!.toNumber() : null;

    // Elegir el menor entre todos los precios aplicables.
    // Estrategia mismo patrón que carrito B2C (session_2026_05_07_carrito_b2c_niveles):
    // gana el menor sin acumular descuentos.
    //
    // EXCEPCION: si liquidacion activa, niveles por mayor se IGNORAN. Un
    // nivel "Por Mayor PRECIO_FIJO S/9" sobre un producto en liquidacion
    // a S/5 podria llevarlo de vuelta a S/9 si vende 12 unidades, lo cual
    // contradice el remate. La liquidacion gana siempre.
    const candidatos: Array<{
      valor: number;
      etiqueta: string;
      motivoLiquidacion?: string | null;
      vipPoliticaId?: string;
    }> = [{ valor: precioBase, etiqueta: 'Precio base' }];

    // ===== Candidatos de precio especial VIP =====
    // Cada política VIP aplicable entra como un candidato más del reduce (gana
    // el menor): el cliente recibe el menor precio entre TODAS sus políticas y
    // nunca paga más que una oferta/liquidación pública más barata. No aplica a
    // componentes de combo (ignorarNiveles), que tienen su propio deal.
    if (opts?.vips?.length && !opts?.ignorarNiveles) {
      for (const vip of opts.vips) {
        const vipCandidato = await this._calcularCandidatoVip(
          vip,
          productoId,
          varianteId,
          precioBase,
          precioCosto,
        );
        if (vipCandidato != null) {
          candidatos.push({
            valor: vipCandidato,
            etiqueta: vip.etiqueta,
            vipPoliticaId: vip.politicaId,
          });
        }
      }
    }
    // `ignorarNiveles`: los componentes de combo (origenComboId) NO usan
    // niveles por mayor — el combo es su propio deal de precio. Sin esto, el
    // backend preciaría el componente por volumen y divergiría del precio
    // que mandó el cliente (base/oferta/liquidación) → 409 al cobrar.
    if (precioConNivel != null && !liquidacionVigente && !opts?.ignorarNiveles) {
      candidatos.push({ valor: precioConNivel, etiqueta: nivelNombre ?? 'Nivel' });
    }
    if (precioOferta != null) candidatos.push({ valor: precioOferta, etiqueta: 'Oferta' });
    if (precioLiquidacion != null) {
      candidatos.push({
        valor: precioLiquidacion,
        etiqueta: 'Liquidación',
        motivoLiquidacion: stock.motivoLiquidacion,
      });
    }
    const ganador = candidatos.reduce((best, c) => (c.valor < best.valor ? c : best));
    const descuentoAplicado = precioBase > 0 ? ((precioBase - ganador.valor) / precioBase) * 100 : 0;

    this.logger.info('Price calculated', {
      itemNombre,
      cantidad,
      precioBase,
      precioUnitario: ganador.valor,
      nivelAplicado: ganador.etiqueta,
      descuentoAplicado,
      enOferta: ofertaVigente,
      enLiquidacion: liquidacionVigente,
    });

    return {
      precioUnitario: ganador.valor,
      nivelAplicado: ganador.etiqueta,
      descuentoAplicado,
      precioBase,
      motivoLiquidacion: ganador.motivoLiquidacion ?? null,
      precioCosto,
      vipAplicado: !!ganador.vipPoliticaId,
      vipPoliticaId: ganador.vipPoliticaId ?? null,
      precioPublico: Math.min(
        precioBase,
        precioOferta ?? Number.POSITIVE_INFINITY,
        precioLiquidacion ?? Number.POSITIVE_INFINITY,
      ),
    };
  }

  /**
   * Calcula el precio candidato de una política de precio especial (VIP) para
   * la línea. Devuelve null si el modo no puede resolverse (ej. PRECIO_COSTO
   * sin costo configurado, o MAYOR sin niveles).
   */
  private async _calcularCandidatoVip(
    vip: VipPrecioContexto,
    productoId: string | null,
    varianteId: string | null,
    precioBase: number,
    precioCosto: number | null,
  ): Promise<number | null> {
    switch (vip.modo) {
      case 'PRECIO_COSTO': {
        // Costo no configurado (null) o <= 0 → no aplica VIP (evita vender a 0).
        // Debe coincidir con Flutter (_calcularCandidatoVip) o saltaría el 409.
        if (precioCosto == null || precioCosto <= 0) return null;
        return round6(precioCosto * (1 + (vip.markupSobreCosto ?? 0) / 100));
      }
      case 'PRECIO_MAYOR_DESDE_UNIDAD': {
        // Todos los niveles activos, sin filtrar por cantidad (desde la unidad 1).
        // VARIANTE: sus niveles viven con productoId NULL + varianteId → se
        // filtra SOLO por varianteId (exigir ambos nunca matcheaba).
        const niveles = await this.prisma.precioNivel.findMany({
          where: {
            ...(varianteId ? { varianteId } : { productoId }),
            isActive: true,
          },
          orderBy: { cantidadMinima: 'asc' },
        });
        if (!niveles.length) return null;
        const precioDeNivel = (n: (typeof niveles)[number]): number =>
          n.tipoPrecio === TipoPrecioNivel.PRECIO_FIJO
            ? n.precio!.toNumber()
            : precioBase * (1 - n.porcentajeDesc!.toNumber() / 100);
        // Escalones "por mayor" = cantidadMinima > 1 (el de 1 es retail/base).
        const mayoristas = niveles.filter((n) => n.cantidadMinima > 1);
        const pool = mayoristas.length ? mayoristas : niveles;
        const elegido =
          (vip.estrategiaMayor ?? 'PRIMER_NIVEL') === 'MEJOR_NIVEL'
            ? pool.reduce((best, n) =>
                precioDeNivel(n) < precioDeNivel(best) ? n : best,
              )
            : pool[0]; // PRIMER_NIVEL: menor cantidadMinima (pool ya ordenado asc)
        return round6(precioDeNivel(elegido));
      }
      case 'PORCENTAJE': {
        let desc = precioBase * ((vip.valor ?? 0) / 100);
        if (vip.descuentoMaximo != null && desc > vip.descuentoMaximo) {
          desc = vip.descuentoMaximo;
        }
        return round6(Math.max(precioBase - desc, 0));
      }
      case 'MONTO_FIJO': {
        let desc = vip.valor ?? 0;
        if (vip.descuentoMaximo != null && desc > vip.descuentoMaximo) {
          desc = vip.descuentoMaximo;
        }
        return round6(Math.max(precioBase - desc, 0));
      }
      default:
        return null;
    }
  }

  /**
   * Validar que no haya solapamiento de rangos de cantidad
   */
  private async validateNoOverlap(
    productoId: string | null,
    varianteId: string | null,
    cantidadMinima: number,
    cantidadMaxima: number | null,
    excludeId?: string,
  ): Promise<void> {
    // Buscar niveles que se solapen
    const nivelesExistentes = await this.prisma.precioNivel.findMany({
      where: {
        ...(productoId && { productoId }),
        ...(varianteId && { varianteId }),
        ...(excludeId && { id: { not: excludeId } }),
        isActive: true,
      },
    });

    for (const nivel of nivelesExistentes) {
      const existeMin = nivel.cantidadMinima;
      const existeMax = nivel.cantidadMaxima;

      // Verificar solapamiento
      const solapa =
        (cantidadMinima >= existeMin &&
          (!existeMax || cantidadMinima <= existeMax)) ||
        (cantidadMaxima &&
          cantidadMaxima >= existeMin &&
          (!existeMax || cantidadMaxima <= existeMax)) ||
        (cantidadMinima <= existeMin &&
          (!cantidadMaxima || cantidadMaxima >= existeMin));

      if (solapa) {
        throw new ConflictException(
          `El rango de cantidades se solapa con el nivel "${nivel.nombre}" (${existeMin} - ${existeMax || '∞'})`,
        );
      }
    }
  }

  /**
   * Mapear a DTO de respuesta
   */
  private mapToResponseDto(nivel: any): PrecioNivelResponseDto {
    return {
      id: nivel.id,
      productoId: nivel.productoId,
      varianteId: nivel.varianteId,
      nombre: nivel.nombre,
      cantidadMinima: nivel.cantidadMinima,
      cantidadMaxima: nivel.cantidadMaxima,
      tipoPrecio: nivel.tipoPrecio,
      precio: nivel.precio ? nivel.precio.toNumber() : null,
      porcentajeDesc: nivel.porcentajeDesc
        ? nivel.porcentajeDesc.toNumber()
        : null,
      descripcion: nivel.descripcion,
      orden: nivel.orden,
      isActive: nivel.isActive,
      creadoEn: nivel.creadoEn,
      actualizadoEn: nivel.actualizadoEn,
    };
  }
}
