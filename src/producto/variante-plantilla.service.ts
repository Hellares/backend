import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { TextoBusquedaService } from './texto-busqueda.service';
import { construirNombreVariante } from './utils/nombre-variante.util';
import { CLAVE_ATRIBUTO_DISENO } from './variante-diseno.service';
import {
  AplicarVariantePlantillaDto,
  CombinacionPlantillaDto,
  GuardarVariantePlantillaDto,
  NivelPlantillaDto,
  VariantePlantillaDesdeColeccionDto,
} from './dto/variante-plantilla.dto';

/** Máximo de combinaciones por plantilla y por aplicación (como generar). */
const MAX_COMBINACIONES = 50;

type Valor = { atributoId: string; valor: string };

/** Mismo criterio de igualdad de valores que la numeración de diseños. */
const normalizar = (v: string) => v.trim().toUpperCase();

/**
 * Plantillas de VARIANTES: la estructura de una colección guardada para
 * repetirla ("Edredones": 2 PLAZAS · TELA · 3 PZS · HOMBRE, … con precios).
 *
 * Al aplicarla en un producto se escribe el valor de la colección nueva
 * (DINOSAURIO) y nacen esas combinaciones con ese valor, en 0 — las unidades
 * entran con la compra, y los diseños con "Agregar diseños".
 *
 * Es un punto de partida, no un vínculo: las variantes creadas quedan
 * independientes de la plantilla.
 */
@Injectable()
export class VariantePlantillaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly realtime: RealtimeInvalidationService,
    private readonly configCodigos: ConfiguracionCodigosService,
    private readonly textoBusqueda: TextoBusquedaService,
  ) {}

  // ─────────────────────────── Lectura ───────────────────────────

  async listar(empresaId: string) {
    const plantillas = await this.prisma.variantePlantilla.findMany({
      where: { empresaId, isActive: true },
      include: { combinaciones: { orderBy: { orden: 'asc' } } },
      orderBy: { nombre: 'asc' },
    });
    const nombres = await this.nombresDeAtributos(
      empresaId,
      plantillas.flatMap((p) => [p.atributoColeccionId, ...p.atributoIds]),
    );
    return plantillas.map((p) => this.aRespuesta(p, nombres));
  }

  async obtener(empresaId: string, id: string) {
    const p = await this.prisma.variantePlantilla.findFirst({
      where: { id, empresaId, isActive: true },
      include: { combinaciones: { orderBy: { orden: 'asc' } } },
    });
    if (!p) throw new NotFoundException('Plantilla no encontrada');
    const nombres = await this.nombresDeAtributos(empresaId, [p.atributoColeccionId, ...p.atributoIds]);
    return this.aRespuesta(p, nombres);
  }

  // ─────────────────────────── Escritura ───────────────────────────

  async crear(empresaId: string, dto: GuardarVariantePlantillaDto) {
    await this.validar(empresaId, dto);
    await this.nombreLibre(empresaId, dto.nombre);
    const creada = await this.prisma.variantePlantilla.create({
      data: {
        empresaId,
        nombre: dto.nombre.trim(),
        descripcion: dto.descripcion?.trim() || null,
        atributoColeccionId: dto.atributoColeccionId,
        atributoIds: dto.atributoIds,
        combinaciones: { create: dto.combinaciones.map((c, i) => this.filaCombinacion(c, i)) },
      },
      select: { id: true },
    });
    return this.obtener(empresaId, creada.id);
  }

  /** Reemplaza la plantilla entera (nombre, atributos y combinaciones). */
  async actualizar(empresaId: string, id: string, dto: GuardarVariantePlantillaDto) {
    const actual = await this.prisma.variantePlantilla.findFirst({
      where: { id, empresaId, isActive: true },
      select: { id: true },
    });
    if (!actual) throw new NotFoundException('Plantilla no encontrada');
    await this.validar(empresaId, dto);
    await this.nombreLibre(empresaId, dto.nombre, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.variantePlantillaCombinacion.deleteMany({ where: { plantillaId: id } });
      await tx.variantePlantilla.update({
        where: { id },
        data: {
          nombre: dto.nombre.trim(),
          descripcion: dto.descripcion?.trim() || null,
          atributoColeccionId: dto.atributoColeccionId,
          atributoIds: dto.atributoIds,
          combinaciones: { create: dto.combinaciones.map((c, i) => this.filaCombinacion(c, i)) },
        },
      });
    });
    return this.obtener(empresaId, id);
  }

  /**
   * Baja lógica. El nombre se libera (queda "<nombre> (eliminada …)") para que
   * se pueda volver a crear una con el mismo: es único por empresa.
   */
  async eliminar(empresaId: string, id: string) {
    const p = await this.prisma.variantePlantilla.findFirst({
      where: { id, empresaId, isActive: true },
      select: { id: true, nombre: true },
    });
    if (!p) throw new NotFoundException('Plantilla no encontrada');
    await this.prisma.variantePlantilla.update({
      where: { id },
      data: { isActive: false, nombre: `${p.nombre} (eliminada ${Date.now().toString(36)})` },
    });
    return { id };
  }

  /**
   * Crea una plantilla copiando la estructura de una colección que ya existe
   * en un producto: sus combinaciones (sin la colección ni el diseño) con el
   * precio, el costo y los precios por mayor de cada una.
   */
  async desdeColeccion(empresaId: string, dto: VariantePlantillaDesdeColeccionDto) {
    const variantes = await this.prisma.productoVariante.findMany({
      where: {
        productoId: dto.productoId,
        empresaId,
        deletedAt: null,
        isActive: true,
        atributosValores: { some: { atributoId: dto.atributoColeccionId } },
      },
      include: {
        atributosValores: { include: { atributo: { select: { id: true, clave: true, orden: true } } } },
        preciosNivel: { where: { isActive: true }, orderBy: { orden: 'asc' } },
        stocksPorSede: true,
      },
      orderBy: { creadoEn: 'desc' },
    });
    const modelo = variantes.filter((v) =>
      v.atributosValores.some(
        (a) => a.atributoId === dto.atributoColeccionId && normalizar(a.valor) === normalizar(dto.valorColeccion),
      ),
    );
    if (!modelo.length) {
      throw new BadRequestException(`No hay variantes activas de la colección "${dto.valorColeccion}" en ese producto.`);
    }

    // Una combinación por juego de valores (sin colección ni diseño). Como
    // vienen de la más nueva a la más vieja, gana el precio vigente.
    const orden = new Map<string, number>();
    const combos = new Map<string, CombinacionPlantillaDto>();
    for (const v of modelo) {
      const valores: Valor[] = v.atributosValores
        .filter((a) => a.atributoId !== dto.atributoColeccionId && a.atributo.clave !== CLAVE_ATRIBUTO_DISENO)
        .sort((a, b) => a.atributo.orden - b.atributo.orden)
        .map((a) => {
          orden.set(a.atributoId, a.atributo.orden);
          return { atributoId: a.atributoId, valor: a.valor };
        });
      if (!valores.length) continue;
      const clave = valores.map((x) => `${x.atributoId}=${normalizar(x.valor)}`).join('|');
      if (combos.has(clave)) continue;
      const fila = v.stocksPorSede.find((s) => s.precioConfigurado) ?? v.stocksPorSede[0];
      combos.set(clave, {
        valores,
        precio: fila?.precio != null ? Number(fila.precio) : null,
        precioCosto: fila?.precioCosto != null ? Number(fila.precioCosto) : null,
        niveles: v.preciosNivel.map((n) => ({
          nombre: n.nombre,
          cantidadMinima: n.cantidadMinima,
          cantidadMaxima: n.cantidadMaxima,
          tipoPrecio: n.tipoPrecio,
          precio: n.precio != null ? Number(n.precio) : null,
          porcentajeDesc: n.porcentajeDesc != null ? Number(n.porcentajeDesc) : null,
        })),
      });
    }
    if (!combos.size) {
      throw new BadRequestException('Esa colección no tiene otros atributos además de la colección.');
    }
    const atributoIds = [...orden.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    return this.crear(empresaId, {
      nombre: dto.nombre,
      descripcion: `Copiada de la colección ${dto.valorColeccion}`,
      atributoColeccionId: dto.atributoColeccionId,
      atributoIds,
      combinaciones: [...combos.values()],
    });
  }

  /**
   * Aplica la plantilla en un producto: crea la colección nueva con las
   * combinaciones elegidas, en 0, con sus precios. Las que ya existen en el
   * producto (misma colección y mismos valores) se omiten y se informan.
   * Si un valor no está en la lista de su atributo (DINOSAURIO), se agrega.
   */
  async aplicar(empresaId: string, id: string, dto: AplicarVariantePlantillaDto) {
    const plantilla = await this.prisma.variantePlantilla.findFirst({
      where: { id, empresaId, isActive: true },
      include: { combinaciones: { orderBy: { orden: 'asc' } } },
    });
    if (!plantilla) throw new NotFoundException('Plantilla no encontrada');

    const producto = await this.prisma.producto.findFirst({
      where: { id: dto.productoId, empresaId, deletedAt: null },
      select: { id: true, tieneVariantes: true, isActive: true, sedeId: true },
    });
    if (!producto) throw new NotFoundException('Producto no encontrado');
    if (!producto.tieneVariantes) throw new BadRequestException('El producto no tiene variantes habilitadas');
    if (!producto.isActive) {
      throw new BadRequestException('El producto está inactivo. Actívalo antes de crear variantes.');
    }

    const valorColeccion = dto.valorColeccion.trim();
    const porId = new Map(plantilla.combinaciones.map((c) => [c.id, c]));
    const elegidas = dto.combinaciones?.length
      ? dto.combinaciones.map((e) => {
          const c = porId.get(e.combinacionId);
          if (!c) throw new BadRequestException('Alguna combinación ya no está en la plantilla. Recargá.');
          return { c, precio: e.precio, precioCosto: e.precioCosto };
        })
      : plantilla.combinaciones.map((c) => ({ c, precio: undefined, precioCosto: undefined }));
    if (elegidas.length > MAX_COMBINACIONES) {
      throw new BadRequestException(`Máximo ${MAX_COMBINACIONES} combinaciones por vez.`);
    }

    const atributoIds = [plantilla.atributoColeccionId, ...plantilla.atributoIds];
    const atributos = await this.prisma.productoAtributo.findMany({
      where: { id: { in: atributoIds }, empresaId, isActive: true },
    });
    const atributosMap = new Map(atributos.map((a) => [a.id, a]));
    const faltan = atributoIds.filter((a) => !atributosMap.has(a));
    if (faltan.length) {
      throw new BadRequestException('Algún atributo de la plantilla ya no existe o está inactivo. Editá la plantilla.');
    }

    // Lo que ya existe en el producto, por juego completo de valores.
    const existentes = await this.prisma.productoVariante.findMany({
      where: { productoId: producto.id, empresaId, deletedAt: null },
      select: { atributosValores: { select: { atributoId: true, valor: true } } },
    });
    const claveDe = (vals: Valor[]) =>
      vals
        .map((v) => `${v.atributoId}=${normalizar(v.valor)}`)
        .sort()
        .join('|');
    const yaExisten = new Set(existentes.map((e) => claveDe(e.atributosValores)));

    const aCrear: Array<{ valores: Valor[]; nombre: string; precio: number | null; precioCosto: number | null; niveles: NivelPlantillaDto[] }> = [];
    const omitidas: string[] = [];
    for (const { c, precio, precioCosto } of elegidas) {
      const valores: Valor[] = [
        ...(c.valores as unknown as Valor[]),
        { atributoId: plantilla.atributoColeccionId, valor: valorColeccion },
      ];
      const nombre = construirNombreVariante(
        valores.map((v) => {
          const a = atributosMap.get(v.atributoId)!;
          return { valor: v.valor, orden: a.orden, usarEnNombreVariante: a.usarEnNombreVariante };
        }),
      );
      if (yaExisten.has(claveDe(valores))) {
        omitidas.push(nombre);
        continue;
      }
      aCrear.push({
        valores,
        nombre,
        precio: precio !== undefined ? precio : c.precio != null ? Number(c.precio) : null,
        precioCosto: precioCosto !== undefined ? precioCosto : c.precioCosto != null ? Number(c.precioCosto) : null,
        niveles: (c.niveles as unknown as NivelPlantillaDto[] | null) ?? [],
      });
    }
    if (!aCrear.length) {
      return { creadas: [], omitidas };
    }

    const sedeIds = await this.sedesDelProducto(producto.id, empresaId, producto.sedeId);
    const base = existentes.length;

    const creadas = await this.prisma.$transaction(
      async (tx) => {
        // Los valores nuevos (DINOSAURIO) entran a la lista de su atributo;
        // si no, quedan fuera de los chips y de las validaciones de generar.
        await this.agregarValoresALista(tx, atributosMap, aCrear.flatMap((x) => x.valores));

        const out: Array<{ id: string; nombre: string }> = [];
        for (const [i, v] of aCrear.entries()) {
          const { codigoEmpresa } = await this.configCodigos.generarCodigoVariante(empresaId, tx);
          const variante = await tx.productoVariante.create({
            data: {
              productoId: producto.id,
              empresaId,
              nombre: v.nombre,
              sku: codigoEmpresa,
              codigoEmpresa,
              isActive: true,
              orden: base + i,
            },
            select: { id: true },
          });
          await tx.productoAtributoValor.createMany({
            data: v.valores.map((x) => ({ varianteId: variante.id, atributoId: x.atributoId, valor: x.valor })),
          });
          if (v.niveles.length) {
            await tx.precioNivel.createMany({
              data: v.niveles.map((n, k) => ({
                varianteId: variante.id,
                nombre: n.nombre,
                cantidadMinima: n.cantidadMinima,
                cantidadMaxima: n.cantidadMaxima ?? null,
                tipoPrecio: n.tipoPrecio,
                precio: n.precio ?? null,
                porcentajeDesc: n.porcentajeDesc ?? null,
                orden: k,
                isActive: true,
              })),
            });
          }
          // En 0: las unidades entran con la compra. Sin precio la fila NO
          // queda configurada, así sale "SIN PRECIO" y no vendible a S/0.
          if (sedeIds.length) {
            await tx.productoStock.createMany({
              data: sedeIds.map((sedeId) => ({
                sedeId,
                empresaId,
                varianteId: variante.id,
                stockActual: 0,
                precio: v.precio,
                precioCosto: v.precioCosto,
                precioConfigurado: v.precio != null,
              })),
              skipDuplicates: true,
            });
          }
          out.push({ id: variante.id, nombre: v.nombre });
        }
        return out;
      },
      { timeout: Math.max(15000, aCrear.length * 2000) },
    );

    await this.cache.invalidateProductosLists(empresaId);
    await this.textoBusqueda.recalcularProducto(producto.id);
    this.realtime.notifyProductoActualizado({ empresaId, productoId: producto.id });

    return { creadas, omitidas };
  }

  // ─────────────────────────── Internos ───────────────────────────

  private async validar(empresaId: string, dto: GuardarVariantePlantillaDto) {
    if (dto.atributoIds.includes(dto.atributoColeccionId)) {
      throw new BadRequestException('El atributo de colección no va entre los de las combinaciones.');
    }
    const ids = [dto.atributoColeccionId, ...dto.atributoIds];
    const encontrados = await this.prisma.productoAtributo.count({
      where: { id: { in: ids }, empresaId, isActive: true },
    });
    if (encontrados !== new Set(ids).size) {
      throw new BadRequestException('Algún atributo no existe o está inactivo.');
    }
    const permitidos = new Set(dto.atributoIds);
    const vistas = new Set<string>();
    for (const c of dto.combinaciones) {
      if (c.valores.some((v) => !permitidos.has(v.atributoId))) {
        throw new BadRequestException('Una combinación usa un atributo que no está en la plantilla.');
      }
      const clave = c.valores
        .map((v) => `${v.atributoId}=${normalizar(v.valor)}`)
        .sort()
        .join('|');
      if (vistas.has(clave)) throw new BadRequestException('Hay combinaciones repetidas.');
      vistas.add(clave);
    }
  }

  private async nombreLibre(empresaId: string, nombre: string, exceptoId?: string) {
    const otra = await this.prisma.variantePlantilla.findFirst({
      where: { empresaId, nombre: nombre.trim(), ...(exceptoId ? { NOT: { id: exceptoId } } : {}) },
      select: { id: true },
    });
    if (otra) throw new ConflictException(`Ya hay una plantilla llamada "${nombre.trim()}".`);
  }

  private filaCombinacion(c: CombinacionPlantillaDto, orden: number) {
    return {
      valores: c.valores.map((v) => ({ atributoId: v.atributoId, valor: v.valor.trim() })) as unknown as Prisma.InputJsonValue,
      precio: c.precio ?? null,
      precioCosto: c.precioCosto ?? null,
      niveles: c.niveles?.length ? (c.niveles as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      orden,
    };
  }

  private async agregarValoresALista(
    tx: Prisma.TransactionClient,
    atributos: Map<string, { id: string; tipo: string; valores: string[] }>,
    valores: Valor[],
  ) {
    const nuevos = new Map<string, string[]>();
    for (const v of valores) {
      const a = atributos.get(v.atributoId);
      // Solo listas cerradas (SELECT con opciones): las de texto libre no
      // tienen lista, y las dependientes llevan su árbol en `opciones`.
      if (!a || a.tipo !== 'SELECT' || !a.valores.length) continue;
      const lista = nuevos.get(a.id) ?? [...a.valores];
      if (!lista.some((x) => normalizar(x) === normalizar(v.valor))) lista.push(v.valor);
      nuevos.set(a.id, lista);
    }
    for (const [idAtr, lista] of nuevos) {
      if (lista.length !== atributos.get(idAtr)!.valores.length) {
        await tx.productoAtributo.update({ where: { id: idAtr }, data: { valores: lista } });
      }
    }
  }

  /** Las sedes donde el producto ya tiene stock; si ninguna, la suya o todas. */
  private async sedesDelProducto(productoId: string, empresaId: string, sedeProducto: string | null) {
    const stocks = await this.prisma.productoStock.findMany({
      where: {
        empresaId,
        OR: [{ productoId }, { variante: { productoId, deletedAt: null } }],
      },
      select: { sedeId: true },
    });
    if (stocks.length) return [...new Set(stocks.map((s) => s.sedeId))];
    if (sedeProducto) return [sedeProducto];
    const sedes = await this.prisma.sede.findMany({
      where: { empresaId, isActive: true },
      select: { id: true },
    });
    return sedes.map((s) => s.id);
  }

  private async nombresDeAtributos(empresaId: string, ids: string[]) {
    const atributos = await this.prisma.productoAtributo.findMany({
      where: { id: { in: [...new Set(ids)] }, empresaId },
      select: { id: true, nombre: true, clave: true, isActive: true },
    });
    return new Map(atributos.map((a) => [a.id, a]));
  }

  private aRespuesta(
    p: {
      id: string;
      nombre: string;
      descripcion: string | null;
      atributoColeccionId: string;
      atributoIds: string[];
      combinaciones: Array<{ id: string; valores: Prisma.JsonValue; precio: Prisma.Decimal | null; precioCosto: Prisma.Decimal | null; niveles: Prisma.JsonValue; orden: number }>;
    },
    atributos: Map<string, { id: string; nombre: string; clave: string; isActive: boolean }>,
  ) {
    const info = (atributoId: string) => {
      const a = atributos.get(atributoId);
      return { id: atributoId, nombre: a?.nombre ?? '(atributo eliminado)', clave: a?.clave ?? null, activo: a?.isActive ?? false };
    };
    return {
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      atributoColeccion: info(p.atributoColeccionId),
      atributos: p.atributoIds.map(info),
      combinaciones: p.combinaciones.map((c) => ({
        id: c.id,
        valores: c.valores,
        precio: c.precio != null ? Number(c.precio) : null,
        precioCosto: c.precioCosto != null ? Number(c.precioCosto) : null,
        niveles: c.niveles ?? [],
        orden: c.orden,
      })),
    };
  }
}
