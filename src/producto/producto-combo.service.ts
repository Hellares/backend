import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CreateComponenteComboDto } from './dto/create-producto-combo.dto';
import { UpdateComponenteComboDto } from './dto/update-producto-combo.dto';
import { ProductoComboResponseDto, ComboCompletoResponseDto } from './dto/producto-combo-response.dto';
import { CreateComboDto } from './dto/create-combo.dto';
import { TipoPrecioCombo } from '@prisma/client';

/**
 * Servicio para gestión de combos/kits de productos
 * Maneja la lógica de combos fijos y ensamblables
 */
@Injectable()
export class ProductoComboService {
  private readonly logger: AppLoggerService;

  constructor(
    private prisma: PrismaService,
    private configCodigosService: ConfiguracionCodigosService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ProductoComboService.name);
  }

  /**
   * Crea un nuevo combo directamente
   * El combo se crea como un producto con esCombo=true desde el inicio
   */
  async createCombo(dto: CreateComboDto, userId: string): Promise<any> {
    const { empresaId, imagenesIds, precioFijo, descuentoPorcentaje, ...comboData } = dto;

    try {
      // Verificar permisos del usuario en la empresa
      const empresaUsuario = await this.prisma.empresaUsuarioRol.findFirst({
        where: {
          empresaId,
          usuarioId: userId,
          isActive: true,
        },
      });

      if (!empresaUsuario) {
        throw new ForbiddenException('No tienes permisos en esta empresa');
      }

      // Validar que la categoría pertenece a la empresa (si se proporciona)
      if (comboData.empresaCategoriaId) {
        const categoria = await this.prisma.empresaCategoria.findFirst({
          where: {
            id: comboData.empresaCategoriaId,
            empresaId,
          },
        });
        if (!categoria) {
          throw new BadRequestException('Categoría no encontrada o no pertenece a la empresa');
        }
      }

      // Validar que la marca pertenece a la empresa (si se proporciona)
      if (comboData.empresaMarcaId) {
        const marca = await this.prisma.empresaMarca.findFirst({
          where: {
            id: comboData.empresaMarcaId,
            empresaId,
          },
        });
        if (!marca) {
          throw new BadRequestException('Marca no encontrada o no pertenece a la empresa');
        }
      }

      // Validar tipo de precio vs campos requeridos
      if (dto.tipoPrecioCombo === TipoPrecioCombo.FIJO && !precioFijo) {
        throw new BadRequestException('Debe proporcionar precioFijo cuando el tipo es FIJO');
      }

      if (dto.tipoPrecioCombo === TipoPrecioCombo.CALCULADO_CON_DESCUENTO && !descuentoPorcentaje) {
        throw new BadRequestException(
          'Debe proporcionar descuentoPorcentaje cuando el tipo es CALCULADO_CON_DESCUENTO',
        );
      }

      // Determinar el precio inicial según el tipo
      let precioInicial = 0;
      if (dto.tipoPrecioCombo === TipoPrecioCombo.FIJO && precioFijo) {
        precioInicial = precioFijo;
      }

      // Crear combo dentro de transacción para evitar race conditions
      const combo = await this.prisma.$transaction(async (tx) => {
        // Generar códigos únicos (usando servicio centralizado)
        const { codigoEmpresa, codigoSistema } = await this.configCodigosService.generarCodigoProducto(
          empresaId,
          dto.sedeId,
          tx,
        );

        // Crear el combo como un producto
        return await tx.producto.create({
        data: {
          empresaId,
          sedeId: comboData.sedeId,
          empresaCategoriaId: comboData.empresaCategoriaId,
          empresaMarcaId: comboData.empresaMarcaId,
          codigoEmpresa,
          codigoSistema,
          sku: comboData.sku,
          codigoBarras: comboData.codigoBarras,
          nombre: comboData.nombre,
          descripcion: comboData.descripcion,

          // Campos específicos de combo
          esCombo: true,
          tieneVariantes: false, // Los combos no pueden tener variantes
          tipoPrecioCombo: dto.tipoPrecioCombo,

          // ❌ precio: precioInicial - DEPRECATED: Precio ahora en ProductoStock por sede
          // El precio del combo se configurará en ProductoStock después de crearlo
          // Para combos FIJO: usar precioFijo en ProductoStock
          // Para combos CALCULADO: calcular desde componentes en ProductoStock

          // Descuento (se usa descuentoMaximo para almacenar el porcentaje del combo)
          descuentoMaximo: descuentoPorcentaje,

          // Otros campos
          videoUrl: comboData.videoUrl,
          impuestoPorcentaje: comboData.impuestoPorcentaje,
          visibleMarketplace: comboData.visibleMarketplace ?? true,
          destacado: comboData.destacado ?? false,
        },
        include: {
          empresaCategoria: {
            include: {
              categoriaMaestra: true,
            },
          },
          empresaMarca: {
            include: {
              marcaMaestra: true,
            },
          },
          sede: true,
        },
        });
      });

      // Asociar imágenes si se proporcionaron (fuera de transacción)
      if (imagenesIds && imagenesIds.length > 0) {
        await this.prisma.archivo.updateMany({
          where: {
            id: { in: imagenesIds },
            empresaId,
          },
          data: {
            entidadId: combo.id,
            entidadTipo: 'PRODUCTO',
          },
        });
      }

      this.logger.log(`Combo creado: ${combo.id} - ${combo.nombre}`);

      return {
        id: combo.id,
        empresaId: combo.empresaId,
        nombre: combo.nombre,
        descripcion: combo.descripcion,
        esCombo: combo.esCombo,
        tipoPrecioCombo: combo.tipoPrecioCombo,
        // ❌ precio: Number(combo.precio) - DEPRECATED: Precio ahora en ProductoStock
        precio: 0, // TODO: Obtener desde ProductoStock por sedeId
        precioCalculado: 0, // TODO: Calcular desde ProductoStock
        // TODO: Calcular stock desde ProductoStock
        stockDisponible: 0,
        stock: 0,
        descuentoPorcentaje: descuentoPorcentaje ? Number(descuentoPorcentaje) : null,
        descuentoAplicado: null,
        componentes: [], // Nuevo combo no tiene componentes todavía
        tieneStockSuficiente: false, // Sin componentes = sin stock suficiente
        componentesSinStock: [],
        codigoEmpresa: combo.codigoEmpresa,
        codigoSistema: combo.codigoSistema,
        sku: combo.sku,
        isActive: combo.isActive,
        creadoEn: combo.creadoEn,
        categoria: (combo as any).empresaCategoria,
        marca: (combo as any).empresaMarca,
        sede: (combo as any).sede,
        imagen: null, // Por ahora sin imagen (se pueden agregar después)
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al crear combo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * NOTA: El método generateCodigos() ha sido migrado a ConfiguracionCodigosService
   * para centralizar toda la lógica de generación de códigos.
   *
   * Usar: configCodigosService.generarCodigoProducto()
   */

  /**
   * Agrega un componente a un combo existente
   * @param sedeId - Requerido para obtener precios y stock de la sede
   */
  async agregarComponente(
    comboId: string,
    empresaId: string,
    sedeId: string,
    dto: CreateComponenteComboDto,
  ): Promise<ProductoComboResponseDto> {
    try {
      // Validar que el combo existe y pertenece a la empresa
      const combo = await this.prisma.producto.findFirst({
        where: {
          id: comboId,
          empresaId,
          esCombo: true,
          deletedAt: null,
        },
      });

      if (!combo) {
        throw new NotFoundException('Combo no encontrado');
      }

      // Validar que se proporcione al menos un componente (producto o variante)
      if (!dto.componenteProductoId && !dto.componenteVarianteId) {
        throw new BadRequestException(
          'Debe proporcionar componenteProductoId o componenteVarianteId',
        );
      }

      // Validar que no se proporcionen ambos
      if (dto.componenteProductoId && dto.componenteVarianteId) {
        throw new BadRequestException(
          'Solo puede proporcionar componenteProductoId O componenteVarianteId, no ambos',
        );
      }

      // Validar que el componente existe
      if (dto.componenteProductoId) {
        const producto = await this.prisma.producto.findFirst({
          where: {
            id: dto.componenteProductoId,
            empresaId,
            deletedAt: null,
          },
        });
        if (!producto) {
          throw new NotFoundException('Producto componente no encontrado');
        }

        // Validar que el producto componente no sea un combo (evitar recursión)
        if (producto.esCombo) {
          throw new BadRequestException(
            'Los combos no pueden contener otros combos como componentes. ' +
            'Solo se permiten productos simples o variantes.',
          );
        }

        // Validar que si el producto tiene variantes, se debe agregar la variante específica
        if (producto.tieneVariantes) {
          throw new BadRequestException(
            'Este producto tiene variantes. Debes agregar la variante específica como componente, ' +
            'no el producto general. Ve a la sección de variantes y selecciona la que deseas agregar.',
          );
        }
      }

      if (dto.componenteVarianteId) {
        const variante = await this.prisma.productoVariante.findFirst({
          where: {
            id: dto.componenteVarianteId,
            empresaId,
            deletedAt: null,
          },
        });
        if (!variante) {
          throw new NotFoundException('Variante componente no encontrada');
        }
      }

      // Verificar que no exista ya este componente en el combo
      const existente = await this.prisma.productoCombo.findFirst({
        where: {
          comboId,
          ...(dto.componenteProductoId && { componenteProductoId: dto.componenteProductoId }),
          ...(dto.componenteVarianteId && { componenteVarianteId: dto.componenteVarianteId }),
        },
      });

      if (existente) {
        throw new BadRequestException('Este componente ya existe en el combo');
      }

      // Crear el componente del combo
      const componente = await this.prisma.productoCombo.create({
        data: {
          comboId,
          componenteProductoId: dto.componenteProductoId,
          componenteVarianteId: dto.componenteVarianteId,
          cantidad: dto.cantidad,
          esPersonalizable: dto.esPersonalizable ?? false,
          categoriaComponente: dto.categoriaComponente,
          orden: dto.orden ?? 0,
        },
        include: {
          componenteProducto: {
            include: {
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
          componenteVariante: {
            include: {
              producto: true,
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
        },
      });

      this.logger.log(`Componente agregado al combo ${comboId}`);
      return this.mapToResponseDto(componente, sedeId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al agregar componente al combo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Agrega múltiples componentes a un combo en una sola operación (batch)
   * @param sedeId - Requerido para obtener precios y stock de la sede
   */
  async agregarComponentesBatch(
    comboId: string,
    empresaId: string,
    sedeId: string,
    componentes: CreateComponenteComboDto[],
  ): Promise<ProductoComboResponseDto[]> {
    try {
      // Validar que el combo existe y pertenece a la empresa
      const combo = await this.prisma.producto.findFirst({
        where: {
          id: comboId,
          empresaId,
          esCombo: true,
          deletedAt: null,
        },
      });

      if (!combo) {
        throw new NotFoundException('Combo no encontrado');
      }

      if (!componentes || componentes.length === 0) {
        throw new BadRequestException('Debe proporcionar al menos un componente');
      }

      // Validar todos los componentes antes de insertar
      const componentesValidados: CreateComponenteComboDto[] = [];

      for (const dto of componentes) {
        // Validar que se proporcione al menos un componente (producto o variante)
        if (!dto.componenteProductoId && !dto.componenteVarianteId) {
          throw new BadRequestException(
            'Cada componente debe tener componenteProductoId o componenteVarianteId',
          );
        }

        // Validar que no se proporcionen ambos
        if (dto.componenteProductoId && dto.componenteVarianteId) {
          throw new BadRequestException(
            'Solo puede proporcionar componenteProductoId O componenteVarianteId, no ambos',
          );
        }

        // Validar que el componente existe
        if (dto.componenteProductoId) {
          const producto = await this.prisma.producto.findFirst({
            where: {
              id: dto.componenteProductoId,
              empresaId,
              deletedAt: null,
            },
          });
          if (!producto) {
            throw new NotFoundException(`Producto componente no encontrado: ${dto.componenteProductoId}`);
          }

          // Validar que el producto componente no sea un combo (evitar recursión)
          if (producto.esCombo) {
            throw new BadRequestException(
              `El producto "${producto.nombre}" es un combo. Los combos no pueden contener otros combos.`,
            );
          }

          // Validar que si el producto tiene variantes, se debe agregar la variante específica
          if (producto.tieneVariantes) {
            throw new BadRequestException(
              `El producto "${producto.nombre}" tiene variantes. Debes agregar la variante específica como componente.`,
            );
          }
        }

        if (dto.componenteVarianteId) {
          const variante = await this.prisma.productoVariante.findFirst({
            where: {
              id: dto.componenteVarianteId,
              empresaId,
              deletedAt: null,
            },
          });
          if (!variante) {
            throw new NotFoundException(`Variante componente no encontrada: ${dto.componenteVarianteId}`);
          }
        }

        // Verificar que no exista ya este componente en el combo
        const existente = await this.prisma.productoCombo.findFirst({
          where: {
            comboId,
            ...(dto.componenteProductoId && { componenteProductoId: dto.componenteProductoId }),
            ...(dto.componenteVarianteId && { componenteVarianteId: dto.componenteVarianteId }),
          },
        });

        if (existente) {
          throw new BadRequestException(
            `Ya existe un componente con el mismo producto/variante en este combo`,
          );
        }

        componentesValidados.push(dto);
      }

      // Insertar todos los componentes en batch
      const componentesCreados = await Promise.all(
        componentesValidados.map(async (dto) => {
          const componente = await this.prisma.productoCombo.create({
            data: {
              comboId,
              componenteProductoId: dto.componenteProductoId,
              componenteVarianteId: dto.componenteVarianteId,
              cantidad: dto.cantidad,
              esPersonalizable: dto.esPersonalizable ?? false,
              categoriaComponente: dto.categoriaComponente,
              orden: dto.orden ?? 0,
            },
            include: {
              componenteProducto: {
                include: {
                  stocksPorSede: {
                    where: { sedeId },
                  },
                },
              },
              componenteVariante: {
                include: {
                  producto: true,
                  stocksPorSede: {
                    where: { sedeId },
                  },
                },
              },
            },
          });
          return componente;
        }),
      );

      this.logger.log(`${componentesCreados.length} componentes agregados al combo ${comboId} en batch`);
      return componentesCreados.map((c) => this.mapToResponseDto(c, sedeId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al agregar componentes en batch: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Obtiene todos los componentes de un combo
   * @param sedeId - Requerido para obtener precios y stock específicos de la sede
   */
  async getComponentesCombo(
    comboId: string,
    empresaId: string,
    sedeId: string,
  ): Promise<ProductoComboResponseDto[]> {
    try {
      // Validar que el combo existe
      const combo = await this.prisma.producto.findFirst({
        where: {
          id: comboId,
          empresaId,
          esCombo: true,
          deletedAt: null,
        },
      });

      if (!combo) {
        throw new NotFoundException('Combo no encontrado');
      }

      const componentes = await this.prisma.productoCombo.findMany({
        where: { comboId },
        include: {
          componenteProducto: {
            include: {
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
          componenteVariante: {
            include: {
              producto: true,
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
        },
        orderBy: { orden: 'asc' },
      });

      return componentes.map((c) => this.mapToResponseDto(c, sedeId));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al obtener componentes del combo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Obtiene información completa de un combo con cálculos
   * @param sedeId - Requerido para obtener precios específicos de la sede
   */
  async getComboCompleto(
    comboId: string,
    empresaId: string,
    sedeId: string,
  ): Promise<ComboCompletoResponseDto> {
    try {
      const combo = await this.prisma.producto.findFirst({
        where: {
          id: comboId,
          empresaId,
          esCombo: true,
          deletedAt: null,
        },
        include: {
          componentesCombo: {
            include: {
              componenteProducto: {
                include: {
                  stocksPorSede: {
                    where: { sedeId },
                  },
                },
              },
              componenteVariante: {
                include: {
                  producto: true,
                  stocksPorSede: {
                    where: { sedeId },
                  },
                },
              },
            },
            orderBy: { orden: 'asc' },
          },
          stocksPorSede: {
            where: { sedeId },
          },
        },
      });

      if (!combo) {
        throw new NotFoundException('Combo no encontrado');
      }

      const componentes = combo.componentesCombo.map((c) => this.mapToResponseDto(c, sedeId));
      const precioCalculado = await this.calcularPrecioCombo(comboId, sedeId);
      const stockDisponible = await this.getStockDisponibleCombo(comboId, sedeId);
      const componentesSinStock = await this.getComponentesSinStock(comboId, sedeId);

      // Obtener precio del combo desde ProductoStock
      const stockCombo = combo.stocksPorSede[0];
      const precioCombo = stockCombo?.precio ? Number(stockCombo.precio) : 0;

      return {
        id: combo.id,
        nombre: combo.nombre,
        descripcion: combo.descripcion,
        esCombo: combo.esCombo,
        tipoPrecioCombo: combo.tipoPrecioCombo || TipoPrecioCombo.CALCULADO,
        precio: precioCombo,
        precioCalculado,
        descuentoPorcentaje: combo.descuentoMaximo ? Number(combo.descuentoMaximo) : null,
        descuentoAplicado:
          combo.tipoPrecioCombo === TipoPrecioCombo.FIJO
            ? precioCalculado - precioCombo
            : null,
        stockDisponible,
        componentes,
        tieneStockSuficiente: stockDisponible > 0,
        componentesSinStock: componentesSinStock.length > 0 ? componentesSinStock : undefined,
        imagen: null, // TODO: Agregar lógica para obtener la primera imagen si existe
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al obtener combo completo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Obtiene todos los combos de una empresa con información completa
   * @param sedeId - Requerido para obtener precios y stock específicos de la sede
   */
  async getAllCombos(empresaId: string, sedeId: string): Promise<ComboCompletoResponseDto[]> {
    try {
      const combos = await this.prisma.producto.findMany({
        where: {
          empresaId,
          esCombo: true,
          isActive: true,
          deletedAt: null,
        },
        include: {
          componentesCombo: {
            include: {
              componenteProducto: {
                include: {
                  stocksPorSede: {
                    where: { sedeId },
                  },
                },
              },
              componenteVariante: {
                include: {
                  producto: true,
                  stocksPorSede: {
                    where: { sedeId },
                  },
                },
              },
            },
            orderBy: { orden: 'asc' },
          },
          stocksPorSede: {
            where: { sedeId },
          },
        },
        orderBy: { creadoEn: 'desc' },
      });

      // Mapear cada combo con sus cálculos
      const combosCompletos = await Promise.all(
        combos.map(async (combo: any) => {
          const componentes = combo.componentesCombo.map((c: any) => this.mapToResponseDto(c, sedeId));
          const precioCalculado = await this.calcularPrecioCombo(combo.id, sedeId);
          const stockDisponible = await this.getStockDisponibleCombo(combo.id, sedeId);
          const componentesSinStock = await this.getComponentesSinStock(combo.id, sedeId);

          // Obtener precio del combo desde ProductoStock
          const stockCombo = combo.stocksPorSede[0];
          const precioCombo = stockCombo?.precio ? Number(stockCombo.precio) : 0;

          return {
            id: combo.id,
            nombre: combo.nombre,
            descripcion: combo.descripcion,
            esCombo: combo.esCombo,
            tipoPrecioCombo: combo.tipoPrecioCombo || TipoPrecioCombo.CALCULADO,
            precio: precioCombo,
            precioCalculado,
            descuentoPorcentaje: combo.descuentoMaximo ? Number(combo.descuentoMaximo) : null,
            descuentoAplicado:
              combo.tipoPrecioCombo === TipoPrecioCombo.FIJO
                ? precioCalculado - precioCombo
                : null,
            stockDisponible,
            componentes,
            tieneStockSuficiente: stockDisponible > 0,
            componentesSinStock: componentesSinStock.length > 0 ? componentesSinStock : undefined,
            imagen: null,
          };
        }),
      );

      return combosCompletos;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al obtener todos los combos: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Actualiza un componente del combo
   * @param sedeId - Requerido para obtener precios y stock de la sede
   */
  async actualizarComponente(
    componenteId: string,
    empresaId: string,
    sedeId: string,
    dto: UpdateComponenteComboDto,
  ): Promise<ProductoComboResponseDto> {
    try {
      const componente = await this.prisma.productoCombo.findFirst({
        where: { id: componenteId },
        include: {
          combo: true,
        },
      });

      if (!componente || componente.combo.empresaId !== empresaId) {
        throw new NotFoundException('Componente de combo no encontrado');
      }

      const actualizado = await this.prisma.productoCombo.update({
        where: { id: componenteId },
        data: {
          ...(dto.cantidad !== undefined && { cantidad: dto.cantidad }),
          ...(dto.esPersonalizable !== undefined && { esPersonalizable: dto.esPersonalizable }),
          ...(dto.categoriaComponente !== undefined && {
            categoriaComponente: dto.categoriaComponente,
          }),
          ...(dto.orden !== undefined && { orden: dto.orden }),
        },
        include: {
          componenteProducto: {
            include: {
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
          componenteVariante: {
            include: {
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
        },
      });

      this.logger.log(`Componente ${componenteId} actualizado`);
      return this.mapToResponseDto(actualizado, sedeId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al actualizar componente: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Elimina un componente del combo
   */
  async eliminarComponente(componenteId: string, empresaId: string): Promise<void> {
    try {
      const componente = await this.prisma.productoCombo.findFirst({
        where: { id: componenteId },
        include: { combo: true },
      });

      if (!componente || componente.combo.empresaId !== empresaId) {
        throw new NotFoundException('Componente de combo no encontrado');
      }

      await this.prisma.productoCombo.delete({
        where: { id: componenteId },
      });

      this.logger.log(`Componente ${componenteId} eliminado del combo`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al eliminar componente: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Valida si un combo tiene stock suficiente
   * @param sedeId - Requerido para verificar stock de la sede específica
   */
  async validarStockCombo(comboId: string, sedeId: string, cantidadRequerida: number = 1): Promise<boolean> {
    const stockDisponible = await this.getStockDisponibleCombo(comboId, sedeId);
    return stockDisponible >= cantidadRequerida;
  }

  /**
   * Calcula el stock disponible de un combo
   * Retorna la cantidad máxima de combos que se pueden armar con el stock actual
   * @param sedeId - Requerido para obtener stock de la sede específica
   */
  async getStockDisponibleCombo(comboId: string, sedeId: string): Promise<number> {
    try {
      const componentes = await this.prisma.productoCombo.findMany({
        where: { comboId },
        include: {
          componenteProducto: {
            include: {
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
          componenteVariante: {
            include: {
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
        },
      });

      if (componentes.length === 0) {
        return 0;
      }

      let stockMinimo = Infinity;

      for (const componente of componentes) {
        let stockComponente = 0;

        if (componente.componenteVariante) {
          const stock = componente.componenteVariante.stocksPorSede[0];
          stockComponente = stock?.stockActual || 0;
        } else if (componente.componenteProducto) {
          const stock = componente.componenteProducto.stocksPorSede[0];
          stockComponente = stock?.stockActual || 0;
        }

        // Calcular cuántos combos se pueden armar con el stock de este componente
        const maxCombos = Math.floor(stockComponente / componente.cantidad);
        stockMinimo = Math.min(stockMinimo, maxCombos);
      }

      return stockMinimo === Infinity ? 0 : stockMinimo;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al calcular stock de combo: ${errorMessage}`);
      return 0;
    }
  }

  /**
   * Calcula el precio de un combo según su tipo
   * @param sedeId - Requerido para obtener precios específicos de la sede
   */
  async calcularPrecioCombo(comboId: string, sedeId: string): Promise<number> {
    try {
      const combo = await this.prisma.producto.findUnique({
        where: { id: comboId },
        include: {
          componentesCombo: {
            include: {
              componenteProducto: {
                include: {
                  stocksPorSede: {
                    where: { sedeId },
                  },
                },
              },
              componenteVariante: {
                include: {
                  stocksPorSede: {
                    where: { sedeId },
                  },
                },
              },
            },
          },
          stocksPorSede: {
            where: { sedeId },
          },
        },
      });

      if (!combo) {
        throw new NotFoundException('Combo no encontrado');
      }

      // Si es precio fijo, retornar el precio definido en ProductoStock
      if (combo.tipoPrecioCombo === TipoPrecioCombo.FIJO) {
        const stockCombo = combo.stocksPorSede[0];
        return stockCombo?.precio ? Number(stockCombo.precio) : 0;
      }

      // Calcular suma de componentes desde ProductoStock
      let precioTotal = 0;

      for (const componente of combo.componentesCombo) {
        let precioComponente = 0;

        if (componente.componenteVariante) {
          const stock = componente.componenteVariante.stocksPorSede[0];
          precioComponente = stock?.precio ? Number(stock.precio) : 0;
        } else if (componente.componenteProducto) {
          const stock = componente.componenteProducto.stocksPorSede[0];
          precioComponente = stock?.precio ? Number(stock.precio) : 0;
        }

        precioTotal += precioComponente * componente.cantidad;
      }

      // Si es calculado con descuento, aplicar descuento
      if (combo.tipoPrecioCombo === TipoPrecioCombo.CALCULADO_CON_DESCUENTO) {
        const descuentoPorcentaje = Number(combo.descuentoMaximo || 0);
        precioTotal = precioTotal * (1 - descuentoPorcentaje / 100);
      }

      return precioTotal;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al calcular precio de combo: ${errorMessage}`);
      return 0;
    }
  }

  /**
   * Obtiene la lista de componentes sin stock suficiente
   * @param sedeId - Requerido para verificar stock de la sede específica
   */
  async getComponentesSinStock(comboId: string, sedeId: string): Promise<string[]> {
    try {
      const componentes = await this.prisma.productoCombo.findMany({
        where: { comboId },
        include: {
          componenteProducto: {
            include: {
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
          componenteVariante: {
            include: {
              stocksPorSede: {
                where: { sedeId },
              },
            },
          },
        },
      });

      const sinStock: string[] = [];

      for (const componente of componentes) {
        let stockComponente = 0;
        let nombre = '';

        if (componente.componenteVariante) {
          const stock = componente.componenteVariante.stocksPorSede[0];
          stockComponente = stock?.stockActual || 0;
          nombre = componente.componenteVariante.nombre;
        } else if (componente.componenteProducto) {
          const stock = componente.componenteProducto.stocksPorSede[0];
          stockComponente = stock?.stockActual || 0;
          nombre = componente.componenteProducto.nombre;
        }

        if (stockComponente < componente.cantidad) {
          sinStock.push(nombre);
        }
      }

      return sinStock;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al obtener componentes sin stock: ${errorMessage}`);
      return [];
    }
  }

  /**
   * Descuenta stock al vender un combo
   * Implementado con transacción para prevenir race conditions
   * @param sedeId - Requerido para descontar stock de la sede específica
   * @param usuarioId - Usuario responsable del movimiento de stock
   */
  async descontarStockCombo(
    comboId: string,
    sedeId: string,
    usuarioId: string,
    cantidad: number = 1,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Obtener componentes del combo con su stock en la sede
        const componentes = await tx.productoCombo.findMany({
          where: { comboId },
          include: {
            componenteProducto: {
              include: {
                stocksPorSede: {
                  where: { sedeId },
                },
              },
            },
            componenteVariante: {
              include: {
                stocksPorSede: {
                  where: { sedeId },
                },
              },
            },
          },
        });

        if (componentes.length === 0) {
          throw new BadRequestException('El combo no tiene componentes configurados');
        }

        // Calcular stock disponible y validar dentro de la transacción
        let stockDisponible = Number.MAX_SAFE_INTEGER;

        for (const componente of componentes) {
          let stockComponente = 0;

          if (componente.componenteVariante) {
            const stock = componente.componenteVariante.stocksPorSede[0];
            stockComponente = stock?.stockActual || 0;
          } else if (componente.componenteProducto) {
            const stock = componente.componenteProducto.stocksPorSede[0];
            stockComponente = stock?.stockActual || 0;
          }

          const combosDisponibles = Math.floor(stockComponente / componente.cantidad);
          stockDisponible = Math.min(stockDisponible, combosDisponibles);
        }

        // Validar stock disponible
        if (stockDisponible < cantidad) {
          throw new BadRequestException(
            `Stock insuficiente para este combo. Disponible: ${stockDisponible}, Solicitado: ${cantidad}`,
          );
        }

        // Descontar stock de cada componente usando ProductoStock
        for (const componente of componentes) {
          const cantidadDescontar = componente.cantidad * cantidad;

          if (componente.componenteVariante) {
            const stock = componente.componenteVariante.stocksPorSede[0];
            if (!stock) {
              throw new BadRequestException(
                `No se encontró stock para la variante ${componente.componenteVariante.nombre} en la sede`,
              );
            }

            const nuevoStock = stock.stockActual - cantidadDescontar;

            // Actualizar stock de la variante
            await tx.productoStock.update({
              where: { id: stock.id },
              data: {
                stockActual: nuevoStock,
              },
            });

            // Registrar movimiento de stock
            await tx.movimientoStock.create({
              data: {
                sedeId,
                empresaId: componente.componenteVariante.empresaId,
                productoStockId: stock.id,
                usuarioId,
                tipo: 'SALIDA_VENTA',
                tipoDocumento: 'VENTA_COMBO',
                cantidad: -cantidadDescontar, // Negativo para salidas
                cantidadAnterior: stock.stockActual,
                cantidadNueva: nuevoStock,
                motivo: `Venta de combo ${comboId}`,
              },
            });
          } else if (componente.componenteProducto) {
            const stock = componente.componenteProducto.stocksPorSede[0];
            if (!stock) {
              throw new BadRequestException(
                `No se encontró stock para el producto ${componente.componenteProducto.nombre} en la sede`,
              );
            }

            const nuevoStock = stock.stockActual - cantidadDescontar;

            // Actualizar stock del producto
            await tx.productoStock.update({
              where: { id: stock.id },
              data: {
                stockActual: nuevoStock,
              },
            });

            // Registrar movimiento de stock
            await tx.movimientoStock.create({
              data: {
                sedeId,
                empresaId: componente.componenteProducto.empresaId,
                productoStockId: stock.id,
                usuarioId,
                tipo: 'SALIDA_VENTA',
                tipoDocumento: 'VENTA_COMBO',
                cantidad: -cantidadDescontar, // Negativo para salidas
                cantidadAnterior: stock.stockActual,
                cantidadNueva: nuevoStock,
                motivo: `Venta de combo ${comboId}`,
              },
            });
          }
        }

        this.logger.log(`Stock descontado para ${cantidad} unidad(es) del combo ${comboId} en sede ${sedeId}`);
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al descontar stock de combo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Mapea un ProductoCombo a DTO de respuesta
   * @param sedeId - Requerido para obtener información de precio y stock de la sede
   */
  private mapToResponseDto(componente: any, sedeId: string): ProductoComboResponseDto {
    return {
      id: componente.id,
      comboId: componente.comboId,
      componenteProductoId: componente.componenteProductoId,
      componenteVarianteId: componente.componenteVarianteId,
      cantidad: componente.cantidad,
      esPersonalizable: componente.esPersonalizable,
      categoriaComponente: componente.categoriaComponente,
      orden: componente.orden,
      creadoEn: componente.creadoEn,
      actualizadoEn: componente.actualizadoEn,
      componenteInfo: this.getComponenteInfo(componente),
    };
  }

  /**
   * Extrae información del componente (producto o variante)
   * Obtiene precio y stock desde ProductoStock
   */
  private getComponenteInfo(componente: any) {
    if (componente.componenteVariante) {
      const variante = componente.componenteVariante;
      const producto = variante.producto;
      const stock = variante.stocksPorSede?.[0];

      return {
        id: variante.id,
        nombre: variante.nombre,
        sku: variante.sku,
        precio: stock?.precio ? Number(stock.precio) : 0,
        stock: stock?.stockActual || 0,
        esVariante: true,
        productoNombre: producto?.nombre, // Nombre del producto padre
        varianteNombre: variante.nombre,  // Nombre de la variante
      };
    } else if (componente.componenteProducto) {
      const stock = componente.componenteProducto.stocksPorSede?.[0];

      return {
        id: componente.componenteProducto.id,
        nombre: componente.componenteProducto.nombre,
        sku: componente.componenteProducto.sku,
        precio: stock?.precio ? Number(stock.precio) : 0,
        stock: stock?.stockActual || 0,
        esVariante: false,
      };
    }
    return undefined;
  }
}
