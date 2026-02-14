import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TipoPrecioCombo } from '@prisma/client';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CreateComponenteComboDto } from './dto/create-producto-combo.dto';
import { UpdateComponenteComboDto } from './dto/update-producto-combo.dto';
import { ProductoComboResponseDto, ComboCompletoResponseDto } from './dto/producto-combo-response.dto';
import { CreateComboDto } from './dto/create-combo.dto';

const Decimal = Prisma.Decimal;

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
        precio: 0, // Sin componentes aún, se calcula al agregar componentes
        precioCalculado: 0,
        precioRegularTotal: 0,
        stockDisponible: 0,
        descuentoPorcentaje: descuentoPorcentaje ? Number(descuentoPorcentaje) : null,
        descuentoAplicado: 0,
        componentes: [],
        tieneStockSuficiente: false,
        componentesSinStock: [],
        codigoEmpresa: combo.codigoEmpresa,
        codigoSistema: combo.codigoSistema,
        sku: combo.sku,
        isActive: combo.isActive,
        creadoEn: combo.creadoEn,
        categoria: (combo as any).empresaCategoria,
        marca: (combo as any).empresaMarca,
        sede: (combo as any).sede,
        imagen: null,
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

      // Crear el componente y ajustar reservaciones existentes dentro de transacción
      const componente = await this.prisma.$transaction(async (tx) => {
        const created = await tx.productoCombo.create({
          data: {
            comboId,
            componenteProductoId: dto.componenteProductoId,
            componenteVarianteId: dto.componenteVarianteId,
            cantidad: dto.cantidad,
            precioEnCombo: dto.precioEnCombo !== undefined && dto.precioEnCombo !== null
              ? new Decimal(dto.precioEnCombo)
              : null,
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

        // Si el combo tiene reservaciones activas, ajustar stockReservadoCombo del nuevo componente
        const reservaciones = await tx.comboReservacion.findMany({
          where: { comboId },
        });

        if (reservaciones.length > 0) {
          const targetId = dto.componenteVarianteId ?? dto.componenteProductoId!;
          const componenteConStocks = dto.componenteVarianteId
            ? await tx.productoVariante.findUnique({
                where: { id: targetId },
                include: { stocksPorSede: true },
              })
            : await tx.producto.findUnique({
                where: { id: targetId },
                include: { stocksPorSede: true },
              });

          const stocks = componenteConStocks?.stocksPorSede ?? [];
          const nombre = componenteConStocks?.nombre ?? 'Componente';

          for (const reservacion of reservaciones) {
            const stock = stocks.find((s: any) => s.sedeId === reservacion.sedeId);
            if (!stock) continue;

            const necesario = dto.cantidad * reservacion.cantidad;
            const disponible = this.getStockDisponibleReal(stock);

            if (disponible < necesario) {
              throw new BadRequestException(
                `Stock insuficiente de "${nombre}" en la sede para cubrir la reservación existente de ${reservacion.cantidad} combos. Disponible: ${disponible}, necesario: ${necesario}`,
              );
            }

            await tx.productoStock.update({
              where: { id: stock.id },
              data: { stockReservadoCombo: { increment: necesario } },
            });
          }
        }

        return created;
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

      // Limitar a 15 componentes por petición para evitar timeouts y optimizar rendimiento en SaaS
      const MAX_COMPONENTES_POR_PETICION = 15;
      if (componentes.length > MAX_COMPONENTES_POR_PETICION) {
        throw new BadRequestException(
          `Solo se pueden agregar máximo ${MAX_COMPONENTES_POR_PETICION} componentes por petición. ` +
          `Se recibieron ${componentes.length}. ` +
          `Por favor, divida la operación en múltiples peticiones.`,
        );
      }

      // Validar estructura de cada componente antes de consultar la DB
      for (const dto of componentes) {
        if (!dto.componenteProductoId && !dto.componenteVarianteId) {
          throw new BadRequestException(
            'Cada componente debe tener componenteProductoId o componenteVarianteId',
          );
        }
        if (dto.componenteProductoId && dto.componenteVarianteId) {
          throw new BadRequestException(
            'Solo puede proporcionar componenteProductoId O componenteVarianteId, no ambos',
          );
        }
      }

      // Recolectar IDs y hacer batch queries (evita N+1)
      const productoIds = componentes
        .filter((d) => d.componenteProductoId)
        .map((d) => d.componenteProductoId!);
      const varianteIds = componentes
        .filter((d) => d.componenteVarianteId)
        .map((d) => d.componenteVarianteId!);

      const [productosDb, variantesDb, existentes] = await Promise.all([
        productoIds.length > 0
          ? this.prisma.producto.findMany({
              where: { id: { in: productoIds }, empresaId, deletedAt: null },
            })
          : Promise.resolve([]),
        varianteIds.length > 0
          ? this.prisma.productoVariante.findMany({
              where: { id: { in: varianteIds }, empresaId, deletedAt: null },
            })
          : Promise.resolve([]),
        this.prisma.productoCombo.findMany({
          where: {
            comboId,
            OR: [
              ...(productoIds.length > 0
                ? [{ componenteProductoId: { in: productoIds } }]
                : []),
              ...(varianteIds.length > 0
                ? [{ componenteVarianteId: { in: varianteIds } }]
                : []),
            ],
          },
        }),
      ]);

      const productoMap = new Map(productosDb.map((p) => [p.id, p]));
      const varianteMap = new Map(variantesDb.map((v) => [v.id, v]));
      const existenteSet = new Set(
        existentes.map((e) => e.componenteProductoId ?? e.componenteVarianteId),
      );

      // Validar cada componente contra los datos ya cargados
      for (const dto of componentes) {
        if (dto.componenteProductoId) {
          const producto = productoMap.get(dto.componenteProductoId);
          if (!producto) {
            throw new NotFoundException(`Producto componente no encontrado: ${dto.componenteProductoId}`);
          }
          if (producto.esCombo) {
            throw new BadRequestException(
              `El producto "${producto.nombre}" es un combo. Los combos no pueden contener otros combos.`,
            );
          }
          if (producto.tieneVariantes) {
            throw new BadRequestException(
              `El producto "${producto.nombre}" tiene variantes. Debes agregar la variante específica como componente.`,
            );
          }
          if (existenteSet.has(dto.componenteProductoId)) {
            throw new BadRequestException(
              `Ya existe un componente con el mismo producto/variante en este combo`,
            );
          }
        }

        if (dto.componenteVarianteId) {
          if (!varianteMap.has(dto.componenteVarianteId)) {
            throw new NotFoundException(`Variante componente no encontrada: ${dto.componenteVarianteId}`);
          }
          if (existenteSet.has(dto.componenteVarianteId)) {
            throw new BadRequestException(
              `Ya existe un componente con el mismo producto/variante en este combo`,
            );
          }
        }
      }

      const componentesValidados = componentes;

      // Insertar todos los componentes en batch dentro de una transacción
      // Timeout aumentado a 15 segundos para soportar batches grandes
      const componentesCreados = await this.prisma.$transaction(async (tx) => {
        const creados = [];
        for (const dto of componentesValidados) {
          const componente = await tx.productoCombo.create({
            data: {
              comboId,
              componenteProductoId: dto.componenteProductoId,
              componenteVarianteId: dto.componenteVarianteId,
              cantidad: dto.cantidad,
              precioEnCombo: dto.precioEnCombo !== undefined && dto.precioEnCombo !== null
                ? new Decimal(dto.precioEnCombo)
                : null,
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
          creados.push(componente);
        }

        // Si el combo tiene reservaciones activas, ajustar stockReservadoCombo de los nuevos componentes
        const reservaciones = await tx.comboReservacion.findMany({
          where: { comboId },
        });

        if (reservaciones.length > 0) {
          // Batch: cargar stocks de todos los componentes nuevos en todas las sedes (evita N+1)
          const newProductoIds = componentesValidados
            .filter((d) => d.componenteProductoId)
            .map((d) => d.componenteProductoId!);
          const newVarianteIds = componentesValidados
            .filter((d) => d.componenteVarianteId)
            .map((d) => d.componenteVarianteId!);

          const allStocks = await tx.productoStock.findMany({
            where: {
              OR: [
                ...(newProductoIds.length > 0
                  ? [{ productoId: { in: newProductoIds }, varianteId: null }]
                  : []),
                ...(newVarianteIds.length > 0
                  ? [{ varianteId: { in: newVarianteIds } }]
                  : []),
              ],
            },
          });

          // Indexar por (productoId|varianteId, sedeId) para acceso O(1)
          const stockIndex = new Map<string, typeof allStocks[0]>();
          for (const s of allStocks) {
            const key = `${s.varianteId ?? s.productoId}:${s.sedeId}`;
            stockIndex.set(key, s);
          }

          for (const dto of componentesValidados) {
            const targetId = dto.componenteVarianteId ?? dto.componenteProductoId!;
            const nombre = dto.componenteVarianteId
              ? varianteMap.get(dto.componenteVarianteId)?.nombre ?? 'Componente'
              : productoMap.get(dto.componenteProductoId!)?.nombre ?? 'Componente';

            for (const reservacion of reservaciones) {
              const stock = stockIndex.get(`${targetId}:${reservacion.sedeId}`);
              if (!stock) continue;

              const necesario = dto.cantidad * reservacion.cantidad;
              const disponible = this.getStockDisponibleReal(stock);

              if (disponible < necesario) {
                throw new BadRequestException(
                  `Stock insuficiente de "${nombre}" en la sede para cubrir la reservación existente de ${reservacion.cantidad} combos. Disponible: ${disponible}, necesario: ${necesario}`,
                );
              }

              await tx.productoStock.update({
                where: { id: stock.id },
                data: { stockReservadoCombo: { increment: necesario } },
              });
            }
          }
        }

        return creados;
      }, {
        timeout: 20000, // 20 segundos (suficiente para máximo 15 componentes por petición)
      });

      this.logger.log(
        `✅ ${componentesCreados.length}/${MAX_COMPONENTES_POR_PETICION} componentes agregados al combo ${comboId}`,
      );
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
      const stockDisponible = this.calcularStockDisponibleFromComponentes(combo.componentesCombo);
      const componentesSinStock = this.getComponentesSinStockFromData(combo.componentesCombo);

      // Calcular precios desde los componentes ya cargados
      const { precioCalculado, precioRegularTotal } = this.calcularPreciosFromComponentes(combo.componentesCombo);

      // Aplicar descuento global si es CALCULADO_CON_DESCUENTO
      const descuentoPorcentaje = combo.descuentoMaximo ? Number(combo.descuentoMaximo) : null;
      let precioFinal = precioCalculado;
      if (combo.tipoPrecioCombo === TipoPrecioCombo.CALCULADO_CON_DESCUENTO && descuentoPorcentaje) {
        precioFinal = precioCalculado * (1 - descuentoPorcentaje / 100);
      }

      // Para FIJO, el precio viene de ProductoStock del combo (si existe)
      if (combo.tipoPrecioCombo === TipoPrecioCombo.FIJO) {
        const stockCombo = combo.stocksPorSede[0];
        precioFinal = stockCombo?.precio ? Number(stockCombo.precio) : precioFinal;
      }

      return {
        id: combo.id,
        nombre: combo.nombre,
        descripcion: combo.descripcion,
        esCombo: combo.esCombo,
        tipoPrecioCombo: combo.tipoPrecioCombo || TipoPrecioCombo.CALCULADO,
        precio: precioFinal,
        precioCalculado,
        precioRegularTotal,
        descuentoPorcentaje,
        descuentoAplicado: precioRegularTotal - precioFinal,
        stockDisponible,
        componentes,
        tieneStockSuficiente: stockDisponible > 0,
        componentesSinStock: componentesSinStock.length > 0 ? componentesSinStock : undefined,
        imagen: null,
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

      // Mapear cada combo con sus cálculos (sin queries adicionales, todo viene del include)
      const combosCompletos = combos.map((combo: any) => {
        const componentes = combo.componentesCombo.map((c: any) => this.mapToResponseDto(c, sedeId));
        const stockDisponible = this.calcularStockDisponibleFromComponentes(combo.componentesCombo);
        const componentesSinStock = this.getComponentesSinStockFromData(combo.componentesCombo);
        const { precioCalculado, precioRegularTotal } = this.calcularPreciosFromComponentes(combo.componentesCombo);

        const descuentoPorcentaje = combo.descuentoMaximo ? Number(combo.descuentoMaximo) : null;
        let precioFinal = precioCalculado;
        if (combo.tipoPrecioCombo === TipoPrecioCombo.CALCULADO_CON_DESCUENTO && descuentoPorcentaje) {
          precioFinal = precioCalculado * (1 - descuentoPorcentaje / 100);
        }
        if (combo.tipoPrecioCombo === TipoPrecioCombo.FIJO) {
          const stockCombo = combo.stocksPorSede[0];
          precioFinal = stockCombo?.precio ? Number(stockCombo.precio) : precioFinal;
        }

        return {
          id: combo.id,
          nombre: combo.nombre,
          descripcion: combo.descripcion,
          esCombo: combo.esCombo,
          tipoPrecioCombo: combo.tipoPrecioCombo || TipoPrecioCombo.CALCULADO,
          precio: precioFinal,
          precioCalculado,
          precioRegularTotal,
          descuentoPorcentaje,
          descuentoAplicado: precioRegularTotal - precioFinal,
          stockDisponible,
          componentes,
          tieneStockSuficiente: stockDisponible > 0,
          componentesSinStock: componentesSinStock.length > 0 ? componentesSinStock : undefined,
          imagen: null,
        };
      });

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

      const actualizado = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.productoCombo.update({
          where: { id: componenteId },
          data: {
            ...(dto.cantidad !== undefined && { cantidad: dto.cantidad }),
            ...(dto.precioEnCombo !== undefined && {
              precioEnCombo: dto.precioEnCombo !== null ? new Decimal(dto.precioEnCombo) : null,
            }),
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

        // Si se cambia la cantidad y hay reservaciones, ajustar stockReservadoCombo
        if (dto.cantidad !== undefined && dto.cantidad !== componente.cantidad) {
          const reservaciones = await tx.comboReservacion.findMany({
            where: { comboId: componente.comboId },
          });

          if (reservaciones.length > 0) {
            const delta = dto.cantidad - componente.cantidad;
            const targetId = componente.componenteVarianteId ?? componente.componenteProductoId!;
            const componenteConStocks = componente.componenteVarianteId
              ? await tx.productoVariante.findUnique({
                  where: { id: targetId },
                  include: { stocksPorSede: true },
                })
              : await tx.producto.findUnique({
                  where: { id: targetId },
                  include: { stocksPorSede: true },
                });

            const stocks = componenteConStocks?.stocksPorSede ?? [];

            for (const reservacion of reservaciones) {
              const stock = stocks.find((s: any) => s.sedeId === reservacion.sedeId);
              if (!stock) continue;

              const cantidadDelta = delta * reservacion.cantidad;

              if (delta > 0) {
                const disponible = this.getStockDisponibleReal(stock);
                if (disponible < cantidadDelta) {
                  throw new BadRequestException(
                    `Stock insuficiente para ajustar cantidad. Disponible: ${disponible}, necesario: ${cantidadDelta} adicionales`,
                  );
                }
              }

              await tx.productoStock.update({
                where: { id: stock.id },
                data: { stockReservadoCombo: { increment: cantidadDelta } },
              });
            }
          }
        }

        return updated;
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
      await this.prisma.$transaction(async (tx) => {
        const componente = await tx.productoCombo.findFirst({
          where: { id: componenteId },
          include: {
            combo: true,
            componenteProducto: { include: { stocksPorSede: true } },
            componenteVariante: { include: { stocksPorSede: true } },
          },
        });

        if (!componente || componente.combo.empresaId !== empresaId) {
          throw new NotFoundException('Componente de combo no encontrado');
        }

        // Si el combo tiene reservas activas, liberar stockReservadoCombo de este componente
        const reservaciones = await tx.comboReservacion.findMany({
          where: { comboId: componente.comboId },
        });

        if (reservaciones.length > 0) {
          const stocks = componente.componenteVariante
            ? componente.componenteVariante.stocksPorSede
            : componente.componenteProducto?.stocksPorSede ?? [];

          for (const reservacion of reservaciones) {
            const stock = stocks.find((s: any) => s.sedeId === reservacion.sedeId);
            if (stock) {
              const cantidadLiberar = componente.cantidad * reservacion.cantidad;
              await tx.productoStock.update({
                where: { id: stock.id },
                data: { stockReservadoCombo: { decrement: cantidadLiberar } },
              });
            }
          }
        }

        await tx.productoCombo.delete({
          where: { id: componenteId },
        });
      });

      this.logger.log(`Componente ${componenteId} eliminado del combo`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al eliminar componente: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Eliminar múltiples componentes de un combo en batch
   * Optimizado para eliminar varios componentes en una sola transacción
   */
  async eliminarComponentesBatch(componenteIds: string[], empresaId: string): Promise<void> {
    try {
      if (!componenteIds || componenteIds.length === 0) {
        throw new BadRequestException('Debe proporcionar al menos un componenteId');
      }

      // Limitar a 50 componentes por petición para evitar timeouts
      const MAX_COMPONENTES_POR_PETICION = 50;
      if (componenteIds.length > MAX_COMPONENTES_POR_PETICION) {
        throw new BadRequestException(
          `Solo se pueden eliminar máximo ${MAX_COMPONENTES_POR_PETICION} componentes por petición. ` +
          `Se recibieron ${componenteIds.length}.`,
        );
      }

      await this.prisma.$transaction(async (tx) => {
        // Buscar todos los componentes en una sola query
        const componentes = await tx.productoCombo.findMany({
          where: {
            id: { in: componenteIds },
          },
          include: {
            combo: true,
            componenteProducto: { include: { stocksPorSede: true } },
            componenteVariante: { include: { stocksPorSede: true } },
          },
        });

        // Validar que todos los componentes existen y pertenecen a la empresa
        if (componentes.length !== componenteIds.length) {
          throw new NotFoundException('Uno o más componentes no fueron encontrados');
        }

        for (const componente of componentes) {
          if (componente.combo.empresaId !== empresaId) {
            throw new NotFoundException('Uno o más componentes no pertenecen a esta empresa');
          }
        }

        // Agrupar componentes por comboId para buscar reservaciones eficientemente
        const comboIds = [...new Set(componentes.map(c => c.comboId))];
        const reservaciones = await tx.comboReservacion.findMany({
          where: { comboId: { in: comboIds } },
        });

        // Si hay reservaciones, liberar stockReservadoCombo de cada componente
        if (reservaciones.length > 0) {
          for (const componente of componentes) {
            const stocks = componente.componenteVariante
              ? componente.componenteVariante.stocksPorSede
              : componente.componenteProducto?.stocksPorSede ?? [];

            const reservacionesDelCombo = reservaciones.filter(r => r.comboId === componente.comboId);

            for (const reservacion of reservacionesDelCombo) {
              const stock = stocks.find((s: any) => s.sedeId === reservacion.sedeId);
              if (stock) {
                const cantidadLiberar = componente.cantidad * reservacion.cantidad;
                await tx.productoStock.update({
                  where: { id: stock.id },
                  data: { stockReservadoCombo: { decrement: cantidadLiberar } },
                });
              }
            }
          }
        }

        // Eliminar todos los componentes en una sola operación
        await tx.productoCombo.deleteMany({
          where: { id: { in: componenteIds } },
        });
      }, { timeout: 20000 }); // 20 segundos de timeout

      this.logger.log(`${componenteIds.length} componentes eliminados en batch`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al eliminar componentes en batch: ${errorMessage}`);
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
   * Calcula el stock disponible de un combo (endpoint individual).
   * Hace el query necesario y delega al método sincrono.
   */
  async getStockDisponibleCombo(comboId: string, sedeId: string): Promise<number> {
    const componentes = await this.prisma.productoCombo.findMany({
      where: { comboId },
      include: {
        componenteProducto: { include: { stocksPorSede: { where: { sedeId } } } },
        componenteVariante: { include: { producto: true, stocksPorSede: { where: { sedeId } } } },
      },
    });
    return this.calcularStockDisponibleFromComponentes(componentes);
  }

  /**
   * Calcula el precio de un combo según su tipo (endpoint individual).
   */
  async calcularPrecioCombo(comboId: string, sedeId: string): Promise<number> {
    const combo = await this.prisma.producto.findUnique({
      where: { id: comboId },
      include: {
        componentesCombo: {
          include: {
            componenteProducto: { include: { stocksPorSede: { where: { sedeId } } } },
            componenteVariante: { include: { producto: true, stocksPorSede: { where: { sedeId } } } },
          },
        },
        stocksPorSede: { where: { sedeId } },
      },
    });

    if (!combo) throw new NotFoundException('Combo no encontrado');

    const { precioCalculado } = this.calcularPreciosFromComponentes(combo.componentesCombo);

    if (combo.tipoPrecioCombo === TipoPrecioCombo.FIJO) {
      const stockCombo = combo.stocksPorSede[0];
      return stockCombo?.precio ? Number(stockCombo.precio) : precioCalculado;
    }

    if (combo.tipoPrecioCombo === TipoPrecioCombo.CALCULADO_CON_DESCUENTO) {
      const descuento = Number(combo.descuentoMaximo || 0);
      return precioCalculado * (1 - descuento / 100);
    }

    return precioCalculado;
  }

  // =====================================================
  // MÉTODOS DE RESERVA DE STOCK PARA COMBOS
  // =====================================================

  /**
   * Obtiene la reservación actual de un combo en una sede.
   */
  async getReservacionCombo(comboId: string, sedeId: string): Promise<{ cantidad: number }> {
    const reservacion = await this.prisma.comboReservacion.findUnique({
      where: { comboId_sedeId: { comboId, sedeId } },
    });
    return { cantidad: reservacion?.cantidad ?? 0 };
  }

  /**
   * Reserva stock para un combo: incrementa stockReservadoCombo en cada componente.
   * Si ya existe reserva, actualiza la diferencia (solo el delta).
   * Usa SELECT FOR UPDATE para prevenir race conditions.
   * @param cantidad - Cantidad TOTAL de combos a reservar (no delta)
   */
  async reservarStockCombo(
    comboId: string,
    sedeId: string,
    cantidad: number,
    usuarioId: string,
  ): Promise<{ cantidad: number }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Obtener reservación actual
        const reservacionActual = await tx.comboReservacion.findUnique({
          where: { comboId_sedeId: { comboId, sedeId } },
        });
        const cantidadActual = reservacionActual?.cantidad ?? 0;
        const delta = cantidad - cantidadActual;

        if (delta === 0) return { cantidad: cantidadActual };

        // Obtener componentes con stock
        const componentes = await tx.productoCombo.findMany({
          where: { comboId },
          include: {
            componenteProducto: { include: { stocksPorSede: { where: { sedeId } } } },
            componenteVariante: { include: { stocksPorSede: { where: { sedeId } } } },
          },
        });

        if (componentes.length === 0) {
          throw new BadRequestException('El combo no tiene componentes configurados');
        }

        // Recolectar IDs de stock de todos los componentes
        const stockIds: string[] = [];
        for (const componente of componentes) {
          const stock = componente.componenteVariante
            ? componente.componenteVariante.stocksPorSede[0]
            : componente.componenteProducto?.stocksPorSede[0];
          if (stock) stockIds.push(stock.id);
        }

        if (stockIds.length === 0) {
          throw new BadRequestException('No hay stock registrado para los componentes en esta sede');
        }

        // Bloquear TODAS las filas de stock con FOR UPDATE
        const stocksLocked = await tx.$queryRaw<
          Array<{
            id: string; stockActual: number; empresaId: string;
            stockReservado: number; stockReservadoVenta: number;
            stockReservadoCombo: number; stockDanado: number; stockEnGarantia: number;
          }>
        >`SELECT id, "stockActual", "empresaId", "stockReservado", "stockReservadoVenta",
                 "stockReservadoCombo", "stockDanado", "stockEnGarantia"
          FROM "ProductoStock"
          WHERE id = ANY(${stockIds}::text[])
          ORDER BY id
          FOR UPDATE`;

        const stockMap = new Map(stocksLocked.map((s) => [s.id, s]));

        // Si se incrementa la reserva, validar stock disponible con valores bloqueados
        if (delta > 0) {
          for (const componente of componentes) {
            const stockRef = componente.componenteVariante
              ? componente.componenteVariante.stocksPorSede[0]
              : componente.componenteProducto?.stocksPorSede[0];

            if (!stockRef) {
              const nombre = componente.componenteVariante?.nombre ?? componente.componenteProducto?.nombre ?? 'Componente';
              throw new BadRequestException(`No hay stock de "${nombre}" en esta sede`);
            }

            const locked = stockMap.get(stockRef.id);
            if (!locked) {
              const nombre = componente.componenteVariante?.nombre ?? componente.componenteProducto?.nombre ?? 'Componente';
              throw new BadRequestException(`No hay stock de "${nombre}" en esta sede`);
            }

            const disponible = locked.stockActual - locked.stockReservado - locked.stockReservadoVenta - (locked.stockReservadoCombo || 0) - locked.stockDanado - locked.stockEnGarantia;
            const necesario = componente.cantidad * delta;

            if (disponible < necesario) {
              const nombre = componente.componenteVariante?.nombre ?? componente.componenteProducto?.nombre ?? 'Componente';
              throw new BadRequestException(
                `Stock insuficiente de "${nombre}". Disponible: ${Math.floor(disponible / componente.cantidad)}, necesitas reservar: ${delta} más`,
              );
            }
          }
        }

        // Aplicar delta en stockReservadoCombo de cada componente
        for (const componente of componentes) {
          const stockRef = componente.componenteVariante
            ? componente.componenteVariante.stocksPorSede[0]
            : componente.componenteProducto?.stocksPorSede[0];

          if (!stockRef) continue;

          const locked = stockMap.get(stockRef.id)!;
          const cantidadDelta = componente.cantidad * delta;

          await tx.productoStock.update({
            where: { id: stockRef.id },
            data: { stockReservadoCombo: { increment: cantidadDelta } },
          });

          // Registrar movimiento
          await tx.movimientoStock.create({
            data: {
              sedeId,
              empresaId: locked.empresaId,
              productoStockId: stockRef.id,
              usuarioId,
              tipo: delta > 0 ? 'RESERVA_COMBO' : 'LIBERAR_RESERVA_COMBO',
              tipoDocumento: 'RESERVA_COMBO',
              cantidad: cantidadDelta,
              cantidadAnterior: locked.stockActual,
              cantidadNueva: locked.stockActual,
              motivo: `Reserva de combo ${comboId}: ${cantidad} unidades`,
            },
          });
        }

        // Crear o actualizar ComboReservacion
        if (reservacionActual) {
          await tx.comboReservacion.update({
            where: { comboId_sedeId: { comboId, sedeId } },
            data: { cantidad },
          });
        } else {
          await tx.comboReservacion.create({
            data: { comboId, sedeId, cantidad },
          });
        }

        this.logger.log(`Reserva de combo ${comboId} actualizada a ${cantidad} en sede ${sedeId}`);
        return { cantidad };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error al reservar stock de combo: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Libera toda la reserva de un combo en una sede (cantidad = 0).
   */
  async liberarReservaCombo(
    comboId: string,
    sedeId: string,
    usuarioId: string,
  ): Promise<{ cantidad: number }> {
    return this.reservarStockCombo(comboId, sedeId, 0, usuarioId);
  }

  // =====================================================
  // MÉTODOS PRIVADOS DE CÁLCULO (sincrónos, operan sobre datos ya cargados)
  // =====================================================

  /**
   * Calcula stock disponible real de un componente desde su ProductoStock.
   * stockDisponible = stockActual - stockReservado - stockReservadoVenta - stockReservadoCombo - stockDanado - stockEnGarantia
   */
  private getStockDisponibleReal(stock: any): number {
    if (!stock) return 0;
    return stock.stockActual - stock.stockReservado - stock.stockReservadoVenta - (stock.stockReservadoCombo || 0) - stock.stockDanado - stock.stockEnGarantia;
  }

  /**
   * Calcula cuántos combos se pueden armar con los componentes dados.
   * Retorna el mínimo entre los máximos de cada componente (cuello de botella).
   */
  private calcularStockDisponibleFromComponentes(componentes: any[]): number {
    if (componentes.length === 0) return 0;

    let stockMinimo = Infinity;
    for (const componente of componentes) {
      const stock = componente.componenteVariante
        ? componente.componenteVariante.stocksPorSede?.[0]
        : componente.componenteProducto?.stocksPorSede?.[0];

      const disponible = this.getStockDisponibleReal(stock);
      const maxCombos = Math.floor(disponible / componente.cantidad);
      stockMinimo = Math.min(stockMinimo, maxCombos);
    }

    return stockMinimo === Infinity ? 0 : Math.max(0, stockMinimo);
  }

  /**
   * Retorna nombres de componentes sin stock suficiente.
   */
  private getComponentesSinStockFromData(componentes: any[]): string[] {
    const sinStock: string[] = [];

    for (const componente of componentes) {
      const stock = componente.componenteVariante
        ? componente.componenteVariante.stocksPorSede?.[0]
        : componente.componenteProducto?.stocksPorSede?.[0];

      const disponible = this.getStockDisponibleReal(stock);
      if (disponible < componente.cantidad) {
        const nombre = componente.componenteVariante?.nombre ?? componente.componenteProducto?.nombre ?? 'Componente';
        sinStock.push(nombre);
      }
    }

    return sinStock;
  }

  /**
   * Calcula precios del combo desde los componentes.
   * - precioCalculado: suma de (precioEnCombo ?? precioRegular) * cantidad
   * - precioRegularTotal: suma de precioRegular * cantidad (sin overrides)
   */
  private calcularPreciosFromComponentes(componentes: any[]): { precioCalculado: number; precioRegularTotal: number } {
    let precioCalculado = 0;
    let precioRegularTotal = 0;

    for (const componente of componentes) {
      const stock = componente.componenteVariante
        ? componente.componenteVariante.stocksPorSede?.[0]
        : componente.componenteProducto?.stocksPorSede?.[0];

      const precioRegular = stock?.precio ? Number(stock.precio) : 0;
      const precioOverride = componente.precioEnCombo !== null && componente.precioEnCombo !== undefined
        ? Number(componente.precioEnCombo)
        : null;

      precioRegularTotal += precioRegular * componente.cantidad;
      precioCalculado += (precioOverride ?? precioRegular) * componente.cantidad;
    }

    return { precioCalculado, precioRegularTotal };
  }

  /**
   * Descuenta stock al vender un combo
   * Usa SELECT FOR UPDATE para bloquear filas de stock y prevenir race conditions
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
        // Obtener componentes del combo
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

        // Recolectar IDs de stock de todos los componentes
        const stockIds: string[] = [];
        for (const componente of componentes) {
          const stock = componente.componenteVariante
            ? componente.componenteVariante.stocksPorSede[0]
            : componente.componenteProducto?.stocksPorSede[0];
          if (stock) stockIds.push(stock.id);
        }

        if (stockIds.length === 0) {
          throw new BadRequestException('No hay stock registrado para los componentes en esta sede');
        }

        // Bloquear TODAS las filas de stock de los componentes con FOR UPDATE
        const stocksLocked = await tx.$queryRaw<
          Array<{
            id: string; stockActual: number; empresaId: string;
            stockReservado: number; stockReservadoVenta: number;
            stockReservadoCombo: number; stockDanado: number; stockEnGarantia: number;
          }>
        >`SELECT id, "stockActual", "empresaId", "stockReservado", "stockReservadoVenta",
                 "stockReservadoCombo", "stockDanado", "stockEnGarantia"
          FROM "ProductoStock"
          WHERE id = ANY(${stockIds}::text[])
          ORDER BY id
          FOR UPDATE`;

        const stockMap = new Map(stocksLocked.map((s) => [s.id, s]));

        // Validar stock disponible con valores bloqueados
        let stockDisponibleCombo = Number.MAX_SAFE_INTEGER;

        for (const componente of componentes) {
          const stockRef = componente.componenteVariante
            ? componente.componenteVariante.stocksPorSede[0]
            : componente.componenteProducto?.stocksPorSede[0];

          if (!stockRef) {
            const nombre = componente.componenteVariante?.nombre ?? componente.componenteProducto?.nombre ?? 'Componente';
            throw new BadRequestException(`No se encontró stock para ${nombre} en la sede`);
          }

          const locked = stockMap.get(stockRef.id);
          if (!locked) {
            const nombre = componente.componenteVariante?.nombre ?? componente.componenteProducto?.nombre ?? 'Componente';
            throw new BadRequestException(`No se encontró stock para ${nombre} en la sede`);
          }

          const disponible = locked.stockActual
            - locked.stockReservado
            - locked.stockReservadoVenta
            - (locked.stockReservadoCombo || 0)
            - locked.stockDanado
            - locked.stockEnGarantia;
          const combosDisponibles = Math.floor(disponible / componente.cantidad);
          stockDisponibleCombo = Math.min(stockDisponibleCombo, combosDisponibles);
        }

        if (stockDisponibleCombo < cantidad) {
          throw new BadRequestException(
            `Stock insuficiente para este combo. Disponible: ${stockDisponibleCombo}, Solicitado: ${cantidad}`,
          );
        }

        // Descontar stock de cada componente usando los valores bloqueados
        for (const componente of componentes) {
          const stockRef = componente.componenteVariante
            ? componente.componenteVariante.stocksPorSede[0]
            : componente.componenteProducto?.stocksPorSede[0];

          if (!stockRef) continue;

          const locked = stockMap.get(stockRef.id)!;
          const cantidadDescontar = componente.cantidad * cantidad;
          const nuevoStock = locked.stockActual - cantidadDescontar;

          await tx.productoStock.update({
            where: { id: stockRef.id },
            data: { stockActual: nuevoStock },
          });

          await tx.movimientoStock.create({
            data: {
              sedeId,
              empresaId: locked.empresaId,
              productoStockId: stockRef.id,
              usuarioId,
              tipo: 'SALIDA_VENTA',
              tipoDocumento: 'VENTA_COMBO',
              cantidad: -cantidadDescontar,
              cantidadAnterior: locked.stockActual,
              cantidadNueva: nuevoStock,
              motivo: `Venta de combo ${comboId}`,
            },
          });
        }

        // Decrementar stockReservadoCombo si hay reservación activa
        const reservacion = await tx.comboReservacion.findUnique({
          where: { comboId_sedeId: { comboId, sedeId } },
        });

        if (reservacion && reservacion.cantidad > 0) {
          const cantVentaContraReserva = Math.min(cantidad, reservacion.cantidad);
          const nuevaCantReserva = reservacion.cantidad - cantVentaContraReserva;

          for (const componente of componentes) {
            const stockRef = componente.componenteVariante
              ? componente.componenteVariante.stocksPorSede[0]
              : componente.componenteProducto?.stocksPorSede[0];

            if (!stockRef) continue;

            const cantidadLiberar = componente.cantidad * cantVentaContraReserva;
            await tx.productoStock.update({
              where: { id: stockRef.id },
              data: { stockReservadoCombo: { decrement: cantidadLiberar } },
            });
          }

          if (nuevaCantReserva === 0) {
            await tx.comboReservacion.delete({
              where: { comboId_sedeId: { comboId, sedeId } },
            });
          } else {
            await tx.comboReservacion.update({
              where: { comboId_sedeId: { comboId, sedeId } },
              data: { cantidad: nuevaCantReserva },
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
   */
  private mapToResponseDto(componente: any, sedeId: string): ProductoComboResponseDto {
    return {
      id: componente.id,
      comboId: componente.comboId,
      componenteProductoId: componente.componenteProductoId,
      componenteVarianteId: componente.componenteVarianteId,
      cantidad: componente.cantidad,
      precioEnCombo: componente.precioEnCombo !== null && componente.precioEnCombo !== undefined
        ? Number(componente.precioEnCombo)
        : undefined,
      esPersonalizable: componente.esPersonalizable,
      categoriaComponente: componente.categoriaComponente,
      orden: componente.orden,
      creadoEn: componente.creadoEn,
      actualizadoEn: componente.actualizadoEn,
      componenteInfo: this.getComponenteInfo(componente),
    };
  }

  /**
   * Extrae información del componente (producto o variante).
   * Retorna precio regular (desde ProductoStock), precioEnCombo (override), y stock disponible real.
   */
  private getComponenteInfo(componente: any) {
    const precioEnCombo = componente.precioEnCombo !== null && componente.precioEnCombo !== undefined
      ? Number(componente.precioEnCombo)
      : undefined;

    if (componente.componenteVariante) {
      const variante = componente.componenteVariante;
      const producto = variante.producto;
      const stock = variante.stocksPorSede?.[0];

      return {
        id: variante.id,
        nombre: variante.nombre,
        sku: variante.sku,
        precio: stock?.precio ? Number(stock.precio) : 0,
        precioEnCombo,
        stock: this.getStockDisponibleReal(stock),
        esVariante: true,
        productoNombre: producto?.nombre,
        varianteNombre: variante.nombre,
      };
    } else if (componente.componenteProducto) {
      const stock = componente.componenteProducto.stocksPorSede?.[0];

      return {
        id: componente.componenteProducto.id,
        nombre: componente.componenteProducto.nombre,
        sku: componente.componenteProducto.sku,
        precio: stock?.precio ? Number(stock.precio) : 0,
        precioEnCombo,
        stock: this.getStockDisponibleReal(stock),
        esVariante: false,
      };
    }
    return undefined;
  }
}
