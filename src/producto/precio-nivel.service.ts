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

/** Redondea a 4 decimales (igual que el storage Decimal(14,4)). */
const round4 = (v: number): number => Math.round(v * 10000) / 10000;

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
   * Calcular el precio según la cantidad para un producto o variante
   * @param sedeId - Requerido para obtener el precio base desde ProductoStock
   */
  async calcularPrecioSegunCantidad(
    productoId: string | null,
    varianteId: string | null,
    sedeId: string,
    cantidad: number,
    opts?: { ignorarNiveles?: boolean; vip?: VipPrecioContexto },
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

    // Calcular precio según niveles (si aplica)
    const niveles = await this.prisma.precioNivel.findMany({
      where: {
        ...(productoId && { productoId }),
        ...(varianteId && { varianteId }),
        isActive: true,
        cantidadMinima: { lte: cantidad },
        OR: [{ cantidadMaxima: { gte: cantidad } }, { cantidadMaxima: null }],
      },
      orderBy: { cantidadMinima: 'desc' },
    });

    let precioConNivel: number | null = null;
    let nivelNombre: string | null = null;
    if (niveles.length) {
      const nivel = niveles[0];
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

    // ===== Candidato de precio especial VIP =====
    // El VIP entra como un candidato más del reduce (gana el menor): el cliente
    // nunca paga más que una oferta/liquidación pública más barata. No aplica a
    // componentes de combo (ignorarNiveles), que tienen su propio deal.
    if (opts?.vip && !opts?.ignorarNiveles) {
      const vipCandidato = await this._calcularCandidatoVip(
        opts.vip,
        productoId,
        varianteId,
        precioBase,
        precioCosto,
      );
      if (vipCandidato != null) {
        candidatos.push({
          valor: vipCandidato,
          etiqueta: opts.vip.etiqueta,
          vipPoliticaId: opts.vip.politicaId,
        });
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
        return round4(precioCosto * (1 + (vip.markupSobreCosto ?? 0) / 100));
      }
      case 'PRECIO_MAYOR_DESDE_UNIDAD': {
        // Todos los niveles activos, sin filtrar por cantidad (desde la unidad 1).
        const niveles = await this.prisma.precioNivel.findMany({
          where: {
            ...(productoId && { productoId }),
            ...(varianteId && { varianteId }),
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
        return round4(precioDeNivel(elegido));
      }
      case 'PORCENTAJE': {
        let desc = precioBase * ((vip.valor ?? 0) / 100);
        if (vip.descuentoMaximo != null && desc > vip.descuentoMaximo) {
          desc = vip.descuentoMaximo;
        }
        return round4(Math.max(precioBase - desc, 0));
      }
      case 'MONTO_FIJO': {
        let desc = vip.valor ?? 0;
        if (vip.descuentoMaximo != null && desc > vip.descuentoMaximo) {
          desc = vip.descuentoMaximo;
        }
        return round4(Math.max(precioBase - desc, 0));
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
