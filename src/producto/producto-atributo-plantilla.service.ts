import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
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

    // Verificar que el producto o variante existe y pertenece a la empresa
    if (productoId) {
      const producto = await this.prisma.producto.findFirst({
        where: { id: productoId, empresaId, deletedAt: null },
      });
      if (!producto) {
        throw new NotFoundException(`Producto ${productoId} no encontrado`);
      }
    } else if (varianteId) {
      const variante = await this.prisma.productoVariante.findFirst({
        where: { id: varianteId, empresaId, deletedAt: null },
      });
      if (!variante) {
        throw new NotFoundException(`Variante ${varianteId} no encontrada`);
      }
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

    // Crear valores de atributos (con conflictos se ignoran)
    const result = await this.prisma.productoAtributoValor.createMany({
      data: atributosValores,
      skipDuplicates: true,
    });

    this.logger.log(
      `Plantilla "${plantilla.nombre}" aplicada a ${productoId ? 'producto' : 'variante'} ${productoId || varianteId} (${result.count} de ${atributosActivos.length} atributos creados)`,
    );

    return {
      atributosCreados: result.count,
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
