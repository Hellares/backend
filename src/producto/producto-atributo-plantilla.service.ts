import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CacheService } from '../redis/cache.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { CreateProductoAtributoPlantillaDto } from './dto/create-producto-atributo-plantilla.dto';
import { UpdateProductoAtributoPlantillaDto } from './dto/update-producto-atributo-plantilla.dto';
import { ProductoAtributoPlantillaResponseDto } from './dto/producto-atributo-plantilla-response.dto';

@Injectable()
export class ProductoAtributoPlantillaService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private planLimitsService: PlanLimitsService,
    loggerService: AppLoggerService,
    private readonly cacheService: CacheService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoAtributoPlantillaService.name);
  }

  /**
   * Include clause reutilizable para plantillas con atributos optimizados
   */
  private get plantillaInclude() {
    return {
      atributos: {
        include: {
          atributo: {
            select: {
              id: true,
              nombre: true,
              clave: true,
              tipo: true,
              requerido: true,
              descripcion: true,
              unidad: true,
              valores: true,
              isActive: true,
              // Sin esto, un atributo dependiente dentro de una plantilla no
              // sabe de qué cuelga cada opción y el formulario termina
              // ofreciendo la lista plana: los procesadores de todas las
              // marcas mezclados.
              dependeDeAtributoId: true,
              opciones: {
                orderBy: { orden: 'asc' as const },
                select: {
                  id: true,
                  valor: true,
                  orden: true,
                  padre: { select: { valor: true } },
                },
              },
            },
          },
        },
        orderBy: { orden: 'asc' as const },
      },
      categoria: {
        select: {
          id: true,
          nombreLocal: true,
          nombrePersonalizado: true,
        },
      },
    };
  }

  /**
   * Crear una nueva plantilla de atributos
   */
  async create(
    empresaId: string,
    createDto: CreateProductoAtributoPlantillaDto,
  ): Promise<ProductoAtributoPlantillaResponseDto> {
    // Validar límite del plan (solo para plantillas personalizadas)
    await this.planLimitsService.checkPlantillasAtributosLimit(empresaId);

    await this.liberarNombre(empresaId, createDto.nombre);

    // Verificar que todos los atributos existan y pertenezcan a la empresa
    const atributoIds = createDto.atributos.map((a) => a.atributoId);
    const atributosExistentes = await this.prisma.productoAtributo.findMany({
      where: {
        id: { in: atributoIds },
        empresaId,
        isActive: true,
      },
    });

    if (atributosExistentes.length !== atributoIds.length) {
      throw new BadRequestException(
        'Uno o más atributos no existen o no pertenecen a la empresa',
      );
    }

    // Crear la plantilla con sus atributos
    const plantilla = await this.prisma.productoAtributoPlantilla.create({
      data: {
        empresaId,
        nombre: createDto.nombre,
        descripcion: createDto.descripcion,
        icono: createDto.icono,
        categoriaId: createDto.categoriaId,
        orden: createDto.orden ?? 0,
        esPredefinida: false, // Las creadas por usuarios son personalizadas
        atributos: {
          create: createDto.atributos.map((a, index) => ({
            atributoId: a.atributoId,
            orden: a.orden ?? index,
            requeridoOverride: a.requeridoOverride,
            valoresOverride: a.valoresOverride ?? [],
          })),
        },
      },
      include: this.plantillaInclude,
    });

    this.logger.log(
      `Plantilla "${plantilla.nombre}" creada para empresa ${empresaId}`,
    );

    return this.mapToResponseDto(plantilla);
  }

  /**
   * Obtener todas las plantillas de una empresa
   */
  async findAll(
    empresaId: string,
    categoriaId?: string,
  ): Promise<ProductoAtributoPlantillaResponseDto[]> {
    const plantillas = await this.prisma.productoAtributoPlantilla.findMany({
      where: {
        empresaId,
        isActive: true,
        ...(categoriaId && { categoriaId }),
      },
      include: this.plantillaInclude,
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });

    return plantillas.map((p) => this.mapToResponseDto(p));
  }

  /**
   * Obtener una plantilla por ID
   */
  async findOne(
    id: string,
    empresaId: string,
  ): Promise<ProductoAtributoPlantillaResponseDto> {
    const plantilla = await this.prisma.productoAtributoPlantilla.findFirst({
      where: {
        id,
        empresaId,
        isActive: true,
      },
      include: this.plantillaInclude,
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    return this.mapToResponseDto(plantilla);
  }

  /**
   * Actualizar una plantilla
   */
  async update(
    id: string,
    empresaId: string,
    updateDto: UpdateProductoAtributoPlantillaDto,
  ): Promise<ProductoAtributoPlantillaResponseDto> {
    // Verificar que la plantilla existe
    const plantilla = await this.prisma.productoAtributoPlantilla.findFirst({
      where: { id, empresaId, isActive: true },
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    // No permitir editar plantillas predefinidas del sistema
    if (plantilla.esPredefinida) {
      throw new BadRequestException(
        'No se pueden editar plantillas predefinidas del sistema',
      );
    }

    // Verificar nombre único (si se está cambiando)
    if (updateDto.nombre && updateDto.nombre !== plantilla.nombre) {
      await this.liberarNombre(empresaId, updateDto.nombre);
    }

    // Validar atributos si se proporcionaron
    if (updateDto.atributos) {
      const atributoIds = updateDto.atributos.map((a) => a.atributoId);
      const atributosExistentes = await this.prisma.productoAtributo.findMany({
        where: {
          id: { in: atributoIds },
          empresaId,
          isActive: true,
        },
        select: { id: true },
      });

      if (atributosExistentes.length !== atributoIds.length) {
        throw new BadRequestException(
          'Uno o más atributos no existen o no pertenecen a la empresa',
        );
      }
    }

    // Transacción atómica: delete atributos + create nuevos + update plantilla
    const plantillaActualizada = await this.prisma.$transaction(async (tx) => {
      if (updateDto.atributos) {
        await tx.plantillaAtributo.deleteMany({
          where: { plantillaId: id },
        });

        await tx.plantillaAtributo.createMany({
          data: updateDto.atributos.map((a, index) => ({
            plantillaId: id,
            atributoId: a.atributoId,
            orden: a.orden ?? index,
            requeridoOverride: a.requeridoOverride,
            valoresOverride: a.valoresOverride ?? [],
          })),
        });
      }

      return tx.productoAtributoPlantilla.update({
        where: { id },
        data: {
          nombre: updateDto.nombre,
          descripcion: updateDto.descripcion,
          icono: updateDto.icono,
          categoriaId: updateDto.categoriaId,
          orden: updateDto.orden,
        },
        include: this.plantillaInclude,
      });
    });

    this.logger.log(`Plantilla ${id} actualizada para empresa ${empresaId}`);

    return this.mapToResponseDto(plantillaActualizada);
  }

  /**
   * Eliminar (soft delete) una plantilla.
   *
   * Si hay productos que la usan no se elimina salvo `forzar`: sus atributos
   * perderían la sección y pasarían a "Otras" en la tienda sin que nadie lo
   * decida. Con `forzar` la plantilla se quita de esos productos; los valores
   * de los atributos NO se tocan.
   */
  async remove(id: string, empresaId: string, forzar = false): Promise<void> {
    const plantilla = await this.prisma.productoAtributoPlantilla.findFirst({
      where: { id, empresaId, isActive: true },
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    if (plantilla.esPredefinida) {
      throw new BadRequestException(
        'No se pueden eliminar plantillas predefinidas del sistema',
      );
    }

    const enUso = await this.prisma.producto.count({
      where: { empresaId, deletedAt: null, plantillasAtributosIds: { has: id } },
    });

    if (enUso > 0 && !forzar) {
      throw new BadRequestException(
        `La plantilla "${plantilla.nombre}" está en uso en ${enUso} producto${enUso === 1 ? '' : 's'}. ` +
          'Si la eliminas, sus atributos quedan sin sección en la ficha.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productoAtributoPlantilla.update({
        where: { id },
        data: { isActive: false, nombre: this.nombreDeEliminada(plantilla.nombre) },
      });

      // `timezone('UTC', now())` y no `now()`: el delta-sync del app compara
      // contra UTC y un sello en hora local deja el cambio sin viajar.
      await tx.$executeRaw`
        UPDATE "Producto"
           SET "plantillasAtributosIds" = array_remove("plantillasAtributosIds", ${id}),
               "actualizadoEn" = timezone('UTC', now())
         WHERE "empresaId" = ${empresaId}
           AND ${id} = ANY("plantillasAtributosIds")`;
    });

    if (enUso > 0) {
      try {
        await this.cacheService.invalidateProductosLists(empresaId);
      } catch (e) {
        this.logger.warn(
          `No se pudo invalidar el cache de productos de ${empresaId}: ${e}`,
        );
      }
    }

    this.logger.log(`Plantilla ${id} eliminada para empresa ${empresaId}`);
  }

  /**
   * El nombre es único por empresa y eliminar es un soft delete: sin esto, el
   * nombre de una plantilla eliminada quedaba tomado para siempre y volver a
   * crearla fallaba con "ya existe" aunque no apareciera en ninguna lista.
   */
  private nombreDeEliminada(nombre: string): string {
    return `${nombre} (eliminada ${Date.now().toString(36)})`;
  }

  /**
   * Deja `nombre` disponible: falla si lo tiene una plantilla ACTIVA y, si lo
   * tiene una eliminada (las de antes de renombrar al eliminar), la renombra.
   */
  private async liberarNombre(empresaId: string, nombre: string): Promise<void> {
    const existe = await this.prisma.productoAtributoPlantilla.findUnique({
      where: { empresaId_nombre: { empresaId, nombre } },
      select: { id: true, isActive: true },
    });
    if (!existe) return;

    if (existe.isActive) {
      throw new BadRequestException(
        `Ya existe una plantilla con el nombre "${nombre}"`,
      );
    }

    await this.prisma.productoAtributoPlantilla.update({
      where: { id: existe.id },
      data: { nombre: this.nombreDeEliminada(nombre) },
    });
  }

  /**
   * Aplicar plantilla a un producto o variante
   * Crea los valores de atributos basándose en la plantilla
   */
  async aplicarPlantilla(
    plantillaId: string,
    empresaId: string,
    productoId?: string,
    varianteId?: string,
  ): Promise<{ atributosCreados: number; atributosOmitidos: number }> {
    if (!productoId && !varianteId) {
      throw new BadRequestException(
        'Debe especificar productoId o varianteId',
      );
    }

    if (productoId && varianteId) {
      throw new BadRequestException(
        'No se puede especificar productoId y varianteId al mismo tiempo',
      );
    }

    // Verificar que el producto o variante existe y pertenece a la empresa.
    // `productoPadreId` es el Producto cuyo actualizadoEn hay que bumpear
    // para el delta-sync (el padre, si se aplica a una variante).
    let productoPadreId: string;
    if (productoId) {
      const producto = await this.prisma.producto.findFirst({
        where: { id: productoId, empresaId, deletedAt: null },
        select: { id: true },
      });
      if (!producto) {
        throw new NotFoundException(`Producto ${productoId} no encontrado`);
      }
      productoPadreId = producto.id;
    } else {
      const variante = await this.prisma.productoVariante.findFirst({
        where: { id: varianteId, empresaId, deletedAt: null },
        select: { id: true, productoId: true },
      });
      if (!variante) {
        throw new NotFoundException(`Variante ${varianteId} no encontrada`);
      }
      productoPadreId = variante.productoId;
    }

    // Obtener plantilla con atributos (solo atributos activos)
    const plantilla = await this.prisma.productoAtributoPlantilla.findFirst({
      where: {
        id: plantillaId,
        empresaId,
        isActive: true,
      },
      include: this.plantillaInclude,
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    // Filtrar solo atributos que siguen activos
    const atributosActivos = plantilla.atributos.filter(
      (pa) => pa.atributo.isActive,
    );

    if (atributosActivos.length === 0) {
      throw new BadRequestException(
        'La plantilla no tiene atributos activos para aplicar',
      );
    }

    // Generar valor por defecto según el tipo de atributo
    const getValorPorDefecto = (atributo: any): string => {
      switch (atributo.tipo) {
        case 'SELECT':
        case 'MULTI_SELECT':
        case 'COLOR':
        case 'TALLA':
        case 'MATERIAL':
        case 'CAPACIDAD':
          // Usar el primer valor predefinido si existe
          return atributo.valores?.length > 0 ? atributo.valores[0] : '';
        case 'NUMERO':
          return '0';
        case 'BOOLEAN':
          return 'false';
        case 'TEXTO':
        default:
          return '';
      }
    };

    const atributosValores = atributosActivos.map((pa) => ({
      atributoId: pa.atributoId,
      productoId: productoId || null,
      varianteId: varianteId || null,
      valor: getValorPorDefecto(pa.atributo),
    }));

    // Crear valores de atributos (con conflictos se ignoran) y bumpear
    // el Producto en la MISMA transacción: sin actualizadoEn nuevo, el
    // delta-sync del app no trae los atributos recién aplicados.
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productoAtributoValor.createMany({
        data: atributosValores,
        skipDuplicates: true,
      });
      if (created.count > 0) {
        await tx.producto.update({
          where: { id: productoPadreId },
          data: { actualizadoEn: new Date() },
        });
      }
      return created;
    });

    // El listado vive en Redis 30 min (`findAll` es un `getOrSet`): sin esto
    // la ficha recién aplicada quedaba invisible media hora para cualquiera
    // que haga sync COMPLETO. El bump de `actualizadoEn` solo cubre el
    // delta-sync, que va directo a la base.
    if (result.count > 0) {
      try {
        await this.cacheService.invalidateProductosLists(empresaId);
      } catch (e) {
        // Que falle el cache no puede tumbar una aplicación ya confirmada.
        this.logger.warn(
          `No se pudo invalidar el cache de productos de ${empresaId}: ${e}`,
        );
      }
    }

    const omitidos = atributosActivos.length - result.count;
    this.logger.log(
      `Plantilla "${plantilla.nombre}" aplicada a ${productoId ? 'producto' : 'variante'} ${productoId || varianteId} (${result.count} creados, ${omitidos} ya existían)`,
    );

    return {
      atributosCreados: result.count,
      atributosOmitidos: omitidos,
    };
  }

  /**
   * Mapear entidad a DTO de respuesta
   */
  private mapToResponseDto(plantilla: any): ProductoAtributoPlantillaResponseDto {
    return {
      id: plantilla.id,
      empresaId: plantilla.empresaId,
      categoriaId: plantilla.categoriaId,
      nombre: plantilla.nombre,
      descripcion: plantilla.descripcion,
      icono: plantilla.icono,
      esPredefinida: plantilla.esPredefinida,
      orden: plantilla.orden,
      isActive: plantilla.isActive,
      creadoEn: plantilla.creadoEn,
      actualizadoEn: plantilla.actualizadoEn,
      atributos: plantilla.atributos.map((pa: any) => ({
        id: pa.id,
        atributoId: pa.atributoId,
        orden: pa.orden,
        requeridoOverride: pa.requeridoOverride,
        // 🔴 Un override VACÍO significa "sin restricción, valen todos". Se
        // devuelve como null y no como `[]` porque son cosas distintas: `[]`
        // se lee como "cero valores elegidos".
        //
        // La columna es un `String[]` de Postgres y no admite null, así que la
        // normalización va acá. Sin esto, la pantalla de editar plantilla
        // mostraba "0/3 val." y abría el selector con todo desmarcado en
        // plantillas donde nunca se restringió nada — que son todas, porque el
        // create guarda `valoresOverride ?? []`.
        valoresOverride:
          pa.valoresOverride && pa.valoresOverride.length > 0
            ? pa.valoresOverride
            : null,
        atributo: {
          id: pa.atributo.id,
          nombre: pa.atributo.nombre,
          clave: pa.atributo.clave,
          tipo: pa.atributo.tipo,
          requerido: pa.requeridoOverride ?? pa.atributo.requerido,
          descripcion: pa.atributo.descripcion,
          unidad: pa.atributo.unidad,
          valores: pa.atributo.valores, // Siempre retornar valores base, el frontend aplica override
          dependeDeAtributoId: pa.atributo.dependeDeAtributoId ?? null,
          opciones: (pa.atributo.opciones ?? []).map((o: any) => ({
            id: o.id,
            valor: o.valor,
            padreValor: o.padre?.valor ?? null,
            orden: o.orden,
          })),
        },
      })),
      categoria: plantilla.categoria,
    };
  }
}
