import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CacheService } from '../redis/cache.service';
import { CreateProductoAtributoDto, OpcionAtributoDto } from './dto/create-producto-atributo.dto';
import { UpdateProductoAtributoDto } from './dto/update-producto-atributo.dto';
import { AtributoTipo, Prisma } from '@prisma/client';

export interface OpcionAtributoResponse {
  id: string;
  valor: string;
  /** Valor del atributo PADRE del que cuelga. Null en los atributos raíz. */
  padreValor: string | null;
  orden: number;
}

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
  /** Las opciones con su jerarquía. Vacío en los tipos que no llevan lista. */
  opciones: OpcionAtributoResponse[];
  dependeDeAtributoId: string | null;
  orden: number;
  mostrarEnListado: boolean;
  usarParaFiltros: boolean;
  mostrarEnMarketplace: boolean;
  isActive: boolean;
  creadoEn: Date;
  actualizadoEn: Date;
}

/** Cuántos eslabones se admiten en una cadena, como red contra un ciclo que se escape. */
const MAX_PROFUNDIDAD_DEPENDENCIA = 10;

/** Las opciones siempre se leen con el valor de su padre resuelto. */
const INCLUIR_OPCIONES = {
  opciones: {
    orderBy: { orden: 'asc' as const },
    include: { padre: { select: { valor: true } } },
  },
};

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
      // Reactivar atributo soft-deleted actualizando sus datos. Pasa por la
      // misma sincronización que el alta: si no, quedaba con las opciones
      // viejas de cuando se lo desactivó y un `valores` que no las refleja.
      const entradasReactivado = this.opcionesDeDto(dto.opciones, dto.valores);
      await this.validarDependencia(empresaId, existing.id, dto.tipo, dto.dependeDeAtributoId);

      const reactivado = await this.prisma.$transaction(async (tx) => {
        await tx.productoAtributo.update({
          where: { id: existing.id },
          data: {
            isActive: true,
            nombre: dto.nombre,
            tipo: dto.tipo,
            requerido: dto.requerido ?? false,
            descripcion: dto.descripcion,
            unidad: dto.unidad,
            dependeDeAtributoId: dto.dependeDeAtributoId ?? null,
            categoriaIds: dto.categoriaIds ?? [],
            orden: dto.orden ?? 0,
            mostrarEnListado: dto.mostrarEnListado ?? true,
            usarParaFiltros: dto.usarParaFiltros ?? true,
            mostrarEnMarketplace: dto.mostrarEnMarketplace ?? true,
          },
        });

        const valores = await this.sincronizarOpciones(
          tx,
          existing.id,
          dto.dependeDeAtributoId ?? null,
          entradasReactivado,
        );

        return tx.productoAtributo.update({
          where: { id: existing.id },
          data: { valores },
          include: INCLUIR_OPCIONES,
        });
      });

      this.logger.success('Product attribute reactivated', { atributoId: reactivado.id });
      return this.mapToResponse(reactivado);
    }

    // Validar coherencia entre tipo y valores
    const entradas = this.opcionesDeDto(dto.opciones, dto.valores);
    this.validateAtributoValues(
      dto.tipo,
      entradas.map((o) => o.valor),
    );
    await this.validarDependencia(empresaId, null, dto.tipo, dto.dependeDeAtributoId);

    // El alta va en transacción porque son dos pasos: nace el atributo y
    // recién con su id se pueden colgar las opciones. `valores` se escribe al
    // final, calculado desde las opciones, para que el espejo no pueda quedar
    // diciendo algo distinto a la fuente.
    const atributo = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.productoAtributo.create({
        data: {
          empresaId,
          categoriaIds: dto.categoriaIds ?? [],
          nombre: dto.nombre,
          clave: dto.clave,
          tipo: dto.tipo,
          requerido: dto.requerido ?? false,
          descripcion: dto.descripcion,
          unidad: dto.unidad,
          dependeDeAtributoId: dto.dependeDeAtributoId ?? null,
          valores: [],
          orden: dto.orden ?? 0,
          mostrarEnListado: dto.mostrarEnListado ?? true,
          usarParaFiltros: dto.usarParaFiltros ?? true,
          mostrarEnMarketplace: dto.mostrarEnMarketplace ?? true,
        },
      });

      const valores = await this.sincronizarOpciones(
        tx,
        creado.id,
        creado.dependeDeAtributoId,
        entradas,
      );

      return tx.productoAtributo.update({
        where: { id: creado.id },
        data: { valores },
        include: INCLUIR_OPCIONES,
      });
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
      include: INCLUIR_OPCIONES,
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
      include: INCLUIR_OPCIONES,
      orderBy: { orden: 'asc' },
    });

    return atributos.map((a) => this.mapToResponse(a));
  }

  /**
   * Los atributos que el buscador puede ofrecer como filtro.
   *
   * Solo los que se eligen de una lista: filtrar por un texto libre o una
   * fecha no es una faceta, es otra clase de filtro. Vienen con sus opciones y
   * con `dependeDeAtributoId`, que es lo que le permite a la pantalla mostrar
   * FABRICANTE → FAMILIA → PROCESADOR en cascada y no como tres listas sueltas.
   *
   * No trae conteos a propósito: contar productos por cada valor obliga a un
   * groupBy por atributo y el catálogo se pagina igual. Si más adelante hacen
   * falta, van en su propio endpoint.
   */
  async filtrosDisponibles(
    empresaId: string,
    categoriaId?: string,
  ): Promise<ProductoAtributoResponse[]> {
    const atributos = await this.prisma.productoAtributo.findMany({
      where: {
        empresaId,
        isActive: true,
        usarParaFiltros: true,
        tipo: {
          in: [
            AtributoTipo.SELECT,
            AtributoTipo.MULTI_SELECT,
            AtributoTipo.SELECT_DEPENDIENTE,
          ],
        },
        ...(categoriaId ? { categoriaIds: { has: categoriaId } } : {}),
      },
      include: INCLUIR_OPCIONES,
      orderBy: { orden: 'asc' },
      take: 200,
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
      include: INCLUIR_OPCIONES,
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
    const tocaOpciones = dto.opciones !== undefined || dto.valores !== undefined;
    const entradas = tocaOpciones
      ? this.opcionesDeDto(dto.opciones, dto.valores)
      : null;
    const valoresParaValidar = entradas
      ? entradas.map((o) => o.valor)
      : existing.valores;
    this.validateAtributoValues(tipoParaValidar, valoresParaValidar);

    // `dependeDeAtributoId` admite null explícito para desarmar la cadena, así
    // que hay que distinguir "no vino" de "vino en null".
    const dependeDeParaValidar =
      dto.dependeDeAtributoId !== undefined
        ? dto.dependeDeAtributoId
        : existing.dependeDeAtributoId;
    await this.validarDependencia(
      empresaId,
      atributoId,
      tipoParaValidar,
      dependeDeParaValidar,
    );

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
          ...(dto.dependeDeAtributoId !== undefined && {
            dependeDeAtributoId: dto.dependeDeAtributoId,
          }),
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
      if (entradas) {
        const viejos = existing.valores ?? [];
        const nuevos = entradas.map((o) => o.valor);
        const removidos = viejos.filter((v) => !nuevos.includes(v));
        const agregados = nuevos.filter((v) => !viejos.includes(v));
        if (removidos.length === 1 && agregados.length === 1) {
          const res = await tx.productoAtributoValor.updateMany({
            where: { atributoId, valor: removidos[0] },
            data: { valor: agregados[0] },
          });
          rename = { de: removidos[0], a: agregados[0], count: res.count };

          // 🔴 La OPCIÓN también se renombra en su lugar, y ANTES de
          // sincronizar. Si no, el sincronizador la ve como "una que sale y
          // otra que entra": borra la vieja y el cascade del FK se lleva
          // TODAS sus hijas. Renombrar QUALCOMM borraría sus procesadores.
          //
          // Esto solo hace falta cuando el cliente manda la lista plana. Si
          // manda `opciones` con id, el apareo por id ya resuelve el rename.
          await tx.productoAtributoOpcion.updateMany({
            where: { atributoId, valor: removidos[0] },
            data: { valor: agregados[0] },
          });
        } else if (removidos.length > 0 && agregados.length > 0) {
          this.logger.warn(
            `Cambio múltiple de valores en atributo ${atributoId} ` +
              `(removidos: ${removidos.length}, agregados: ${agregados.length}). ` +
              `No se aplica cascada automática para evitar ambigüedad.`,
          );
        }

        const valores = await this.sincronizarOpciones(
          tx,
          atributoId,
          atributo.dependeDeAtributoId,
          entradas,
        );
        await tx.productoAtributo.update({
          where: { id: atributoId },
          data: { valores },
        });
      }

      const conOpciones = await tx.productoAtributo.findUniqueOrThrow({
        where: { id: atributoId },
        include: INCLUIR_OPCIONES,
      });

      return { atributo: conOpciones, rename };
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
      case AtributoTipo.SELECT_DEPENDIENTE:
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
  /**
   * Deja las opciones del atributo igual a lo que llegó, y devuelve la lista
   * plana con la que se regenera el espejo `valores`.
   *
   * 🔑 El apareo va primero por `id` y recién después por `valor`. Con el id,
   * renombrar una opción la actualiza EN SU LUGAR y sus hijas la siguen
   * apuntando; sin él, un rename se ve como "una que sale y otra que entra" y
   * el borrado se lleva la rama entera por el cascade del FK.
   */
  private async sincronizarOpciones(
    tx: Prisma.TransactionClient,
    atributoId: string,
    dependeDeAtributoId: string | null,
    entradas: OpcionAtributoDto[],
  ): Promise<string[]> {
    const existentes = await tx.productoAtributoOpcion.findMany({
      where: { atributoId },
    });
    const porId = new Map(existentes.map((o) => [o.id, o]));
    const porValor = new Map(existentes.map((o) => [o.valor, o]));

    // Las opciones del padre, para resolver `padreValor` → id.
    const opcionesPadre = dependeDeAtributoId
      ? await tx.productoAtributoOpcion.findMany({
          where: { atributoId: dependeDeAtributoId },
        })
      : [];
    const padrePorValor = new Map(opcionesPadre.map((o) => [o.valor, o.id]));

    const conservados = new Set<string>();
    const valores: string[] = [];
    let orden = 0;

    for (const entrada of entradas) {
      const valor = entrada.valor?.trim();
      if (!valor) continue;

      let padreId: string | null = null;
      if (dependeDeAtributoId) {
        if (!entrada.padreValor) {
          throw new BadRequestException(
            `La opción "${valor}" no dice de qué valor del atributo padre cuelga`,
          );
        }
        padreId = padrePorValor.get(entrada.padreValor) ?? null;
        if (!padreId) {
          throw new BadRequestException(
            `El atributo padre no tiene la opción "${entrada.padreValor}"`,
          );
        }
      }

      const actual = (entrada.id && porId.get(entrada.id)) || porValor.get(valor);
      if (actual) {
        conservados.add(actual.id);
        await tx.productoAtributoOpcion.update({
          where: { id: actual.id },
          data: { valor, padreId, orden: entrada.orden ?? orden },
        });
      } else {
        const creada = await tx.productoAtributoOpcion.create({
          data: { atributoId, valor, padreId, orden: entrada.orden ?? orden },
        });
        conservados.add(creada.id);
      }

      valores.push(valor);
      orden++;
    }

    const aBorrar = existentes
      .filter((o) => !conservados.has(o.id))
      .map((o) => o.id);

    if (aBorrar.length > 0) {
      // 🔴 Freno contra la pérdida silenciosa de ramas enteras.
      //
      // La cascada de renombrado solo sabe resolver UN cambio (uno sale, uno
      // entra). Al renombrar dos valores de una sola vez no hay forma de
      // aparearlos, así que las opciones viejas caen acá como "borradas" — y
      // el `onDelete: Cascade` del FK se lleva a todas sus hijas.
      //
      // Con la lista plana eso dejaba valores desactualizados; con la
      // jerarquía borra los procesadores de una marca sin que nadie lo pida.
      // Antes que adivinar, se corta y se explica.
      const conHijas = await tx.productoAtributoOpcion.findMany({
        where: { padreId: { in: aBorrar } },
        select: { padre: { select: { valor: true } } },
      });

      if (conHijas.length > 0) {
        const afectadas = [
          ...new Set(conHijas.map((h) => h.padre?.valor).filter(Boolean)),
        ];
        throw new BadRequestException(
          `No se pueden quitar las opciones ${afectadas.join(', ')}: hay ` +
            `${conHijas.length} opción(es) de otro atributo colgando de ellas y ` +
            `se borrarían. Si querés renombrarlas, hacelo de a una por vez; si ` +
            `querés eliminarlas, primero sacá las opciones que dependen de ellas.`,
        );
      }

      await tx.productoAtributoOpcion.deleteMany({ where: { id: { in: aBorrar } } });
    }

    return valores;
  }

  /**
   * Valida que la dependencia declarada sea sana antes de guardarla.
   *
   * `atributoId` es null al crear (todavía no existe), y en ese caso no hace
   * falta buscar ciclos: un atributo recién nacido no puede ser el padre de
   * nadie.
   */
  private async validarDependencia(
    empresaId: string,
    atributoId: string | null,
    tipo: AtributoTipo,
    dependeDeAtributoId: string | null | undefined,
  ): Promise<void> {
    if (tipo === AtributoTipo.SELECT_DEPENDIENTE && !dependeDeAtributoId) {
      throw new BadRequestException(
        'Una selección dependiente necesita el atributo del que depende',
      );
    }
    if (!dependeDeAtributoId) return;

    if (tipo !== AtributoTipo.SELECT_DEPENDIENTE) {
      throw new BadRequestException(
        'Solo una selección dependiente puede declarar un atributo padre',
      );
    }
    if (atributoId && dependeDeAtributoId === atributoId) {
      throw new BadRequestException('Un atributo no puede depender de sí mismo');
    }

    const padre = await this.prisma.productoAtributo.findFirst({
      where: { id: dependeDeAtributoId, empresaId },
    });
    if (!padre) {
      throw new BadRequestException('El atributo padre no existe en esta empresa');
    }
    // Con un padre de selección múltiple el producto puede tener DOS valores a
    // la vez y no habría forma de saber qué rama ofrecer abajo.
    if (padre.tipo === AtributoTipo.MULTI_SELECT) {
      throw new BadRequestException(
        `"${padre.nombre}" es de selección múltiple y no puede ser padre: si un producto tiene dos valores a la vez, no se sabe qué opciones mostrar`,
      );
    }
    if (
      padre.tipo !== AtributoTipo.SELECT &&
      padre.tipo !== AtributoTipo.SELECT_DEPENDIENTE
    ) {
      throw new BadRequestException(
        `"${padre.nombre}" no tiene lista de valores, así que no puede ser padre de una selección dependiente`,
      );
    }

    // Subir por la cadena hasta la raíz buscando volver al punto de partida.
    let cursorId: string | null = padre.dependeDeAtributoId;
    let saltos = 0;
    while (cursorId) {
      if (atributoId && cursorId === atributoId) {
        throw new BadRequestException(
          'Esa dependencia arma un ciclo: el atributo terminaría dependiendo de sí mismo',
        );
      }
      if (++saltos > MAX_PROFUNDIDAD_DEPENDENCIA) {
        throw new BadRequestException('La cadena de dependencias es demasiado larga');
      }
      const siguiente = await this.prisma.productoAtributo.findUnique({
        where: { id: cursorId },
        select: { dependeDeAtributoId: true },
      });
      cursorId = siguiente?.dependeDeAtributoId ?? null;
    }
  }

  /** Las opciones que manda el cliente, o la lista plana si mandó `valores` a la vieja usanza. */
  private opcionesDeDto(
    opciones: OpcionAtributoDto[] | undefined,
    valores: string[] | undefined,
  ): OpcionAtributoDto[] {
    if (opciones) return opciones;
    return (valores ?? []).map((valor) => ({ valor }));
  }

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
      opciones: (atributo.opciones ?? [])
        .slice()
        .sort((a: any, b: any) => a.orden - b.orden)
        .map((o: any) => ({
          id: o.id,
          valor: o.valor,
          padreValor: o.padre?.valor ?? null,
          orden: o.orden,
        })),
      dependeDeAtributoId: atributo.dependeDeAtributoId ?? null,
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
