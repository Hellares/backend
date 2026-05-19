import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { Prisma } from '@prisma/client';
import {
  CrearComponenteDto,
  ActualizarComponenteDto,
  FabricarDto,
} from './dto';

/**
 * Módulo Producto Compuesto / BOM (Bill of Materials).
 *
 * Fase A (calculadora de costo): listar/calcular/CRUD componentes.
 * Fase B (fabricar): descontar insumos + sumar producto final + kardex.
 */
@Injectable()
export class ProductoComponenteService {
  private readonly logger = new Logger(ProductoComponenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Lista los componentes de un producto final, incluyendo nombre,
   * unidad y precioCosto del componente en la sede indicada (para que
   * el frontend pueda mostrar costo unitario y subtotal sin queries extras).
   */
  async listar(empresaId: string, productoId: string, sedeId?: string) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const componentes = await this.prisma.productoComponente.findMany({
      where: { productoId },
      orderBy: { creadoEn: 'asc' },
      include: {
        componente: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            unidadMedida: {
              select: {
                id: true,
                nombrePersonalizado: true,
                simboloPersonalizado: true,
                nombreLocal: true,
                simboloLocal: true,
                unidadMaestra: { select: { nombre: true, simbolo: true } },
              },
            },
          },
        },
      },
    });

    // Si no se pasó sede, intento detectar la única sede del producto
    // final para hidratar costos sin pedirle al usuario una sede explícita.
    const sedeResuelta = sedeId ?? (await this._sedeUnicaDelProducto(productoId));

    const stocksMap = sedeResuelta
      ? await this._costosPorComponente(
          componentes.map((c) => c.componenteId),
          sedeResuelta,
        )
      : new Map<string, number | null>();

    return componentes.map((c) => {
      const cantidad = Number(c.cantidad);
      const costoUnit = stocksMap.get(c.componenteId) ?? null;
      const subtotal =
        costoUnit != null ? +(cantidad * costoUnit).toFixed(4) : null;
      const um = c.componente.unidadMedida;
      // Resolución del símbolo/nombre: local override > personalizado > maestra.
      const simbolo =
        um?.simboloLocal ??
        um?.simboloPersonalizado ??
        um?.unidadMaestra?.simbolo ??
        null;
      const nombreUM =
        um?.nombreLocal ??
        um?.nombrePersonalizado ??
        um?.unidadMaestra?.nombre ??
        null;
      return {
        id: c.id,
        productoId: c.productoId,
        componenteId: c.componenteId,
        cantidad,
        notas: c.notas,
        componente: {
          id: c.componente.id,
          nombre: c.componente.nombre,
          codigoEmpresa: c.componente.codigoEmpresa,
          unidadMedida: simbolo,
          unidadMedidaNombre: nombreUM,
        },
        precioCostoUnitario: costoUnit,
        subtotal,
        sedeUsada: sedeResuelta ?? null,
      };
    });
  }

  /**
   * Calcula el costo sugerido del producto final sumando
   * (cantidad × precioCosto) de cada componente en la sede indicada.
   * Si algún componente no tiene precioCosto en esa sede, lo reporta
   * en `componentesSinCosto` y NO lo cuenta — el total sería parcial.
   */
  async calcularCosto(empresaId: string, productoId: string, sedeId: string) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const componentes = await this.prisma.productoComponente.findMany({
      where: { productoId },
      include: { componente: { select: { id: true, nombre: true } } },
    });

    if (componentes.length === 0) {
      return {
        costoTotal: 0,
        cantidadComponentes: 0,
        componentesSinCosto: [],
        sedeId,
      };
    }

    const costosMap = await this._costosPorComponente(
      componentes.map((c) => c.componenteId),
      sedeId,
    );

    let total = 0;
    const sinCosto: { id: string; nombre: string }[] = [];

    for (const c of componentes) {
      const costo = costosMap.get(c.componenteId);
      if (costo == null) {
        sinCosto.push({ id: c.componente.id, nombre: c.componente.nombre });
        continue;
      }
      total += Number(c.cantidad) * costo;
    }

    return {
      costoTotal: +total.toFixed(4),
      cantidadComponentes: componentes.length,
      componentesSinCosto: sinCosto,
      sedeId,
    };
  }

  async crear(
    empresaId: string,
    productoId: string,
    dto: CrearComponenteDto,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    // Validaciones de integridad
    if (dto.componenteId === productoId) {
      throw new BadRequestException(
        'Un producto no puede ser componente de sí mismo',
      );
    }
    await this._assertProductoPerteneceAEmpresa(empresaId, dto.componenteId);

    // Detectar ciclo directo (el componente ya usa al producto como insumo)
    const ciclo = await this.prisma.productoComponente.findFirst({
      where: { productoId: dto.componenteId, componenteId: productoId },
      select: { id: true },
    });
    if (ciclo) {
      throw new BadRequestException(
        'Ciclo detectado: el componente seleccionado ya usa este producto como insumo',
      );
    }

    try {
      const nuevo = await this.prisma.productoComponente.create({
        data: {
          productoId,
          componenteId: dto.componenteId,
          cantidad: new Prisma.Decimal(dto.cantidad),
          notas: dto.notas,
        },
      });
      return nuevo;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ese componente ya está en la receta de este producto',
        );
      }
      throw e;
    }
  }

  async actualizar(
    empresaId: string,
    productoId: string,
    componenteRowId: string,
    dto: ActualizarComponenteDto,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const existente = await this.prisma.productoComponente.findUnique({
      where: { id: componenteRowId },
    });
    if (!existente || existente.productoId !== productoId) {
      throw new NotFoundException('Componente no encontrado en este producto');
    }

    return this.prisma.productoComponente.update({
      where: { id: componenteRowId },
      data: {
        cantidad:
          dto.cantidad != null ? new Prisma.Decimal(dto.cantidad) : undefined,
        notas: dto.notas,
      },
    });
  }

  async eliminar(
    empresaId: string,
    productoId: string,
    componenteRowId: string,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const existente = await this.prisma.productoComponente.findUnique({
      where: { id: componenteRowId },
    });
    if (!existente || existente.productoId !== productoId) {
      throw new NotFoundException('Componente no encontrado en este producto');
    }

    await this.prisma.productoComponente.delete({
      where: { id: componenteRowId },
    });
    return { id: componenteRowId };
  }

  /**
   * Fabrica `cantidad` unidades del producto final desde sus componentes.
   * Descuenta stock de cada insumo (cantidad_componente × N) y suma
   * `cantidad` al stock del producto final. Genera 1+N movimientos de
   * kardex con el mismo `numeroDocumento` para reconstruir el lote.
   *
   * Reglas:
   * - El producto NO debe ser insumo (no se fabrican insumos).
   * - El producto debe tener al menos un componente en su receta.
   * - `cantidad_componente × N` debe ser entero para cada componente
   *   (stockActual es Int). Si no, 400 con detalle de los conflictivos.
   * - Stock de cada componente debe ser suficiente en la sede dada.
   * - Si el producto final no tiene stock en esta sede, se crea.
   */
  async fabricar(
    empresaId: string,
    productoId: string,
    dto: FabricarDto,
    usuarioId: string,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const producto = await this.prisma.producto.findUnique({
      where: { id: productoId },
      select: { id: true, nombre: true, esInsumo: true, empresaId: true },
    });
    if (!producto) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (producto.esInsumo) {
      throw new BadRequestException(
        'Este producto está marcado como insumo y no se puede fabricar',
      );
    }

    const componentes = await this.prisma.productoComponente.findMany({
      where: { productoId },
      include: {
        componente: { select: { id: true, nombre: true } },
      },
    });
    if (componentes.length === 0) {
      throw new BadRequestException(
        'El producto no tiene receta. Agrega componentes antes de fabricar.',
      );
    }

    // Validar enteros: cantidad_componente × N para cada uno.
    const consumos = componentes.map((c) => {
      const cantidadConsumida = Number(c.cantidad) * dto.cantidad;
      // Tolerancia mínima para evitar falsos positivos por float (0.1+0.2)
      const redondeado = Math.round(cantidadConsumida);
      const esEntero = Math.abs(cantidadConsumida - redondeado) < 1e-6;
      return {
        componenteRowId: c.id,
        componenteId: c.componenteId,
        nombreComponente: c.componente.nombre,
        cantidadPorUnidad: Number(c.cantidad),
        cantidadConsumida,
        cantidadConsumidaEntera: redondeado,
        esEntero,
      };
    });
    const fraccionarios = consumos.filter((c) => !c.esEntero);
    if (fraccionarios.length > 0) {
      throw new BadRequestException({
        code: 'FABRICACION_CANTIDAD_FRACCIONARIA',
        message: `No se puede fabricar ${dto.cantidad} unidad(es): algunos componentes requieren cantidad fraccionaria que no se puede descontar del inventario (el stock se maneja en unidades enteras). Cambia la unidad de medida de esos componentes a una más pequeña (ej: KG → GR) o ajusta el lote.`,
        cantidad: dto.cantidad,
        componentesConflictivos: fraccionarios.map((f) => ({
          componenteId: f.componenteId,
          nombre: f.nombreComponente,
          cantidadPorUnidad: f.cantidadPorUnidad,
          cantidadConsumida: f.cantidadConsumida,
        })),
      });
    }

    const numeroDocumento = `PROD-${Date.now()}-${Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, '0')}`;
    const motivoSalida = `Insumo para producción de ${producto.nombre}`;
    const motivoEntrada = `Fabricación: ${producto.nombre} × ${dto.cantidad}`;

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock + cargar stocks de TODOS los componentes en esta sede
      const componenteIds = consumos.map((c) => c.componenteId);
      const stocksComponentes = await tx.$queryRaw<
        Array<{
          id: string;
          productoId: string;
          stockActual: number;
        }>
      >`SELECT id, "productoId", "stockActual"
        FROM "ProductoStock"
        WHERE "sedeId" = ${dto.sedeId}
          AND "varianteId" IS NULL
          AND "productoId" = ANY(${componenteIds}::text[])
        FOR UPDATE`;

      const stockPorComponenteId = new Map<
        string,
        { id: string; stockActual: number }
      >();
      for (const s of stocksComponentes) {
        if (s.productoId) {
          stockPorComponenteId.set(s.productoId, {
            id: s.id,
            stockActual: s.stockActual,
          });
        }
      }

      // Validar disponibilidad de cada componente
      const sinStock: {
        nombre: string;
        disponible: number;
        requerido: number;
      }[] = [];
      for (const c of consumos) {
        const stock = stockPorComponenteId.get(c.componenteId);
        const disponible = stock?.stockActual ?? 0;
        if (disponible < c.cantidadConsumidaEntera) {
          sinStock.push({
            nombre: c.nombreComponente,
            disponible,
            requerido: c.cantidadConsumidaEntera,
          });
        }
      }
      if (sinStock.length > 0) {
        throw new BadRequestException({
          code: 'FABRICACION_STOCK_INSUFICIENTE',
          message: `Stock insuficiente para fabricar: ${sinStock
            .map(
              (s) => `${s.nombre} (necesita ${s.requerido}, hay ${s.disponible})`,
            )
            .join('; ')}`,
          faltantes: sinStock,
        });
      }

      // Descontar cada componente + crear movimiento PRODUCCION_SALIDA
      const movimientosSalida: {
        componenteId: string;
        nombre: string;
        cantidadConsumida: number;
        stockResultante: number;
      }[] = [];
      for (const c of consumos) {
        const stock = stockPorComponenteId.get(c.componenteId)!;
        const stockAnterior = stock.stockActual;
        const stockNuevo = stockAnterior - c.cantidadConsumidaEntera;
        await tx.productoStock.update({
          where: { id: stock.id },
          data: { stockActual: stockNuevo },
        });
        await tx.movimientoStock.create({
          data: {
            sedeId: dto.sedeId,
            empresaId,
            productoStockId: stock.id,
            tipo: 'PRODUCCION_SALIDA',
            tipoDocumento: 'PRODUCCION',
            numeroDocumento,
            cantidadAnterior: stockAnterior,
            cantidad: -c.cantidadConsumidaEntera,
            cantidadNueva: stockNuevo,
            motivo: motivoSalida,
            observaciones: dto.observaciones,
            usuarioId,
          },
        });
        movimientosSalida.push({
          componenteId: c.componenteId,
          nombre: c.nombreComponente,
          cantidadConsumida: c.cantidadConsumidaEntera,
          stockResultante: stockNuevo,
        });
      }

      // Sumar al producto final (crear stock si no existe en esta sede).
      // findFirst en vez de findUnique: Prisma rechaza null en campos
      // opcionales dentro de compound unique. Mismo patrón que usa
      // _costosPorComponente más abajo.
      let stockFinal = await tx.productoStock.findFirst({
        where: {
          sedeId: dto.sedeId,
          productoId,
          varianteId: null,
        },
        select: { id: true, stockActual: true },
      });
      const stockFinalAnterior = stockFinal?.stockActual ?? 0;
      const stockFinalNuevo = stockFinalAnterior + dto.cantidad;

      if (stockFinal) {
        await tx.productoStock.update({
          where: { id: stockFinal.id },
          data: { stockActual: stockFinalNuevo },
        });
      } else {
        stockFinal = await tx.productoStock.create({
          data: {
            sedeId: dto.sedeId,
            productoId,
            empresaId,
            stockActual: stockFinalNuevo,
          },
          select: { id: true, stockActual: true },
        });
      }

      await tx.movimientoStock.create({
        data: {
          sedeId: dto.sedeId,
          empresaId,
          productoStockId: stockFinal.id,
          tipo: 'PRODUCCION_ENTRADA',
          tipoDocumento: 'PRODUCCION',
          numeroDocumento,
          cantidadAnterior: stockFinalAnterior,
          cantidad: dto.cantidad,
          cantidadNueva: stockFinalNuevo,
          motivo: motivoEntrada,
          observaciones: dto.observaciones,
          usuarioId,
        },
      });

      return {
        numeroDocumento,
        productoId,
        productoNombre: producto.nombre,
        sedeId: dto.sedeId,
        cantidadProducida: dto.cantidad,
        stockFinalAnterior,
        stockFinalNuevo,
        componentesConsumidos: movimientosSalida,
      };
    });

    this.logger.log(
      `Fabricación ${numeroDocumento}: ${producto.nombre} × ${dto.cantidad} en sede ${dto.sedeId} (usuario ${usuarioId})`,
    );

    try {
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`No se pudo invalidar cache tras fabricar: ${msg}`);
    }

    return result;
  }

  // ─── helpers privados ─────────────────────────────────────────

  private async _assertProductoPerteneceAEmpresa(
    empresaId: string,
    productoId: string,
  ) {
    const p = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
      select: { id: true },
    });
    if (!p) {
      throw new NotFoundException('Producto no encontrado en esta empresa');
    }
  }

  /**
   * Devuelve `Map<componenteId, precioCosto>` para una sede dada.
   * Si un componente no tiene stock registrado en esa sede, lo omite
   * (el caller decide qué hacer con el faltante).
   */
  private async _costosPorComponente(
    componenteIds: string[],
    sedeId: string,
  ): Promise<Map<string, number>> {
    if (componenteIds.length === 0) return new Map();
    const stocks = await this.prisma.productoStock.findMany({
      where: {
        sedeId,
        productoId: { in: componenteIds },
        varianteId: null,
      },
      select: { productoId: true, precioCosto: true },
    });
    const map = new Map<string, number>();
    for (const s of stocks) {
      if (s.productoId && s.precioCosto != null) {
        map.set(s.productoId, Number(s.precioCosto));
      }
    }
    return map;
  }

  /**
   * Si el producto solo está activo en 1 sede, devuelve esa sede.
   * Usado para que el frontend no tenga que pedir sedeId explícito
   * cuando solo hay una opción posible.
   */
  private async _sedeUnicaDelProducto(
    productoId: string,
  ): Promise<string | null> {
    const sedes = await this.prisma.productoStock.findMany({
      where: { productoId, varianteId: null },
      select: { sedeId: true },
      distinct: ['sedeId'],
      take: 2,
    });
    if (sedes.length === 1) return sedes[0].sedeId;
    return null;
  }
}
