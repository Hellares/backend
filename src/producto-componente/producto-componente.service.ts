import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';
import { Prisma } from '@prisma/client';
import {
  CrearComponenteDto,
  ActualizarComponenteDto,
  FabricarDto,
  CopiarRecetaDto,
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
  async listar(
    empresaId: string,
    productoId: string,
    sedeId?: string,
    varianteId?: string,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);
    if (varianteId) {
      await this._assertVariantePerteneceAProducto(productoId, varianteId);
    }

    const componentes = await this.prisma.productoComponente.findMany({
      where: { productoId, varianteId: varianteId ?? null },
      orderBy: { creadoEn: 'asc' },
      include: {
        componente: {
          select: {
            id: true,
            nombre: true,
            codigoEmpresa: true,
            factorCompra: true,
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
            unidadCompra: {
              select: {
                simboloPersonalizado: true,
                simboloLocal: true,
                unidadMaestra: { select: { simbolo: true } },
              },
            },
          },
        },
      },
    });

    // Si no se pasó sede, intento detectar la única sede del producto
    // final para hidratar costos sin pedirle al usuario una sede explícita.
    const sedeResuelta = sedeId ?? (await this._sedeUnicaDelProducto(productoId));

    const componenteIds = componentes.map((c) => c.componenteId);
    const [costosMap, stocksMap] = sedeResuelta
      ? await Promise.all([
          this._costosPorComponente(componenteIds, sedeResuelta),
          this._stocksPorComponente(componenteIds, sedeResuelta),
        ])
      : [
          new Map<string, number>(),
          new Map<string, number>(),
        ];

    return componentes.map((c) => {
      const cantidad = Number(c.cantidad);
      const costoUnit = costosMap.get(c.componenteId) ?? null;
      const subtotal =
        costoUnit != null ? +(cantidad * costoUnit).toFixed(4) : null;
      const stockActual = stocksMap.get(c.componenteId) ?? null;
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
      // Unidad de compra (para mostrar conversión en el preview de fabricar:
      // "200 cm (2 m)"). factorCompra = unidades atómicas por 1 de compra.
      const uc = c.componente.unidadCompra;
      const simboloCompra =
        uc?.simboloLocal ??
        uc?.simboloPersonalizado ??
        uc?.unidadMaestra?.simbolo ??
        null;
      const factorCompra =
        c.componente.factorCompra != null
          ? Number(c.componente.factorCompra)
          : null;
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
          factorCompra,
          unidadCompraSimbolo: simboloCompra,
        },
        precioCostoUnitario: costoUnit,
        subtotal,
        stockDisponible: stockActual,
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
  async calcularCosto(
    empresaId: string,
    productoId: string,
    sedeId: string,
    varianteId?: string,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);
    if (varianteId) {
      await this._assertVariantePerteneceAProducto(productoId, varianteId);
    }

    const componentes = await this.prisma.productoComponente.findMany({
      where: { productoId, varianteId: varianteId ?? null },
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
    if (dto.varianteId) {
      await this._assertVariantePerteneceAProducto(productoId, dto.varianteId);
    }

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

    // Pre-check de duplicado a nivel app. La unique de Postgres NO protege
    // el caso varianteId null (dos NULL no chocan), así que lo validamos acá
    // para ambos casos (base y variante).
    const dup = await this.prisma.productoComponente.findFirst({
      where: {
        productoId,
        varianteId: dto.varianteId ?? null,
        componenteId: dto.componenteId,
      },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException(
        'Ese componente ya está en la receta de este producto',
      );
    }

    try {
      const nuevo = await this.prisma.productoComponente.create({
        data: {
          productoId,
          varianteId: dto.varianteId ?? null,
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
   * Copia la receta base del producto (varianteId null) a una variante como
   * plantilla inicial. Útil al convertir un producto fabricado a variantes:
   * cada talla parte de la receta base y luego se ajustan cantidades.
   * Si la variante ya tiene receta, falla salvo que `sobrescribir=true`.
   */
  async copiarRecetaAVariante(
    empresaId: string,
    productoId: string,
    dto: CopiarRecetaDto,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);
    await this._assertVariantePerteneceAProducto(productoId, dto.varianteId);

    const base = await this.prisma.productoComponente.findMany({
      where: { productoId, varianteId: null },
      orderBy: { creadoEn: 'asc' },
    });
    if (base.length === 0) {
      throw new BadRequestException(
        'El producto no tiene receta base (sin variante) para copiar.',
      );
    }

    const existentes = await this.prisma.productoComponente.findMany({
      where: { productoId, varianteId: dto.varianteId },
      select: { id: true },
    });
    if (existentes.length > 0 && !dto.sobrescribir) {
      throw new ConflictException(
        'La variante ya tiene receta. Usa sobrescribir=true para reemplazarla.',
      );
    }

    const copiados = await this.prisma.$transaction(async (tx) => {
      if (existentes.length > 0) {
        await tx.productoComponente.deleteMany({
          where: { productoId, varianteId: dto.varianteId },
        });
      }
      await tx.productoComponente.createMany({
        data: base.map((b) => ({
          productoId,
          varianteId: dto.varianteId,
          componenteId: b.componenteId,
          cantidad: b.cantidad,
          notas: b.notas,
        })),
      });
      return base.length;
    });

    return { varianteId: dto.varianteId, copiados };
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

    // Coherencia variante ↔ producto. Si el producto tiene variantes hay que
    // fabricar UNA variante específica (cada talla tiene su receta y su stock).
    const varianteId = dto.varianteId ?? null;
    const numVariantes = await this.prisma.productoVariante.count({
      where: { productoId, deletedAt: null },
    });
    if (numVariantes > 0 && !varianteId) {
      throw new BadRequestException(
        'Este producto tiene variantes: indica qué variante fabricar (varianteId).',
      );
    }
    if (numVariantes === 0 && varianteId) {
      throw new BadRequestException(
        'Este producto no tiene variantes; no envíes varianteId.',
      );
    }
    if (varianteId) {
      await this._assertVariantePerteneceAProducto(productoId, varianteId);
    }

    const componentes = await this.prisma.productoComponente.findMany({
      where: { productoId, varianteId },
      include: {
        componente: { select: { id: true, nombre: true } },
      },
    });
    if (componentes.length === 0) {
      throw new BadRequestException(
        varianteId
          ? 'Esta variante no tiene receta. Agrega componentes (o copia la receta base) antes de fabricar.'
          : 'El producto no tiene receta. Agrega componentes antes de fabricar.',
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
    const motivoSalida = dto.soloConsumirInsumos
      ? `Consumo de insumos por producción previa de ${producto.nombre}`
      : `Insumo para producción de ${producto.nombre}`;
    const motivoEntrada = `Fabricación: ${producto.nombre} × ${dto.cantidad}`;

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock + cargar stocks (con precioCosto) de TODOS los componentes
      // en esta sede. El precioCosto lo necesitamos para el promedio
      // ponderado del costo del producto final.
      const componenteIds = consumos.map((c) => c.componenteId);
      const stocksComponentes = await tx.$queryRaw<
        Array<{
          id: string;
          productoId: string;
          stockActual: number;
          precioCosto: string | null;
        }>
      >`SELECT id, "productoId", "stockActual", "precioCosto"
        FROM "ProductoStock"
        WHERE "sedeId" = ${dto.sedeId}
          AND "varianteId" IS NULL
          AND "productoId" = ANY(${componenteIds}::text[])
        FOR UPDATE`;

      const stockPorComponenteId = new Map<
        string,
        { id: string; stockActual: number; precioCosto: number | null }
      >();
      for (const s of stocksComponentes) {
        if (s.productoId) {
          stockPorComponenteId.set(s.productoId, {
            id: s.id,
            stockActual: s.stockActual,
            precioCosto: s.precioCosto != null ? Number(s.precioCosto) : null,
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
        await crearMovimientoStockConValoracion(tx, {
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
        });
        movimientosSalida.push({
          componenteId: c.componenteId,
          nombre: c.nombreComponente,
          cantidadConsumida: c.cantidadConsumidaEntera,
          stockResultante: stockNuevo,
        });
      }

      // Lado del producto final. En modo "solo consumir insumos" (registrar
      // producción previa cuyo stock terminado YA existe) NO se suma stock ni
      // se recalcula costo: únicamente se descuentan los insumos.
      let stockFinalAnterior = 0;
      let stockFinalNuevo = 0;
      let precioCostoAnterior: number | null = null;
      let precioCostoNuevo: number | null = null;
      let costoActualizado = false;
      let razonCostoNoActualizado: string | null = null;
      // Costeo del lote: insumos + mano de obra (overhead futuro aquí).
      const costoManoObra = dto.costoManoObra ?? 0;
      let costoInsumos = 0;
      let costoLoteTotal = 0;

      if (!dto.soloConsumirInsumos) {
        // Sumar al producto final (crear stock si no existe en esta sede).
        // XOR en ProductoStock: un stock es de producto base (productoId set,
        // varianteId null) O de variante (varianteId set, productoId null),
        // nunca ambos. Buscamos/creamos según corresponda.
        let stockFinal = await tx.productoStock.findFirst({
          where: varianteId
            ? { sedeId: dto.sedeId, varianteId }
            : { sedeId: dto.sedeId, productoId, varianteId: null },
          select: { id: true, stockActual: true, precioCosto: true },
        });
        stockFinalAnterior = stockFinal?.stockActual ?? 0;
        stockFinalNuevo = stockFinalAnterior + dto.cantidad;
        precioCostoAnterior =
          stockFinal?.precioCosto != null
            ? Number(stockFinal.precioCosto)
            : null;

        // Costo del lote = Σ(cantidadConsumida × precioCosto). Si algún insumo
        // no tiene precioCosto en la sede, no actualizamos el costo del final
        // (sería parcial). Se reporta el motivo en el response.
        const insumosSinCosto: string[] = [];
        for (const c of consumos) {
          const stock = stockPorComponenteId.get(c.componenteId)!;
          if (stock.precioCosto == null) {
            insumosSinCosto.push(c.nombreComponente);
          } else {
            costoInsumos += c.cantidadConsumidaEntera * stock.precioCosto;
          }
        }
        // Costo total del lote = insumos + mano de obra del lote.
        costoLoteTotal = costoInsumos + costoManoObra;

        // Promedio ponderado con el stock previo (si existía).
        if (insumosSinCosto.length > 0) {
          razonCostoNoActualizado = `Insumos sin precio costo: ${insumosSinCosto.join(', ')}`;
        } else {
          const valorPrevio = stockFinalAnterior * (precioCostoAnterior ?? 0);
          const valorTotal = valorPrevio + costoLoteTotal;
          precioCostoNuevo = +(valorTotal / stockFinalNuevo).toFixed(2);
          costoActualizado = true;
        }

        if (stockFinal) {
          await tx.productoStock.update({
            where: { id: stockFinal.id },
            data: {
              stockActual: stockFinalNuevo,
              ...(costoActualizado && precioCostoNuevo != null
                ? { precioCosto: precioCostoNuevo }
                : {}),
            },
          });
        } else {
          stockFinal = await tx.productoStock.create({
            data: {
              sedeId: dto.sedeId,
              // XOR: si es variante, productoId va null (y viceversa).
              productoId: varianteId ? null : productoId,
              varianteId,
              empresaId,
              stockActual: stockFinalNuevo,
              ...(costoActualizado && precioCostoNuevo != null
                ? { precioCosto: precioCostoNuevo }
                : {}),
            },
            select: { id: true, stockActual: true, precioCosto: true },
          });
        }

        // Trazabilidad del cambio de costo en el historial de precios.
        if (
          costoActualizado &&
          precioCostoNuevo != null &&
          precioCostoNuevo !== precioCostoAnterior
        ) {
          await tx.productoPrecioHistorialSede.create({
            data: {
              productoStockId: stockFinal.id,
              sedeId: dto.sedeId,
              tipoCambio: 'COSTO',
              precioCostoAnterior:
                precioCostoAnterior != null
                  ? new Prisma.Decimal(precioCostoAnterior)
                  : null,
              precioCostoNuevo: new Prisma.Decimal(precioCostoNuevo),
              razon: `Fabricación ${numeroDocumento}: promedio ponderado con ${stockFinalAnterior} unidad(es) previa(s)`,
              origenModulo: 'PRODUCCION',
              usuarioId,
            },
          });
        }

        await crearMovimientoStockConValoracion(tx, {
          sedeId: dto.sedeId,
          empresaId,
          productoStockId: stockFinal.id,
          tipo: 'PRODUCCION_ENTRADA',
          tipoDocumento: 'PRODUCCION',
          numeroDocumento,
          cantidadAnterior: stockFinalAnterior,
          cantidad: dto.cantidad,
          cantidadNueva: stockFinalNuevo,
          // Valor de la entrada = costo REAL del lote (insumos + mano de obra),
          // NO el ponderado. Así el historial puede leer el costo del lote
          // desde el kardex y derivar la mano de obra (= total − insumos).
          precioCostoUnitario: costoActualizado
            ? +(costoLoteTotal / dto.cantidad).toFixed(4)
            : undefined,
          // Mano de obra explícita del lote (marca que es costeo nuevo: los
          // lotes viejos tienen null y NO se les deriva M.O.).
          costoManoObra,
          motivo: motivoEntrada,
          observaciones: dto.observaciones,
          usuarioId,
        });
      }

      return {
        numeroDocumento,
        productoId,
        varianteId,
        productoNombre: producto.nombre,
        sedeId: dto.sedeId,
        soloConsumoInsumos: !!dto.soloConsumirInsumos,
        // En modo solo-consumo no se "produce" stock nuevo; reportamos las
        // unidades cuyo consumo se registró por separado.
        cantidadProducida: dto.soloConsumirInsumos ? 0 : dto.cantidad,
        unidadesRegistradas: dto.cantidad,
        stockFinalAnterior,
        stockFinalNuevo,
        precioCostoAnterior,
        precioCostoNuevo,
        costoActualizado,
        razonCostoNoActualizado,
        // Costeo del lote (cuando se fabricó stock nuevo).
        costoInsumos: +costoInsumos.toFixed(2),
        costoManoObra: +costoManoObra.toFixed(2),
        costoLoteTotal: +costoLoteTotal.toFixed(2),
        costoUnitarioLote: !dto.soloConsumirInsumos && dto.cantidad > 0
            ? +(costoLoteTotal / dto.cantidad).toFixed(4)
            : null,
        componentesConsumidos: movimientosSalida,
      };
    });

    this.logger.log(
      `${dto.soloConsumirInsumos ? 'Consumo insumos (prod. previa)' : 'Fabricación'} ${numeroDocumento}: ${producto.nombre} × ${dto.cantidad} en sede ${dto.sedeId} (usuario ${usuarioId})`,
    );

    try {
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`No se pudo invalidar cache tras fabricar: ${msg}`);
    }

    return result;
  }

  /**
   * Historial de lotes de fabricación de un producto: lista los
   * MovimientoStock con tipo=PRODUCCION_ENTRADA agrupados por
   * numeroDocumento (cada lote es 1 fila). Opcionalmente filtrado por
   * sede.
   */
  async historialFabricaciones(
    empresaId: string,
    productoId: string,
    sedeId?: string,
    limit = 50,
    varianteId?: string,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const movimientos = await this.prisma.movimientoStock.findMany({
      where: {
        tipo: 'PRODUCCION_ENTRADA',
        tipoDocumento: 'PRODUCCION',
        // XOR: el stock de una variante tiene productoId NULL y varianteId set.
        // Si filtramos por variante, hay que buscar por varianteId (no por
        // productoId, que es null en ese caso). Para el producto base, sí por
        // productoId con varianteId null.
        productoStock: varianteId
          ? {
              varianteId,
              variante: { productoId },
              ...(sedeId ? { sedeId } : {}),
            }
          : {
              productoId,
              varianteId: null,
              ...(sedeId ? { sedeId } : {}),
            },
      },
      orderBy: { creadoEn: 'desc' },
      take: limit,
      select: {
        id: true,
        numeroDocumento: true,
        cantidad: true,
        cantidadAnterior: true,
        cantidadNueva: true,
        valorMovimiento: true,
        precioCostoUnitario: true,
        costoManoObra: true,
        observaciones: true,
        creadoEn: true,
        usuarioId: true,
        sede: { select: { id: true, nombre: true } },
      },
    });

    // Resolver nombres de usuario en batch. MovimientoStock no tiene
    // relación directa con Usuario en el schema, así que separamos.
    const usuariosUnicos = [
      ...new Set(movimientos.map((m) => m.usuarioId)),
    ];
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: usuariosUnicos } },
      select: {
        id: true,
        email: true,
        persona: {
          select: { nombres: true, apellidos: true },
        },
      },
    });
    const usuarioById = new Map(usuarios.map((u) => [u.id, u]));

    return movimientos.map((m) => {
      const u = usuarioById.get(m.usuarioId);
      const nombreCompleto = u?.persona
        ? `${u.persona.nombres ?? ''} ${u.persona.apellidos ?? ''}`.trim()
        : (u?.email ?? '');
      return {
        id: m.id,
        numeroDocumento: m.numeroDocumento,
        cantidadProducida: m.cantidad,
        stockAnterior: m.cantidadAnterior,
        stockNuevo: m.cantidadNueva,
        // Costo del lote (insumos + M.O.) solo para lotes con costeo nuevo
        // (costoManoObra no null); en lotes viejos el valorMovimiento es el
        // ponderado, no el costo del lote, así que no lo mostramos.
        costoLote: m.costoManoObra != null && m.valorMovimiento != null
            ? Number(m.valorMovimiento)
            : null,
        costoUnitario: m.costoManoObra != null && m.precioCostoUnitario != null
            ? Number(m.precioCostoUnitario)
            : null,
        observaciones: m.observaciones,
        creadoEn: m.creadoEn,
        sede: m.sede,
        usuario: u ? { id: u.id, nombre: nombreCompleto } : null,
      };
    });
  }

  /**
   * Detalle de un lote: todos los insumos consumidos
   * (PRODUCCION_SALIDA con el mismo numeroDocumento).
   */
  async detalleFabricacion(
    empresaId: string,
    productoId: string,
    numeroDocumento: string,
  ) {
    await this._assertProductoPerteneceAEmpresa(empresaId, productoId);

    const movimientos = await this.prisma.movimientoStock.findMany({
      where: {
        numeroDocumento,
        tipoDocumento: 'PRODUCCION',
        productoStock: { empresaId },
      },
      orderBy: { creadoEn: 'asc' },
      select: {
        id: true,
        tipo: true,
        cantidad: true,
        cantidadAnterior: true,
        cantidadNueva: true,
        valorMovimiento: true,
        precioCostoUnitario: true,
        costoManoObra: true,
        observaciones: true,
        creadoEn: true,
        sede: { select: { id: true, nombre: true } },
        productoStock: {
          select: {
            id: true,
            precioCosto: true,
            producto: {
              select: {
                id: true,
                nombre: true,
                codigoEmpresa: true,
                unidadMedida: {
                  select: {
                    simboloLocal: true,
                    simboloPersonalizado: true,
                    unidadMaestra: { select: { simbolo: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (movimientos.length === 0) {
      throw new NotFoundException(
        `No se encontró el lote de fabricación ${numeroDocumento}`,
      );
    }

    const entrada = movimientos.find((m) => m.tipo === 'PRODUCCION_ENTRADA');
    const salidas = movimientos.filter(
      (m) => m.tipo === 'PRODUCCION_SALIDA',
    );

    // Trazabilidad: última compra de cada insumo (proveedor + precio + fecha).
    // El sistema usa costo promedio (no rastrea de qué compra salió cada
    // unidad consumida), así que mostramos la compra más reciente como
    // referencia. Los costos "al momento" y "actual" sí son exactos.
    const insumoIds = [
      ...new Set(
        salidas
          .map((s) => s.productoStock.producto?.id)
          .filter((id): id is string => !!id),
      ),
    ];
    const ultimaCompraPorInsumo = new Map<
      string,
      { proveedor: string | null; precioUnitario: number; fecha: Date }
    >();
    if (insumoIds.length > 0) {
      const detalles = await this.prisma.compraDetalle.findMany({
        where: { productoId: { in: insumoIds }, compra: { empresaId } },
        orderBy: { compra: { creadoEn: 'desc' } },
        select: {
          productoId: true,
          precioUnitario: true,
          compra: {
            select: {
              creadoEn: true,
              fechaRecepcion: true,
              proveedor: { select: { nombre: true } },
            },
          },
        },
      });
      for (const cd of detalles) {
        if (cd.productoId && !ultimaCompraPorInsumo.has(cd.productoId)) {
          ultimaCompraPorInsumo.set(cd.productoId, {
            proveedor: cd.compra.proveedor?.nombre ?? null,
            precioUnitario: Number(cd.precioUnitario),
            fecha: cd.compra.fechaRecepcion ?? cd.compra.creadoEn,
          });
        }
      }
    }

    // Costeo del lote: insumos = Σ valor de las salidas (siempre confiable);
    // mano de obra se LEE de la entrada (null en lotes viejos → no se deriva
    // restando, que daba un valor fantasma). Total = insumos + M.O.
    const costoInsumos = salidas.reduce(
      (acc, s) => acc + (s.valorMovimiento != null ? Number(s.valorMovimiento) : 0),
      0,
    );
    const costoManoObra =
      entrada?.costoManoObra != null ? Number(entrada.costoManoObra) : null;
    // Total del lote: si hay costeo nuevo, insumos + M.O.; si es lote viejo
    // (sin M.O. registrada), el costo de producción real es solo insumos.
    const costoLoteTotal = +(costoInsumos + (costoManoObra ?? 0)).toFixed(2);

    const fmtUm = (p: (typeof movimientos)[number]['productoStock']['producto']) => {
      const um = p?.unidadMedida;
      return (
        um?.simboloLocal ??
        um?.simboloPersonalizado ??
        um?.unidadMaestra?.simbolo ??
        ''
      );
    };

    return {
      numeroDocumento,
      sede: entrada?.sede ?? null,
      creadoEn: entrada?.creadoEn ?? null,
      productoFinal: entrada
        ? {
            id: entrada.productoStock.producto?.id,
            nombre: entrada.productoStock.producto?.nombre,
            cantidadProducida: entrada.cantidad,
            stockAnterior: entrada.cantidadAnterior,
            stockNuevo: entrada.cantidadNueva,
          }
        : null,
      insumosConsumidos: salidas.map((s) => {
        const insumoId = s.productoStock.producto?.id;
        const compra = insumoId
          ? ultimaCompraPorInsumo.get(insumoId)
          : undefined;
        return {
          id: insumoId,
          nombre: s.productoStock.producto?.nombre,
          codigo: s.productoStock.producto?.codigoEmpresa,
          unidadMedida: fmtUm(s.productoStock.producto),
          cantidadConsumida: Math.abs(s.cantidad),
          costo: s.valorMovimiento != null ? Number(s.valorMovimiento) : null,
          // Costo unitario del insumo AL MOMENTO de fabricar (snapshot real).
          costoUnitarioMomento:
            s.precioCostoUnitario != null
              ? Number(s.precioCostoUnitario)
              : null,
          // Costo unitario ACTUAL del insumo en la sede (para comparar).
          costoUnitarioActual:
            s.productoStock.precioCosto != null
              ? Number(s.productoStock.precioCosto)
              : null,
          // Referencia: última compra del insumo (proveedor/precio/fecha).
          ultimaCompra: compra
            ? {
                proveedor: compra.proveedor,
                precioUnitario: compra.precioUnitario,
                fecha: compra.fecha,
              }
            : null,
          stockAnterior: s.cantidadAnterior,
          stockNuevo: s.cantidadNueva,
        };
      }),
      // Costeo del lote (mano de obra derivada = total − insumos).
      costoInsumos: +costoInsumos.toFixed(2),
      costoManoObra,
      costoLoteTotal,
      observaciones: entrada?.observaciones ?? null,
    };
  }

  /**
   * Lista GLOBAL de lotes fabricados (PRODUCCION_ENTRADA) de la empresa, para
   * la página "Producción". Filtrable por sede, búsqueda de producto y rango
   * de fechas. Devuelve { items, total } para paginación.
   */
  async listarLotesProduccion(
    empresaId: string,
    opts: {
      sedeId?: string;
      search?: string;
      desde?: Date;
      hasta?: Date;
      limit?: number;
      offset?: number;
    },
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const q = opts.search?.trim();

    const searchFilter = q
      ? {
          OR: [
            {
              producto: {
                nombre: { contains: q, mode: Prisma.QueryMode.insensitive },
              },
            },
            {
              variante: {
                nombre: { contains: q, mode: Prisma.QueryMode.insensitive },
              },
            },
            {
              variante: {
                producto: {
                  nombre: { contains: q, mode: Prisma.QueryMode.insensitive },
                },
              },
            },
          ],
        }
      : {};

    const where: Prisma.MovimientoStockWhereInput = {
      tipo: 'PRODUCCION_ENTRADA',
      tipoDocumento: 'PRODUCCION',
      ...(opts.desde || opts.hasta
        ? {
            creadoEn: {
              ...(opts.desde ? { gte: opts.desde } : {}),
              ...(opts.hasta ? { lte: opts.hasta } : {}),
            },
          }
        : {}),
      productoStock: {
        empresaId,
        ...(opts.sedeId ? { sedeId: opts.sedeId } : {}),
        ...searchFilter,
      },
    };

    const [total, movimientos] = await this.prisma.$transaction([
      this.prisma.movimientoStock.count({ where }),
      this.prisma.movimientoStock.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          numeroDocumento: true,
          cantidad: true,
          cantidadNueva: true,
          valorMovimiento: true,
          precioCostoUnitario: true,
          costoManoObra: true,
          creadoEn: true,
          usuarioId: true,
          sede: { select: { id: true, nombre: true } },
          productoStock: {
            select: {
              producto: {
                select: { id: true, nombre: true, codigoEmpresa: true },
              },
              variante: {
                select: {
                  id: true,
                  nombre: true,
                  producto: {
                    select: { id: true, nombre: true, codigoEmpresa: true },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    const usuariosUnicos = [...new Set(movimientos.map((m) => m.usuarioId))];
    const usuarios = await this.prisma.usuario.findMany({
      where: { id: { in: usuariosUnicos } },
      select: {
        id: true,
        email: true,
        persona: { select: { nombres: true, apellidos: true } },
      },
    });
    const usuarioById = new Map(usuarios.map((u) => [u.id, u]));

    const items = movimientos.map((m) => {
      const ps = m.productoStock;
      const prod = ps.producto ?? ps.variante?.producto ?? null;
      const u = usuarioById.get(m.usuarioId);
      const nombreCompleto = u?.persona
        ? `${u.persona.nombres ?? ''} ${u.persona.apellidos ?? ''}`.trim()
        : (u?.email ?? '');
      return {
        id: m.id,
        numeroDocumento: m.numeroDocumento,
        productoId: prod?.id ?? null,
        productoNombre: prod?.nombre ?? '—',
        codigoEmpresa: prod?.codigoEmpresa ?? null,
        varianteId: ps.variante?.id ?? null,
        varianteNombre: ps.variante?.nombre ?? null,
        cantidadProducida: m.cantidad,
        stockNuevo: m.cantidadNueva,
        // Costo del lote solo para costeo nuevo (costoManoObra no null).
        costoLote: m.costoManoObra != null && m.valorMovimiento != null
            ? Number(m.valorMovimiento)
            : null,
        costoUnitario: m.costoManoObra != null && m.precioCostoUnitario != null
            ? Number(m.precioCostoUnitario)
            : null,
        creadoEn: m.creadoEn,
        sede: m.sede,
        usuario: u ? { id: u.id, nombre: nombreCompleto } : null,
      };
    });

    return { items, total, limit, offset };
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
   * Valida que la variante exista y pertenezca al producto final indicado
   * (y no esté soft-deleteada). Usado por todos los endpoints que aceptan
   * varianteId para recetas/fabricación por variante.
   */
  private async _assertVariantePerteneceAProducto(
    productoId: string,
    varianteId: string,
  ) {
    const v = await this.prisma.productoVariante.findFirst({
      where: { id: varianteId, productoId, deletedAt: null },
      select: { id: true },
    });
    if (!v) {
      throw new NotFoundException('Variante no encontrada en este producto');
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
   * Devuelve `Map<componenteId, stockActual>` para una sede dada.
   * Usado por el GET /componentes para que el frontend pueda mostrar
   * disponibilidad por insumo y validar fabricación en cliente.
   */
  private async _stocksPorComponente(
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
      select: { productoId: true, stockActual: true },
    });
    const map = new Map<string, number>();
    for (const s of stocks) {
      if (s.productoId) {
        map.set(s.productoId, s.stockActual);
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
