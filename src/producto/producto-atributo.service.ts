import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CreateProductoAtributoDto } from './dto/create-producto-atributo.dto';
import { AtributoTipo } from '@prisma/client';

export interface ProductoAtributoResponse {
  id: string;
  empresaId: string;
  nombre: string;
  tipo: AtributoTipo;
  requerido: boolean;
  descripcion?: string;
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
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoAtributoService.name);
  }

  /**
   * Crear un atributo de producto
   */
  async create(
    empresaId: string,
    dto: CreateProductoAtributoDto,
  ): Promise<ProductoAtributoResponse> {
    this.logger.info('Creating product attribute', { empresaId, dto });

    // Verificar que no existe un atributo con el mismo nombre
    const existing = await this.prisma.productoAtributo.findFirst({
      where: {
        empresaId,
        nombre: dto.nombre,
      },
    });

    if (existing) {
      throw new ConflictException(`Ya existe un atributo con el nombre: ${dto.nombre}`);
    }

    // Validar coherencia entre tipo y valores
    this.validateAtributoValues(dto.tipo, dto.valores);

    const atributo = await this.prisma.productoAtributo.create({
      data: {
        empresaId,
        nombre: dto.nombre,
        tipo: dto.tipo,
        requerido: dto.requerido ?? false,
        descripcion: dto.descripcion,
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
    dto: Partial<CreateProductoAtributoDto>,
  ): Promise<ProductoAtributoResponse> {
    this.logger.info('Updating attribute', { atributoId, empresaId, dto });

    const existing = await this.prisma.productoAtributo.findFirst({
      where: {
        id: atributoId,
        empresaId,
      },
    });

    if (!existing) {
      throw new NotFoundException(`Atributo ${atributoId} no encontrado`);
    }

    // Si se actualiza el nombre, verificar que no exista
    if (dto.nombre && dto.nombre !== existing.nombre) {
      const duplicado = await this.prisma.productoAtributo.findFirst({
        where: {
          empresaId,
          nombre: dto.nombre,
          id: { not: atributoId },
        },
      });

      if (duplicado) {
        throw new ConflictException(`Ya existe un atributo con el nombre: ${dto.nombre}`);
      }
    }

    // Determinar tipo y valores para validación
    const tipoParaValidar = dto.tipo ?? existing.tipo;
    const valoresParaValidar = dto.valores ?? existing.valores;
    this.validateAtributoValues(tipoParaValidar, valoresParaValidar);

    const atributo = await this.prisma.productoAtributo.update({
      where: { id: atributoId },
      data: {
        ...(dto.nombre && { nombre: dto.nombre }),
        ...(dto.tipo && { tipo: dto.tipo }),
        ...(dto.requerido !== undefined && { requerido: dto.requerido }),
        ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
        ...(dto.valores && { valores: dto.valores }),
        ...(dto.orden !== undefined && { orden: dto.orden }),
        ...(dto.mostrarEnListado !== undefined && { mostrarEnListado: dto.mostrarEnListado }),
        ...(dto.usarParaFiltros !== undefined && { usarParaFiltros: dto.usarParaFiltros }),
        ...(dto.mostrarEnMarketplace !== undefined && {
          mostrarEnMarketplace: dto.mostrarEnMarketplace,
        }),
      },
    });

    this.logger.success('Attribute updated', { atributoId });

    return this.mapToResponse(atributo);
  }

  /**
   * Eliminar un atributo
   */
  async remove(atributoId: string, empresaId: string): Promise<void> {
    this.logger.info('Deleting attribute', { atributoId, empresaId });

    const atributo = await this.prisma.productoAtributo.findFirst({
      where: {
        id: atributoId,
        empresaId,
      },
    });

    if (!atributo) {
      throw new NotFoundException(`Atributo ${atributoId} no encontrado`);
    }

    await this.prisma.productoAtributo.delete({
      where: { id: atributoId },
    });

    this.logger.success('Attribute deleted', { atributoId });
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

      case AtributoTipo.TEXTO:
      case AtributoTipo.NUMERO:
      case AtributoTipo.BOOLEAN:
        // No deben tener valores predefinidos
        if (valoresArray.length > 0) {
          throw new BadRequestException(
            `El tipo ${tipo} no admite valores predefinidos`,
          );
        }
        break;

      case AtributoTipo.COLOR:
      case AtributoTipo.TALLA:
      case AtributoTipo.MATERIAL:
      case AtributoTipo.CAPACIDAD:
        // Pueden tener valores predefinidos (opcional) o no
        // No hay restricciones adicionales
        break;

      default:
        // Esto no debería ocurrir si el enum está actualizado
        throw new BadRequestException(`Tipo de atributo no reconocido: ${tipo}`);
    }
  }
  /**
   * Mapear a response
   */
  private mapToResponse(atributo: any): ProductoAtributoResponse {
    return {
      id: atributo.id,
      empresaId: atributo.empresaId,
      nombre: atributo.nombre,
      tipo: atributo.tipo,
      requerido: atributo.requerido,
      descripcion: atributo.descripcion,
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
}
