import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { CreateProductoAtributoPlantillaDto } from './dto/create-producto-atributo-plantilla.dto';
import { UpdateProductoAtributoPlantillaDto } from './dto/update-producto-atributo-plantilla.dto';
import { ProductoAtributoPlantillaResponseDto } from './dto/producto-atributo-plantilla-response.dto';

@Injectable()
export class ProductoAtributoPlantillaService {
  private readonly logger = new Logger(ProductoAtributoPlantillaService.name);

  constructor(
    private prisma: PrismaService,
    private planLimitsService: PlanLimitsService,
  ) {}

  /**
   * Crear una nueva plantilla de atributos
   */
  async create(
    empresaId: string,
    createDto: CreateProductoAtributoPlantillaDto,
  ): Promise<ProductoAtributoPlantillaResponseDto> {
    // Validar límite del plan (solo para plantillas personalizadas)
    await this.planLimitsService.checkPlantillasAtributosLimit(empresaId);

    // Verificar que el nombre no esté duplicado
    const existe = await this.prisma.productoAtributoPlantilla.findUnique({
      where: {
        empresaId_nombre: {
          empresaId,
          nombre: createDto.nombre,
        },
      },
    });

    if (existe) {
      throw new BadRequestException(
        `Ya existe una plantilla con el nombre "${createDto.nombre}"`,
      );
    }

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
      include: {
        atributos: {
          include: {
            atributo: true,
          },
          orderBy: {
            orden: 'asc',
          },
        },
        categoria: {
          select: {
            id: true,
            nombreLocal: true,
            nombrePersonalizado: true,
          },
        },
      },
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
      include: {
        atributos: {
          include: {
            atributo: true,
          },
          orderBy: {
            orden: 'asc',
          },
        },
        categoria: {
          select: {
            id: true,
            nombreLocal: true,
            nombrePersonalizado: true,
          },
        },
      },
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
      include: {
        atributos: {
          include: {
            atributo: true,
          },
          orderBy: {
            orden: 'asc',
          },
        },
        categoria: {
          select: {
            id: true,
            nombreLocal: true,
            nombrePersonalizado: true,
          },
        },
      },
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
      const existe = await this.prisma.productoAtributoPlantilla.findUnique({
        where: {
          empresaId_nombre: {
            empresaId,
            nombre: updateDto.nombre,
          },
        },
      });

      if (existe) {
        throw new BadRequestException(
          `Ya existe una plantilla con el nombre "${updateDto.nombre}"`,
        );
      }
    }

    // Si se actualizan los atributos, validar y actualizar
    if (updateDto.atributos) {
      const atributoIds = updateDto.atributos.map((a) => a.atributoId);
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

      // Eliminar atributos actuales y crear nuevos
      await this.prisma.plantillaAtributo.deleteMany({
        where: { plantillaId: id },
      });

      await this.prisma.plantillaAtributo.createMany({
        data: updateDto.atributos.map((a, index) => ({
          plantillaId: id,
          atributoId: a.atributoId,
          orden: a.orden ?? index,
          requeridoOverride: a.requeridoOverride,
          valoresOverride: a.valoresOverride ?? [],
        })),
      });
    }

    // Actualizar datos básicos de la plantilla
    const plantillaActualizada = await this.prisma.productoAtributoPlantilla.update({
      where: { id },
      data: {
        nombre: updateDto.nombre,
        descripcion: updateDto.descripcion,
        icono: updateDto.icono,
        categoriaId: updateDto.categoriaId,
        orden: updateDto.orden,
      },
      include: {
        atributos: {
          include: {
            atributo: true,
          },
          orderBy: {
            orden: 'asc',
          },
        },
        categoria: {
          select: {
            id: true,
            nombreLocal: true,
            nombrePersonalizado: true,
          },
        },
      },
    });

    this.logger.log(`Plantilla ${id} actualizada para empresa ${empresaId}`);

    return this.mapToResponseDto(plantillaActualizada);
  }

  /**
   * Eliminar (soft delete) una plantilla
   */
  async remove(id: string, empresaId: string): Promise<void> {
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

    await this.prisma.productoAtributoPlantilla.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.log(`Plantilla ${id} eliminada para empresa ${empresaId}`);
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
  ): Promise<{ atributosCreados: number }> {
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

    // Obtener plantilla con atributos
    const plantilla = await this.prisma.productoAtributoPlantilla.findFirst({
      where: {
        id: plantillaId,
        empresaId,
        isActive: true,
      },
      include: {
        atributos: {
          include: {
            atributo: true,
          },
        },
      },
    });

    if (!plantilla) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    // Los valores iniciales son vacíos - solo creamos la estructura
    // El usuario llenará los valores en el formulario
    const atributosValores = plantilla.atributos.map((pa) => ({
      atributoId: pa.atributoId,
      productoId: productoId || null,
      varianteId: varianteId || null,
      valor: '', // Valor vacío - se llenará después
    }));

    // Crear valores de atributos (con conflictos se ignoran)
    await this.prisma.productoAtributoValor.createMany({
      data: atributosValores,
      skipDuplicates: true,
    });

    this.logger.log(
      `Plantilla "${plantilla.nombre}" aplicada a ${productoId ? 'producto' : 'variante'} ${productoId || varianteId}`,
    );

    return {
      atributosCreados: plantilla.atributos.length,
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
        valoresOverride: pa.valoresOverride,
        atributo: {
          id: pa.atributo.id,
          nombre: pa.atributo.nombre,
          clave: pa.atributo.clave,
          tipo: pa.atributo.tipo,
          requerido: pa.requeridoOverride ?? pa.atributo.requerido,
          descripcion: pa.atributo.descripcion,
          unidad: pa.atributo.unidad,
          valores: pa.atributo.valores, // Siempre retornar valores base, el frontend aplica override
        },
      })),
      categoria: plantilla.categoria,
    };
  }
}
