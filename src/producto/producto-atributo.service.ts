import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CacheService } from '../redis/cache.service';
import { CreateProductoAtributoDto } from './dto/create-producto-atributo.dto';
import { UpdateProductoAtributoDto } from './dto/update-producto-atributo.dto';
import { AtributoTipo } from '@prisma/client';

export interface ProductoAtributoResponse {
  id: string;
  empresaId: string;
  categoriaIds: string[];
  nombre: string;
  clave: string;
  tipo: AtributoTipo;
  requerido: boolean;
  descripcion?: string;
  unidad?: string;
  valores: string[];
  orden: number;
  mostrarEnListado: boolean;
  usarParaFiltros: boolean;
  mostrarEnMarketplace: boolean;
  isActive: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
}

@Injectable()
export class ProductoAtributoService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
    private readonly cacheService: CacheService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoAtributoService.name);
  }

  /**
   * Tras cambiar un atributo (nombre/clave/valores), los productos y variantes
   * que lo usan muestran el dato VIEJO porque el nombre del atributo viaja
   * embebido en el catálogo cacheado (y en la copia local del app). El atributo
   * en sí no guarda el nombre por variante: vive en ProductoAtributo y se resuelve
   * por join. Por eso, al renombrarlo, hay que:
   *  1. "Tocar" el actualizadoEn de los productos afectados (base + vía variante)
   *     para que el delta-sync del app baje el cambio.
   *
   * 🔴 El sello va en UTC, NO con `now()` pelado: la sesión de Postgres corre
   * en America/Lima y la columna es `timestamp SIN zona`, así que `now()`
   * guarda cinco horas ANTES de lo que escribe Prisma. Con eso el
   * `actualizadoEn` retrocedía y el delta **nunca bajaba el cambio** — o sea
   * que este método no cumplía su propio propósito, en silencio.
   *  2. Invalidar la caché Redis del catálogo de la empresa.
   */
  private async propagarCambioAtributo(
    atributoId: string,
    empresaId: string,
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        UPDATE "Producto" SET "actualizadoEn" = timezone('UTC', now())
        WHERE id IN (
          SELECT av."productoId" FROM "ProductoAtributoValor" av
            WHERE av."atributoId" = ${atributoId} AND av."productoId" IS NOT NULL
          UNION
          SELECT v."productoId" FROM "ProductoAtributoValor" av
            JOIN "ProductoVariante" v ON v.id = av."varianteId"
            WHERE av."atributoId" = ${atributoId}
        )`;
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (e) {
      this.logger.warn(
        `No se pudo propagar el cambio del atributo ${atributoId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /**
   * Crear un atributo de producto
   */
  async create(
    empresaId: string,
    dto: CreateProductoAtributoDto,
  ): Promise<ProductoAtributoResponse> {
    this.logger.info('Creating product attribute', { empresaId, dto });

    // Verificar que no existe un atributo activo con la misma clave
    const existing = await this.prisma.productoAtributo.findUnique({
      where: {
        empresaId_clave: {
          empresaId,
          clave: dto.clave,
        },
      },
    });

    if (existing) {
      if (existing.isActive) {
        throw new ConflictException(`Ya existe un atributo con la clave: ${dto.clave}`);
      }
      // Reactivar atributo soft-deleted actualizando sus datos
      const reactivado = await this.prisma.productoAtributo.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          nombre: dto.nombre,
          tipo: dto.tipo,
          requerido: dto.requerido ?? false,
          descripcion: dto.descripcion,
          unidad: dto.unidad,
          valores: dto.valores ?? [],
          categoriaIds: dto.categoriaIds ?? [],
          orden: dto.orden ?? 0,
          mostrarEnListado: dto.mostrarEnListado ?? true,
          usarParaFiltros: dto.usarParaFiltros ?? true,
          mostrarEnMarketplace: dto.mostrarEnMarketplace ?? true,
        },
      });
      this.logger.success('Product attribute reactivated', { atributoId: reactivado.id });
      return this.mapToResponse(reactivado);
    }

    // Validar coherencia entre tipo y valores
    this.validateAtributoValues(dto.tipo, dto.valores);

    const atributo = await this.prisma.productoAtributo.create({
      data: {
        empresaId,
        categoriaIds: dto.categoriaIds ?? [],
        nombre: dto.nombre,
        clave: dto.clave,
        tipo: dto.tipo,
        requerido: dto.requerido ?? false,
        descripcion: dto.descripcion,
        unidad: dto.unidad,
        valores: dto.valores ?? [],
        orden: dto.orden ?? 0,
        mostrarEnListado: dto.mostrarEnListado ?? true,
        usarParaFiltros: dto.usarParaFiltros ?? true,
        mostrarEnMarketplace: dto.mostrarEnMarketplace ?? true,
      },
    });

    this.logger.success('Product attribute created', { atributoId: atributo.id });

    return this.mapToResponse(atributo);
  }

  /**
   * Obtener todos los atributos de una empresa
   */
  async findAll(empresaId: string, includeInactive = false): Promise<ProductoAtributoResponse[]> {
    this.logger.debug('Finding all attributes', { empresaId });

    const atributos = await this.prisma.productoAtributo.findMany({
      where: {
        empresaId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { orden: 'asc' },
      take: 200, // Límite de seguridad
    });

    return atributos.map((a) => this.mapToResponse(a));
  }

  /**
   * Obtener atributos por categoría
   */
  async findByCategoria(empresaId: string, categoriaId: string): Promise<ProductoAtributoResponse[]> {
    this.logger.debug('Finding attributes by category', { empresaId, categoriaId });

    const atributos = await this.prisma.productoAtributo.findMany({
      where: {
        empresaId,
        categoriaIds: { has: categoriaId },
        isActive: true,
      },
      orderBy: { orden: 'asc' },
    });

    return atributos.map((a) => this.mapToResponse(a));
  }

  /**
   * Obtener un atributo por ID
   */
  async findOne(atributoId: string, empresaId: string): Promise<ProductoAtributoResponse> {
    this.logger.debug('Finding attribute by ID', { atributoId, empresaId });

    const atributo = await this.prisma.productoAtributo.findFirst({
      where: {
        id: atributoId,
        empresaId,
        isActive: true,
      },
    });

    if (!atributo) {
      throw new NotFoundException(`Atributo ${atributoId} no encontrado`);
    }

    return this.mapToResponse(atributo);
  }

  /**
   * Actualizar un atributo
   */
  async update(
    atributoId: string,
    empresaId: string,
    dto: UpdateProductoAtributoDto,
  ): Promise<ProductoAtributoResponse> {
    this.logger.info('Updating attribute', { atributoId, empresaId, dto });

    const existing = await this.prisma.productoAtributo.findFirst({
      where: {
        id: atributoId,
        empresaId,
        isActive: true,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Atributo ${atributoId} no encontrado`);
    }

    // Si se actualiza la clave, verificar que no exista otra activa con la misma
    if (dto.clave && dto.clave !== existing.clave) {
      const duplicado = await this.prisma.productoAtributo.findFirst({
        where: {
          empresaId,
          clave: dto.clave,
          isActive: true,
          id: { not: atributoId },
        },
      });

      if (duplicado) {
        throw new ConflictException(`Ya existe un atributo activo con la clave: ${dto.clave}`);
      }
    }

    // Determinar tipo y valores para validación
    const tipoParaValidar = dto.tipo ?? existing.tipo;
    const valoresParaValidar = dto.valores ?? existing.valores;
    this.validateAtributoValues(tipoParaValidar, valoresParaValidar);

    // Update + cascada de rename en UNA transacción: si la cascada falla,
    // el cambio de la lista de opciones también se revierte (antes el
    // updateMany corría suelto y un fallo a mitad dejaba asignaciones
    // mezcladas entre el valor viejo y el nuevo).
    const { atributo, rename } = await this.prisma.$transaction(async (tx) => {
      const atributo = await tx.productoAtributo.update({
        where: { id: atributoId },
        data: {
          ...(dto.nombre && { nombre: dto.nombre }),
          ...(dto.clave && { clave: dto.clave }),
          ...(dto.tipo && { tipo: dto.tipo }),
          ...(dto.requerido !== undefined && { requerido: dto.requerido }),
          ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
          ...(dto.unidad !== undefined && { unidad: dto.unidad }),
          ...(dto.categoriaIds !== undefined && { categoriaIds: dto.categoriaIds }),
          ...(dto.valores && { valores: dto.valores }),
          ...(dto.orden !== undefined && { orden: dto.orden }),
          ...(dto.mostrarEnListado !== undefined && { mostrarEnListado: dto.mostrarEnListado }),
          ...(dto.usarParaFiltros !== undefined && { usarParaFiltros: dto.usarParaFiltros }),
          ...(dto.mostrarEnMarketplace !== undefined && {
            mostrarEnMarketplace: dto.mostrarEnMarketplace,
          }),
        },
      });

      // Cascada de rename de VALOR: el valor que cada variante/producto tiene
      // guardado (ProductoAtributoValor.valor) es un string independiente de la
      // lista de opciones (ProductoAtributo.valores). Si se renombró un valor de
      // la lista, las asignaciones existentes quedarían con el string viejo. Se
      // detecta un rename simple (un valor sale, uno entra) y se propaga a todas
      // las asignaciones. Cambios múltiples no se cascadean (ambigüedad).
      let rename: { de: string; a: string; count: number } | null = null;
      if (dto.valores) {
        const viejos = existing.valores ?? [];
        const nuevos = dto.valores;
        const removidos = viejos.filter((v) => !nuevos.includes(v));
        const agregados = nuevos.filter((v) => !viejos.includes(v));
        if (removidos.length === 1 && agregados.length === 1) {
          const res = await tx.productoAtributoValor.updateMany({
            where: { atributoId, valor: removidos[0] },
            data: { valor: agregados[0] },
          });
          rename = { de: removidos[0], a: agregados[0], count: res.count };
        } else if (removidos.length > 0 && agregados.length > 0) {
          this.logger.warn(
            `Cambio múltiple de valores en atributo ${atributoId} ` +
              `(removidos: ${removidos.length}, agregados: ${agregados.length}). ` +
              `No se aplica cascada automática para evitar ambigüedad.`,
          );
        }
      }

      return { atributo, rename };
    });

    this.logger.success('Attribute updated', { atributoId });
    if (rename && rename.count > 0) {
      this.logger.info(
        `Cascada de rename de valor "${rename.de}" → "${rename.a}" en ${rename.count} asignación(es)`,
      );
    }

    // Propagar el cambio: invalidar caché + tocar actualizadoEn de los
    // productos afectados para que el rename llegue al app.
    await this.propagarCambioAtributo(atributoId, empresaId);

    return this.mapToResponse(atributo);
  }

  /**
   * Eliminar un atributo (soft delete)
   * Marca como inactivo en vez de eliminar para preservar valores existentes
   */
  async remove(
    atributoId: string,
    empresaId: string,
  ): Promise<{ valoresEnUso: number }> {
    this.logger.info('Soft-deleting attribute', { atributoId, empresaId });

    const atributo = await this.prisma.productoAtributo.findFirst({
      where: {
        id: atributoId,
        empresaId,
        isActive: true,
      },
    });

    if (!atributo) {
      throw new NotFoundException(`Atributo ${atributoId} no encontrado`);
    }

    // Verificar si el atributo está en uso en alguna plantilla activa
    const enPlantillas = await this.prisma.plantillaAtributo.count({
      where: {
        atributoId,
        plantilla: { isActive: true },
      },
    });

    if (enPlantillas > 0) {
      throw new BadRequestException(
        `No se puede eliminar el atributo "${atributo.nombre}" porque está en uso en ${enPlantillas} plantilla(s) activa(s). Elimínelo primero de las plantillas.`,
      );
    }

    // Valores asignados a productos/variantes: el soft-delete los preserva
    // pero dejan de mostrarse en fichas/filtros. No se bloquea (el atributo
    // sería ineliminable en la práctica), pero se informa al cliente y se
    // deja rastro en el log para auditoría.
    const valoresEnUso = await this.prisma.productoAtributoValor.count({
      where: { atributoId },
    });

    await this.prisma.productoAtributo.update({
      where: { id: atributoId },
      data: { isActive: false },
    });

    if (valoresEnUso > 0) {
      this.logger.warn(
        `Atributo "${atributo.nombre}" desactivado con ${valoresEnUso} valor(es) aún asignados a productos/variantes`,
      );
    }
    this.logger.success('Attribute soft-deleted', { atributoId });

    await this.propagarCambioAtributo(atributoId, empresaId);

    return { valoresEnUso };
  }

  /**
   * Validar que los valores sean coherentes con el tipo de atributo
   */
  private validateAtributoValues(tipo: AtributoTipo, valores?: string[]): void {
    // Si no se proporcionan valores, se asume array vacío
    const valoresArray = valores ?? [];

    switch (tipo) {
      case AtributoTipo.SELECT:
      case AtributoTipo.MULTI_SELECT:
        // Debe tener al menos un valor predefinido
        if (valoresArray.length === 0) {
          throw new BadRequestException(
            `El tipo ${tipo} requiere al menos un valor predefinido en 'valores'`,
          );
        }
        // Cada valor debe ser una cadena no vacía
        if (valoresArray.some(v => !v || v.trim() === '')) {
          throw new BadRequestException(
            `Los valores predefinidos para ${tipo} no pueden estar vacíos`,
          );
        }
        break;

      case AtributoTipo.COLOR:
      case AtributoTipo.TALLA:
      case AtributoTipo.MATERIAL:
      case AtributoTipo.CAPACIDAD:
        // Legacy: no son tipos de dato sino NOMBRES de atributo, se comportan
        // como SELECT y ya no se ofrecen en el selector. Quedan laxos para no
        // romper filas viejas; no hay ninguna en beta ni en prod.
        break;

      default:
        // Todo el resto es de DATO LIBRE: se tipea al editar el producto, no
        // se elige de una lista. Un tipo nuevo del enum cae acá solo y se
        // comporta bien; el valor inválido ya lo rechazó el @IsEnum del DTO,
        // así que este default no necesita hacer de guardia de enum.
        if (valoresArray.length > 0) {
          throw new BadRequestException(
            `El tipo ${tipo} no admite valores predefinidos`,
          );
        }
    }
  }
  /**
   * Mapear a response
   */
  private mapToResponse(atributo: any): ProductoAtributoResponse {
    return {
      id: atributo.id,
      empresaId: atributo.empresaId,
      categoriaIds: atributo.categoriaIds,
      nombre: atributo.nombre,
      clave: atributo.clave,
      tipo: atributo.tipo,
      requerido: atributo.requerido,
      descripcion: atributo.descripcion,
      unidad: atributo.unidad,
      valores: atributo.valores,
      orden: atributo.orden,
      mostrarEnListado: atributo.mostrarEnListado,
      usarParaFiltros: atributo.usarParaFiltros,
      mostrarEnMarketplace: atributo.mostrarEnMarketplace,
      isActive: atributo.isActive,
      creadoEn: atributo.creadoEn,
      actualizadoEn: atributo.actualizadoEn,
    };
  }

  /**
   * Crea valores de atributos estructurados para un producto base
   * Convierte el formato array de atributos a la tabla ProductoAtributoValor
   * @param productoId ID del producto
   * @param empresaId ID de la empresa
   * @param atributosEstructurados Array de atributos con sus valores
   * @param tx Transacción de Prisma (opcional)
   */
  async createProductoAtributosFromStructured(
    productoId: string,
    empresaId: string,
    atributosEstructurados: Array<{ atributoId: string; valor: string }>,
    tx?: any,
  ): Promise<void> {
    if (atributosEstructurados.length === 0) {
      return;
    }

    const prisma = tx || this.prisma;

    // Verificar que los atributos pertenezcan a la empresa y estén activos
    const atributoIds = atributosEstructurados.map(a => a.atributoId);
    const atributosExistentes = await prisma.productoAtributo.findMany({
      where: {
        id: { in: atributoIds },
        empresaId,
        isActive: true,
      },
      select: { id: true },
    });

    const existentesSet = new Set(atributosExistentes.map((a: any) => a.id));
    const atributosValidos = atributosEstructurados.filter(a => existentesSet.has(a.atributoId));

    if (atributosValidos.length === 0) {
      this.logger.warn(`Ningún atributoId válido encontrado para empresa ${empresaId}. No se crearán valores.`);
      return;
    }

    const valoresAtributos = atributosValidos.map(a => ({
      productoId,
      atributoId: a.atributoId,
      valor: String(a.valor),
    }));

    await prisma.productoAtributoValor.createMany({
      data: valoresAtributos,
      skipDuplicates: true,
    });

    this.logger.debug(`Creados ${valoresAtributos.length} valores de atributos estructurados para producto ${productoId}`);
  }
}
