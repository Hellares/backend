import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { crearMovimientoStockConValoracion } from '../producto-stock/movimiento-stock.helper';
import { round6 } from '../common/utils/money.util';
import { simboloUnidad } from '../common/utils/unidad-presentacion.util';
import { AbrirBultoDto, CerrarBultoDto } from './dto';

/**
 * Apertura y cierre de bultos: convertir stock de una variante CERRADA
 * (SACO 15KG, se vende por unidad) en la variante SUELTA que sale de abrirla
 * (GRANEL, se vende por gramo), y a la inversa.
 *
 * Por qué existe, si ya está `fabricar`
 * -------------------------------------
 * El BOM hace exactamente esta forma —consumir A, producir B, promedio
 * ponderado, kardex PRODUCCION_*— y de hecho reusamos sus tipos de movimiento
 * y su patrón de lock. Pero NO puede expresar el ratio: `ProductoComponente
 * .cantidad` es `Decimal(12,4)` y va POR UNIDAD del producto final, así que
 * "1 saco por cada gramo" sería 0.0000667 y redondea a 0.0001 — 50% de error.
 * Acá el rendimiento va en el sentido contrario (1 saco → 15 000 g) y entra
 * entero.
 *
 * Lo que NO es
 * ------------
 * No es la unidad de presentación. La presentación traduce cómo se MUESTRA un
 * mismo stock (gramos por dentro, kilos al cobrar). Acá hay dos stocks reales
 * y una conversión física entre ellos, que alguien ejecuta y queda en kardex.
 */
@Injectable()
export class AperturaBultoService {
  private readonly logger = new Logger(AperturaBultoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly realtimeInvalidation: RealtimeInvalidationService,
  ) {}

  /**
   * Bultos abribles en una sede, con el stock de los dos lados.
   *
   * Alimenta la pantalla "Abrir bultos" y —esto es lo importante— le da a la
   * alerta de stock mínimo la información que hoy no tiene: si el granel está
   * bajo mínimo PERO hay bultos cerrados en depósito, la acción no es
   * comprarle al proveedor sino abrir uno. Sin esa distinción el gerente pide
   * compras que no hacen falta.
   */
  async listarDisponibles(empresaId: string, sedeId: string) {
    const bultos = await this.prisma.productoVariante.findMany({
      where: {
        empresaId,
        deletedAt: null,
        isActive: true,
        varianteAperturaId: { not: null },
      },
      select: {
        id: true,
        nombre: true,
        rendimientoApertura: true,
        varianteAperturaId: true,
        producto: { select: { id: true, nombre: true } },
        varianteApertura: {
          select: {
            id: true,
            nombre: true,
            factorPresentacion: true,
            unidadPresentacion: {
              select: {
                simboloLocal: true,
                simboloPersonalizado: true,
                unidadMaestra: { select: { simbolo: true } },
              },
            },
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
      orderBy: { nombre: 'asc' },
    });
    if (bultos.length === 0) return [];

    // Una sola consulta para los dos lados de todas las parejas.
    const varianteIds = [
      ...new Set(
        bultos.flatMap((b) => [b.id, b.varianteAperturaId!]).filter(Boolean),
      ),
    ];
    const stocks = await this.prisma.productoStock.findMany({
      where: { sedeId, varianteId: { in: varianteIds } },
      select: { varianteId: true, stockActual: true, stockMinimo: true },
    });
    const porVariante = new Map(stocks.map((s) => [s.varianteId!, s]));

    return bultos
      .filter((b) => b.varianteApertura)
      .map((b) => {
        const stockBulto = porVariante.get(b.id);
        const stockDestino = porVariante.get(b.varianteAperturaId!);
        const disponibles = stockBulto?.stockActual ?? 0;
        const sueltas = stockDestino?.stockActual ?? 0;
        const minimo = stockDestino?.stockMinimo ?? null;

        return {
          producto: b.producto,
          bulto: { varianteId: b.id, nombre: b.nombre, stock: disponibles },
          destino: {
            varianteId: b.varianteApertura!.id,
            nombre: b.varianteApertura!.nombre,
            stock: sueltas,
            stockMinimo: minimo,
            factorPresentacion:
              b.varianteApertura!.factorPresentacion != null
                ? Number(b.varianteApertura!.factorPresentacion)
                : null,
            simbolo:
              simboloUnidad(b.varianteApertura!.unidadPresentacion) ??
              simboloUnidad(b.varianteApertura!.unidadMedida),
          },
          rendimiento: Number(b.rendimientoApertura ?? 0),
          // 🔑 Lo que la alerta necesita para decidir qué acción ofrecer.
          destinoBajoMinimo: minimo != null && sueltas <= minimo,
          sePuedeAbrir: disponibles > 0,
        };
      });
  }

  /**
   * Abre N bultos cerrados: descuenta N de la variante origen y suma
   * N × rendimiento a la variante destino.
   */
  async abrir(empresaId: string, dto: AbrirBultoDto, usuarioId: string) {
    return this._mover(empresaId, dto, usuarioId, 'ABRIR');
  }

  /**
   * Rearma N bultos: descuenta N × rendimiento del granel y devuelve N a la
   * variante cerrada. Existe porque el user lo pidió explícitamente
   * ("flexible, en algún momento lo podemos necesitar"), pero en la práctica
   * abrir es casi irreversible: ver el guard de stock suelto.
   */
  async cerrar(empresaId: string, dto: CerrarBultoDto, usuarioId: string) {
    return this._mover(empresaId, dto, usuarioId, 'CERRAR');
  }

  private async _mover(
    empresaId: string,
    dto: AbrirBultoDto | CerrarBultoDto,
    usuarioId: string,
    operacion: 'ABRIR' | 'CERRAR',
  ) {
    if (dto.cantidad <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    }

    // La variante del DTO es SIEMPRE la cerrada (el saco): es la que sabe en
    // qué se convierte y cuánto rinde. Cerrar es la misma relación al revés,
    // no una relación nueva.
    const saco = await this.prisma.productoVariante.findFirst({
      where: { id: dto.varianteId, empresaId, deletedAt: null, isActive: true },
      select: {
        id: true,
        nombre: true,
        productoId: true,
        varianteAperturaId: true,
        rendimientoApertura: true,
        producto: { select: { nombre: true } },
        varianteApertura: {
          select: { id: true, nombre: true, isActive: true, deletedAt: true },
        },
      },
    });
    if (!saco) {
      throw new NotFoundException('Variante no encontrada o inactiva');
    }
    if (!saco.varianteAperturaId || !saco.varianteApertura) {
      throw new BadRequestException({
        code: 'VARIANTE_SIN_APERTURA',
        message:
          `"${saco.nombre}" no tiene configurado en qué variante se convierte al abrirse. ` +
          'Configurá la variante de apertura y su rendimiento en el formulario del producto.',
      });
    }
    if (!saco.varianteApertura.isActive || saco.varianteApertura.deletedAt) {
      throw new BadRequestException(
        `La variante destino "${saco.varianteApertura.nombre}" está inactiva o eliminada`,
      );
    }

    const rendimiento = Number(saco.rendimientoApertura ?? 0);
    if (!(rendimiento > 0)) {
      throw new BadRequestException({
        code: 'RENDIMIENTO_INVALIDO',
        message: `"${saco.nombre}" no tiene un rendimiento de apertura válido (debe ser mayor a 0).`,
      });
    }
    // El rendimiento se descuenta del stock del destino, que es Int. Un
    // rendimiento fraccionario dejaría el stock imposible de cuadrar.
    const unidadesPorBulto = Math.round(rendimiento);
    if (Math.abs(rendimiento - unidadesPorBulto) > 1e-6) {
      throw new BadRequestException({
        code: 'RENDIMIENTO_FRACCIONARIO',
        message:
          `El rendimiento de "${saco.nombre}" es ${rendimiento} y el stock se maneja en unidades enteras. ` +
          'Usá una unidad de venta más chica en la variante a granel (ej: KG → GR).',
      });
    }

    await this._assertPuedeOperar(empresaId, usuarioId);

    const granelId = saco.varianteAperturaId;
    const totalGranel = unidadesPorBulto * dto.cantidad;
    const numeroDocumento = `APER-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const etiqueta = `${saco.producto?.nombre ?? ''} ${saco.nombre}`.trim();

    const result = await this.prisma.$transaction(async (tx) => {
      // Lock de las DOS filas en un solo FOR UPDATE. Abrir y cerrar usan esta
      // MISMA consulta sobre el MISMO par de variantes, así que dos
      // operaciones concurrentes recorren las filas en el mismo orden y una
      // espera a la otra en vez de cruzarse.
      // (El `ORDER BY` es para leer determinista, no para fijar el orden de
      // los locks: Postgres los toma al escanear, que puede ser antes del
      // sort. Lo que evita el deadlock es que la consulta sea la misma.)
      const filas = await tx.$queryRaw<
        Array<{
          id: string;
          varianteId: string;
          stockActual: number;
          precioCosto: string | null;
        }>
      >`SELECT id, "varianteId", "stockActual", "precioCosto"
        FROM "ProductoStock"
        WHERE "sedeId" = ${dto.sedeId}
          AND "varianteId" IN (${saco.id}, ${granelId})
        ORDER BY "varianteId"
        FOR UPDATE`;

      const porVariante = new Map(
        filas.map((f) => [
          f.varianteId,
          {
            id: f.id,
            stockActual: f.stockActual,
            precioCosto: f.precioCosto != null ? Number(f.precioCosto) : null,
          },
        ]),
      );
      const stockSaco = porVariante.get(saco.id);
      const stockGranel = porVariante.get(granelId);

      if (!stockSaco || !stockGranel) {
        throw new BadRequestException({
          code: 'SIN_STOCK_EN_SEDE',
          message:
            'Alguna de las dos variantes no tiene registro de stock en esta sede. ' +
            'Creá el stock de ambas antes de abrir o cerrar bultos.',
        });
      }

      // Origen y destino según la operación. Todo lo de abajo es simétrico.
      const origen = operacion === 'ABRIR' ? stockSaco : stockGranel;
      const destino = operacion === 'ABRIR' ? stockGranel : stockSaco;
      const cantidadOrigen = operacion === 'ABRIR' ? dto.cantidad : totalGranel;
      const cantidadDestino = operacion === 'ABRIR' ? totalGranel : dto.cantidad;

      if (origen.stockActual < cantidadOrigen) {
        throw new BadRequestException({
          code: operacion === 'ABRIR' ? 'BULTOS_INSUFICIENTES' : 'GRANEL_INSUFICIENTE',
          message:
            operacion === 'ABRIR'
              ? `No hay bultos suficientes: necesita ${cantidadOrigen}, hay ${origen.stockActual}.`
              : `No se puede rearmar ${dto.cantidad} bulto(s): hacen falta ${cantidadOrigen} unidades sueltas y hay ${origen.stockActual}. ` +
                'Si ya se vendió parte del bulto abierto, ese bulto no vuelve.',
          disponible: origen.stockActual,
          requerido: cantidadOrigen,
        });
      }

      // ── Costo ───────────────────────────────────────────────────
      // El valor sale del ORIGEN y entra al DESTINO por promedio ponderado.
      // Si el origen no tiene costo registrado no se toca el del destino:
      // inventarlo en 0 licuaría el promedio y falsearía el margen.
      const origenNuevo = origen.stockActual - cantidadOrigen;
      const destinoAnterior = destino.stockActual;
      const destinoNuevo = destinoAnterior + cantidadDestino;

      let precioCostoDestinoNuevo: number | null = null;
      let costoActualizado = false;
      let razonCostoNoActualizado: string | null = null;
      const valorMovido =
        origen.precioCosto != null ? origen.precioCosto * cantidadOrigen : null;

      if (valorMovido == null) {
        razonCostoNoActualizado =
          'La variante de origen no tiene precio de costo en esta sede';
      } else {
        const valorPrevio = destinoAnterior * (destino.precioCosto ?? 0);
        // `round6`, NO centavos: es un costo POR UNIDAD. Abrir un saco de
        // S/150 en 22 000 g da 0.006818/g, que en centavos sería 0.01 — 47%
        // arriba. Ver feedback_precio_unitario_no_es_monto.
        precioCostoDestinoNuevo = round6((valorPrevio + valorMovido) / destinoNuevo);
        costoActualizado = true;
      }

      // Costo unitario con el que se valora CADA movimiento en el kardex.
      const costoUnitOrigen = origen.precioCosto ?? null;
      const costoUnitDestino =
        valorMovido != null ? round6(valorMovido / cantidadDestino) : null;

      await tx.productoStock.update({
        where: { id: origen.id },
        data: { stockActual: origenNuevo },
      });
      await tx.productoStock.update({
        where: { id: destino.id },
        data: {
          stockActual: destinoNuevo,
          ...(costoActualizado && precioCostoDestinoNuevo != null
            ? { precioCosto: precioCostoDestinoNuevo }
            : {}),
        },
      });

      const motivo =
        operacion === 'ABRIR'
          ? `Apertura de ${dto.cantidad} bulto(s) de ${etiqueta}`
          : `Rearmado de ${dto.cantidad} bulto(s) de ${etiqueta}`;

      await crearMovimientoStockConValoracion(tx, {
        sedeId: dto.sedeId,
        empresaId,
        productoStockId: origen.id,
        tipo: 'PRODUCCION_SALIDA',
        tipoDocumento: 'APERTURA_BULTO',
        numeroDocumento,
        cantidadAnterior: origen.stockActual,
        cantidad: -cantidadOrigen,
        cantidadNueva: origenNuevo,
        motivo,
        observaciones: dto.observaciones,
        precioCostoUnitario: costoUnitOrigen,
        usuarioId,
      });
      await crearMovimientoStockConValoracion(tx, {
        sedeId: dto.sedeId,
        empresaId,
        productoStockId: destino.id,
        tipo: 'PRODUCCION_ENTRADA',
        tipoDocumento: 'APERTURA_BULTO',
        numeroDocumento,
        cantidadAnterior: destinoAnterior,
        cantidad: cantidadDestino,
        cantidadNueva: destinoNuevo,
        motivo,
        observaciones: dto.observaciones,
        precioCostoUnitario: costoUnitDestino,
        usuarioId,
      });

      // Historial del cambio de costo del destino (misma auditoría que usa
      // `fabricar`), solo si efectivamente cambió.
      if (
        costoActualizado &&
        precioCostoDestinoNuevo != null &&
        precioCostoDestinoNuevo !== destino.precioCosto
      ) {
        await tx.productoPrecioHistorialSede.create({
          data: {
            productoStockId: destino.id,
            sedeId: dto.sedeId,
            precioCostoAnterior:
              destino.precioCosto != null
                ? new Prisma.Decimal(destino.precioCosto)
                : null,
            precioCostoNuevo: new Prisma.Decimal(precioCostoDestinoNuevo),
            tipoCambio: 'COSTO',
            razon: motivo,
            origenModulo: 'APERTURA_BULTO',
            usuarioId,
          },
        });
      }

      return {
        operacion,
        numeroDocumento,
        bultos: dto.cantidad,
        unidadesPorBulto,
        origen: {
          varianteId: operacion === 'ABRIR' ? saco.id : granelId,
          stockAnterior: origen.stockActual,
          stockNuevo: origenNuevo,
          cantidadMovida: cantidadOrigen,
        },
        destino: {
          varianteId: operacion === 'ABRIR' ? granelId : saco.id,
          stockAnterior: destinoAnterior,
          stockNuevo: destinoNuevo,
          cantidadMovida: cantidadDestino,
          precioCostoAnterior: destino.precioCosto,
          precioCostoNuevo: precioCostoDestinoNuevo,
        },
        costoActualizado,
        razonCostoNoActualizado,
      };
    });

    this.logger.log(
      `${operacion} ${result.numeroDocumento}: ${etiqueta} × ${dto.cantidad} en sede ${dto.sedeId} (usuario ${usuarioId})`,
    );
    await this.cache.invalidateProductosLists(empresaId);

    // Abrir mueve stock entre DOS variantes del mismo producto, y sin avisar
    // los devices que ya tienen el catálogo cargado siguen viendo el granel en
    // cero. El sheet de venta esconde los valores de atributo sin stock, así
    // que el granel recién abierto NO aparece para vender hasta que alguien
    // recargue a mano. Invalidar Redis no alcanza: eso arregla la próxima
    // consulta al servidor, no la copia que el POS ya tiene en memoria.
    // Fire-and-forget, igual que en compra y devolución: un fallo del push no
    // puede tumbar una operación de stock ya commiteada.
    try {
      for (const varianteId of [
        result.origen.varianteId,
        result.destino.varianteId,
      ]) {
        this.realtimeInvalidation.notifyStockCambiado({
          empresaId,
          productoId: saco.productoId,
          varianteId,
          sedeId: dto.sedeId,
        });
      }
    } catch (err: any) {
      this.logger.warn(
        `Error notificando realtime ${operacion} ${result.numeroDocumento}: ${err?.message ?? err}`,
      );
    }

    return result;
  }

  /**
   * Abrir un bulto es irreversible en la práctica y cambia el costo del
   * granel, así que lo autoriza gerencia. Misma policy que la venta bajo
   * costo y las liquidaciones: SUPER_ADMIN/EMPRESA_ADMIN a nivel empresa, o
   * GERENTE_SEDE/ADMINISTRADOR a nivel sede.
   */
  private async _assertPuedeOperar(empresaId: string, usuarioId: string) {
    const [empresaRol, sedeRol] = await Promise.all([
      this.prisma.empresaUsuarioRol.findFirst({
        where: {
          usuarioId,
          empresaId,
          isActive: true,
          deletedAt: null,
          rol: { in: ['SUPER_ADMIN', 'EMPRESA_ADMIN'] },
        },
        select: { id: true },
      }),
      this.prisma.usuarioSedeRol.findFirst({
        where: {
          usuarioId,
          sede: { empresaId },
          rol: { in: ['GERENTE_SEDE', 'ADMINISTRADOR'] },
          isActive: true,
        },
        select: { id: true },
      }),
    ]);
    if (!empresaRol && !sedeRol) {
      throw new ForbiddenException({
        code: 'APERTURA_NO_AUTORIZADA',
        message:
          'Abrir o rearmar bultos requiere rol de gerencia (GERENTE_SEDE/ADMINISTRADOR en la sede, o SUPER_ADMIN/EMPRESA_ADMIN en la empresa).',
      });
    }
  }
}
