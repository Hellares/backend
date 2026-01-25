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

// Usar Prisma.Decimal para los valores decimales
const Decimal = Prisma.Decimal;

@Injectable()
export class PrecioNivelService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
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

    // Crear el nivel de precio
    const precioNivel = await this.prisma.precioNivel.create({
      data: {
        productoId,
        varianteId,
        nombre: dto.nombre,
        cantidadMinima: dto.cantidadMinima,
        cantidadMaxima: dto.cantidadMaxima,
        tipoPrecio: dto.tipoPrecio,
        precio: dto.precio ? new Decimal(dto.precio) : null,
        porcentajeDesc: dto.porcentajeDesc
          ? new Decimal(dto.porcentajeDesc)
          : null,
        descripcion: dto.descripcion,
        orden: dto.orden ?? 0,
      },
    });

    this.logger.info('Precio nivel created successfully', {
      id: precioNivel.id,
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
  ): Promise<{
    precioUnitario: number;
    nivelAplicado: string;
    descuentoAplicado: number;
    precioBase: number;
  }> {
    this.logger.info('Calculating price by quantity', {
      productoId,
      varianteId,
      sedeId,
      cantidad,
    });

    // Obtener el precio base desde ProductoStock
    let precioBase: Prisma.Decimal | null = null;
    let itemNombre: string;

    if (varianteId) {
      const variante = await this.prisma.productoVariante.findUnique({
        where: { id: varianteId },
        include: {
          stocksPorSede: {
            where: { sedeId },
          },
        },
      });
      if (!variante) {
        throw new NotFoundException(`Variante ${varianteId} no encontrada`);
      }
      const stock = variante.stocksPorSede[0];
      if (!stock || !stock.precio) {
        throw new BadRequestException(
          `No se ha configurado precio para la variante ${variante.nombre} en esta sede`,
        );
      }
      precioBase = stock.precio;
      itemNombre = variante.nombre;
    } else if (productoId) {
      const producto = await this.prisma.producto.findUnique({
        where: { id: productoId },
        include: {
          stocksPorSede: {
            where: { sedeId },
          },
        },
      });
      if (!producto) {
        throw new NotFoundException(`Producto ${productoId} no encontrado`);
      }
      const stock = producto.stocksPorSede[0];
      if (!stock || !stock.precio) {
        throw new BadRequestException(
          `No se ha configurado precio para el producto ${producto.nombre} en esta sede`,
        );
      }
      precioBase = stock.precio;
      itemNombre = producto.nombre;
    } else {
      throw new BadRequestException(
        'Debe proporcionar productoId o varianteId',
      );
    }

    // Buscar niveles de precio aplicables
    const niveles = await this.prisma.precioNivel.findMany({
      where: {
        ...(productoId && { productoId }),
        ...(varianteId && { varianteId }),
        isActive: true,
        cantidadMinima: { lte: cantidad },
        OR: [{ cantidadMaxima: { gte: cantidad } }, { cantidadMaxima: null }],
      },
      orderBy: { cantidadMinima: 'desc' }, // El nivel más alto aplicable
    });

    if (!niveles.length) {
      // No hay niveles, usar precio base
      return {
        precioUnitario: precioBase.toNumber(),
        nivelAplicado: 'Precio base',
        descuentoAplicado: 0,
        precioBase: precioBase.toNumber(),
      };
    }

    // Tomar el primer nivel (más específico)
    const nivel = niveles[0];

    // Calcular precio según tipo
    let precioUnitario: number;
    let descuentoAplicado: number;

    if (nivel.tipoPrecio === TipoPrecioNivel.PRECIO_FIJO) {
      precioUnitario = nivel.precio.toNumber();
      descuentoAplicado =
        ((precioBase.toNumber() - precioUnitario) / precioBase.toNumber()) *
        100;
    } else {
      // PORCENTAJE_DESCUENTO
      const descuento = nivel.porcentajeDesc.toNumber();
      precioUnitario = precioBase.toNumber() * (1 - descuento / 100);
      descuentoAplicado = descuento;
    }

    this.logger.info('Price calculated', {
      itemNombre,
      cantidad,
      precioBase: precioBase.toNumber(),
      precioUnitario,
      nivelAplicado: nivel.nombre,
      descuentoAplicado,
    });

    return {
      precioUnitario,
      nivelAplicado: nivel.nombre,
      descuentoAplicado,
      precioBase: precioBase.toNumber(),
    };
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
