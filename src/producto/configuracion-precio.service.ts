import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConfiguracionPrecioDto } from './dto/create-configuracion-precio.dto';
import { UpdateConfiguracionPrecioDto } from './dto/update-configuracion-precio.dto';
import {
  ConfiguracionPrecioResponseDto,
  ConfiguracionPrecioNivelResponseDto,
} from './dto/configuracion-precio-response.dto';

@Injectable()
export class ConfiguracionPrecioService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea una nueva configuración de precios
   */
  async crear(
    empresaId: string,
    dto: CreateConfiguracionPrecioDto,
  ): Promise<ConfiguracionPrecioResponseDto> {
    // Verificar que no exista una configuración con el mismo nombre
    const existe = await this.prisma.configuracionPrecio.findFirst({
      where: {
        empresaId,
        nombre: dto.nombre,
      },
    });

    if (existe) {
      throw new BadRequestException(
        `Ya existe una configuración con el nombre "${dto.nombre}"`,
      );
    }

    // Validar que no haya rangos de cantidad superpuestos
    this.validarRangosNoSuperpuestos(dto.niveles);

    // Crear la configuración con sus niveles
    const configuracion = await this.prisma.configuracionPrecio.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        niveles: {
          create: dto.niveles.map((nivel) => ({
            nombre: nivel.nombre,
            cantidadMinima: nivel.cantidadMinima,
            cantidadMaxima: nivel.cantidadMaxima,
            tipoPrecio: nivel.tipoPrecio,
            porcentajeDesc: nivel.porcentajeDesc,
            descripcion: nivel.descripcion,
            orden: nivel.orden ?? 0,
          })),
        },
      },
      include: {
        niveles: {
          orderBy: {
            cantidadMinima: 'asc',
          },
        },
      },
    });

    return this.mapToResponseDto(configuracion);
  }

  /**
   * Obtiene todas las configuraciones de una empresa
   */
  async obtenerTodas(empresaId: string): Promise<ConfiguracionPrecioResponseDto[]> {
    const configuraciones = await this.prisma.configuracionPrecio.findMany({
      where: {
        empresaId,
        isActive: true,
      },
      include: {
        niveles: {
          orderBy: {
            cantidadMinima: 'asc',
          },
        },
        _count: {
          select: {
            productos: true,
          },
        },
      },
      orderBy: {
        nombre: 'asc',
      },
    });

    return configuraciones.map((config) => ({
      ...this.mapToResponseDto(config),
      cantidadProductosUsando: config._count.productos,
    }));
  }

  /**
   * Obtiene una configuración por ID
   */
  async obtenerPorId(
    empresaId: string,
    configuracionId: string,
  ): Promise<ConfiguracionPrecioResponseDto> {
    const configuracion = await this.prisma.configuracionPrecio.findFirst({
      where: {
        id: configuracionId,
        empresaId,
      },
      include: {
        niveles: {
          orderBy: {
            cantidadMinima: 'asc',
          },
        },
        _count: {
          select: {
            productos: true,
          },
        },
      },
    });

    if (!configuracion) {
      throw new NotFoundException('Configuración de precios no encontrada');
    }

    return {
      ...this.mapToResponseDto(configuracion),
      cantidadProductosUsando: configuracion._count.productos,
    };
  }

  /**
   * Actualiza una configuración
   */
  async actualizar(
    empresaId: string,
    configuracionId: string,
    dto: UpdateConfiguracionPrecioDto,
  ): Promise<ConfiguracionPrecioResponseDto> {
    // Verificar que existe
    const configuracion = await this.prisma.configuracionPrecio.findFirst({
      where: {
        id: configuracionId,
        empresaId,
      },
    });

    if (!configuracion) {
      throw new NotFoundException('Configuración de precios no encontrada');
    }

    // Si se cambia el nombre, verificar que no exista otro con ese nombre
    if (dto.nombre && dto.nombre !== configuracion.nombre) {
      const existe = await this.prisma.configuracionPrecio.findFirst({
        where: {
          empresaId,
          nombre: dto.nombre,
          id: {
            not: configuracionId,
          },
        },
      });

      if (existe) {
        throw new BadRequestException(
          `Ya existe una configuración con el nombre "${dto.nombre}"`,
        );
      }
    }

    // Si se actualizan niveles, validar rangos
    if (dto.niveles) {
      this.validarRangosNoSuperpuestos(dto.niveles);
    }

    // Actualizar la configuración
    const actualizada = await this.prisma.configuracionPrecio.update({
      where: {
        id: configuracionId,
      },
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        ...(dto.niveles && {
          niveles: {
            deleteMany: {}, // Eliminar niveles anteriores
            create: dto.niveles.map((nivel) => ({
              nombre: nivel.nombre,
              cantidadMinima: nivel.cantidadMinima,
              cantidadMaxima: nivel.cantidadMaxima,
              tipoPrecio: nivel.tipoPrecio,
              porcentajeDesc: nivel.porcentajeDesc,
              descripcion: nivel.descripcion,
              orden: nivel.orden ?? 0,
            })),
          },
        }),
      },
      include: {
        niveles: {
          orderBy: {
            cantidadMinima: 'asc',
          },
        },
      },
    });

    return this.mapToResponseDto(actualizada);
  }

  /**
   * Elimina una configuración
   */
  async eliminar(empresaId: string, configuracionId: string): Promise<void> {
    const configuracion = await this.prisma.configuracionPrecio.findFirst({
      where: {
        id: configuracionId,
        empresaId,
      },
      include: {
        _count: {
          select: {
            productos: true,
          },
        },
      },
    });

    if (!configuracion) {
      throw new NotFoundException('Configuración de precios no encontrada');
    }

    // Verificar que no esté siendo usada por productos
    if (configuracion._count.productos > 0) {
      throw new BadRequestException(
        `No se puede eliminar esta configuración porque está siendo usada por ${configuracion._count.productos} producto(s)`,
      );
    }

    // Marcar como inactiva en lugar de eliminar
    await this.prisma.configuracionPrecio.update({
      where: {
        id: configuracionId,
      },
      data: {
        isActive: false,
      },
    });
  }

  /**
   * Valida que no haya rangos de cantidad superpuestos
   */
  private validarRangosNoSuperpuestos(
    niveles: Array<{
      cantidadMinima: number;
      cantidadMaxima?: number | null;
    }>,
  ): void {
    // Ordenar por cantidadMinima
    const nivelesOrdenados = [...niveles].sort(
      (a, b) => a.cantidadMinima - b.cantidadMinima,
    );

    for (let i = 0; i < nivelesOrdenados.length; i++) {
      const nivelActual = nivelesOrdenados[i];

      // Validar que cantidadMaxima sea mayor que cantidadMinima
      if (
        nivelActual.cantidadMaxima &&
        nivelActual.cantidadMaxima <= nivelActual.cantidadMinima
      ) {
        throw new BadRequestException(
          `La cantidad máxima debe ser mayor que la cantidad mínima en el nivel ${i + 1}`,
        );
      }

      // Verificar superposición con el siguiente nivel
      if (i < nivelesOrdenados.length - 1) {
        const nivelSiguiente = nivelesOrdenados[i + 1];

        if (nivelActual.cantidadMaxima) {
          if (nivelActual.cantidadMaxima >= nivelSiguiente.cantidadMinima) {
            throw new BadRequestException(
              `Los rangos de cantidad se superponen entre niveles`,
            );
          }
        }
      }
    }
  }

  /**
   * Mapea la entidad de Prisma al DTO de respuesta
   */
  private mapToResponseDto(configuracion: any): ConfiguracionPrecioResponseDto {
    return {
      id: configuracion.id,
      empresaId: configuracion.empresaId,
      nombre: configuracion.nombre,
      descripcion: configuracion.descripcion,
      isActive: configuracion.isActive,
      niveles: configuracion.niveles.map(
        (nivel: any): ConfiguracionPrecioNivelResponseDto => ({
          id: nivel.id,
          nombre: nivel.nombre,
          cantidadMinima: nivel.cantidadMinima,
          cantidadMaxima: nivel.cantidadMaxima,
          tipoPrecio: nivel.tipoPrecio,
          porcentajeDesc: nivel.porcentajeDesc
            ? Number(nivel.porcentajeDesc)
            : null,
          descripcion: nivel.descripcion,
          orden: nivel.orden,
        }),
      ),
      creadoEn: configuracion.creadoEn,
      actualizadoEn: configuracion.actualizadoEn,
    };
  }
}
