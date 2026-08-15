import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CacheService } from '../redis/cache.service';
import { SetProductoAtributosDto, AtributoValorDto } from './dto/create-producto-atributo-valor.dto';
import { AtributoTipo } from '@prisma/client';
import {
  construirNombreVariante,
  nombreEsAutogenerado,
} from './utils/nombre-variante.util';

export interface AtributoValorResponse {
  id: string;
  productoId?: string;
  varianteId?: string;
  atributoId: string;
  valor: string;
  // Información del atributo (plantilla)
  atributo: {
    nombre: string;
    clave: string;
    tipo: AtributoTipo;
    unidad?: string;
  };
}

@Injectable()
export class ProductoAtributoValorService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
    private readonly cacheService: CacheService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoAtributoValorService.name);
  }

  /// El listado de productos vive en Redis 30 minutos (`findAll` es un
  /// `getOrSet`), así que guardar atributos sin invalidarlo dejaba la ficha
  /// vieja servida durante media hora.
  ///
  /// 🔴 No alcanza con bumpear `Producto.actualizadoEn`: ese sello lo mira el
  /// delta-sync, que va directo a la base, pero un cliente que hace sync
  /// COMPLETO —primera carga, snapshot invalidado, `fullSyncRequired`— pasa
  /// por el cache y se lleva los atributos anteriores. Todos los demás
  /// servicios del módulo invalidan; este era el único que no.
  private async invalidarListas(empresaId: string): Promise<void> {
    try {
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (e) {
      // Que falle el cache no puede tumbar un guardado que ya se hizo.
      this.logger.warn(
        `No se pudo invalidar el cache de productos de ${empresaId}: ${e}`,
      );
    }
  }

  /**
   * Asignar o actualizar atributos de un producto
   */
  async setProductoAtributos(
    empresaId: string,
    productoId: string,
    dto: SetProductoAtributosDto,
  ): Promise<AtributoValorResponse[]> {
    this.logger.info('Setting producto attributes', { productoId, dto });

    // Verificar que el producto existe y pertenece a la empresa
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException(`Producto ${productoId} no encontrado`);
    }

    // Validar que todos los atributos existen y pertenecen a la empresa
    await this.validateAtributos(empresaId, dto.atributos);

    // 🔴 REEMPLAZA: lo que no venga en `dto.atributos` se borra. Es a
    // propósito —así se quita un atributo— pero obliga a que quien llama mande
    // la ficha COMPLETA, no solo los campos que acaba de tocar.
    const resultado = await this.prisma.$transaction(async (tx) => {
      // Eliminar todos los valores existentes del producto
      await tx.productoAtributoValor.deleteMany({
        where: { productoId },
      });

      // Crear en bulk + un solo findMany con include (2 queries en vez de N)
      await tx.productoAtributoValor.createMany({
        data: dto.atributos.map((atributo) => ({
          productoId,
          atributoId: atributo.atributoId,
          valor: atributo.valor,
        })),
      });

      const valoresCreados = await tx.productoAtributoValor.findMany({
        where: { productoId },
        include: {
          atributo: {
            select: { nombre: true, clave: true, tipo: true, unidad: true },
          },
        },
      });

      // Las secciones aplicadas se SUMAN a las que ya tenía, sin repetir y
      // respetando el orden en que se fueron agregando.
      const seccionesNuevas = (dto.plantillasAtributosIds ?? []).filter(
        (id) => !producto.plantillasAtributosIds.includes(id),
      );
      const plantillasAtributosIds = [
        ...producto.plantillasAtributosIds,
        ...new Set(seccionesNuevas),
      ];

      // El bump NO es cosmético: el delta-sync del app trae productos por
      // `actualizadoEn`, así que sin esto los atributos recién guardados no
      // llegan nunca al celular —y no hay error que lo delate—.
      await tx.producto.update({
        where: { id: productoId },
        data: { plantillasAtributosIds, actualizadoEn: new Date() },
      });

      return valoresCreados.map((v) => this.mapToResponse(v));
    });

    // Fuera de la transacción: si el guardado se confirmó, el cache tiene que
    // caer aunque la invalidación falle.
    await this.invalidarListas(empresaId);
    return resultado;
  }

  /**
   * Asignar o actualizar atributos de una variante
   */
  async setVarianteAtributos(
    empresaId: string,
    varianteId: string,
    dto: SetProductoAtributosDto,
  ): Promise<AtributoValorResponse[]> {
    this.logger.info('Setting variante attributes', { varianteId, dto });

    // Verificar que la variante existe y pertenece a la empresa
    const variante = await this.prisma.productoVariante.findFirst({
      where: { id: varianteId, empresaId },
    });

    if (!variante) {
      throw new NotFoundException(`Variante ${varianteId} no encontrada`);
    }

    // Validar que todos los atributos existen y pertenecen a la empresa
    await this.validateAtributos(empresaId, dto.atributos);

    // Usar transacción para asegurar atomicidad
    const resultado = await this.prisma.$transaction(async (tx) => {
      // Los valores de ANTES, para saber si el nombre actual lo generamos
      // nosotros o lo escribió alguien a mano.
      const valoresPrevios = await tx.productoAtributoValor.findMany({
        where: { varianteId },
        include: {
          atributo: {
            select: { orden: true, usarEnNombreVariante: true },
          },
        },
      });

      // Eliminar todos los valores existentes de la variante
      await tx.productoAtributoValor.deleteMany({
        where: { varianteId },
      });

      // Crear en bulk + un solo findMany con include (2 queries en vez de N)
      await tx.productoAtributoValor.createMany({
        data: dto.atributos.map((atributo) => ({
          varianteId,
          atributoId: atributo.atributoId,
          valor: atributo.valor,
        })),
      });

      const valoresCreados = await tx.productoAtributoValor.findMany({
        where: { varianteId },
        include: {
          atributo: {
            select: {
              nombre: true,
              clave: true,
              tipo: true,
              unidad: true,
              orden: true,
              usarEnNombreVariante: true,
            },
          },
        },
      });

      // El nombre de la variante se REARMA acá.
      //
      // Antes no se tocaba: una variante creada por combinación quedaba con el
      // nombre de ese momento y asignarle atributos después no lo cambiaba
      // nunca. Solo se pisa si el nombre era autogenerado — si alguien lo
      // escribió a mano, se respeta.
      const paraNombre = valoresCreados.map((v) => ({
        valor: v.valor,
        orden: v.atributo.orden,
        usarEnNombreVariante: v.atributo.usarEnNombreVariante,
      }));
      const nombreNuevo = construirNombreVariante(paraNombre);

      const eraAutogenerado = nombreEsAutogenerado(
        variante.nombre,
        valoresPrevios.map((v) => ({
          valor: v.valor,
          orden: v.atributo.orden,
          usarEnNombreVariante: v.atributo.usarEnNombreVariante,
        })),
      );

      if (eraAutogenerado && nombreNuevo.length > 0 && nombreNuevo !== variante.nombre) {
        await tx.productoVariante.update({
          where: { id: varianteId },
          data: { nombre: nombreNuevo },
        });
        this.logger.info(
          `Nombre de variante regenerado: "${variante.nombre}" → "${nombreNuevo}"`,
        );
      }

      // Las variantes viajan al app ADENTRO de su producto, y el delta-sync
      // pide por `Producto.actualizadoEn`: sin bumpear el padre, los atributos
      // de la variante se guardan pero el celular sigue viendo los viejos.
      await tx.producto.update({
        where: { id: variante.productoId },
        data: { actualizadoEn: new Date() },
      });

      return valoresCreados.map((v) => this.mapToResponse(v));
    });

    await this.invalidarListas(empresaId);
    return resultado;
  }

  /**
   * Obtener atributos de un producto
   */
  async getProductoAtributos(
    empresaId: string,
    productoId: string,
  ): Promise<AtributoValorResponse[]> {
    this.logger.debug('Getting producto attributes', { productoId });

    // Verificar que el producto existe
    const producto = await this.prisma.producto.findFirst({
      where: { id: productoId, empresaId },
    });

    if (!producto) {
      throw new NotFoundException(`Producto ${productoId} no encontrado`);
    }

    const valores = await this.prisma.productoAtributoValor.findMany({
      where: { productoId },
      include: {
        atributo: {
          select: {
            nombre: true,
            clave: true,
            tipo: true,
            unidad: true,
          },
        },
      },
    });

    return valores.map((v) => this.mapToResponse(v));
  }

  /**
   * Obtener atributos de una variante
   */
  async getVarianteAtributos(
    empresaId: string,
    varianteId: string,
  ): Promise<AtributoValorResponse[]> {
    this.logger.debug('Getting variante attributes', { varianteId });

    // Verificar que la variante existe
    const variante = await this.prisma.productoVariante.findFirst({
      where: { id: varianteId, empresaId },
    });

    if (!variante) {
      throw new NotFoundException(`Variante ${varianteId} no encontrada`);
    }

    const valores = await this.prisma.productoAtributoValor.findMany({
      where: { varianteId },
      include: {
        atributo: {
          select: {
            nombre: true,
            clave: true,
            tipo: true,
            unidad: true,
          },
        },
      },
    });

    return valores.map((v) => this.mapToResponse(v));
  }

  /**
   * Validar que los atributos existen y pertenecen a la empresa
   */
  private async validateAtributos(
    empresaId: string,
    atributos: AtributoValorDto[],
  ): Promise<void> {
    const atributoIds = atributos.map((a) => a.atributoId);

    const atributosExistentes = await this.prisma.productoAtributo.findMany({
      where: {
        id: { in: atributoIds },
        empresaId,
        isActive: true,
      },
    });

    const existentesMap = new Map(atributosExistentes.map(a => [a.id, a]));

    if (atributosExistentes.length !== atributoIds.length) {
      const faltantes = atributoIds.filter((id) => !existentesMap.has(id));
      throw new BadRequestException(
        `Los siguientes atributos no existen, están inactivos o no pertenecen a la empresa: ${faltantes.join(', ')}`,
      );
    }

    // Un valor de atributo DEPENDIENTE tiene que pertenecer a la rama del
    // valor elegido en su padre. Se resuelve con una sola consulta: las
    // opciones de todos los dependientes que vengan en el payload, con el
    // valor de su opción padre resuelto.
    const dependientes = atributosExistentes.filter(
      (a) => a.tipo === AtributoTipo.SELECT_DEPENDIENTE && a.dependeDeAtributoId,
    );
    const opcionesPorAtributo = new Map<string, Map<string, string | null>>();
    if (dependientes.length > 0) {
      const opciones = await this.prisma.productoAtributoOpcion.findMany({
        where: { atributoId: { in: dependientes.map((a) => a.id) } },
        select: { atributoId: true, valor: true, padre: { select: { valor: true } } },
      });
      for (const o of opciones) {
        if (!opcionesPorAtributo.has(o.atributoId)) {
          opcionesPorAtributo.set(o.atributoId, new Map());
        }
        opcionesPorAtributo.get(o.atributoId)!.set(o.valor, o.padre?.valor ?? null);
      }
    }
    // Lo que el payload asigna a cada atributo, para saber qué eligió el padre.
    const valorPorAtributo = new Map(atributos.map((a) => [a.atributoId, a.valor]));

    // Validar que los valores sean coherentes con el tipo de atributo
    for (const atributo of atributos) {
      const plantilla = existentesMap.get(atributo.atributoId);
      if (!plantilla) continue;

      // Validar según tipo
      switch (plantilla.tipo) {
        case AtributoTipo.NUMERO:
        case AtributoTipo.MONEDA:
          if (isNaN(Number(atributo.valor))) {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" requiere un valor numérico, recibido: ${atributo.valor}`,
            );
          }
          break;

        case AtributoTipo.BOOLEAN:
          if (atributo.valor !== 'true' && atributo.valor !== 'false') {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" requiere un valor booleano (true/false), recibido: ${atributo.valor}`,
            );
          }
          break;

        case AtributoTipo.SELECT:
          // Verificar que el valor esté en los valores predefinidos
          if (plantilla.valores.length > 0 && !plantilla.valores.includes(atributo.valor)) {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" solo acepta los valores: ${plantilla.valores.join(', ')}. Recibido: ${atributo.valor}`,
            );
          }
          break;

        case AtributoTipo.MULTI_SELECT: {
          // 🔴 El app manda los elegidos separados por coma ("Rojo,Azul"), así
          // que compararlos como un solo string rechazaba cualquier selección
          // de 2+ valores con "solo acepta los valores: ...". Se valida uno
          // por uno.
          const elegidos = atributo.valor
            .split(',')
            .map(v => v.trim())
            .filter(v => v.length > 0);
          const invalidos = plantilla.valores.length > 0
            ? elegidos.filter(v => !plantilla.valores.includes(v))
            : [];
          if (invalidos.length > 0) {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" solo acepta los valores: ${plantilla.valores.join(', ')}. Recibido: ${invalidos.join(', ')}`,
            );
          }
          break;
        }

        case AtributoTipo.SELECT_DEPENDIENTE: {
          const opciones = opcionesPorAtributo.get(plantilla.id);
          if (!opciones || opciones.size === 0) break;

          const padreDeLaOpcion = opciones.get(atributo.valor);
          if (padreDeLaOpcion === undefined) {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" no tiene la opción "${atributo.valor}"`,
            );
          }

          // El padre puede no venir en este payload (edición parcial de un
          // producto que ya lo tenía). Sin ese dato no hay contra qué comparar
          // y se acepta: el valor ya se validó contra la lista de opciones.
          const valorDelPadre = valorPorAtributo.get(plantilla.dependeDeAtributoId!);
          if (valorDelPadre === undefined) break;

          if (padreDeLaOpcion !== valorDelPadre) {
            throw new BadRequestException(
              `"${atributo.valor}" no corresponde a "${valorDelPadre}" en "${plantilla.nombre}"` +
                (padreDeLaOpcion ? `, sino a "${padreDeLaOpcion}"` : ''),
            );
          }
          break;
        }

        case AtributoTipo.COLOR:
        case AtributoTipo.TALLA:
        case AtributoTipo.MATERIAL:
        case AtributoTipo.CAPACIDAD:
          // Validar contra valores predefinidos si existen
          if (plantilla.valores.length > 0 && !plantilla.valores.includes(atributo.valor)) {
            throw new BadRequestException(
              `El atributo "${plantilla.nombre}" solo acepta los valores: ${plantilla.valores.join(', ')}. Recibido: ${atributo.valor}`,
            );
          }
          break;
      }
    }
  }

  /**
   * Mapear a response
   */
  private mapToResponse(valor: any): AtributoValorResponse {
    return {
      id: valor.id,
      productoId: valor.productoId,
      varianteId: valor.varianteId,
      atributoId: valor.atributoId,
      valor: valor.valor,
      atributo: {
        nombre: valor.atributo.nombre,
        clave: valor.atributo.clave,
        tipo: valor.atributo.tipo,
        unidad: valor.atributo.unidad,
      },
    };
  }
}
