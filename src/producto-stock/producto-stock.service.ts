import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { CrearStockDto } from './dto/crear-stock.dto';
import { AjustarStockDto } from './dto/ajustar-stock.dto';
import { ActualizarPreciosSedeDto } from './dto/actualizar-precios-sede.dto';
import { QueryHistorialPreciosDto } from './dto/query-historial-precios.dto';
import { ActivarLiquidacionDto } from './dto/activar-liquidacion.dto';
import { BulkEditarStockPreciosDto } from './dto/bulk-editar-stock-precios.dto';
import {
  CampoPrecio,
  ComparacionPrecio,
  FiltroStock,
  ModoVerificacion,
  VerificarPreciosDto,
} from './dto/verificar-precios.dto';
import { Prisma, TipoCambioPrecio, TipoPrecioNivel } from '@prisma/client';
import { crearMovimientoStockConValoracion } from './movimiento-stock.helper';
import { PromocionService } from '../promocion/promocion.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';
import { createPaginatedResponse } from '../common/utils/pagination.util';
import {
  condicionStockPorPalabras,
  pareceCodigo,
  tokenizarBusqueda,
} from '../producto/texto-busqueda.util';

// Usar Prisma.Decimal para los valores decimales
const Decimal = Prisma.Decimal;
type DecimalType = Prisma.Decimal;

/// Lo mínimo para resolver el símbolo de una unidad: local > personalizado >
/// maestra, la misma jerarquía que usa el resto del catálogo.
const _selectSimbolo = {
  simboloLocal: true,
  simboloPersonalizado: true,
  unidadMaestra: { select: { simbolo: true } },
} as const;

/// Aplana la unidad de presentación a `{ factor, simbolo }`, que es lo único
/// que el cliente necesita para hablar en kilos en vez de gramos.
function _presentacionPlana(entidad: {
  factorPresentacion?: Prisma.Decimal | null;
  unidadPresentacion?: {
    simboloLocal?: string | null;
    simboloPersonalizado?: string | null;
    unidadMaestra?: { simbolo?: string | null } | null;
  } | null;
} | null): { factorPresentacion: number | null; unidadPresentacionSimbolo: string | null } {
  const u = entidad?.unidadPresentacion;
  return {
    factorPresentacion:
      entidad?.factorPresentacion != null
        ? Number(entidad.factorPresentacion)
        : null,
    unidadPresentacionSimbolo:
      u?.simboloLocal ?? u?.simboloPersonalizado ?? u?.unidadMaestra?.simbolo ?? null,
  };
}

@Injectable()
export class ProductoStockService {
  private readonly logger = new Logger(ProductoStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly promocionService: PromocionService,
    private readonly realtimeInvalidation: RealtimeInvalidationService,
  ) {}

  /**
   * Obtiene el stock de un producto/variante en una sede específica
   */
  async getStockPorSede(
    sedeId: string,
    productoId?: string,
    varianteId?: string,
  ) {
    if (!productoId && !varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }
    if (productoId && varianteId) {
      throw new BadRequestException(
        'Solo se debe enviar productoId o varianteId, no ambos',
      );
    }

    return await this.prisma.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
      include: {
        producto: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            sku: true,
            esInsumo: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
            sku: true,
          },
        },
        sede: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
          },
        },
      },
    });
  }

  /**
   * Crea un nuevo registro de stock para un producto/variante en una sede
   */
  async crearStock(
    empresaId: string,
    dto: CrearStockDto,
    usuarioId: string,
  ) {
    // Validar que se proporcione producto o variante (XOR)
    if (!dto.productoId && !dto.varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }
    if (dto.productoId && dto.varianteId) {
      throw new BadRequestException(
        'Solo se debe enviar productoId o varianteId, no ambos',
      );
    }

    // Validar que el producto o variante esté activo
    if (dto.productoId) {
      const producto = await this.prisma.producto.findFirst({
        where: { id: dto.productoId, empresaId, isActive: true },
      });
      if (!producto) {
        throw new NotFoundException(
          'Producto no encontrado o inactivo',
        );
      }
    }

    if (dto.varianteId) {
      const variante = await this.prisma.productoVariante.findFirst({
        where: { id: dto.varianteId, isActive: true },
      });
      if (!variante) {
        throw new NotFoundException(
          'Variante no encontrada o inactiva',
        );
      }
    }

    // Verificar que la sede esté activa
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId, isActive: true },
    });
    if (!sede) {
      throw new NotFoundException('Sede no encontrada o inactiva');
    }

    // Verificar que no exista ya un registro de stock
    const existente = await this.prisma.productoStock.findFirst({
      where: {
        sedeId: dto.sedeId,
        productoId: dto.productoId ?? null,
        varianteId: dto.varianteId ?? null,
      },
    });

    if (existente) {
      throw new BadRequestException(
        'Ya existe un registro de stock para este producto/variante en esta sede',
      );
    }

    // Crear stock y movimiento inicial en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // Crear registro de stock (incluyendo precios si se proporcionan)
      const stock = await tx.productoStock.create({
        data: {
          sedeId: dto.sedeId,
          empresaId,
          productoId: dto.productoId,
          varianteId: dto.varianteId,
          stockActual: dto.stockActual,
          stockMinimo: dto.stockMinimo,
          stockMaximo: dto.stockMaximo,
          ubicacion: dto.ubicacion,
          // Precios opcionales por sede
          precio: dto.precio ? new Decimal(dto.precio) : null,
          precioCosto: dto.precioCosto ? new Decimal(dto.precioCosto) : null,
          precioOferta: dto.precioOferta ? new Decimal(dto.precioOferta) : null,
          enOferta: dto.enOferta ?? false,
          fechaInicioOferta: dto.fechaInicioOferta
            ? new Date(dto.fechaInicioOferta)
            : null,
          fechaFinOferta: dto.fechaFinOferta
            ? new Date(dto.fechaFinOferta)
            : null,
          // Marcar como configurado si se proporciona precio
          precioConfigurado: !!dto.precio,
          precioIncluyeIgv: dto.precioIncluyeIgv ?? true,
        },
        include: {
          producto: true,
          variante: true,
          sede: true,
        },
      });

      // Registrar movimiento inicial si hay stock
      if (dto.stockActual > 0) {
        await crearMovimientoStockConValoracion(tx, {
          sedeId: dto.sedeId,
          empresaId,
          productoStockId: stock.id,
          tipo: 'ENTRADA_AJUSTE',
          tipoDocumento: 'INICIAL',
          cantidadAnterior: 0,
          cantidad: dto.stockActual,
          cantidadNueva: dto.stockActual,
          motivo: 'Stock inicial',
          usuarioId,
        });
      }

      return stock;
    });

    // Invalidar cache de productos después de crear stock
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * Ajusta el stock de un producto/variante en una sede
   * Registra el movimiento en el historial
   * Usa SELECT FOR UPDATE para prevenir race conditions en operaciones concurrentes
   */
  async ajustarStock(
    productoStockId: string,
    empresaId: string,
    dto: AjustarStockDto,
    usuarioId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Bloquear la fila con FOR UPDATE para prevenir lecturas concurrentes
      const [stockLocked] = await tx.$queryRaw<
        Array<{ id: string; stockActual: number; sedeId: string; productoId: string | null; varianteId: string | null }>
      >`SELECT id, "stockActual", "sedeId", "productoId", "varianteId"
        FROM "ProductoStock"
        WHERE id = ${productoStockId}
        FOR UPDATE`;

      if (!stockLocked) {
        throw new NotFoundException('Stock no encontrado');
      }

      // Cargar relaciones para validaciones (ya bloqueada la fila de stock)
      const stock = await tx.productoStock.findUnique({
        where: { id: productoStockId },
        include: {
          producto: true,
          variante: true,
        },
      });

      // Validar que el producto o variante siga activo
      if (stock!.producto && !stock!.producto.isActive) {
        throw new BadRequestException(
          'No se puede ajustar stock de un producto inactivo',
        );
      }

      if (stock!.variante && !stock!.variante.isActive) {
        throw new BadRequestException(
          'No se puede ajustar stock de una variante inactiva',
        );
      }

      // Calcular nuevo stock usando el valor bloqueado (consistente)
      const stockAnterior = stockLocked.stockActual;
      const nuevoStock = stockAnterior + dto.cantidad;

      // Validar que no quede negativo
      if (nuevoStock < 0) {
        throw new BadRequestException(
          `Stock insuficiente. Actual: ${stockAnterior}, Requerido: ${Math.abs(dto.cantidad)}`,
        );
      }

      // Actualizar stock
      const stockActualizado = await tx.productoStock.update({
        where: { id: productoStockId },
        data: { stockActual: nuevoStock },
        include: {
          producto: true,
          variante: true,
          sede: true,
        },
      });

      // Registrar movimiento
      await crearMovimientoStockConValoracion(tx, {
        sedeId: stockLocked.sedeId,
        empresaId,
        productoStockId,
        tipo: dto.tipo,
        tipoDocumento: dto.tipoDocumento,
        numeroDocumento: dto.numeroDocumento,
        cantidadAnterior: stockAnterior,
        cantidad: dto.cantidad,
        cantidadNueva: nuevoStock,
        motivo: dto.motivo,
        observaciones: dto.observaciones,
        usuarioId,
      });

      this.logger.log(
        `Stock ajustado: ${stock!.producto?.nombre || stock!.variante?.nombre} | Anterior: ${stockAnterior} | Cambio: ${dto.cantidad} | Nuevo: ${nuevoStock}`,
      );

      return stockActualizado;
    });

    // Invalidar cache de productos después de ajustar stock
    await this.invalidateProductCache(empresaId);

    // Notificar realtime: los cajeros con app abierta verán el nuevo
    // stock en sus cards en <3s sin pull-to-refresh manual.
    this.realtimeInvalidation.notifyStockCambiado({
      empresaId,
      productoId: result.productoId,
      varianteId: result.varianteId,
      sedeId: result.sedeId,
    });

    return result;
  }

  /**
   * Obtiene el stock de todos los productos en una sede
   */
  async getStocksPorSede(
    sedeId: string,
    empresaId: string,
    page: number = 1,
    limit: number = 50,
    search?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.ProductoStockWhereInput = { sedeId, empresaId };

    // Búsqueda por nombre/código/SKU/barras del producto o de la variante
    const term = search?.trim();
    if (term) {
      // Por PALABRAS, no por frase entera: en el mostrador se teclea
      // "lavadora samsung" y antes eso devolvía cero (una palabra está en el
      // nombre y la otra en la marca). Ver `texto-busqueda.util.ts`.
      const terminos = tokenizarBusqueda(term);
      const porPalabras = condicionStockPorPalabras(terminos);

      if (pareceCodigo(term)) {
        // El escaneo de código de barras se resuelve por igualdad exacta.
        where.OR = [
          { producto: { codigoBarras: { equals: term, mode: 'insensitive' } } },
          { producto: { sku: { equals: term, mode: 'insensitive' } } },
          { producto: { codigoEmpresa: { equals: term, mode: 'insensitive' } } },
          { variante: { codigoBarras: { equals: term, mode: 'insensitive' } } },
          { variante: { sku: { equals: term, mode: 'insensitive' } } },
          ...(porPalabras.length > 0 ? [{ AND: porPalabras }] : []),
        ];
      } else if (porPalabras.length > 0) {
        where.AND = porPalabras;
      }
    }

    // 🔴 Fuera lo BORRADO. El where solo miraba sede y empresa, así que las
    // filas de stock de variantes soft-deleted seguían saliendo: REDMI 15 PRO
    // tiene 2 variantes vivas y listaba 14, con stock de sobra (una borrada
    // con 47 unidades). Cualquiera que sume esas filas obtiene un total que no
    // existe.
    //
    // Una fila de producto se filtra por su producto; una de variante, por la
    // variante Y por su producto —una variante viva de un producto borrado
    // tampoco va—.
    //
    // 🔴 Se SUMA a `where.AND`, nunca se asigna: la búsqueda por palabras de
    // arriba ya lo usa, y asignarlo acá la borraría sin que nadie lo note.
    const soloVivos: Prisma.ProductoStockWhereInput = {
      OR: [
        { producto: { deletedAt: null } },
        { variante: { deletedAt: null, producto: { deletedAt: null } } },
      ],
    };
    if (Array.isArray(where.AND)) {
      where.AND = [...where.AND, soloVivos];
    } else if (where.AND) {
      where.AND = [where.AND, soloVivos];
    } else {
      where.AND = [soloVivos];
    }

    const [stocks, total] = await Promise.all([
      this.prisma.productoStock.findMany({
        where,
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
              codigoEmpresa: true,
              sku: true,
              // Ver el comentario de la variante: el granel se lee en kilos.
              factorPresentacion: true,
              unidadPresentacion: { select: _selectSimbolo },
              // Marca y categoría para la tabla de inventario por sede.
              // El nombre efectivo = nombreLocal ?? nombrePersonalizado ?? maestra.nombre.
              empresaMarca: {
                select: {
                  nombreLocal: true,
                  nombrePersonalizado: true,
                  marcaMaestra: { select: { nombre: true } },
                },
              },
              empresaCategoria: {
                select: {
                  nombreLocal: true,
                  nombrePersonalizado: true,
                  categoriaMaestra: { select: { nombre: true } },
                },
              },
              // precio: true, // ❌ DEPRECATED - Precio ahora solo en ProductoStock
            },
          },
          variante: {
            select: {
              id: true,
              nombre: true,
              sku: true,
              // precio: true, // ❌ DEPRECATED - Precio ahora solo en ProductoStock
              // Presentación PROPIA de la variante: el granel se guarda en
              // gramos pero se lee en kilos. Sin esto la pantalla de mín/máx
              // pedía "9000" donde el usuario piensa "9 kg".
              factorPresentacion: true,
              unidadPresentacion: { select: _selectSimbolo },
              // 🔴 El producto DUEÑO de la variante. En estas filas el
              // `productoId` propio es NULL —XOR del modelo—, así que sin esto
              // el cliente no tiene forma de saber a qué producto pertenece la
              // variante: la pantalla de mín/máx las mostraba sueltas, sin
              // poder agruparlas ni decir de qué producto son.
              //
              // Su presentación viaja también porque la variante la HEREDA
              // cuando no tiene una propia.
              producto: {
                select: {
                  id: true,
                  nombre: true,
                  codigoEmpresa: true,
                  factorPresentacion: true,
                  unidadPresentacion: { select: _selectSimbolo },
                },
              },
            },
          },
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
              isActive: true,
            },
          },
        },
        // Se ordena por `creadoEn` y NO por nombre de producto: ordenar por
        // relación obliga a un join ordenado y es caro. El cliente agrupa por
        // producto igual, así que el orden de llegada no cambia lo que se ve.
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.productoStock.count({ where }),
    ]);

    // Aplanar marca/categoría a `{ nombre }` (el front lee empresaMarca.nombre
    // / empresaCategoria.nombre). Nombre efectivo: local > personalizado > maestra.
    const stocksMapped = stocks.map((s) => ({
      ...s,
      // La presentación aplanada, para producto y variante. La variante que no
      // tiene una propia HEREDA la de su producto: así se resuelve del mismo
      // modo que en el catálogo y el granel se lee en kilos en las dos formas.
      variante: s.variante
        ? {
            ...s.variante,
            ..._presentacionPlana(
              s.variante.factorPresentacion != null
                ? s.variante
                : s.variante.producto,
            ),
          }
        : null,
      producto: s.producto
        ? {
            ...s.producto,
            ..._presentacionPlana(s.producto),
            empresaMarca: s.producto.empresaMarca
              ? {
                  nombre:
                    s.producto.empresaMarca.nombreLocal ??
                    s.producto.empresaMarca.nombrePersonalizado ??
                    s.producto.empresaMarca.marcaMaestra?.nombre ??
                    null,
                }
              : null,
            empresaCategoria: s.producto.empresaCategoria
              ? {
                  nombre:
                    s.producto.empresaCategoria.nombreLocal ??
                    s.producto.empresaCategoria.nombrePersonalizado ??
                    s.producto.empresaCategoria.categoriaMaestra?.nombre ??
                    null,
                }
              : null,
          }
        : null,
    }));

    return createPaginatedResponse(stocksMapped, total, page, limit);
  }

  /**
   * Kardex: historial de movimientos de stock para un producto
   */
  async getHistorialMovimientos(
    productoStockId: string,
    filtros?: {
      limit?: number;
      offset?: number;
      tipo?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      documento?: string;
    },
  ) {
    const limit = filtros?.limit ?? 100;
    const offset = filtros?.offset ?? 0;

    const where: any = { productoStockId };

    if (filtros?.tipo) {
      where.tipo = filtros.tipo;
    }

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.creadoEn = {};
      if (filtros?.fechaDesde) {
        where.creadoEn.gte = new Date(filtros.fechaDesde);
      }
      if (filtros?.fechaHasta) {
        where.creadoEn.lte = new Date(filtros.fechaHasta);
      }
    }

    // Filtro por código de documento: busca en numeroDocumento del propio
    // movimiento y en codigo de los documentos relacionados (venta/compra/
    // transferencia/devolución). El user puede tipear "VEN-001" o solo "001".
    const docQuery = filtros?.documento?.trim();
    if (docQuery) {
      where.OR = [
        { numeroDocumento: { contains: docQuery, mode: 'insensitive' } },
        { venta: { codigo: { contains: docQuery, mode: 'insensitive' } } },
        { compra: { codigo: { contains: docQuery, mode: 'insensitive' } } },
        {
          transferencia: {
            codigo: { contains: docQuery, mode: 'insensitive' },
          },
        },
        { devolucion: { codigo: { contains: docQuery, mode: 'insensitive' } } },
      ];
    }

    // Para ubicar la LÍNEA de venta correspondiente a este stock (precio de
    // venta real + margen snapshot). OJO gotcha variante: el stock de una
    // variante tiene productoId=NULL → se filtra por varianteId; el de un
    // producto simple por productoId + varianteId null.
    const stockRow = await this.prisma.productoStock.findUnique({
      where: { id: productoStockId },
      select: { productoId: true, varianteId: true },
    });
    const filtroLineaVenta = stockRow?.varianteId
      ? { varianteId: stockRow.varianteId }
      : { productoId: stockRow?.productoId ?? '', varianteId: null };

    // Pedimos `limit + 1` para detectar si hay más sin requerir un count
    // separado (más caro). Si volvieron limit+1, recortamos al límite y
    // marcamos hasMore=true. El resumen sí cuenta el total real igual.
    const movimientosRaw = await this.prisma.movimientoStock.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      skip: offset,
      take: limit + 1,
      include: {
        // Enriquecido: vendedor/cliente/canal + la línea de venta de ESTE
        // producto (precio de venta y margen al momento de vender).
        venta: {
          select: {
            id: true,
            codigo: true,
            nombreCliente: true,
            canalVenta: true,
            vendedor: {
              select: {
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
            detalles: {
              where: filtroLineaVenta,
              select: {
                precioUnitario: true,
                cantidad: true,
                total: true,
                margenSnapshot: true,
              },
              take: 1,
            },
          },
        },
        compra: {
          select: {
            id: true,
            codigo: true,
            proveedor: { select: { nombre: true } },
          },
        },
        transferencia: { select: { id: true, codigo: true } },
        devolucion: { select: { id: true, codigo: true } },
      },
    });
    const hasMore = movimientosRaw.length > limit;
    const movimientosPage = hasMore
      ? movimientosRaw.slice(0, limit)
      : movimientosRaw;

    // Usuario responsable de cada movimiento (MovimientoStock no tiene la
    // relación mapeada en Prisma → lookup batch por página, 1 query).
    const usuarioIds = [...new Set(movimientosPage.map((m) => m.usuarioId))];
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: usuarioIds } },
      select: {
        id: true,
        email: true,
        persona: { select: { nombres: true, apellidos: true } },
      },
    });
    const nombreUsuario = new Map(
      usuarios.map((u) => [
        u.id,
        u.persona
          ? `${u.persona.nombres ?? ''} ${u.persona.apellidos ?? ''}`.trim()
          : (u.email ?? ''),
      ]),
    );
    const movimientos = movimientosPage.map((m) => ({
      ...m,
      usuarioNombre: nombreUsuario.get(m.usuarioId) || null,
    }));

    // Resumen agregado por tipo. Usa el MISMO `where` que la lista para
    // que el resumen respete tipo/fechaDesde/fechaHasta — antes era
    // global y descuadraba con lo visible cuando había filtros activos.
    // El resumen se calcula SIEMPRE sobre todo el histórico filtrado
    // (no respeta offset/limit) — es el total real.
    const resumen = await this.prisma.movimientoStock.groupBy({
      by: ['tipo'],
      where,
      _sum: { cantidad: true, valorMovimiento: true },
      _count: { id: true },
    });

    return {
      movimientos,
      hasMore,
      resumen: resumen.map((r) => ({
        tipo: r.tipo,
        totalCantidad: r._sum.cantidad ?? 0,
        totalMovimientos: r._count.id,
        // Valor monetario agregado del grupo. null cuando ningún mov del
        // grupo tiene snapshot (todos previos a la mig 20260521).
        totalValor:
          r._sum.valorMovimiento != null
            ? Number(r._sum.valorMovimiento)
            : null,
      })),
    };
  }

  /**
   * Obtiene el stock de un producto/variante en todas las sedes
   */
  async getStockEnTodasSedes(
    empresaId: string,
    productoId?: string,
    varianteId?: string,
  ) {
    if (!productoId && !varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }
    if (productoId && varianteId) {
      throw new BadRequestException(
        'Solo se debe enviar productoId o varianteId, no ambos',
      );
    }

    const stocks = await this.prisma.productoStock.findMany({
      where: {
        empresaId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
      include: {
        sede: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
            isActive: true,
          },
        },
        producto: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            sku: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
            sku: true,
          },
        },
      },
      orderBy: {
        stockActual: 'desc',
      },
    });

    // Calcular total de stock
    const totalStock = stocks.reduce(
      (sum, stock) => sum + stock.stockActual,
      0,
    );

    return {
      stocks,
      resumen: {
        totalSedes: stocks.length,
        stockTotal: totalStock,
        sedesConStock: stocks.filter((s) => s.stockActual > 0).length,
        sedesSinStock: stocks.filter((s) => s.stockActual === 0).length,
      },
    };
  }

  /**
   * Obtiene productos con stock bajo el mínimo
   */
  async getProductosBajoMinimo(empresaId: string, sedeId?: string) {
    // Obtener IDs filtrados en DB (compara stockActual <= stockMinimo en PostgreSQL)
    const idsResult = await this.prisma.$queryRaw<Array<{ id: string; stockActual: number }>>`
      SELECT id, "stockActual"
      FROM "ProductoStock"
      WHERE "empresaId" = ${empresaId}
        AND "stockMinimo" IS NOT NULL
        AND "stockActual" <= "stockMinimo"
        ${sedeId ? Prisma.sql`AND "sedeId" = ${sedeId}` : Prisma.empty}
      ORDER BY "stockActual" ASC
    `;

    if (idsResult.length === 0) {
      return { productos: [], total: 0, criticos: 0 };
    }

    const ids = idsResult.map((r) => r.id);

    // Cargar relaciones con Prisma usando los IDs ya filtrados
    const filtrados = await this.prisma.productoStock.findMany({
      where: { id: { in: ids } },
      include: {
        producto: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            sku: true,
            esInsumo: true,
          },
        },
        variante: {
          select: {
            id: true,
            nombre: true,
            sku: true,
          },
        },
        sede: {
          select: {
            id: true,
            nombre: true,
            codigo: true,
          },
        },
      },
      orderBy: {
        stockActual: 'asc',
      },
    });

    return {
      productos: filtrados,
      total: filtrados.length,
      criticos: idsResult.filter((r) => r.stockActual === 0).length,
    };
  }

  // =====================================================
  // GESTIÓN DE PRECIOS POR SEDE
  // =====================================================

  /**
   * Actualiza los precios de un producto en una sede específica
   * Registra el cambio en el historial de precios por sede
   */
  async actualizarPreciosSede(
    productoStockId: string,
    empresaId: string,
    dto: ActualizarPreciosSedeDto,
    usuarioId: string,
  ) {
    // Obtener stock actual con precios
    const stock = await this.prisma.productoStock.findUnique({
      where: { id: productoStockId },
      include: {
        producto: true,
        variante: true,
        sede: true,
      },
    });

    if (!stock) {
      throw new NotFoundException('Stock no encontrado');
    }

    if (stock.empresaId !== empresaId) {
      throw new BadRequestException(
        'El stock no pertenece a esta empresa',
      );
    }

    // Preparar datos de actualización
    const updateData: any = {};
    let hayActualizacion = false;

    if (dto.precio !== undefined) {
      updateData.precio = dto.precio ? new Decimal(dto.precio) : null;
      hayActualizacion = true;
    }

    if (dto.precioCosto !== undefined) {
      updateData.precioCosto = dto.precioCosto
        ? new Decimal(dto.precioCosto)
        : null;
      hayActualizacion = true;
    }

    if (dto.precioOferta !== undefined) {
      updateData.precioOferta = dto.precioOferta
        ? new Decimal(dto.precioOferta)
        : null;
      hayActualizacion = true;
    }

    if (dto.enOferta !== undefined) {
      updateData.enOferta = dto.enOferta;
      hayActualizacion = true;
    }

    if (dto.precioIncluyeIgv !== undefined) {
      updateData.precioIncluyeIgv = dto.precioIncluyeIgv;
      hayActualizacion = true;
    }

    if (dto.fechaInicioOferta !== undefined) {
      updateData.fechaInicioOferta = dto.fechaInicioOferta
        ? new Date(dto.fechaInicioOferta)
        : null;
      hayActualizacion = true;
    }

    if (dto.fechaFinOferta !== undefined) {
      updateData.fechaFinOferta = dto.fechaFinOferta
        ? new Date(dto.fechaFinOferta)
        : null;
      hayActualizacion = true;
    }

    if (dto.ubicacion !== undefined) {
      updateData.ubicacion = dto.ubicacion || null;
      hayActualizacion = true;
    }

    if (dto.stockMinimo !== undefined) {
      updateData.stockMinimo = dto.stockMinimo;
      hayActualizacion = true;
    }

    if (dto.stockMaximo !== undefined) {
      updateData.stockMaximo = dto.stockMaximo;
      hayActualizacion = true;
    }

    if (!hayActualizacion) {
      throw new BadRequestException(
        'No se proporcionaron campos para actualizar',
      );
    }

    // Actualizar y registrar en historial en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // Si se está actualizando el precio, marcar como configurado
      if (dto.precio !== undefined && dto.precio !== null) {
        updateData.precioConfigurado = true;
      } else if (dto.precio === null) {
        // Si se está eliminando el precio, marcar como no configurado
        updateData.precioConfigurado = false;
      }

      // Actualizar precios
      const stockActualizado = await tx.productoStock.update({
        where: { id: productoStockId },
        data: updateData,
        include: {
          producto: true,
          variante: true,
          sede: true,
        },
      });

      // Registrar en historial SOLO si hubo cambio real de valor (no solo
      // si el DTO trae el campo). Antes se creaba un registro MANUAL
      // "sin diff de precios" cada vez que el frontend reenviaba los
      // mismos precios al guardar el dialog sin tocar nada.
      const cambio = (anterior: any, nuevo: any) => {
        if (nuevo === undefined) return false; // campo no enviado
        const ant = anterior != null ? Number(anterior.toString()) : null;
        const nvo = nuevo != null ? Number(nuevo) : null;
        if (ant == null && nvo == null) return false;
        if (ant == null || nvo == null) return true;
        return Math.abs(ant - nvo) > 0.001; // tolerancia centavo
      };
      const huboCambioPrecios =
        cambio(stock.precio, dto.precio) ||
        cambio(stock.precioCosto, dto.precioCosto) ||
        cambio(stock.precioOferta, dto.precioOferta);

      if (huboCambioPrecios) {
        await tx.productoPrecioHistorialSede.create({
          data: {
            productoStockId: stock.id,
            sedeId: stock.sedeId,
            precioAnterior: stock.precio
              ? new Decimal(stock.precio.toString())
              : null,
            precioNuevo:
              dto.precio !== undefined
                ? dto.precio
                  ? new Decimal(dto.precio)
                  : null
                : stock.precio
                  ? new Decimal(stock.precio.toString())
                  : null,
            precioCostoAnterior: stock.precioCosto
              ? new Decimal(stock.precioCosto.toString())
              : null,
            precioCostoNuevo:
              dto.precioCosto !== undefined
                ? dto.precioCosto
                  ? new Decimal(dto.precioCosto)
                  : null
                : stock.precioCosto
                  ? new Decimal(stock.precioCosto.toString())
                  : null,
            precioOfertaAnterior: stock.precioOferta
              ? new Decimal(stock.precioOferta.toString())
              : null,
            precioOfertaNuevo:
              dto.precioOferta !== undefined
                ? dto.precioOferta
                  ? new Decimal(dto.precioOferta)
                  : null
                : stock.precioOferta
                  ? new Decimal(stock.precioOferta.toString())
                  : null,
            tipoCambio: (dto.tipoCambio as TipoCambioPrecio) || TipoCambioPrecio.MANUAL,
            razon: dto.razon,
            origenModulo: 'INVENTARIO',
            usuarioId,
          },
        });
      }

      this.logger.log(
        `Precios actualizados para ${stock.producto?.nombre || stock.variante?.nombre} en sede ${stock.sede.nombre}`,
      );

      // Auto-trigger: notificar clientes cuando se activa una oferta
      if (dto.enOferta === true && !stock.enOferta && stock.producto) {
        this.promocionService
          .notificarOfertaAutomatica(empresaId, usuarioId, {
            id: stock.producto.id,
            nombre: stock.producto.nombre,
            precioOferta: dto.precioOferta ? Number(dto.precioOferta) : undefined,
          })
          .catch((err) =>
            this.logger.error(`Error en notificación automática de oferta: ${err.message}`),
          );
      }

      return stockActualizado;
    });

    // Invalidar cache de productos después de actualizar precios
    await this.invalidateProductCache(empresaId);

    // Notificar a clientes conectados vía FCM data-only para que invaliden
    // su cache local y refresquen el item. Defensa en capas: si FCM falla
    // o llega tarde, el 409 PRECIO_DESACTUALIZADO al cobrar sigue
    // protegiendo contra cobro a precio viejo.
    this.realtimeInvalidation.notifyPrecioCambiado({
      empresaId,
      productoId: stock.productoId,
      varianteId: stock.varianteId,
      sedeId: stock.sedeId,
    });

    return result;
  }

  /**
   * Obtiene el precio de un producto en una sede (sin fallbacks)
   * Retorna el precio tal como está configurado en ProductoStock
   * Si no tiene precio configurado, retorna null
   */
  async obtenerPrecio(
    sedeId: string,
    productoId?: string,
    varianteId?: string,
  ): Promise<{
    precio: number | null;
    precioCosto: number | null;
    precioOferta: number | null;
    enOferta: boolean;
    ofertaActiva: boolean;
    precioConfigurado: boolean;
  } | null> {
    if (!productoId && !varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }
    if (productoId && varianteId) {
      throw new BadRequestException(
        'Solo se debe enviar productoId o varianteId, no ambos',
      );
    }

    // Obtener stock con precios de sede
    const stock = await this.prisma.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
    });

    if (!stock) {
      return null;
    }

    // Verificar si la oferta está activa por fechas
    let ofertaActiva = false;
    if (stock.enOferta && stock.precioOferta) {
      const ahora = new Date();
      const inicioOferta = stock.fechaInicioOferta;
      const finOferta = stock.fechaFinOferta;

      if (inicioOferta && finOferta) {
        ofertaActiva = ahora >= inicioOferta && ahora <= finOferta;
      } else if (inicioOferta) {
        ofertaActiva = ahora >= inicioOferta;
      } else if (finOferta) {
        ofertaActiva = ahora <= finOferta;
      } else {
        ofertaActiva = true; // Si no hay fechas, la oferta está activa
      }
    }

    return {
      precio: stock.precio ? parseFloat(stock.precio.toString()) : null,
      precioCosto: stock.precioCosto
        ? parseFloat(stock.precioCosto.toString())
        : null,
      precioOferta: stock.precioOferta
        ? parseFloat(stock.precioOferta.toString())
        : null,
      enOferta: stock.enOferta,
      ofertaActiva,
      precioConfigurado: stock.precioConfigurado,
    };
  }

  /**
   * Valida si un producto está disponible para venta
   * Verifica: precio configurado, stock disponible, producto activo
   */
  async validarDisponibleParaVenta(
    sedeId: string,
    productoId: string,
    varianteId: string | null = null,
    cantidad: number = 1,
  ): Promise<{
    disponible: boolean;
    razones: string[];
  }> {
    const stock = await this.prisma.productoStock.findFirst({
      where: {
        sedeId,
        productoId: productoId ?? null,
        varianteId: varianteId ?? null,
      },
      include: {
        producto: true,
        variante: true,
      },
    });

    const razones: string[] = [];

    if (!stock) {
      razones.push('Producto no disponible en esta sede');
      return { disponible: false, razones };
    }

    // Validar precio configurado
    if (!stock.precioConfigurado || !stock.precio) {
      razones.push('Producto sin precio configurado');
    }

    // Validar stock suficiente
    if (stock.stockActual < cantidad) {
      razones.push(
        `Stock insuficiente (disponible: ${stock.stockActual}, requerido: ${cantidad})`,
      );
    }

    // Validar producto activo
    if (stock.producto && !stock.producto.isActive) {
      razones.push('Producto inactivo');
    }

    // Validar variante activa
    if (stock.variante && !stock.variante.isActive) {
      razones.push('Variante inactiva');
    }

    return {
      disponible: razones.length === 0,
      razones,
    };
  }

  /**
   * Obtiene productos pendientes de configuración de precio en una sede
   * Útil para dashboards y alertas
   */
  async getProductosPendientesPrecio(
    sedeId: string,
    empresaId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const [stocks, total] = await Promise.all([
      this.prisma.productoStock.findMany({
        where: {
          sedeId,
          empresaId,
          precioConfigurado: false,
          stockActual: { gt: 0 }, // Solo productos con stock
        },
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
              codigoEmpresa: true,
              sku: true,
              isActive: true,
            },
          },
          variante: {
            select: {
              id: true,
              nombre: true,
              sku: true,
              isActive: true,
            },
          },
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.productoStock.count({
        where: {
          sedeId,
          empresaId,
          precioConfigurado: false,
          stockActual: { gt: 0 },
        },
      }),
    ]);

    return createPaginatedResponse(stocks, total, page, limit);
  }

  /**
   * Obtiene productos listos para venta (precio configurado + stock disponible)
   * Filtra productos activos con precio y stock
   */
  async getProductosListosVenta(
    sedeId: string,
    empresaId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const [stocks, total] = await Promise.all([
      this.prisma.productoStock.findMany({
        where: {
          sedeId,
          empresaId,
          precioConfigurado: true,
          precio: { not: null },
          stockActual: { gt: 0 },
          producto: { isActive: true },
        },
        include: {
          producto: {
            select: {
              id: true,
              nombre: true,
              codigoEmpresa: true,
              sku: true,
              descripcion: true,
              visibleMarketplace: true,
            },
          },
          variante: {
            select: {
              id: true,
              nombre: true,
              sku: true,
            },
          },
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
            },
          },
        },
        orderBy: { actualizadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.productoStock.count({
        where: {
          sedeId,
          empresaId,
          precioConfigurado: true,
          precio: { not: null },
          stockActual: { gt: 0 },
          producto: { isActive: true },
        },
      }),
    ]);

    return createPaginatedResponse(stocks, total, page, limit);
  }

  /**
   * Obtiene productos para mostrar en marketplace
   * Filtra: precio configurado, stock disponible, visible en marketplace
   */
  async getProductosMarketplace(
    empresaId: string,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const [stocks, total] = await Promise.all([
      this.prisma.productoStock.findMany({
        where: {
          empresaId,
          precioConfigurado: true,
          precio: { not: null },
          stockActual: { gt: 0 },
          producto: {
            isActive: true,
            visibleMarketplace: true,
          },
        },
        include: {
          producto: {
            include: {
              // archivos: true, // ❌ Producto usa relación polimórfica con Archivo (entidadTipo/entidadId)
              empresaCategoria: true,
              empresaMarca: true,
            },
          },
          variante: {
            include: {
              archivos: true,
            },
          },
          sede: {
            select: {
              id: true,
              nombre: true,
              codigo: true,
              direccion: true,
            },
          },
        },
        orderBy: [
          { producto: { destacado: 'desc' } },
          { producto: { ordenMarketplace: 'asc' } },
        ],
        skip,
        take: limit,
      }),
      this.prisma.productoStock.count({
        where: {
          empresaId,
          precioConfigurado: true,
          precio: { not: null },
          stockActual: { gt: 0 },
          producto: {
            isActive: true,
            visibleMarketplace: true,
          },
        },
      }),
    ]);

    return createPaginatedResponse(stocks, total, page, limit);
  }

  /**
   * Obtiene estadísticas de configuración de precios
   * Útil para dashboards y métricas
   */
  async getEstadisticasPrecios(empresaId: string, sedeId?: string) {
    const where: Prisma.ProductoStockWhereInput = { empresaId };
    if (sedeId) {
      where.sedeId = sedeId;
    }

    const [
      total,
      conPrecio,
      sinPrecio,
      conStock,
      listosVenta,
      sinStock,
      inactivos,
    ] = await Promise.all([
      // Total de registros de stock
      this.prisma.productoStock.count({ where }),

      // Con precio configurado
      this.prisma.productoStock.count({
        where: { ...where, precioConfigurado: true },
      }),

      // Sin precio configurado
      this.prisma.productoStock.count({
        where: { ...where, precioConfigurado: false },
      }),

      // Con stock disponible
      this.prisma.productoStock.count({
        where: { ...where, stockActual: { gt: 0 } },
      }),

      // Listos para venta (precio + stock + activo)
      this.prisma.productoStock.count({
        where: {
          ...where,
          precioConfigurado: true,
          stockActual: { gt: 0 },
          producto: { isActive: true },
        },
      }),

      // Sin stock
      this.prisma.productoStock.count({
        where: { ...where, stockActual: 0 },
      }),

      // Inactivos
      this.prisma.productoStock.count({
        where: { ...where, producto: { isActive: false } },
      }),
    ]);

    // Productos pendientes (con stock pero sin precio)
    const pendientes = await this.prisma.productoStock.count({
      where: {
        ...where,
        precioConfigurado: false,
        stockActual: { gt: 0 },
      },
    });

    return {
      total,
      conPrecio,
      sinPrecio,
      conStock,
      sinStock,
      listosVenta,
      pendientes,
      inactivos,
      porcentajes: {
        precioConfigurado: total > 0 ? (conPrecio / total) * 100 : 0,
        listosVenta: total > 0 ? (listosVenta / total) * 100 : 0,
        pendientes: conStock > 0 ? (pendientes / conStock) * 100 : 0,
      },
    };
  }

  /**
   * Obtiene el historial de cambios de precio de un producto en una sede
   */
  async obtenerHistorialPreciosSede(
    productoStockId: string,
    limit: number = 50,
  ) {
    return await this.prisma.productoPrecioHistorialSede.findMany({
      where: { productoStockId },
      include: {
        usuario: {
          select: {
            id: true,
            email: true,
            persona: {
              select: {
                nombres: true,
                apellidos: true,
              },
            },
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
      take: limit,
    });
  }

  /**
   * Actualiza precios masivamente para todos los productos de una sede
   * Útil para ajustes de mercado o cambios de estrategia de precios
   */
  async actualizarPreciosMasivosPorSede(
    sedeId: string,
    empresaId: string,
    ajuste: {
      tipo: 'PORCENTAJE' | 'MONTO_FIJO';
      valor: number;
      aplicarA: 'PRECIO' | 'PRECIO_COSTO';
      operacion: 'AUMENTAR' | 'DISMINUIR';
      productoIds?: string[];
      excluirCombos?: boolean;
      soloCombos?: boolean;
    },
    usuarioId: string,
  ) {
    // Validar sede
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId, isActive: true },
    });

    if (!sede) {
      throw new NotFoundException('Sede no encontrada o inactiva');
    }

    // Construir filtro
    const where: Prisma.ProductoStockWhereInput = {
      sedeId,
      empresaId,
    };

    if (ajuste.productoIds && ajuste.productoIds.length > 0) {
      where.productoId = { in: ajuste.productoIds };
    }

    // Filtro de combos
    if (ajuste.excluirCombos) {
      where.producto = { esCombo: false };
    } else if (ajuste.soloCombos) {
      where.producto = { esCombo: true, tipoPrecioCombo: 'FIJO' };
      this.logger.log('Ajuste masivo solo para combos FIJO');
    }

    // Obtener todos los stocks afectados
    const stocks = await this.prisma.productoStock.findMany({
      where,
      include: {
        producto: true,
        variante: true,
      },
    });

    if (stocks.length === 0) {
      throw new BadRequestException(
        'No se encontraron productos para actualizar',
      );
    }

    this.logger.log(
      `Actualizando precios de ${stocks.length} productos en sede ${sede.nombre}`,
    );

    // Actualizar en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      const actualizados = [];

      for (const stock of stocks) {
        // ✅ Obtener precio actual solo de ProductoStock (ya no hay fallback a variante/producto)
        let precioActual: DecimalType | null = null;
        let precioCostoActual: DecimalType | null = null;

        if (ajuste.aplicarA === 'PRECIO') {
          precioActual = stock.precio;
        } else {
          precioCostoActual = stock.precioCosto;
        }

        if (!precioActual && !precioCostoActual) {
          this.logger.warn(
            `ProductoStock ${stock.id} (${stock.producto?.nombre}) no tiene precio configurado, omitiendo`,
          );
          continue;
        }

        // Calcular nuevo precio
        let nuevoPrecio: DecimalType;
        let nuevoPrecioCosto: DecimalType | null = null;

        if (ajuste.aplicarA === 'PRECIO') {
          if (ajuste.tipo === 'PORCENTAJE') {
            const factor =
              ajuste.operacion === 'AUMENTAR'
                ? 1 + ajuste.valor / 100
                : 1 - ajuste.valor / 100;
            nuevoPrecio = new Decimal(
              parseFloat(precioActual.toString()) * factor,
            );
          } else {
            nuevoPrecio =
              ajuste.operacion === 'AUMENTAR'
                ? new Decimal(parseFloat(precioActual.toString()) + ajuste.valor)
                : new Decimal(parseFloat(precioActual.toString()) - ajuste.valor);
          }
        } else {
          if (precioCostoActual) {
            if (ajuste.tipo === 'PORCENTAJE') {
              const factor =
                ajuste.operacion === 'AUMENTAR'
                  ? 1 + ajuste.valor / 100
                  : 1 - ajuste.valor / 100;
              nuevoPrecioCosto = new Decimal(
                parseFloat(precioCostoActual.toString()) * factor,
              );
            } else {
              nuevoPrecioCosto =
                ajuste.operacion === 'AUMENTAR'
                  ? new Decimal(
                      parseFloat(precioCostoActual.toString()) + ajuste.valor,
                    )
                  : new Decimal(
                      parseFloat(precioCostoActual.toString()) - ajuste.valor,
                    );
            }
          }
        }

        // Actualizar stock
        const updateData: any = {};
        if (ajuste.aplicarA === 'PRECIO') {
          updateData.precio = nuevoPrecio;
          updateData.precioConfigurado = true; // Marcar como configurado
        } else {
          updateData.precioCosto = nuevoPrecioCosto;
        }

        const stockActualizado = await tx.productoStock.update({
          where: { id: stock.id },
          data: updateData,
        });

        // Registrar en historial
        await tx.productoPrecioHistorialSede.create({
          data: {
            productoStockId: stock.id,
            sedeId: stock.sedeId,
            precioAnterior:
              ajuste.aplicarA === 'PRECIO'
                ? stock.precio || precioActual
                : null,
            precioNuevo: ajuste.aplicarA === 'PRECIO' ? nuevoPrecio : null,
            precioCostoAnterior:
              ajuste.aplicarA === 'PRECIO_COSTO'
                ? stock.precioCosto || precioCostoActual
                : null,
            precioCostoNuevo:
              ajuste.aplicarA === 'PRECIO_COSTO' ? nuevoPrecioCosto : null,
            tipoCambio: TipoCambioPrecio.MASIVO,
            razon: `Ajuste masivo: ${ajuste.operacion} ${ajuste.valor}${ajuste.tipo === 'PORCENTAJE' ? '%' : ' unidades'} en ${ajuste.aplicarA}`,
            origenModulo: 'INVENTARIO',
            usuarioId,
          },
        });

        actualizados.push(stockActualizado);
      }

      this.logger.log(
        `${actualizados.length} productos actualizados exitosamente`,
      );

      return {
        totalActualizados: actualizados.length,
        sede: {
          id: sede.id,
          nombre: sede.nombre,
        },
        ajuste,
      };
    });

    // Invalidar cache de productos después de actualizar precios masivamente
    await this.invalidateProductCache(empresaId);

    return result;
  }

  /**
   * Lista historial de precios con filtros avanzados y paginacion
   */
  async getHistorialPreciosGlobal(
    empresaId: string,
    query: QueryHistorialPreciosDto,
  ) {
    const limit = query.limit || 50;

    const where: any = {
      productoStock: { empresaId },
    };

    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.tipoCambio) where.tipoCambio = query.tipoCambio;

    if (query.productoId) {
      where.productoStock = {
        ...where.productoStock,
        OR: [
          { productoId: query.productoId },
          { varianteId: query.productoId },
        ],
      };
    }

    if (query.search) {
      where.productoStock = {
        ...where.productoStock,
        OR: [
          { producto: { nombre: { contains: query.search, mode: 'insensitive' } } },
          { variante: { nombre: { contains: query.search, mode: 'insensitive' } } },
          { producto: { codigoEmpresa: { contains: query.search, mode: 'insensitive' } } },
        ],
      };
    }

    if (query.fechaInicio || query.fechaFin) {
      where.creadoEn = {};
      if (query.fechaInicio) where.creadoEn.gte = new Date(query.fechaInicio);
      if (query.fechaFin) {
        const fin = new Date(query.fechaFin);
        fin.setHours(23, 59, 59, 999);
        where.creadoEn.lte = fin;
      }
    }

    const findArgs: Prisma.ProductoPrecioHistorialSedeFindManyArgs = {
      where,
      include: {
        sede: { select: { id: true, nombre: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        productoStock: {
          select: {
            id: true,
            productoId: true,
            varianteId: true,
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
          },
        },
      },
      orderBy: { creadoEn: 'desc' },
      take: limit,
    };

    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1;
    }

    const data = await this.prisma.productoPrecioHistorialSede.findMany(findArgs);

    return {
      data,
      meta: {
        limit,
        hasNext: data.length === limit,
        nextCursor: data.length > 0 ? data[data.length - 1].id : null,
      },
    };
  }

  /**
   * Exportar historial de precios a Excel (streaming)
   */
  async exportHistorialPrecios(
    empresaId: string,
    query: QueryHistorialPreciosDto,
    res: Response,
  ) {
    const where: any = {
      productoStock: { empresaId },
    };

    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.tipoCambio) where.tipoCambio = query.tipoCambio;

    if (query.productoId) {
      where.productoStock = {
        ...where.productoStock,
        OR: [
          { productoId: query.productoId },
          { varianteId: query.productoId },
        ],
      };
    }

    if (query.fechaInicio || query.fechaFin) {
      where.creadoEn = {};
      if (query.fechaInicio) where.creadoEn.gte = new Date(query.fechaInicio);
      if (query.fechaFin) {
        const fin = new Date(query.fechaFin);
        fin.setHours(23, 59, 59, 999);
        where.creadoEn.lte = fin;
      }
    }

    // Validar rango maximo 3 meses
    if (query.fechaInicio && query.fechaFin) {
      const inicio = new Date(query.fechaInicio);
      const fin = new Date(query.fechaFin);
      const maxFin = new Date(inicio);
      maxFin.setMonth(maxFin.getMonth() + 3);
      if (fin > maxFin) {
        throw new BadRequestException('El rango maximo de exportacion es de 3 meses');
      }
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Historial de Precios');
    sheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 18 },
      { header: 'Sede', key: 'sede', width: 20 },
      { header: 'Codigo', key: 'codigo', width: 15 },
      { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Variante', key: 'variante', width: 20 },
      { header: 'Tipo Cambio', key: 'tipoCambio', width: 16 },
      { header: 'Precio Anterior', key: 'precioAnterior', width: 16 },
      { header: 'Precio Nuevo', key: 'precioNuevo', width: 16 },
      { header: 'Costo Anterior', key: 'costoAnterior', width: 16 },
      { header: 'Costo Nuevo', key: 'costoNuevo', width: 16 },
      { header: 'Oferta Anterior', key: 'ofertaAnterior', width: 16 },
      { header: 'Oferta Nuevo', key: 'ofertaNuevo', width: 16 },
      { header: 'Razon', key: 'razon', width: 25 },
      { header: 'Origen', key: 'origen', width: 15 },
      { header: 'Usuario', key: 'usuario', width: 22 },
    ];

    const headerStyle: Partial<ExcelJS.Style> = {
      font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'thin' },
        bottom: { style: 'thin' },
        left: { style: 'thin' },
        right: { style: 'thin' },
      },
    };
    sheet.getRow(1).eachCell((cell) => { cell.style = headerStyle; });
    sheet.getRow(1).height = 25;

    const BATCH_SIZE = 2000;
    let cursor: string | undefined = undefined;

    while (true) {
      const batch = await this.prisma.productoPrecioHistorialSede.findMany({
        where,
        include: {
          sede: { select: { nombre: true } },
          usuario: {
            select: {
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
          productoStock: {
            select: {
              producto: { select: { nombre: true, codigoEmpresa: true } },
              variante: { select: { nombre: true, sku: true } },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;

      for (const h of batch) {
        const usuarioNombre = h.usuario?.persona
          ? `${h.usuario.persona.nombres} ${h.usuario.persona.apellidos}`
          : '';

        sheet.addRow({
          fecha: h.creadoEn.toISOString().replace('T', ' ').substring(0, 19),
          sede: h.sede?.nombre ?? '',
          codigo: h.productoStock?.producto?.codigoEmpresa ?? '',
          producto: h.productoStock?.producto?.nombre ?? '',
          variante: h.productoStock?.variante
            ? `${h.productoStock.variante.nombre}${h.productoStock.variante.sku ? ` (${h.productoStock.variante.sku})` : ''}`
            : '',
          tipoCambio: h.tipoCambio,
          precioAnterior: h.precioAnterior ? Number(h.precioAnterior) : '',
          precioNuevo: h.precioNuevo ? Number(h.precioNuevo) : '',
          costoAnterior: h.precioCostoAnterior ? Number(h.precioCostoAnterior) : '',
          costoNuevo: h.precioCostoNuevo ? Number(h.precioCostoNuevo) : '',
          ofertaAnterior: h.precioOfertaAnterior ? Number(h.precioOfertaAnterior) : '',
          ofertaNuevo: h.precioOfertaNuevo ? Number(h.precioOfertaNuevo) : '',
          razon: h.razon ?? '',
          origen: h.origenModulo ?? '',
          usuario: usuarioNombre,
        });
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }

    for (const col of [7, 8, 9, 10, 11, 12]) {
      sheet.getColumn(col).numFmt = '#,##0.00';
    }

    const fechaLabel = query.fechaInicio && query.fechaFin
      ? `${query.fechaInicio}_${query.fechaFin}`
      : new Date().toISOString().split('T')[0];

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=historial_precios_${fechaLabel}.xlsx`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Cron: Desactivar ofertas expiradas (cada hora)
   */
  @Cron('0 * * * *')
  async desactivarOfertasExpiradas() {
    try {
      const ahora = new Date();
      const result = await this.prisma.productoStock.updateMany({
        where: {
          enOferta: true,
          fechaFinOferta: { not: null, lt: ahora },
        },
        data: { enOferta: false },
      });

      if (result.count > 0) {
        this.logger.log(`[Ofertas] ${result.count} ofertas expiradas desactivadas`);
      }
    } catch (error: any) {
      this.logger.error(`[Ofertas] Error desactivando ofertas: ${error.message}`);
    }
  }

  /**
   * Obtener ubicaciones distintas de una sede
   */
  async getUbicaciones(empresaId: string, sedeId: string) {
    const result = await this.prisma.$queryRaw<Array<{ ubicacion: string }>>`
      SELECT DISTINCT "ubicacion"
      FROM "ProductoStock"
      WHERE "empresaId" = ${empresaId}
      AND "sedeId" = ${sedeId}
      AND "ubicacion" IS NOT NULL
      AND "ubicacion" != ''
      ORDER BY "ubicacion"
    `;
    return result.map((r) => r.ubicacion);
  }

  /**
   * Obtener stock filtrado por ubicación
   */
  async getStockPorUbicacion(empresaId: string, sedeId: string, ubicacion: string) {
    return this.prisma.productoStock.findMany({
      where: { empresaId, sedeId, ubicacion },
      include: {
        producto: { select: { id: true, nombre: true, codigoEmpresa: true, codigoBarras: true } },
        variante: { select: { id: true, nombre: true, sku: true } },
        sede: { select: { id: true, nombre: true } },
      },
      orderBy: { producto: { nombre: 'asc' } },
    });
  }

  /**
   * Exportar Kardex a Excel
   */
  async exportKardex(
    productoStockId: string,
    filtros: {
      tipo?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      documento?: string;
    },
    res: any,
  ) {
    const data = await this.getHistorialMovimientos(productoStockId, {
      limit: 10000,
      ...filtros,
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Kardex');

    // Header style
    const headerStyle: {
      font: Partial<ExcelJS.Font>;
      fill: ExcelJS.FillPattern;
      alignment: Partial<ExcelJS.Alignment>;
    } = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
      alignment: { horizontal: 'center' },
    };

    sheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 18 },
      { header: 'Tipo Movimiento', key: 'tipo', width: 30 },
      { header: 'Documento', key: 'documento', width: 20 },
      { header: 'Cant. Anterior', key: 'anterior', width: 15 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Cant. Nueva', key: 'nueva', width: 15 },
      { header: 'Costo Unit.', key: 'costoUnit', width: 13 },
      { header: 'Valor', key: 'valor', width: 13 },
      { header: 'P. Venta', key: 'pVenta', width: 12 },
      { header: 'Cliente / Proveedor', key: 'tercero', width: 28 },
      { header: 'Canal', key: 'canal', width: 14 },
      { header: 'Usuario', key: 'usuario', width: 24 },
      { header: 'Motivo', key: 'motivo', width: 30 },
    ];

    // Apply header style
    sheet.getRow(1).eachCell((cell) => {
      cell.font = headerStyle.font;
      cell.fill = headerStyle.fill;
      cell.alignment = headerStyle.alignment;
    });

    const CANAL_LABEL: Record<string, string> = {
      POS: 'Mostrador (POS)',
      ONLINE: 'Marketplace',
      COTIZACION: 'Cotización',
      WHATSAPP_IA: 'Agente IA (WhatsApp)',
    };
    for (const mov of data.movimientos) {
      const doc = mov.venta?.codigo || mov.compra?.codigo || mov.transferencia?.codigo || mov.devolucion?.codigo || mov.numeroDocumento || '';
      const lineaVenta = mov.venta?.detalles?.[0];
      sheet.addRow({
        fecha: mov.creadoEn ? new Date(mov.creadoEn).toLocaleString('es-PE') : '',
        tipo: mov.tipo.replace(/_/g, ' '),
        documento: doc,
        anterior: mov.cantidadAnterior,
        cantidad: mov.cantidad,
        nueva: mov.cantidadNueva,
        // Snapshot del costo unitario al momento del movimiento (null
        // para movs previos a la mig 20260521 → celda vacía).
        costoUnit:
          mov.precioCostoUnitario != null
            ? Number(mov.precioCostoUnitario)
            : null,
        valor:
          mov.valorMovimiento != null ? Number(mov.valorMovimiento) : null,
        // Enriquecimiento: precio de venta de la línea, cliente/proveedor,
        // canal y usuario responsable.
        pVenta:
          lineaVenta?.precioUnitario != null
            ? Number(lineaVenta.precioUnitario)
            : null,
        tercero:
          mov.venta?.nombreCliente || mov.compra?.proveedor?.nombre || '',
        canal: mov.venta?.canalVenta
          ? (CANAL_LABEL[mov.venta.canalVenta] ?? mov.venta.canalVenta)
          : '',
        usuario: mov.usuarioNombre || '',
        motivo: mov.motivo || '',
      });
    }
    // Format moneda para columnas valor
    sheet.getColumn('costoUnit').numFmt = '#,##0.00';
    sheet.getColumn('valor').numFmt = '#,##0.00';
    sheet.getColumn('pVenta').numFmt = '#,##0.00';

    // Resumen sheet
    const resumenSheet = workbook.addWorksheet('Resumen');
    resumenSheet.columns = [
      { header: 'Tipo Movimiento', key: 'tipo', width: 30 },
      { header: 'Total Cantidad', key: 'totalCantidad', width: 15 },
      { header: 'Total Movimientos', key: 'totalMovimientos', width: 18 },
      { header: 'Total Valor', key: 'totalValor', width: 15 },
    ];
    resumenSheet.getRow(1).eachCell((cell) => {
      cell.font = headerStyle.font;
      cell.fill = headerStyle.fill;
      cell.alignment = headerStyle.alignment;
    });

    for (const r of data.resumen) {
      resumenSheet.addRow({
        tipo: r.tipo.replace(/_/g, ' '),
        totalCantidad: r.totalCantidad,
        totalMovimientos: r.totalMovimientos,
        totalValor: r.totalValor ?? null,
      });
    }
    resumenSheet.getColumn('totalValor').numFmt = '#,##0.00';

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=kardex_${productoStockId}.xlsx`,
    });

    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Actualizar stock minimo/maximo en bulk
   */
  async actualizarStockMinMaxBulk(
    empresaId: string,
    sedeId: string,
    items: Array<{ productoStockId: string; stockMinimo?: number; stockMaximo?: number }>,
  ) {
    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.productoStock.update({
          where: { id: item.productoStockId },
          data: {
            ...(item.stockMinimo !== undefined && { stockMinimo: item.stockMinimo }),
            ...(item.stockMaximo !== undefined && { stockMaximo: item.stockMaximo }),
          },
        }),
      ),
    );
  }

  /**
   * Edición masiva de stock y precios de una sede (grilla tipo excel).
   *
   * Por cada fila:
   * - Si no existe el registro ProductoStock en la sede, se crea (stock 0).
   * - `agregarStock` ajusta el stock generando MovimientoStock
   *   (AJUSTE_ENTRADA / AJUSTE_SALIDA) — trazabilidad completa en kardex.
   * - `precio` / `precioCosto` actualizan precios registrando
   *   ProductoPrecioHistorialSede, igual que el flujo individual.
   *
   * Todo corre en UNA transacción: si una fila falla, no se aplica nada.
   * Los precios se aplican antes que el stock para que el movimiento de
   * kardex quede valorizado con el costo nuevo de la misma fila.
   */
  async bulkEditarStockPrecios(
    empresaId: string,
    sedeId: string,
    dto: BulkEditarStockPreciosDto,
    usuarioId: string,
  ) {
    dto.items.forEach((item, i) => {
      if (!!item.varianteId === !!item.productoId) {
        throw new BadRequestException(
          `Fila ${i + 1}: se requiere exactamente uno de varianteId o productoId`,
        );
      }
      if (
        item.agregarStock === undefined &&
        item.precio === undefined &&
        item.precioCosto === undefined &&
        item.mayorPrecio === undefined &&
        !item.mayorEliminar
      ) {
        throw new BadRequestException(`Fila ${i + 1}: no tiene cambios que aplicar`);
      }

      // El nivel por mayor necesita las dos mitades: un precio sin cantidad
      // no se sabe desde cuándo aplica, y una cantidad sin precio no crea nada.
      if (item.mayorPrecio !== undefined && item.mayorCantidadMinima === undefined) {
        throw new BadRequestException(
          `Fila ${i + 1}: falta la cantidad mínima del precio por mayor`,
        );
      }
      if (item.mayorCantidadMinima !== undefined && item.mayorPrecio === undefined && !item.mayorEliminar) {
        throw new BadRequestException(
          `Fila ${i + 1}: falta el precio por mayor para la cantidad mínima indicada`,
        );
      }
      if (item.mayorEliminar && item.mayorPrecio !== undefined) {
        throw new BadRequestException(
          `Fila ${i + 1}: no se puede fijar y eliminar el precio por mayor a la vez`,
        );
      }
      if (item.mayorEliminar && item.mayorCantidadMinima === undefined) {
        throw new BadRequestException(
          `Fila ${i + 1}: para eliminar el precio por mayor hay que indicar su cantidad mínima`,
        );
      }
    });

    const motivo = dto.motivo?.trim() || 'Edición masiva de inventario';

    // Tolerancia de centavo, mismo criterio que actualizarPreciosSede
    const cambio = (anterior: DecimalType | null, nuevo: number | undefined) => {
      if (nuevo === undefined) return false;
      const ant = anterior != null ? Number(anterior.toString()) : null;
      if (ant == null) return true;
      return Math.abs(ant - nuevo) > 0.001;
    };

    const resultado = await this.prisma.$transaction(
      async (tx) => {
        const resumen = {
          stockAjustado: 0,
          preciosActualizados: 0,
          registrosCreados: 0,
          nivelesActualizados: 0,
          nivelesEliminados: 0,
        };
        const productosAfectados = new Set<string>();
        const nivelesAfectados: Array<{ productoId: string | null; varianteId: string | null }> = [];

        for (const item of dto.items) {
          let stock = await tx.productoStock.findFirst({
            where: {
              sedeId,
              empresaId,
              productoId: item.productoId ?? null,
              varianteId: item.varianteId ?? null,
            },
            include: {
              producto: { select: { id: true, nombre: true, isActive: true } },
              variante: {
                select: { id: true, nombre: true, isActive: true, productoId: true },
              },
            },
          });

          // Crear el registro si la variante/producto aún no existe en la sede
          if (!stock) {
            if (item.varianteId) {
              const variante = await tx.productoVariante.findFirst({
                where: { id: item.varianteId, empresaId, deletedAt: null },
                select: { id: true },
              });
              if (!variante) {
                throw new NotFoundException(
                  `Variante ${item.varianteId} no encontrada en esta empresa`,
                );
              }
            } else {
              const producto = await tx.producto.findFirst({
                where: { id: item.productoId, empresaId, deletedAt: null },
                select: { id: true },
              });
              if (!producto) {
                throw new NotFoundException(
                  `Producto ${item.productoId} no encontrado en esta empresa`,
                );
              }
            }

            const creado = await tx.productoStock.create({
              data: {
                sedeId,
                empresaId,
                productoId: item.productoId ?? null,
                varianteId: item.varianteId ?? null,
                stockActual: 0,
                precioConfigurado: false,
              },
              include: {
                producto: { select: { id: true, nombre: true, isActive: true } },
                variante: {
                  select: { id: true, nombre: true, isActive: true, productoId: true },
                },
              },
            });
            stock = creado;
            resumen.registrosCreados++;
          }

          const nombre = stock.variante?.nombre || stock.producto?.nombre || stock.id;

          if (stock.producto && !stock.producto.isActive) {
            throw new BadRequestException(`${nombre}: el producto está inactivo`);
          }
          if (stock.variante && !stock.variante.isActive) {
            throw new BadRequestException(`${nombre}: la variante está inactiva`);
          }

          const productoPadreId = stock.variante?.productoId || stock.producto?.id;
          if (productoPadreId) productosAfectados.add(productoPadreId);

          // 1) Precios primero (el kardex valoriza con el costo nuevo)
          const precioCambia = cambio(stock.precio, item.precio);
          const costoCambia = cambio(stock.precioCosto, item.precioCosto);

          if (precioCambia || costoCambia) {
            await tx.productoStock.update({
              where: { id: stock.id },
              data: {
                ...(precioCambia && {
                  precio: new Decimal(item.precio!),
                  precioConfigurado: true,
                }),
                ...(costoCambia && { precioCosto: new Decimal(item.precioCosto!) }),
              },
            });

            await tx.productoPrecioHistorialSede.create({
              data: {
                productoStockId: stock.id,
                sedeId,
                precioAnterior: stock.precio ? new Decimal(stock.precio.toString()) : null,
                precioNuevo: precioCambia
                  ? new Decimal(item.precio!)
                  : stock.precio
                    ? new Decimal(stock.precio.toString())
                    : null,
                precioCostoAnterior: stock.precioCosto
                  ? new Decimal(stock.precioCosto.toString())
                  : null,
                precioCostoNuevo: costoCambia
                  ? new Decimal(item.precioCosto!)
                  : stock.precioCosto
                    ? new Decimal(stock.precioCosto.toString())
                    : null,
                precioOfertaAnterior: stock.precioOferta
                  ? new Decimal(stock.precioOferta.toString())
                  : null,
                precioOfertaNuevo: stock.precioOferta
                  ? new Decimal(stock.precioOferta.toString())
                  : null,
                tipoCambio: TipoCambioPrecio.MANUAL,
                razon: motivo,
                origenModulo: 'INVENTARIO',
                usuarioId,
              },
            });
            resumen.preciosActualizados++;
          }

          // 2) Precio por mayor (PrecioNivel)
          //
          // 🔴 El nivel es GLOBAL a la variante: PrecioNivel no tiene sedeId,
          // así que esto se aplica a TODAS las sedes aunque la pantalla esté
          // parada en una. El costo con el que se valida, en cambio, sí es el
          // de ESTA sede — es el único contra el que se puede comparar acá.
          if (item.mayorPrecio !== undefined || item.mayorEliminar) {
            const filtroNivel = {
              productoId: item.productoId ?? null,
              varianteId: item.varianteId ?? null,
              cantidadMinima: item.mayorCantidadMinima!,
            };

            if (item.mayorEliminar) {
              const borrados = await tx.precioNivel.deleteMany({ where: filtroNivel });
              if (borrados.count > 0) {
                resumen.nivelesEliminados += borrados.count;
                nivelesAfectados.push({
                  productoId: item.productoId ?? null,
                  varianteId: item.varianteId ?? null,
                });
              }
            } else {
              // Costo efectivo: si en esta misma fila se está cambiando el
              // costo, manda el nuevo. Comparar contra el viejo dejaría pasar
              // un mayorista bajo costo cuando ambos se cargan juntos.
              const costoEfectivo =
                item.precioCosto !== undefined
                  ? item.precioCosto
                  : stock.precioCosto != null
                    ? Number(stock.precioCosto.toString())
                    : null;

              // Es el error que ya ocurrió dos veces con los edredones: un
              // precio por mayor plano aplicado a variantes de costos
              // distintos deja vendiendo bajo costo justo a las caras, y no
              // se nota porque en las baratas el nivel ni siquiera aplica.
              if (costoEfectivo != null && item.mayorPrecio! < costoEfectivo) {
                throw new BadRequestException(
                  `${nombre}: el precio por mayor S/${item.mayorPrecio!.toFixed(2)} está por debajo del costo S/${costoEfectivo.toFixed(2)}`,
                );
              }

              const existente = await tx.precioNivel.findFirst({ where: filtroNivel });

              if (existente) {
                await tx.precioNivel.update({
                  where: { id: existente.id },
                  data: {
                    precio: new Decimal(item.mayorPrecio!),
                    tipoPrecio: TipoPrecioNivel.PRECIO_FIJO,
                    porcentajeDesc: null,
                    isActive: true,
                  },
                });
              } else {
                await tx.precioNivel.create({
                  data: {
                    ...filtroNivel,
                    nombre: 'Por Mayor',
                    cantidadMaxima: null,
                    tipoPrecio: TipoPrecioNivel.PRECIO_FIJO,
                    precio: new Decimal(item.mayorPrecio!),
                    porcentajeDesc: null,
                  },
                });
              }

              resumen.nivelesActualizados++;
              nivelesAfectados.push({
                productoId: item.productoId ?? null,
                varianteId: item.varianteId ?? null,
              });
            }
          }

          // 3) Ajuste de stock con bloqueo de fila y movimiento de kardex
          if (item.agregarStock !== undefined && item.agregarStock !== 0) {
            const [locked] = await tx.$queryRaw<Array<{ stockActual: number }>>`
              SELECT "stockActual" FROM "ProductoStock"
              WHERE id = ${stock.id}
              FOR UPDATE`;

            const stockAnterior = locked.stockActual;
            const nuevoStock = stockAnterior + item.agregarStock;

            if (nuevoStock < 0) {
              throw new BadRequestException(
                `${nombre}: stock insuficiente (actual ${stockAnterior}, se intentó descontar ${Math.abs(item.agregarStock)})`,
              );
            }

            await tx.productoStock.update({
              where: { id: stock.id },
              data: { stockActual: nuevoStock },
            });

            await crearMovimientoStockConValoracion(tx, {
              sedeId,
              empresaId,
              productoStockId: stock.id,
              tipo: item.agregarStock > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA',
              tipoDocumento: 'EDICION_MASIVA',
              cantidadAnterior: stockAnterior,
              cantidad: item.agregarStock,
              cantidadNueva: nuevoStock,
              motivo,
              usuarioId,
            });
            resumen.stockAjustado++;
          }
        }

        return { resumen, productosAfectados: [...productosAfectados], nivelesAfectados };
      },
      { timeout: 60_000 },
    );

    await this.invalidateProductCache(empresaId);

    // Una notificación realtime por producto afectado (no por fila)
    for (const productoId of resultado.productosAfectados) {
      if (resultado.resumen.stockAjustado > 0) {
        this.realtimeInvalidation.notifyStockCambiado({ empresaId, productoId, sedeId });
      }
      if (resultado.resumen.preciosActualizados > 0) {
        this.realtimeInvalidation.notifyPrecioCambiado({ empresaId, productoId, sedeId });
      }
    }

    // Los niveles van por variante, no por producto: el cliente invalida el
    // precio de esa variante puntual.
    for (const nivel of resultado.nivelesAfectados) {
      this.realtimeInvalidation.notifyNivelesCambiados({ empresaId, ...nivel });
    }

    this.logger.log(
      `Edición masiva en sede ${sedeId}: ${resultado.resumen.stockAjustado} ajustes de stock, ` +
        `${resultado.resumen.preciosActualizados} precios, ${resultado.resumen.registrosCreados} registros creados, ` +
        `${resultado.resumen.nivelesActualizados} niveles por mayor, ${resultado.resumen.nivelesEliminados} eliminados`,
    );

    return resultado.resumen;
  }

  /**
   * Resumen de mermas y perdidas
   */
  async getResumenMermas(
    empresaId: string,
    sedeId?: string,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    const where: any = {
      empresaId,
      tipo: { in: ['AJUSTE_MERMA', 'AJUSTE_PERDIDA', 'SALIDA_BAJA', 'SALIDA_DONACION', 'SALIDA_ROBO'] },
    };

    if (sedeId) where.sedeId = sedeId;
    if (fechaDesde) where.creadoEn = { ...where.creadoEn, gte: new Date(fechaDesde) };
    if (fechaHasta) where.creadoEn = { ...where.creadoEn, lte: new Date(fechaHasta) };

    const resumen = await this.prisma.movimientoStock.groupBy({
      by: ['tipo'],
      where,
      _sum: { cantidad: true },
      _count: { id: true },
    });

    const movimientos = await this.prisma.movimientoStock.findMany({
      where,
      orderBy: { creadoEn: 'desc' },
      take: 50,
      include: {
        productoStock: {
          select: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
          },
        },
      },
    });

    return {
      resumen: resumen.map((r) => ({
        tipo: r.tipo,
        totalCantidad: Math.abs(Number(r._sum.cantidad ?? 0)),
        totalMovimientos: r._count.id,
      })),
      movimientos,
    };
  }

  /**
   * Valorizacion del inventario
   */
  async getValorizacionInventario(empresaId: string, sedeId?: string) {
    const whereBase = sedeId ? `AND ps."sedeId" = '${sedeId}'` : '';

    // By sede
    const porSede = await this.prisma.$queryRaw<Array<{
      sedeId: string;
      sedeNombre: string;
      valorTotal: number;
      stockTotal: number;
      totalProductos: number;
    }>>`
      SELECT ps."sedeId", s.nombre as "sedeNombre",
             COALESCE(SUM(ps."stockActual" * COALESCE(ps."precioCosto", 0)), 0)::float as "valorTotal",
             COALESCE(SUM(ps."stockActual"), 0)::int as "stockTotal",
             COUNT(*)::int as "totalProductos"
      FROM "ProductoStock" ps
      JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE ps."empresaId" = ${empresaId} ${Prisma.raw(whereBase)}
      AND ps."stockActual" > 0
      GROUP BY ps."sedeId", s.nombre
      ORDER BY "valorTotal" DESC
    `;

    // Top 10 most valuable
    const topProductos = await this.prisma.$queryRaw<Array<{
      productoNombre: string;
      codigoProducto: string;
      stockActual: number;
      precioCosto: number;
      valorTotal: number;
      sedeNombre: string;
    }>>`
      SELECT p.nombre as "productoNombre", p."codigoEmpresa" as "codigoProducto",
             ps."stockActual"::int, COALESCE(ps."precioCosto", 0)::float as "precioCosto",
             (ps."stockActual" * COALESCE(ps."precioCosto", 0))::float as "valorTotal",
             s.nombre as "sedeNombre"
      FROM "ProductoStock" ps
      JOIN "Producto" p ON p.id = ps."productoId"
      JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE ps."empresaId" = ${empresaId} ${Prisma.raw(whereBase)}
      AND ps."stockActual" > 0
      AND ps."precioCosto" > 0
      ORDER BY "valorTotal" DESC
      LIMIT 10
    `;

    const valorGlobal = porSede.reduce((sum, s) => sum + (s.valorTotal || 0), 0);
    const stockGlobal = porSede.reduce((sum, s) => sum + (s.stockTotal || 0), 0);

    return {
      valorGlobal: Math.round(valorGlobal * 100) / 100,
      stockGlobal,
      totalSedes: porSede.length,
      porSede,
      topProductos,
    };
  }

  /**
   * Sugerencias de reorden (productos bajo stock minimo)
   */
  async getSugerenciasReorden(empresaId: string, sedeId?: string) {
    const where: any = {
      empresaId,
      stockMinimo: { not: null },
    };
    if (sedeId) where.sedeId = sedeId;

    const productos = await this.prisma.productoStock.findMany({
      where,
      include: {
        producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
        variante: { select: { id: true, nombre: true, sku: true } },
        sede: { select: { id: true, nombre: true } },
      },
    });

    // Filter only those below minimum
    const bajosMinimo = productos.filter((ps) => ps.stockActual <= (ps.stockMinimo ?? 0));

    return bajosMinimo.map((ps) => {
      const stockMinimo = ps.stockMinimo ?? 0;
      const stockMaximo = ps.stockMaximo ?? stockMinimo * 2;
      const cantidadSugerida = Math.max(stockMaximo - ps.stockActual, 0);

      return {
        productoStockId: ps.id,
        productoId: ps.productoId,
        varianteId: ps.varianteId,
        productoNombre: ps.producto?.nombre ?? ps.variante?.nombre ?? 'Producto',
        codigoProducto: ps.producto?.codigoEmpresa ?? ps.variante?.sku ?? '',
        sedeNombre: ps.sede?.nombre ?? '',
        stockActual: ps.stockActual,
        stockMinimo,
        stockMaximo,
        cantidadSugerida,
        precioCosto: ps.precioCosto ? Number(ps.precioCosto) : null,
        valorEstimado: cantidadSugerida * (ps.precioCosto ? Number(ps.precioCosto) : 0),
      };
    }).sort((a, b) => {
      // Most urgent first (lowest stock relative to minimum)
      const urgA = a.stockActual / (a.stockMinimo || 1);
      const urgB = b.stockActual / (b.stockMinimo || 1);
      return urgA - urgB;
    });
  }

  /**
   * Reporte de rotacion de productos
   */
  async getReporteRotacion(empresaId: string, sedeId?: string, dias: number = 90) {
    const fechaDesde = new Date();
    fechaDesde.setDate(fechaDesde.getDate() - dias);

    const whereBase = sedeId ? `AND ps."sedeId" = '${sedeId}'` : '';

    const result = await this.prisma.$queryRaw<Array<{
      productoStockId: string;
      productoNombre: string;
      codigoProducto: string;
      sedeNombre: string;
      stockActual: number;
      unidadesVendidas: number;
      totalMovimientos: number;
    }>>`
      SELECT ps.id as "productoStockId",
             p.nombre as "productoNombre",
             p."codigoEmpresa" as "codigoProducto",
             s.nombre as "sedeNombre",
             ps."stockActual"::int,
             COALESCE(ventas."unidadesVendidas", 0)::int as "unidadesVendidas",
             COALESCE(ventas."totalMovimientos", 0)::int as "totalMovimientos"
      FROM "ProductoStock" ps
      JOIN "Producto" p ON p.id = ps."productoId"
      JOIN "Sede" s ON s.id = ps."sedeId"
      LEFT JOIN (
        SELECT ms."productoStockId",
               SUM(ABS(ms.cantidad))::int as "unidadesVendidas",
               COUNT(*)::int as "totalMovimientos"
        FROM "MovimientoStock" ms
        WHERE ms.tipo = 'SALIDA_VENTA'
        AND ms."creadoEn" >= ${fechaDesde}
        GROUP BY ms."productoStockId"
      ) ventas ON ventas."productoStockId" = ps.id
      WHERE ps."empresaId" = ${empresaId} ${Prisma.raw(whereBase)}
      AND ps."stockActual" > 0
      ORDER BY "unidadesVendidas" DESC
    `;

    // Classify
    const total = result.length;
    const altaRotacion = result.filter((r) => r.unidadesVendidas >= 50);
    const mediaRotacion = result.filter((r) => r.unidadesVendidas >= 10 && r.unidadesVendidas < 50);
    const bajaRotacion = result.filter((r) => r.unidadesVendidas >= 1 && r.unidadesVendidas < 10);
    const sinMovimiento = result.filter((r) => r.unidadesVendidas === 0);

    return {
      periodo: dias,
      totalProductos: total,
      resumen: {
        altaRotacion: altaRotacion.length,
        mediaRotacion: mediaRotacion.length,
        bajaRotacion: bajaRotacion.length,
        sinMovimiento: sinMovimiento.length,
      },
      productos: result.map((r) => ({
        ...r,
        clasificacion: r.unidadesVendidas >= 50 ? 'ALTA'
          : r.unidadesVendidas >= 10 ? 'MEDIA'
          : r.unidadesVendidas >= 1 ? 'BAJA'
          : 'SIN_MOVIMIENTO',
      })),
    };
  }

  /**
   * Invalidar cache de productos y estadísticas de la empresa
   */
  private async invalidateProductCache(empresaId: string): Promise<void> {
    try {
      const statsKey = this.cacheService.getEmpresaStatsKey(empresaId);
      await this.cacheService.invalidate(statsKey);
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Error al invalidar cache: ${errorMessage}`);
    }
  }

  // =====================================================
  // MONITOR DE PRODUCTOS
  // =====================================================

  /**
   * Monitor completo del estado de productos: estadísticas y alertas
   */
  async getMonitorProductos(empresaId: string, sedeId?: string) {
    const baseWhere: any = { empresaId };
    if (sedeId) baseWhere.sedeId = sedeId;

    // 1. Conteos paralelos de ProductoStock
    const [
      totalProductoStock,
      conStock,
      sinStock,
      conPrecio,
      sinPrecio,
      conPrecioCosto,
      sinPrecioCosto,
      conUbicacion,
      sinUbicacion,
      precioIncluyeIgv,
      precioNoIncluyeIgv,
      enOferta,
    ] = await Promise.all([
      this.prisma.productoStock.count({ where: baseWhere }),
      this.prisma.productoStock.count({ where: { ...baseWhere, stockActual: { gt: 0 } } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, stockActual: { lte: 0 } } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioConfigurado: true } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioConfigurado: false } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioCosto: { not: null } } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, OR: [{ precioCosto: null }, { precioCosto: 0 }] } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, ubicacion: { not: null }, NOT: { ubicacion: '' } } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, OR: [{ ubicacion: null }, { ubicacion: '' }] } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioIncluyeIgv: true } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, precioIncluyeIgv: false } }),
      this.prisma.productoStock.count({ where: { ...baseWhere, enOferta: true } }),
    ]);

    // Bajo mínimo: raw SQL porque Prisma no puede comparar dos columnas
    const bajoMinimoResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::int as count FROM "ProductoStock"
      WHERE "empresaId" = ${empresaId}
      ${sedeId ? Prisma.sql`AND "sedeId" = ${sedeId}` : Prisma.empty}
      AND "stockMinimo" IS NOT NULL
      AND "stockActual" <= "stockMinimo"
    `;
    const bajoMinimo = Number(bajoMinimoResult[0]?.count ?? 0);

    // 2. Conteos de Producto (no stock) para marketplace e imágenes
    const productoBaseWhere: any = { empresaId, isActive: true, deletedAt: null };

    const [totalProductos, visibleMarketplace, noVisibleMarketplace, conBarcode] = await Promise.all([
      this.prisma.producto.count({ where: productoBaseWhere }),
      this.prisma.producto.count({ where: { ...productoBaseWhere, visibleMarketplace: true } }),
      this.prisma.producto.count({ where: { ...productoBaseWhere, visibleMarketplace: false } }),
      this.prisma.producto.count({ where: { ...productoBaseWhere, codigoBarras: { not: null }, NOT: { codigoBarras: '' } } }),
    ]);
    const sinBarcode = totalProductos - conBarcode;

    // Productos con imagen (raw SQL por relación polimórfica)
    const conImagenResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT p.id)::int as count
      FROM "Producto" p
      WHERE p."empresaId" = ${empresaId} AND p."isActive" = true AND p."deletedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "Archivo" a
        WHERE a."entidadId" = p.id AND a."tipoArchivo" = 'IMAGEN' AND a."isActive" = true
      )
    `;
    const conImagen = Number(conImagenResult[0]?.count ?? 0);
    const sinImagen = totalProductos - conImagen;

    // 3. Métricas compuestas
    const listosParaVenta = await this.prisma.productoStock.count({
      where: { ...baseWhere, precioConfigurado: true, stockActual: { gt: 0 } },
    });

    // % catálogo completo = tiene precio + stock > 0 + ubicación + imagen / total
    const catalogoCompletoResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT ps.id)::int as count
      FROM "ProductoStock" ps
      JOIN "Producto" p ON p.id = ps."productoId"
      WHERE ps."empresaId" = ${empresaId}
      ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      AND ps."precioConfigurado" = true
      AND ps."stockActual" > 0
      AND ps."ubicacion" IS NOT NULL AND ps."ubicacion" != ''
      AND EXISTS (SELECT 1 FROM "Archivo" a WHERE a."entidadId" = p.id AND a."tipoArchivo" = 'IMAGEN' AND a."isActive" = true)
    `;
    const catalogoCompleto = Number(catalogoCompletoResult[0]?.count ?? 0);
    const porcentajeCatalogoCompleto = totalProductoStock > 0
      ? Math.round((catalogoCompleto / totalProductoStock) * 10000) / 100
      : 0;

    // 4. Listas de alertas (max 20 cada una)
    const includeProducto = {
      producto: { select: { id: true, nombre: true, codigoEmpresa: true, visibleMarketplace: true } },
      variante: { select: { id: true, nombre: true } },
      sede: { select: { id: true, nombre: true } },
    };

    const mapAlerta = (ps: any) => ({
      id: ps.id,
      productoId: ps.producto?.id ?? ps.productoId,
      nombre: ps.variante ? `${ps.producto?.nombre} - ${ps.variante.nombre}` : ps.producto?.nombre,
      codigoEmpresa: ps.producto?.codigoEmpresa,
      sedeNombre: ps.sede?.nombre,
      stockActual: ps.stockActual,
      precio: ps.precio ? Number(ps.precio) : null,
      ubicacion: ps.ubicacion,
    });

    const [alertaSinPrecio, alertaSinCosto, alertaSinUbicacion, alertaStockCero, alertaPrecioSinIgv] = await Promise.all([
      this.prisma.productoStock.findMany({ where: { ...baseWhere, precioConfigurado: false }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
      this.prisma.productoStock.findMany({ where: { ...baseWhere, OR: [{ precioCosto: null }] }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
      this.prisma.productoStock.findMany({ where: { ...baseWhere, OR: [{ ubicacion: null }, { ubicacion: '' }] }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
      this.prisma.productoStock.findMany({ where: { ...baseWhere, stockActual: { lte: 0 } }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
      this.prisma.productoStock.findMany({ where: { ...baseWhere, precioConfigurado: true, precioIncluyeIgv: false }, include: includeProducto, take: 20 }).then(r => r.map(mapAlerta)),
    ]);

    // Alertas bajo mínimo (raw SQL)
    const alertaBajoMinimo = await this.prisma.$queryRaw<any[]>`
      SELECT ps.id, ps."productoId", ps."stockActual", ps.precio::float, ps.ubicacion,
             p.nombre, p."codigoEmpresa", s.nombre as "sedeNombre"
      FROM "ProductoStock" ps
      JOIN "Producto" p ON p.id = ps."productoId"
      JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE ps."empresaId" = ${empresaId}
      ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      AND ps."stockMinimo" IS NOT NULL
      AND ps."stockActual" <= ps."stockMinimo"
      LIMIT 20
    `;

    // Alertas sin imagen y marketplace sin imagen (con datos de stock)
    const alertaSinImagen = await this.prisma.$queryRaw<any[]>`
      SELECT p.id, p.id as "productoId", p.nombre, p."codigoEmpresa",
             COALESCE(ps."stockActual", 0)::int as "stockActual",
             ps.precio::float as precio,
             ps.ubicacion,
             s.nombre as "sedeNombre"
      FROM "Producto" p
      LEFT JOIN "ProductoStock" ps ON ps."productoId" = p.id AND ps."empresaId" = p."empresaId"
        ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      LEFT JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE p."empresaId" = ${empresaId} AND p."isActive" = true AND p."deletedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "Archivo" a WHERE a."entidadId" = p.id AND a."tipoArchivo" = 'IMAGEN' AND a."isActive" = true)
      LIMIT 20
    `;

    const alertaSinBarcode = await this.prisma.$queryRaw<any[]>`
      SELECT p.id, p.id as "productoId", p.nombre, p."codigoEmpresa",
             COALESCE(ps."stockActual", 0)::int as "stockActual",
             ps.precio::float as precio,
             ps.ubicacion,
             s.nombre as "sedeNombre"
      FROM "Producto" p
      LEFT JOIN "ProductoStock" ps ON ps."productoId" = p.id AND ps."empresaId" = p."empresaId"
        ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      LEFT JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE p."empresaId" = ${empresaId} AND p."isActive" = true AND p."deletedAt" IS NULL
      AND (p."codigoBarras" IS NULL OR p."codigoBarras" = '')
      LIMIT 20
    `;

    const alertaMarketplaceSinImagen = await this.prisma.$queryRaw<any[]>`
      SELECT p.id, p.id as "productoId", p.nombre, p."codigoEmpresa",
             COALESCE(ps."stockActual", 0)::int as "stockActual",
             ps.precio::float as precio,
             ps.ubicacion,
             s.nombre as "sedeNombre"
      FROM "Producto" p
      LEFT JOIN "ProductoStock" ps ON ps."productoId" = p.id AND ps."empresaId" = p."empresaId"
        ${sedeId ? Prisma.sql`AND ps."sedeId" = ${sedeId}` : Prisma.empty}
      LEFT JOIN "Sede" s ON s.id = ps."sedeId"
      WHERE p."empresaId" = ${empresaId} AND p."isActive" = true AND p."deletedAt" IS NULL
      AND p."visibleMarketplace" = true
      AND NOT EXISTS (SELECT 1 FROM "Archivo" a WHERE a."entidadId" = p.id AND a."tipoArchivo" = 'IMAGEN' AND a."isActive" = true)
      LIMIT 20
    `;

    // 5. Respuesta completa
    return {
      estadisticas: {
        totalProductos,
        productosActivos: totalProductos,
        totalProductoStock,
        conStock,
        sinStock,
        bajoMinimo,
        conPrecio,
        sinPrecio,
        conPrecioCosto,
        sinPrecioCosto,
        conUbicacion,
        sinUbicacion,
        visibleMarketplace,
        noVisibleMarketplace,
        precioIncluyeIgv,
        precioNoIncluyeIgv,
        enOferta,
        conImagen,
        sinImagen,
        conBarcode,
        sinBarcode,
        porcentajeCatalogoCompleto,
        listosParaVenta,
      },
      alertas: {
        sinPrecio: alertaSinPrecio,
        sinPrecioCosto: alertaSinCosto,
        sinUbicacion: alertaSinUbicacion,
        sinImagen: alertaSinImagen,
        stockCero: alertaStockCero,
        bajoMinimo: alertaBajoMinimo,
        marketplaceSinImagen: alertaMarketplaceSinImagen,
        precioSinIgv: alertaPrecioSinIgv,
        sinBarcode: alertaSinBarcode,
      },
    };
  }

  // =====================================================
  // BULK OPERATIONS (Monitor de Productos)
  // =====================================================

  /**
   * Listar productos con estado marketplace
   */
  async getProductosMarketplaceEstado(empresaId: string) {
    const productos = await this.prisma.producto.findMany({
      where: { empresaId, isActive: true, deletedAt: null },
      select: {
        id: true,
        nombre: true,
        codigoEmpresa: true,
        visibleMarketplace: true,
        stocksPorSede: {
          select: { stockActual: true, precio: true },
          take: 1,
        },
      },
      orderBy: [{ visibleMarketplace: 'desc' }, { nombre: 'asc' }],
    });

    return productos.map(p => ({
      id: p.id,
      nombre: p.nombre,
      codigoEmpresa: p.codigoEmpresa,
      visibleMarketplace: p.visibleMarketplace,
      stockActual: p.stocksPorSede[0]?.stockActual ?? 0,
      precio: p.stocksPorSede[0]?.precio ? Number(p.stocksPorSede[0].precio) : null,
    }));
  }

  /**
   * Bulk activar/desactivar marketplace para productos
   */
  async bulkMarketplace(empresaId: string, productoIds: string[], visible: boolean) {
    const result = await this.prisma.producto.updateMany({
      where: { id: { in: productoIds }, empresaId },
      data: { visibleMarketplace: visible },
    });
    return { updated: result.count };
  }

  /**
   * Bulk asignar ubicación a registros de stock
   */
  async bulkUbicacion(empresaId: string, productoStockIds: string[], ubicacion: string) {
    const result = await this.prisma.productoStock.updateMany({
      where: { id: { in: productoStockIds }, empresaId },
      data: { ubicacion },
    });
    return { updated: result.count };
  }

  /**
   * Bulk marcar precio incluye IGV
   */
  async bulkPrecioIgv(empresaId: string, productoStockIds: string[], precioIncluyeIgv: boolean) {
    const result = await this.prisma.productoStock.updateMany({
      where: { id: { in: productoStockIds }, empresaId },
      data: { precioIncluyeIgv },
    });
    return { updated: result.count };
  }

  // =====================================================
  // LIQUIDACIÓN — remate por debajo de precio costo
  // =====================================================

  /**
   * Valida que el usuario tenga rol de GERENTE_SEDE/ADMINISTRADOR (a nivel
   * sede) o SUPER_ADMIN/EMPRESA_ADMIN (a nivel empresa) — usado para
   * autorizar la activación de liquidación o la venta bajo costo. El flujo
   * normal es que el front llame primero a /auth/autorizar-operacion para
   * validar DNI+password, este método sirve como defensa extra.
   */
  private async assertAutorizadorGerencial(autorizadoPorId: string, empresaId: string): Promise<void> {
    const empresaRol = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: autorizadoPorId,
        empresaId,
        isActive: true,
        deletedAt: null,
        rol: { in: ['SUPER_ADMIN', 'EMPRESA_ADMIN'] },
      },
    });
    if (empresaRol) return;

    const sedeRol = await this.prisma.usuarioSedeRol.findFirst({
      where: {
        usuarioId: autorizadoPorId,
        sede: { empresaId },
        rol: { in: ['GERENTE_SEDE', 'ADMINISTRADOR'] },
        isActive: true,
      },
    });
    if (sedeRol) return;

    throw new BadRequestException(
      'El autorizador no tiene rol de GERENTE_SEDE/ADMINISTRADOR',
    );
  }

  async activarLiquidacion(
    productoStockId: string,
    empresaId: string,
    dto: ActivarLiquidacionDto,
    usuarioId: string,
  ) {
    const stock = await this.prisma.productoStock.findUnique({
      where: { id: productoStockId },
      include: { producto: true, variante: true, sede: true },
    });
    if (!stock) throw new NotFoundException('Stock no encontrado');
    if (stock.empresaId !== empresaId) {
      throw new BadRequestException('El stock no pertenece a esta empresa');
    }
    // Lock conceptual: no permitir reactivar si ya está activa. Evita
    // race entre dos admins simultáneos que pisaría el precioLiquidacion
    // / motivo del primero sin warning. Para cambiar precio/motivo el
    // admin debe desactivar primero y volver a activar.
    if (stock.enLiquidacion) {
      throw new BadRequestException(
        'El producto ya está en liquidación. Desactívala primero si necesitás cambiar el precio o motivo.',
      );
    }
    if (!stock.precioCosto || Number(stock.precioCosto) <= 0) {
      throw new BadRequestException(
        'El producto no tiene precio de costo configurado. Configúralo antes de liquidar.',
      );
    }
    if (dto.precioLiquidacion > Number(stock.precioCosto)) {
      throw new BadRequestException(
        'El precio de liquidación debe ser menor o igual al precio de costo (S/' +
          Number(stock.precioCosto).toFixed(2) +
          '). Si el precio es mayor al costo, usa una oferta normal.',
      );
    }
    if (dto.motivoLiquidacion === 'OTRO' && !dto.observaciones?.trim()) {
      throw new BadRequestException(
        'Cuando el motivo es OTRO, las observaciones son obligatorias',
      );
    }

    await this.assertAutorizadorGerencial(dto.autorizadoPorId, empresaId);

    const fechaInicio = new Date();
    const fechaFin = dto.fechaFin ? new Date(dto.fechaFin) : null;
    if (fechaFin && fechaFin <= fechaInicio) {
      throw new BadRequestException('La fecha de fin debe ser posterior a hoy');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Check atomico contra race: updateMany con where enLiquidacion=false
      // garantiza que solo gana la primera transaccion. La segunda admin
      // que llegue obtiene count=0 y tiramos error claro.
      const lock = await tx.productoStock.updateMany({
        where: { id: productoStockId, enLiquidacion: false },
        data: {
          enLiquidacion: true,
          precioLiquidacion: new Decimal(dto.precioLiquidacion),
          motivoLiquidacion: dto.motivoLiquidacion,
          observacionesLiquidacion: dto.observaciones ?? null,
          fechaInicioLiquidacion: fechaInicio,
          fechaFinLiquidacion: fechaFin,
          liquidacionAutorizadaPorId: dto.autorizadoPorId,
        },
      });
      if (lock.count === 0) {
        throw new BadRequestException(
          'Otro usuario activó la liquidación de este producto simultáneamente. Refrescá y revisá el estado actual.',
        );
      }
      const result = await tx.productoStock.findUniqueOrThrow({
        where: { id: productoStockId },
        include: { producto: true, variante: true, sede: true },
      });

      await tx.productoPrecioHistorialSede.create({
        data: {
          productoStockId: stock.id,
          sedeId: stock.sedeId,
          precioAnterior: stock.precio,
          precioNuevo: stock.precio,
          precioCostoAnterior: stock.precioCosto,
          precioCostoNuevo: stock.precioCosto,
          precioOfertaAnterior: stock.precioOferta,
          precioOfertaNuevo: new Decimal(dto.precioLiquidacion),
          tipoCambio: TipoCambioPrecio.LIQUIDACION,
          razon:
            `Liquidación activada [${dto.motivoLiquidacion}]` +
            (dto.observaciones ? `: ${dto.observaciones}` : ''),
          origenModulo: 'LIQUIDACION',
          usuarioId,
        },
      });

      return result;
    });

    await this.invalidateProductCache(empresaId);
    this.realtimeInvalidation.notifyPrecioCambiado({
      empresaId,
      productoId: stock.productoId,
      varianteId: stock.varianteId,
      sedeId: stock.sedeId,
    });

    this.logger.log(
      `Liquidación activada para ${stock.producto?.nombre || stock.variante?.nombre} en sede ${stock.sede.nombre} (motivo: ${dto.motivoLiquidacion}, precio: S/${dto.precioLiquidacion})`,
    );

    return updated;
  }

  async desactivarLiquidacion(
    productoStockId: string,
    empresaId: string,
    usuarioId: string,
    razon?: string,
  ) {
    const stock = await this.prisma.productoStock.findUnique({
      where: { id: productoStockId },
      include: { producto: true, variante: true, sede: true },
    });
    if (!stock) throw new NotFoundException('Stock no encontrado');
    if (stock.empresaId !== empresaId) {
      throw new BadRequestException('El stock no pertenece a esta empresa');
    }
    if (!stock.enLiquidacion) {
      throw new BadRequestException('El producto no está en liquidación');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.productoStock.update({
        where: { id: productoStockId },
        data: {
          enLiquidacion: false,
          precioLiquidacion: null,
          motivoLiquidacion: null,
          observacionesLiquidacion: null,
          fechaInicioLiquidacion: null,
          fechaFinLiquidacion: null,
          liquidacionAutorizadaPorId: null,
        },
        include: { producto: true, variante: true, sede: true },
      });

      await tx.productoPrecioHistorialSede.create({
        data: {
          productoStockId: stock.id,
          sedeId: stock.sedeId,
          precioAnterior: stock.precio,
          precioNuevo: stock.precio,
          precioCostoAnterior: stock.precioCosto,
          precioCostoNuevo: stock.precioCosto,
          precioOfertaAnterior: stock.precioLiquidacion,
          precioOfertaNuevo: stock.precioOferta,
          tipoCambio: TipoCambioPrecio.LIQUIDACION,
          razon: razon ? `Liquidación desactivada: ${razon}` : 'Liquidación desactivada',
          origenModulo: 'LIQUIDACION',
          usuarioId,
        },
      });

      return result;
    });

    await this.invalidateProductCache(empresaId);
    this.realtimeInvalidation.notifyPrecioCambiado({
      empresaId,
      productoId: stock.productoId,
      varianteId: stock.varianteId,
      sedeId: stock.sedeId,
    });

    this.logger.log(
      `Liquidación desactivada para ${stock.producto?.nombre || stock.variante?.nombre} en sede ${stock.sede.nombre}` +
        (razon ? ` (razón: ${razon})` : ''),
    );

    return updated;
  }

  /**
   * Lista los productos en liquidación activa por sede (vigentes según fechas).
   */
  async listarLiquidacionesActivas(
    empresaId: string,
    sedeId?: string,
    page = 1,
    limit = 50,
  ) {
    const now = new Date();
    const where: Prisma.ProductoStockWhereInput = {
      empresaId,
      enLiquidacion: true,
      ...(sedeId ? { sedeId } : {}),
      OR: [
        { fechaFinLiquidacion: null },
        { fechaFinLiquidacion: { gte: now } },
      ],
    };

    const [total, rows] = await Promise.all([
      this.prisma.productoStock.count({ where }),
      this.prisma.productoStock.findMany({
        where,
        include: {
          producto: { select: { id: true, nombre: true, codigoEmpresa: true, sku: true } },
          variante: { select: { id: true, nombre: true, sku: true } },
          sede: { select: { id: true, nombre: true } },
          liquidacionAutorizadaPor: {
            select: { id: true, persona: { select: { nombres: true, apellidos: true } } },
          },
        },
        orderBy: { fechaInicioLiquidacion: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return createPaginatedResponse(rows, total, page, limit);
  }

  /**
   * Cron diario que limpia liquidaciones cuya fechaFin ya pasó.
   * Mantiene el campo de auditoría pero las desmarca para que no se apliquen
   * en ventas nuevas.
   */
  @Cron('0 5 * * *')
  async cronExpirarLiquidaciones() {
    const now = new Date();
    const result = await this.prisma.productoStock.updateMany({
      where: {
        enLiquidacion: true,
        fechaFinLiquidacion: { not: null, lt: now },
      },
      data: {
        enLiquidacion: false,
        precioLiquidacion: null,
        motivoLiquidacion: null,
      },
    });
    if (result.count > 0) {
      this.logger.log(`Cron liquidaciones: ${result.count} expiradas desactivadas`);
    }
  }

  // =====================================================
  // VERIFICACIÓN / AUDITORÍA DE PRECIOS
  // =====================================================

  /**
   * Construye el where Prisma según el campo + modo del filtro.
   * Usado por verificarPrecios y exportVerificacionPrecios.
   */
  private _buildVerificacionWhere(
    empresaId: string,
    dto: VerificarPreciosDto,
  ): Prisma.ProductoStockWhereInput {
    const where: Prisma.ProductoStockWhereInput = { empresaId };
    if (dto.sedeId) where.sedeId = dto.sedeId;

    // Cuando hay filtro de comparación, ignoramos campo/modo/min/max/exacto
    // y aplicamos solo el guard de NOT NULL que necesita el modo. La
    // comparación columna-vs-columna se hace post-fetch (Prisma no soporta
    // comparar dos columnas en el where).
    if (dto.comparacion) {
      if (dto.comparacion === ComparacionPrecio.SIN_COSTO) {
        where.precio = { not: null };
        where.precioCosto = null;
      } else {
        // PERDIDA / SIN_MARGEN / MARGEN_BAJO: ambos necesarios para comparar
        where.precio = { not: null };
        where.precioCosto = { not: null };
      }
    } else {
      const campo = dto.campo ?? CampoPrecio.COSTO;
      const modo = dto.modo ?? ModoVerificacion.RANGO;

      const campoMap: Record<
        CampoPrecio,
        keyof Prisma.ProductoStockWhereInput
      > = {
        [CampoPrecio.PRECIO]: 'precio',
        [CampoPrecio.COSTO]: 'precioCosto',
        [CampoPrecio.OFERTA]: 'precioOferta',
        [CampoPrecio.LIQUIDACION]: 'precioLiquidacion',
      };
      const campoKey = campoMap[campo];

      // Filtro por valor del campo seleccionado
      if (modo === ModoVerificacion.SIN_VALOR) {
        (where as any)[campoKey] = null;
      } else if (modo === ModoVerificacion.EXACTO && dto.exacto != null) {
        (where as any)[campoKey] = new Prisma.Decimal(dto.exacto);
      } else if (modo === ModoVerificacion.RANGO) {
        const filtroRango: any = { not: null };
        if (dto.min != null) filtroRango.gte = new Prisma.Decimal(dto.min);
        if (dto.max != null) filtroRango.lte = new Prisma.Decimal(dto.max);
        // Si no se pasa min/max el modo RANGO trae todos los que tienen valor.
        (where as any)[campoKey] = filtroRango;
      }
    }

    // Filtros sobre el producto relacionado (categoría, marca, activo).
    // Nota: empresaCategoria/Marca tienen nombre via relación con maestro
    // o nombrePersonalizado — la UI filtra por ID así que aceptamos eso
    // directamente sin resolver el nombre.
    const productoFilter: Prisma.ProductoWhereInput = {};
    if (dto.empresaCategoriaId)
      productoFilter.empresaCategoriaId = dto.empresaCategoriaId;
    if (dto.empresaMarcaId) productoFilter.empresaMarcaId = dto.empresaMarcaId;
    if (dto.soloActivos !== false) {
      productoFilter.isActive = true;
      productoFilter.deletedAt = null;
    }
    if (Object.keys(productoFilter).length > 0) {
      where.producto = productoFilter;
    }

    // Filtro por stock
    if (dto.stock === FiltroStock.CON) {
      where.stockActual = { gt: 0 };
    } else if (dto.stock === FiltroStock.SIN) {
      where.stockActual = { lte: 0 };
    }

    return where;
  }

  /**
   * Filtra en JS las comparaciones que Prisma no expresa en `where`
   * (columna vs columna). Se aplica DESPUÉS del findMany. Las filas ya
   * vienen pre-filtradas por NOT NULL desde el where, así que precio y
   * precioCosto son seguros de leer (excepto en SIN_COSTO, que no
   * requiere comparación).
   */
  private _aplicarComparacionPrecio<
    T extends {
      precio: DecimalType | null;
      precioCosto: DecimalType | null;
    },
  >(
    stocks: T[],
    comparacion: ComparacionPrecio | undefined,
    margenMinimo: number,
  ): T[] {
    if (!comparacion || comparacion === ComparacionPrecio.SIN_COSTO) {
      // SIN_COSTO ya queda resuelto por el where (precio NOT NULL, costo NULL).
      return stocks;
    }
    return stocks.filter((s) => {
      const precio = s.precio != null ? Number(s.precio) : null;
      const costo = s.precioCosto != null ? Number(s.precioCosto) : null;
      if (precio == null || costo == null) return false;
      switch (comparacion) {
        case ComparacionPrecio.PERDIDA:
          return costo > precio;
        case ComparacionPrecio.SIN_MARGEN:
          return costo === precio;
        case ComparacionPrecio.MARGEN_BAJO: {
          if (precio === 0) return false; // evita división por cero
          const margenPct = ((precio - costo) / precio) * 100;
          return margenPct < margenMinimo;
        }
        default:
          return false;
      }
    });
  }

  /**
   * Lista de productos+sede para auditoría de precios. Response plano y
   * liviano (sin paginar — se limita por `limit`, default 500). Pensado
   * para localizar precios mal cargados via filtros por valor.
   */
  async verificarPrecios(empresaId: string, dto: VerificarPreciosDto) {
    const where = this._buildVerificacionWhere(empresaId, dto);
    const limit = Number(dto.limit ?? 500);
    // Cuando hay comparación columna-vs-columna (PERDIDA/SIN_MARGEN/
    // MARGEN_BAJO) filtramos post-fetch; el `take` del DB no sabe cuántas
    // filas pasan el filtro. Subimos el cap a 5000 para no quedar cortos
    // en empresas grandes. Para los demás casos mantenemos `take = limit`.
    const requiereComparacionPostFetch =
      dto.comparacion != null && dto.comparacion !== ComparacionPrecio.SIN_COSTO;
    const fetchTake = requiereComparacionPostFetch ? 5000 : limit;
    // OPTIMIZACIÓN: el orderBy por relación (producto.nombre + sede.nombre)
    // dispara subqueries caros en Postgres sin índice compuesto. Para
    // datasets ≤5k filas conviene traer sin orden y ordenar en JS. Reduce
    // el query de ~800ms a ~150ms en empresas con muchos productos.
    const stocksRaw = await this.prisma.productoStock.findMany({
      where,
      take: fetchTake,
      include: {
        producto: {
          select: { id: true, nombre: true, codigoEmpresa: true },
        },
        variante: { select: { id: true, nombre: true, sku: true } },
        sede: { select: { id: true, nombre: true } },
      },
    });
    const stocksFiltrados = this._aplicarComparacionPrecio(
      stocksRaw,
      dto.comparacion,
      Number(dto.margenMinimo ?? 10),
    );
    stocksFiltrados.sort((a, b) => {
      const pn = (a.producto?.nombre ?? '').localeCompare(
        b.producto?.nombre ?? '',
      );
      if (pn !== 0) return pn;
      return (a.sede?.nombre ?? '').localeCompare(b.sede?.nombre ?? '');
    });
    // Trim al límite visible y marcamos limitAlcanzado si:
    //  - sin comparación: cuando `stocksRaw.length === limit` (= take = limit)
    //  - con comparación: cuando hay más resultados post-filtro que `limit`
    //    o cuando llenamos el cap de 5000 (puede haber más candidatos sin evaluar)
    const limitAlcanzado = requiereComparacionPostFetch
      ? stocksFiltrados.length > limit || stocksRaw.length === fetchTake
      : stocksFiltrados.length === limit;
    const stocks = stocksFiltrados.slice(0, limit);

    return {
      total: stocks.length,
      limitAlcanzado,
      items: stocks.map((s) => ({
        id: s.id,
        productoId: s.productoId,
        varianteId: s.varianteId,
        codigoEmpresa: s.producto?.codigoEmpresa ?? null,
        nombre:
          s.variante?.nombre != null
            ? `${s.producto?.nombre ?? ''} — ${s.variante.nombre}`
            : (s.producto?.nombre ?? ''),
        sedeId: s.sede.id,
        sedeNombre: s.sede.nombre,
        stockActual: s.stockActual,
        precio: s.precio != null ? Number(s.precio) : null,
        precioCosto: s.precioCosto != null ? Number(s.precioCosto) : null,
        precioOferta: s.precioOferta != null ? Number(s.precioOferta) : null,
        precioLiquidacion:
          s.precioLiquidacion != null ? Number(s.precioLiquidacion) : null,
        enOferta: s.enOferta,
        enLiquidacion: s.enLiquidacion,
        precioConfigurado: s.precioConfigurado,
      })),
    };
  }

  /**
   * Exporta verificación a Excel. Mismas filas que verificarPrecios pero
   * sin límite (configurable, default 5000 para no romper memoria).
   */
  /**
   * Exporta TODO el inventario de una sede a Excel (.xlsx). Respeta el
   * filtro de búsqueda (mismo criterio que getStocksPorSede). La columna
   * "Disponible" usa la misma fórmula que la tabla del app (físico menos
   * reservado, apartado, dañado y garantía) para que coincida con lo que
   * ve el cajero en pantalla.
   */
  async exportStockPorSede(
    sedeId: string,
    empresaId: string,
    search: string | undefined,
    res: Response,
  ) {
    const where: Prisma.ProductoStockWhereInput = { sedeId, empresaId };
    const term = search?.trim();
    if (term) {
      // Por PALABRAS, no por frase entera: en el mostrador se teclea
      // "lavadora samsung" y antes eso devolvía cero (una palabra está en el
      // nombre y la otra en la marca). Ver `texto-busqueda.util.ts`.
      const terminos = tokenizarBusqueda(term);
      const porPalabras = condicionStockPorPalabras(terminos);

      if (pareceCodigo(term)) {
        // El escaneo de código de barras se resuelve por igualdad exacta.
        where.OR = [
          { producto: { codigoBarras: { equals: term, mode: 'insensitive' } } },
          { producto: { sku: { equals: term, mode: 'insensitive' } } },
          { producto: { codigoEmpresa: { equals: term, mode: 'insensitive' } } },
          { variante: { codigoBarras: { equals: term, mode: 'insensitive' } } },
          { variante: { sku: { equals: term, mode: 'insensitive' } } },
          ...(porPalabras.length > 0 ? [{ AND: porPalabras }] : []),
        ];
      } else if (porPalabras.length > 0) {
        where.AND = porPalabras;
      }
    }

    const stocks = await this.prisma.productoStock.findMany({
      where,
      include: {
        producto: {
          select: {
            nombre: true,
            codigoEmpresa: true,
            sku: true,
            empresaMarca: {
              select: {
                nombreLocal: true,
                nombrePersonalizado: true,
                marcaMaestra: { select: { nombre: true } },
              },
            },
            empresaCategoria: {
              select: {
                nombreLocal: true,
                nombrePersonalizado: true,
                categoriaMaestra: { select: { nombre: true } },
              },
            },
          },
        },
        variante: { select: { nombre: true, sku: true } },
        sede: { select: { nombre: true } },
      },
      take: 20000,
    });

    stocks.sort((a, b) =>
      (a.producto?.nombre ?? a.variante?.nombre ?? '').localeCompare(
        b.producto?.nombre ?? b.variante?.nombre ?? '',
      ),
    );

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Syncronize';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Inventario');
    sheet.columns = [
      { header: 'Código', key: 'codigo', width: 14 },
      { header: 'Producto', key: 'nombre', width: 38 },
      { header: 'Variante', key: 'variante', width: 18 },
      { header: 'Marca', key: 'marca', width: 18 },
      { header: 'Categoría', key: 'categoria', width: 20 },
      { header: 'Físico', key: 'fisico', width: 10 },
      { header: 'Disponible', key: 'disponible', width: 11 },
      { header: 'P. Compra', key: 'precioCompra', width: 12 },
      { header: 'P. Venta', key: 'precioVenta', width: 12 },
      { header: 'Reservado', key: 'reservado', width: 11 },
      { header: 'Apartado', key: 'apartado', width: 10 },
      { header: 'Dañado', key: 'danado', width: 9 },
      { header: 'Garantía', key: 'garantia', width: 10 },
      { header: 'Mínimo', key: 'minimo', width: 9 },
      { header: 'Máximo', key: 'maximo', width: 9 },
      { header: 'Ubicación', key: 'ubicacion', width: 16 },
      { header: 'Sede', key: 'sede', width: 16 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1565C0' },
    };
    headerRow.alignment = { horizontal: 'center' };
    headerRow.height = 22;

    for (const s of stocks) {
      const reservado = s.stockReservado ?? 0;
      const apartado = s.stockReservadoVenta ?? 0;
      const danado = s.stockDanado ?? 0;
      const garantia = s.stockEnGarantia ?? 0;
      const disponible =
        s.stockActual - reservado - apartado - danado - garantia;
      sheet.addRow({
        codigo: s.producto?.codigoEmpresa ?? '',
        nombre: s.producto?.nombre ?? s.variante?.nombre ?? '',
        variante: s.variante?.nombre ?? '',
        marca:
          s.producto?.empresaMarca?.nombreLocal ??
          s.producto?.empresaMarca?.nombrePersonalizado ??
          s.producto?.empresaMarca?.marcaMaestra?.nombre ??
          '',
        categoria:
          s.producto?.empresaCategoria?.nombreLocal ??
          s.producto?.empresaCategoria?.nombrePersonalizado ??
          s.producto?.empresaCategoria?.categoriaMaestra?.nombre ??
          '',
        fisico: s.stockActual,
        disponible,
        // P. Compra = precioCosto (costo promedio ponderado). P. Venta = precio.
        precioCompra: s.precioCosto != null ? Number(s.precioCosto) : null,
        precioVenta: s.precio != null ? Number(s.precio) : null,
        reservado,
        apartado,
        danado,
        garantia,
        minimo: s.stockMinimo ?? null,
        maximo: s.stockMaximo ?? null,
        ubicacion: s.ubicacion ?? '',
        sede: s.sede?.nombre ?? '',
      });
    }

    // Formato moneda para P. Compra (col 8) y P. Venta (col 9).
    sheet.getColumn(8).numFmt = '#,##0.00';
    sheet.getColumn(9).numFmt = '#,##0.00';

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=inventario_${new Date().toISOString().slice(0, 10)}.xlsx`,
    });
    await wb.xlsx.write(res);
    res.end();
  }

  async exportVerificacionPrecios(
    empresaId: string,
    dto: VerificarPreciosDto,
    res: Response,
  ) {
    const where = this._buildVerificacionWhere(empresaId, dto);
    const limit = Number(dto.limit ?? 5000);
    // Mismo criterio que verificarPrecios: orderBy en JS, no en DB.
    // Cuando hay comparación post-fetch evaluamos hasta el `limit` directo
    // (que para export ya es alto, default 5000) — no necesitamos un cap
    // extra como en verificarPrecios porque acá el "límite visible" y el
    // "límite de evaluación" coinciden.
    const stocksRaw = await this.prisma.productoStock.findMany({
      where,
      take: limit,
      include: {
        producto: { select: { nombre: true, codigoEmpresa: true } },
        variante: { select: { nombre: true, sku: true } },
        sede: { select: { nombre: true } },
      },
    });
    const stocks = this._aplicarComparacionPrecio(
      stocksRaw,
      dto.comparacion,
      Number(dto.margenMinimo ?? 10),
    );
    stocks.sort((a, b) => {
      const pn = (a.producto?.nombre ?? '').localeCompare(
        b.producto?.nombre ?? '',
      );
      if (pn !== 0) return pn;
      return (a.sede?.nombre ?? '').localeCompare(b.sede?.nombre ?? '');
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Syncronize';
    wb.created = new Date();
    const sheet = wb.addWorksheet('Verificación precios');
    sheet.columns = [
      { header: 'Código', key: 'codigo', width: 14 },
      { header: 'Producto', key: 'nombre', width: 38 },
      { header: 'Variante', key: 'variante', width: 18 },
      { header: 'Sede', key: 'sede', width: 16 },
      { header: 'Stock', key: 'stock', width: 8 },
      { header: 'Precio venta', key: 'precio', width: 13 },
      { header: 'Precio costo', key: 'costo', width: 13 },
      { header: 'Precio oferta', key: 'oferta', width: 13 },
      { header: 'Precio liquidación', key: 'liquidacion', width: 16 },
      { header: 'En oferta', key: 'enOferta', width: 10 },
      { header: 'En liquidación', key: 'enLiquidacion', width: 13 },
    ];
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1565C0' },
    };
    headerRow.alignment = { horizontal: 'center' };
    headerRow.height = 22;

    for (const s of stocks) {
      sheet.addRow({
        codigo: s.producto?.codigoEmpresa ?? '',
        nombre: s.producto?.nombre ?? '',
        variante: s.variante?.nombre ?? '',
        sede: s.sede.nombre,
        stock: s.stockActual,
        precio: s.precio != null ? Number(s.precio) : null,
        costo: s.precioCosto != null ? Number(s.precioCosto) : null,
        oferta: s.precioOferta != null ? Number(s.precioOferta) : null,
        liquidacion:
          s.precioLiquidacion != null ? Number(s.precioLiquidacion) : null,
        enOferta: s.enOferta ? 'Sí' : '',
        enLiquidacion: s.enLiquidacion ? 'Sí' : '',
      });
    }

    // Format moneda para columnas de precios
    for (const col of [6, 7, 8, 9]) {
      sheet.getColumn(col).numFmt = '#,##0.00';
    }

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=verificacion_precios_${new Date().toISOString().slice(0, 10)}.xlsx`,
    });
    await wb.xlsx.write(res);
    res.end();
  }
}
