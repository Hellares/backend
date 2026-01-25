import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CrearTransferenciaDto } from './dto/crear-transferencia.dto';
import { CrearTransferenciasMultiplesDto } from './dto/crear-transferencias-multiples.dto';
import { AprobarTransferenciaDto } from './dto/aprobar-transferencia.dto';
import { RecibirTransferenciaDto } from './dto/recibir-transferencia.dto';
import { ProcesarCompletoTransferenciaDto } from './dto/procesar-completo-transferencia.dto';
import { EstadoTransferencia, TipoMovimientoStock } from '@prisma/client';

@Injectable()
export class TransferenciaStockService {
  private readonly logger = new Logger(TransferenciaStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly codigosService: ConfiguracionCodigosService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Crea una nueva transferencia de stock entre sedes
   * Valida stock disponible en sede origen
   */
  async crear(
    empresaId: string,
    dto: CrearTransferenciaDto,
    usuarioId: string,
  ) {
    // Validaciones iniciales
    if (!dto.productoId && !dto.varianteId) {
      throw new BadRequestException(
        'Se requiere productoId o varianteId',
      );
    }

    if (dto.sedeOrigenId === dto.sedeDestinoId) {
      throw new BadRequestException(
        'La sede origen y destino no pueden ser la misma',
      );
    }

    // Verificar sedes existen
    const [sedeOrigen, sedeDestino] = await Promise.all([
      this.prisma.sede.findFirst({
        where: { id: dto.sedeOrigenId, empresaId, isActive: true },
      }),
      this.prisma.sede.findFirst({
        where: { id: dto.sedeDestinoId, empresaId, isActive: true },
      }),
    ]);

    if (!sedeOrigen) {
      throw new NotFoundException('Sede origen no encontrada');
    }
    if (!sedeDestino) {
      throw new NotFoundException('Sede destino no encontrada');
    }

    // Verificar stock disponible en sede origen
    const stockOrigen = await this.prisma.productoStock.findFirst({
      where: {
        sedeId: dto.sedeOrigenId,
        productoId: dto.productoId || null,
        varianteId: dto.varianteId || null,
      },
      include: {
        producto: true,
        variante: true,
      },
    });

    if (!stockOrigen) {
      throw new NotFoundException(
        'No hay stock registrado del producto en la sede origen',
      );
    }

    // Validar que el producto o variante esté activo
    if (stockOrigen.producto && !stockOrigen.producto.isActive) {
      throw new BadRequestException(
        'No se puede transferir un producto inactivo',
      );
    }

    if (stockOrigen.variante && !stockOrigen.variante.isActive) {
      throw new BadRequestException(
        'No se puede transferir una variante inactiva',
      );
    }

    // Verificar stock disponible (stock físico - stock reservado)
    const stockDisponible = stockOrigen.stockActual - stockOrigen.stockReservado;
    if (stockDisponible < dto.cantidad) {
      throw new BadRequestException(
        `Stock disponible insuficiente en sede origen. Disponible: ${stockDisponible}, Solicitado: ${dto.cantidad}`,
      );
    }

    // Crear transferencia con retry para manejar race conditions
    const maxRetries = 3;
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Crear transferencia dentro de una transacción
        const transferencia = await this.prisma.$transaction(async (tx) => {
          // Generar código único dentro de la transacción
          const codigo = await this.codigosService.generarCodigoTransferencia(
            empresaId,
            tx,
          );

          // Crear transferencia con un solo item
          return await tx.transferenciaStock.create({
            data: {
              empresaId,
              sedeOrigenId: dto.sedeOrigenId,
              sedeDestinoId: dto.sedeDestinoId,
              codigo,
              motivo: dto.motivo,
              observaciones: dto.observaciones,
              solicitadoPor: usuarioId,
              estado: EstadoTransferencia.PENDIENTE,
              totalItems: 1,
              itemsAprobados: 0,
              itemsRechazados: 0,
              itemsRecibidos: 0,
              // Crear un item de transferencia
              items: {
                create: {
                  empresaId,
                  productoId: dto.productoId,
                  varianteId: dto.varianteId,
                  cantidadSolicitada: dto.cantidad,
                },
              },
            },
            include: {
              sedeOrigen: true,
              sedeDestino: true,
              empresa: true,
              items: {
                include: {
                  producto: true,
                  variante: true,
                },
              },
            },
          });
        });

        this.logger.log(
          `Transferencia creada: ${transferencia.codigo} | ${stockOrigen.producto?.nombre || stockOrigen.variante?.nombre} | ${dto.cantidad} unidades | ${sedeOrigen.nombre} → ${sedeDestino.nombre}`,
        );

        // Invalidar cache de productos
        await this.invalidateStockCache(empresaId);

        return transferencia;
      } catch (error) {
        lastError = error;

        // Si es error de restricción única y no es el último intento, reintentar
        if (
          error.code === 'P2002' &&
          error.meta?.target?.includes('codigo') &&
          attempt < maxRetries
        ) {
          this.logger.warn(
            `Conflicto al crear transferencia (código duplicado), reintentando (${attempt}/${maxRetries})...`,
          );
          // Pequeño delay aleatorio antes de reintentar (10-50ms)
          await new Promise((resolve) =>
            setTimeout(resolve, 10 + Math.random() * 40),
          );
          continue;
        }

        // Si es otro tipo de error o ya se agotaron los intentos, lanzar el error
        throw error;
      }
    }

    // Si llegamos aquí, se agotaron los reintentos
    this.logger.error(
      `Error al crear transferencia después de ${maxRetries} intentos`,
    );
    throw lastError;
  }

  /**
   * Crea múltiples transferencias en una sola operación
   * Genera UNA transferencia con múltiples items
   */
  async crearMultiples(
    empresaId: string,
    dto: CrearTransferenciasMultiplesDto,
    usuarioId: string,
  ) {
    // Validaciones iniciales
    if (dto.sedeOrigenId === dto.sedeDestinoId) {
      throw new BadRequestException(
        'La sede origen y destino no pueden ser la misma',
      );
    }

    // Verificar que cada producto tenga productoId o varianteId
    for (const [index, item] of dto.productos.entries()) {
      if (!item.productoId && !item.varianteId) {
        throw new BadRequestException(
          `Producto ${index + 1}: Se requiere productoId o varianteId`,
        );
      }
    }

    // Verificar sedes existen
    const [sedeOrigen, sedeDestino] = await Promise.all([
      this.prisma.sede.findFirst({
        where: { id: dto.sedeOrigenId, empresaId, isActive: true },
      }),
      this.prisma.sede.findFirst({
        where: { id: dto.sedeDestinoId, empresaId, isActive: true },
      }),
    ]);

    if (!sedeOrigen) {
      throw new NotFoundException('Sede origen no encontrada');
    }
    if (!sedeDestino) {
      throw new NotFoundException('Sede destino no encontrada');
    }

    // Validar stock disponible para TODOS los productos antes de crear la transferencia
    const stockValidations = await Promise.all(
      dto.productos.map(async (item, index) => {
        const stockOrigen = await this.prisma.productoStock.findFirst({
          where: {
            sedeId: dto.sedeOrigenId,
            productoId: item.productoId || null,
            varianteId: item.varianteId || null,
          },
          include: {
            producto: true,
            variante: true,
          },
        });

        if (!stockOrigen) {
          return {
            valid: false,
            index,
            error: 'No hay stock registrado en la sede origen',
            nombre: 'Producto desconocido',
          };
        }

        // Validar que el producto o variante esté activo
        if (stockOrigen.producto && !stockOrigen.producto.isActive) {
          return {
            valid: false,
            index,
            error: 'Producto inactivo',
            nombre: stockOrigen.producto.nombre,
          };
        }

        if (stockOrigen.variante && !stockOrigen.variante.isActive) {
          return {
            valid: false,
            index,
            error: 'Variante inactiva',
            nombre: stockOrigen.variante.nombre,
          };
        }

        // Verificar stock disponible (stock físico - stock reservado)
        const stockDisponible = stockOrigen.stockActual - stockOrigen.stockReservado;
        if (stockDisponible < item.cantidad) {
          return {
            valid: false,
            index,
            error: `Stock disponible insuficiente. Disponible: ${stockDisponible}, Solicitado: ${item.cantidad}`,
            nombre: stockOrigen.producto?.nombre || stockOrigen.variante?.nombre,
          };
        }

        return {
          valid: true,
          index,
          stockOrigen,
          nombre: stockOrigen.producto?.nombre || stockOrigen.variante?.nombre,
        };
      }),
    );

    // Verificar si hay errores de validación
    const errores = stockValidations.filter((v) => !v.valid);
    if (errores.length > 0) {
      const mensajesError = errores
        .map((e) => `Producto ${e.index + 1} (${e.nombre}): ${e.error}`)
        .join('; ');
      throw new BadRequestException(
        `Errores de validación: ${mensajesError}`,
      );
    }

    // Generar código único para la transferencia
    const codigo = await this.codigosService.generarCodigoTransferencia(
      empresaId,
      this.prisma,
    );

    // Crear UNA transferencia con múltiples items
    const transferencia = await this.prisma.transferenciaStock.create({
      data: {
        empresaId,
        sedeOrigenId: dto.sedeOrigenId,
        sedeDestinoId: dto.sedeDestinoId,
        codigo,
        solicitadoPor: usuarioId,
        motivo: dto.motivoGeneral,
        observaciones: dto.observaciones,
        totalItems: dto.productos.length,
        itemsAprobados: 0,
        itemsRechazados: 0,
        itemsRecibidos: 0,
        // Crear los items de la transferencia
        items: {
          create: dto.productos.map((item) => ({
            empresaId,
            productoId: item.productoId,
            varianteId: item.varianteId,
            cantidadSolicitada: item.cantidad,
            motivo: item.motivo, // Motivo específico del item (opcional)
          })),
        },
      },
      include: {
        sedeOrigen: true,
        sedeDestino: true,
        items: {
          include: {
            producto: true,
            variante: true,
          },
        },
      },
    });

    // Log
    this.logger.log(
      `Transferencia múltiple creada: ${transferencia.codigo} con ${transferencia.totalItems} items | ${sedeOrigen.nombre} → ${sedeDestino.nombre}`,
    );

    // Invalidar cache de productos
    await this.invalidateStockCache(empresaId);

    return {
      transferencia,
      mensaje: `Transferencia creada con ${transferencia.totalItems} productos`,
    };
  }

  /**
   * Aprueba una transferencia pendiente
   */
  async aprobar(
    transferenciaId: string,
    empresaId: string,
    usuarioId: string,
    dto?: AprobarTransferenciaDto,
  ) {
    const transferencia = await this.prisma.transferenciaStock.findFirst({
      where: {
        id: transferenciaId,
        empresaId,
      },
      include: {
        sedeOrigen: true,
        sedeDestino: true,
        items: {
          include: {
            producto: true,
            variante: true,
          },
        },
      },
    });

    if (!transferencia) {
      throw new NotFoundException('Transferencia no encontrada');
    }

    if (transferencia.estado !== EstadoTransferencia.PENDIENTE) {
      throw new BadRequestException(
        `Solo se pueden aprobar transferencias en estado PENDIENTE. Estado actual: ${transferencia.estado}`,
      );
    }

    // Verificar stock DISPONIBLE (stockActual - stockReservado) para todos los items
    for (const item of transferencia.items) {
      const stockOrigen = await this.prisma.productoStock.findFirst({
        where: {
          sedeId: transferencia.sedeOrigenId,
          productoId: item.productoId || null,
          varianteId: item.varianteId || null,
        },
      });

      if (!stockOrigen) {
        const nombreProducto = item.producto?.nombre || item.variante?.nombre;
        throw new BadRequestException(
          `No hay stock registrado para ${nombreProducto} en la sede origen`,
        );
      }

      const stockDisponible = stockOrigen.stockActual - stockOrigen.stockReservado;
      if (stockDisponible < item.cantidadSolicitada) {
        const nombreProducto = item.producto?.nombre || item.variante?.nombre;
        throw new BadRequestException(
          `Stock disponible insuficiente para ${nombreProducto}. Disponible: ${stockDisponible}, Solicitado: ${item.cantidadSolicitada}`,
        );
      }
    }

    // Aprobar la transferencia y RESERVAR el stock
    const actualizado = await this.prisma.$transaction(async (tx) => {
      // Aprobar todos los items y reservar stock
      for (const item of transferencia.items) {
        // Marcar item como aprobado
        await tx.transferenciaStockItem.update({
          where: { id: item.id },
          data: {
            estado: 'APROBADO',
            cantidadAprobada: item.cantidadSolicitada,
          },
        });

        // RESERVAR stock en sede origen (incrementar stockReservado)
        await tx.productoStock.updateMany({
          where: {
            sedeId: transferencia.sedeOrigenId,
            productoId: item.productoId || null,
            varianteId: item.varianteId || null,
          },
          data: {
            stockReservado: { increment: item.cantidadSolicitada },
          },
        });
      }

      // Actualizar transferencia
      return await tx.transferenciaStock.update({
        where: { id: transferenciaId },
        data: {
          estado: EstadoTransferencia.APROBADA,
          aprobadoPor: usuarioId,
          fechaAprobacion: new Date(),
          observaciones: dto?.observaciones || transferencia.observaciones,
          itemsAprobados: transferencia.totalItems,
        },
        include: {
          sedeOrigen: true,
          sedeDestino: true,
          items: {
            include: {
              producto: true,
              variante: true,
            },
          },
        },
      });
    });

    this.logger.log(`Transferencia aprobada: ${transferencia.codigo} con ${transferencia.totalItems} items`);

    // Invalidar cache de productos (para reflejar cambios en estado)
    await this.invalidateStockCache(empresaId);

    return actualizado;
  }

  /**
   * Marca una transferencia como en tránsito y descuenta stock de origen
   */
  async enviar(
    transferenciaId: string,
    empresaId: string,
    usuarioId: string,
  ) {
    const transferencia = await this.prisma.transferenciaStock.findFirst({
      where: {
        id: transferenciaId,
        empresaId,
      },
      include: {
        sedeOrigen: true,
        sedeDestino: true,
        items: {
          where: { estado: 'APROBADO' },
          include: {
            producto: true,
            variante: true,
          },
        },
      },
    });

    if (!transferencia) {
      throw new NotFoundException('Transferencia no encontrada');
    }

    if (transferencia.estado !== EstadoTransferencia.APROBADA) {
      throw new BadRequestException(
        `Solo se pueden enviar transferencias APROBADAS. Estado actual: ${transferencia.estado}`,
      );
    }

    if (transferencia.items.length === 0) {
      throw new BadRequestException(
        'No hay items aprobados para enviar',
      );
    }

    // Descontar stock físico y liberar reserva
    return await this.prisma.$transaction(async (tx) => {
      // Procesar cada item aprobado
      for (const item of transferencia.items) {
        // Obtener stock origen
        const stockOrigen = await tx.productoStock.findFirst({
          where: {
            sedeId: transferencia.sedeOrigenId,
            productoId: item.productoId || null,
            varianteId: item.varianteId || null,
          },
        });

        if (!stockOrigen) {
          const nombreProducto = item.producto?.nombre || item.variante?.nombre;
          throw new NotFoundException(`Stock origen no encontrado para ${nombreProducto}`);
        }

        const cantidadEnviar = item.cantidadAprobada || item.cantidadSolicitada;

        if (stockOrigen.stockActual < cantidadEnviar) {
          const nombreProducto = item.producto?.nombre || item.variante?.nombre;
          throw new BadRequestException(
            `Stock insuficiente para ${nombreProducto}. Disponible: ${stockOrigen.stockActual}, Requerido: ${cantidadEnviar}`,
          );
        }

        const nuevoStockActual = stockOrigen.stockActual - cantidadEnviar;
        const nuevoStockReservado = stockOrigen.stockReservado - cantidadEnviar;

        // Actualizar stock origen: descontar stockActual y decrementar stockReservado
        await tx.productoStock.update({
          where: { id: stockOrigen.id },
          data: {
            stockActual: nuevoStockActual,
            stockReservado: nuevoStockReservado,
          },
        });

        // Registrar movimiento de salida
        await tx.movimientoStock.create({
          data: {
            sedeId: transferencia.sedeOrigenId,
            empresaId,
            productoStockId: stockOrigen.id,
            tipo: TipoMovimientoStock.SALIDA_TRANSFERENCIA,
            tipoDocumento: 'TRANSFERENCIA',
            numeroDocumento: transferencia.codigo,
            cantidadAnterior: stockOrigen.stockActual,
            cantidad: -cantidadEnviar,
            cantidadNueva: nuevoStockActual,
            motivo: `Transferencia a ${transferencia.sedeDestino.nombre}`,
            observaciones: transferencia.observaciones,
            transferenciaId: transferencia.id,
            usuarioId,
          },
        });

        // Marcar item como enviado
        await tx.transferenciaStockItem.update({
          where: { id: item.id },
          data: {
            estado: 'ENVIADO',
            cantidadEnviada: cantidadEnviar,
          },
        });
      }

      // Actualizar transferencia
      const actualizada = await tx.transferenciaStock.update({
        where: { id: transferenciaId },
        data: {
          estado: EstadoTransferencia.EN_TRANSITO,
          fechaEnvio: new Date(),
        },
        include: {
          sedeOrigen: true,
          sedeDestino: true,
          items: {
            include: {
              producto: true,
              variante: true,
            },
          },
        },
      });

      this.logger.log(
        `Transferencia enviada: ${transferencia.codigo} con ${transferencia.items.length} items`,
      );
      await this.invalidateStockCache(empresaId);
      return actualizada;
    });

    // Invalidar cache de productos (stock modificado en sede origen)
    
  }

  /**
   * Recibe una transferencia en sede destino
   * Crea ProductoStock si no existe
   * Registra movimiento de entrada
   */
  async recibir(
    transferenciaId: string,
    empresaId: string,
    usuarioId: string,
    dto: RecibirTransferenciaDto,
  ) {
    const transferencia = await this.prisma.transferenciaStock.findFirst({
      where: {
        id: transferenciaId,
        empresaId,
      },
      include: {
        sedeOrigen: true,
        sedeDestino: true,
        items: {
          where: { estado: 'ENVIADO' },
          include: {
            producto: true,
            variante: true,
          },
        },
      },
    });

    if (!transferencia) {
      throw new NotFoundException('Transferencia no encontrada');
    }

    if (transferencia.estado !== EstadoTransferencia.EN_TRANSITO) {
      throw new BadRequestException(
        `Solo se pueden recibir transferencias EN_TRANSITO. Estado actual: ${transferencia.estado}`,
      );
    }

    if (transferencia.items.length === 0) {
      throw new BadRequestException(
        'No hay items enviados para recibir',
      );
    }

    // Recibir todos los items en transacción (versión simplificada - cantidad completa)
    return await this.prisma.$transaction(async (tx) => {
      let itemsRecibidos = 0;

      // Procesar cada item enviado
      for (const item of transferencia.items) {
        const cantidadRecibir = item.cantidadEnviada || item.cantidadAprobada || item.cantidadSolicitada;

        // Buscar o crear ProductoStock en sede destino
        let stockDestino = await tx.productoStock.findFirst({
          where: {
            sedeId: transferencia.sedeDestinoId,
            productoId: item.productoId || null,
            varianteId: item.varianteId || null,
          },
        });

        if (!stockDestino) {
          // Obtener el stock origen para copiar configuraciones
          const stockOrigen = await tx.productoStock.findFirst({
            where: {
              sedeId: transferencia.sedeOrigenId,
              productoId: item.productoId || null,
              varianteId: item.varianteId || null,
            },
          });

          // 🎯 AUTO-CREAR ProductoStock si no existe en sede destino
          // Copiar todos los datos de configuración del stock origen
          stockDestino = await tx.productoStock.create({
            data: {
              sedeId: transferencia.sedeDestinoId,
              empresaId,
              productoId: item.productoId,
              varianteId: item.varianteId,
              stockActual: 0,
              stockReservado: 0,
              stockReservadoVenta: 0,
              stockDanado: 0,
              stockEnGarantia: 0,
              ubicacion: dto.ubicacion,
              // Copiar configuraciones del stock origen
              stockMinimo: stockOrigen?.stockMinimo,
              stockMaximo: stockOrigen?.stockMaximo,
              precio: stockOrigen?.precio,
              precioCosto: stockOrigen?.precioCosto,
              precioOferta: stockOrigen?.precioOferta,
              enOferta: stockOrigen?.enOferta || false,
              fechaInicioOferta: stockOrigen?.fechaInicioOferta,
              fechaFinOferta: stockOrigen?.fechaFinOferta,
              precioConfigurado: stockOrigen?.precioConfigurado || false,
            },
          });

          const nombreProducto = item.producto?.nombre || item.variante?.nombre;
          this.logger.log(
            `ProductoStock creado automáticamente para ${nombreProducto} en ${transferencia.sedeDestino.nombre} con configuraciones copiadas del origen`,
          );
        }

        const nuevoStockDestino = stockDestino.stockActual + cantidadRecibir;

        // Actualizar stock destino
        await tx.productoStock.update({
          where: { id: stockDestino.id },
          data: {
            stockActual: nuevoStockDestino,
            ubicacion: dto.ubicacion || stockDestino.ubicacion,
          },
        });

        // Registrar movimiento de entrada
        await tx.movimientoStock.create({
          data: {
            sedeId: transferencia.sedeDestinoId,
            empresaId,
            productoStockId: stockDestino.id,
            tipo: TipoMovimientoStock.ENTRADA_TRANSFERENCIA,
            tipoDocumento: 'TRANSFERENCIA',
            numeroDocumento: transferencia.codigo,
            cantidadAnterior: stockDestino.stockActual,
            cantidad: cantidadRecibir,
            cantidadNueva: nuevoStockDestino,
            motivo: `Transferencia desde ${transferencia.sedeOrigen.nombre}`,
            observaciones: dto.observaciones,
            transferenciaId: transferencia.id,
            usuarioId,
          },
        });

        // Marcar item como recibido
        await tx.transferenciaStockItem.update({
          where: { id: item.id },
          data: {
            estado: 'RECIBIDO',
            cantidadRecibida: cantidadRecibir,
          },
        });

        itemsRecibidos++;
      }

      // Actualizar transferencia
      const actualizada = await tx.transferenciaStock.update({
        where: { id: transferenciaId },
        data: {
          estado: EstadoTransferencia.RECIBIDA,
          recibidoPor: usuarioId,
          fechaRecepcion: new Date(),
          itemsRecibidos,
          observaciones: dto.observaciones || transferencia.observaciones,
        },
        include: {
          sedeOrigen: true,
          sedeDestino: true,
          items: {
            include: {
              producto: true,
              variante: true,
            },
          },
        },
      });

      this.logger.log(
        `Transferencia recibida: ${transferencia.codigo} con ${itemsRecibidos} items`,
      );

      await this.invalidateStockCache(empresaId);

      return actualizada;
      
    });

    // Invalidar cache de productos (stock modificado en sede destino)
   
  }

  /**
   * Procesa completamente una transferencia (aprobar + enviar + recibir) en una sola operación
   * Útil cuando se sabe que todo es correcto y se quiere acelerar el proceso
   */
  async procesarCompleto(
    transferenciaId: string,
    empresaId: string,
    usuarioId: string,
    dto?: { ubicacion?: string; observaciones?: string },
  ) {
    const transferencia = await this.prisma.transferenciaStock.findFirst({
      where: {
        id: transferenciaId,
        empresaId,
      },
      include: {
        sedeOrigen: true,
        sedeDestino: true,
        items: {
          include: {
            producto: true,
            variante: true,
          },
        },
      },
    });

    if (!transferencia) {
      throw new NotFoundException('Transferencia no encontrada');
    }

    if (transferencia.estado !== EstadoTransferencia.PENDIENTE) {
      throw new BadRequestException(
        `Solo se pueden procesar transferencias PENDIENTES. Estado actual: ${transferencia.estado}`,
      );
    }

    if (transferencia.items.length === 0) {
      throw new BadRequestException('La transferencia no tiene items');
    }

    // Validar stock disponible para todos los items
    for (const item of transferencia.items) {
      const stockOrigen = await this.prisma.productoStock.findFirst({
        where: {
          sedeId: transferencia.sedeOrigenId,
          productoId: item.productoId || null,
          varianteId: item.varianteId || null,
        },
      });

      if (!stockOrigen) {
        const nombreProducto = item.producto?.nombre || item.variante?.nombre;
        throw new BadRequestException(
          `No hay stock registrado para ${nombreProducto} en la sede origen`,
        );
      }

      const stockDisponible = stockOrigen.stockActual - stockOrigen.stockReservado;
      if (stockDisponible < item.cantidadSolicitada) {
        const nombreProducto = item.producto?.nombre || item.variante?.nombre;
        throw new BadRequestException(
          `Stock disponible insuficiente para ${nombreProducto}. Disponible: ${stockDisponible}, Solicitado: ${item.cantidadSolicitada}`,
        );
      }
    }

    // Ejecutar todo el proceso en una sola transacción
    return await this.prisma.$transaction(async (tx) => {
      // 1. APROBAR: Aprobar todos los items y RESERVAR stock
      for (const item of transferencia.items) {
        await tx.transferenciaStockItem.update({
          where: { id: item.id },
          data: {
            estado: 'APROBADO',
            cantidadAprobada: item.cantidadSolicitada,
          },
        });

        // RESERVAR stock en sede origen (incrementar stockReservado)
        await tx.productoStock.updateMany({
          where: {
            sedeId: transferencia.sedeOrigenId,
            productoId: item.productoId || null,
            varianteId: item.varianteId || null,
          },
          data: {
            stockReservado: { increment: item.cantidadSolicitada },
          },
        });
      }

      // 2. ENVIAR: Descontar stock físico y liberar reserva
      for (const item of transferencia.items) {
        const stockOrigen = await tx.productoStock.findFirst({
          where: {
            sedeId: transferencia.sedeOrigenId,
            productoId: item.productoId || null,
            varianteId: item.varianteId || null,
          },
        });

        const cantidadEnviar = item.cantidadSolicitada;
        const nuevoStockActual = stockOrigen.stockActual - cantidadEnviar;
        const nuevoStockReservado = stockOrigen.stockReservado - cantidadEnviar;

        // Actualizar stock origen: descontar stockActual y decrementar stockReservado
        await tx.productoStock.update({
          where: { id: stockOrigen.id },
          data: {
            stockActual: nuevoStockActual,
            stockReservado: nuevoStockReservado,
          },
        });

        // Registrar movimiento de salida
        await tx.movimientoStock.create({
          data: {
            sedeId: transferencia.sedeOrigenId,
            empresaId,
            productoStockId: stockOrigen.id,
            tipo: TipoMovimientoStock.SALIDA_TRANSFERENCIA,
            tipoDocumento: 'TRANSFERENCIA',
            numeroDocumento: transferencia.codigo,
            cantidadAnterior: stockOrigen.stockActual,
            cantidad: -cantidadEnviar,
            cantidadNueva: nuevoStockActual,
            motivo: `Transferencia a ${transferencia.sedeDestino.nombre}`,
            observaciones: dto?.observaciones,
            transferenciaId: transferencia.id,
            usuarioId,
          },
        });

        // Marcar item como enviado
        await tx.transferenciaStockItem.update({
          where: { id: item.id },
          data: {
            estado: 'ENVIADO',
            cantidadEnviada: cantidadEnviar,
          },
        });
      }

      // 3. RECIBIR: Crear/actualizar stock destino y marcar items como recibidos
      let itemsRecibidos = 0;

      for (const item of transferencia.items) {
        const cantidadRecibir = item.cantidadSolicitada;

        // Buscar o crear ProductoStock en sede destino
        let stockDestino = await tx.productoStock.findFirst({
          where: {
            sedeId: transferencia.sedeDestinoId,
            productoId: item.productoId || null,
            varianteId: item.varianteId || null,
          },
        });

        if (!stockDestino) {
          // Obtener el stock origen para copiar configuraciones
          const stockOrigen = await tx.productoStock.findFirst({
            where: {
              sedeId: transferencia.sedeOrigenId,
              productoId: item.productoId || null,
              varianteId: item.varianteId || null,
            },
          });

          // Crear ProductoStock con configuraciones copiadas
          stockDestino = await tx.productoStock.create({
            data: {
              sedeId: transferencia.sedeDestinoId,
              empresaId,
              productoId: item.productoId,
              varianteId: item.varianteId,
              stockActual: 0,
              stockReservado: 0,
              stockReservadoVenta: 0,
              stockDanado: 0,
              stockEnGarantia: 0,
              ubicacion: dto?.ubicacion,
              stockMinimo: stockOrigen?.stockMinimo,
              stockMaximo: stockOrigen?.stockMaximo,
              precio: stockOrigen?.precio,
              precioCosto: stockOrigen?.precioCosto,
              precioOferta: stockOrigen?.precioOferta,
              enOferta: stockOrigen?.enOferta || false,
              fechaInicioOferta: stockOrigen?.fechaInicioOferta,
              fechaFinOferta: stockOrigen?.fechaFinOferta,
              precioConfigurado: stockOrigen?.precioConfigurado || false,
            },
          });

          const nombreProducto = item.producto?.nombre || item.variante?.nombre;
          this.logger.log(
            `ProductoStock creado automáticamente para ${nombreProducto} en ${transferencia.sedeDestino.nombre}`,
          );
        }

        const nuevoStockDestino = stockDestino.stockActual + cantidadRecibir;

        // Actualizar stock destino
        await tx.productoStock.update({
          where: { id: stockDestino.id },
          data: {
            stockActual: nuevoStockDestino,
            ubicacion: dto?.ubicacion || stockDestino.ubicacion,
          },
        });

        // Registrar movimiento de entrada
        await tx.movimientoStock.create({
          data: {
            sedeId: transferencia.sedeDestinoId,
            empresaId,
            productoStockId: stockDestino.id,
            tipo: TipoMovimientoStock.ENTRADA_TRANSFERENCIA,
            tipoDocumento: 'TRANSFERENCIA',
            numeroDocumento: transferencia.codigo,
            cantidadAnterior: stockDestino.stockActual,
            cantidad: cantidadRecibir,
            cantidadNueva: nuevoStockDestino,
            motivo: `Transferencia desde ${transferencia.sedeOrigen.nombre}`,
            observaciones: dto?.observaciones,
            transferenciaId: transferencia.id,
            usuarioId,
          },
        });

        // Marcar item como recibido
        await tx.transferenciaStockItem.update({
          where: { id: item.id },
          data: {
            estado: 'RECIBIDO',
            cantidadRecibida: cantidadRecibir,
          },
        });

        itemsRecibidos++;
      }

      // Actualizar transferencia con todos los estados
      const actualizada = await tx.transferenciaStock.update({
        where: { id: transferenciaId },
        data: {
          estado: EstadoTransferencia.RECIBIDA,
          aprobadoPor: usuarioId,
          recibidoPor: usuarioId,
          fechaAprobacion: new Date(),
          fechaEnvio: new Date(),
          fechaRecepcion: new Date(),
          itemsAprobados: transferencia.totalItems,
          itemsRecibidos,
          observaciones: dto?.observaciones || transferencia.observaciones,
        },
        include: {
          sedeOrigen: true,
          sedeDestino: true,
          items: {
            include: {
              producto: true,
              variante: true,
            },
          },
        },
      });

      this.logger.log(
        `Transferencia procesada completamente: ${transferencia.codigo} con ${itemsRecibidos} items (${transferencia.sedeOrigen.nombre} → ${transferencia.sedeDestino.nombre})`,
      );

      return actualizada;
    });

    // Invalidar cache de productos (stock modificado en ambas sedes)
    await this.invalidateStockCache(empresaId);
  }

  /**
   * Rechaza una transferencia pendiente
   */
  async rechazar(
    transferenciaId: string,
    empresaId: string,
    usuarioId: string,
    motivo: string,
  ) {
    const transferencia = await this.prisma.transferenciaStock.findFirst({
      where: {
        id: transferenciaId,
        empresaId,
      },
      include: {
        items: true,
      },
    });

    if (!transferencia) {
      throw new NotFoundException('Transferencia no encontrada');
    }

    if (transferencia.estado !== EstadoTransferencia.PENDIENTE) {
      throw new BadRequestException(
        'Solo se pueden rechazar transferencias PENDIENTES',
      );
    }

    // Rechazar transferencia y todos sus items
    const actualizada = await this.prisma.$transaction(async (tx) => {
      // Si la transferencia estaba APROBADA (aunque se rechaza después), liberar el stock reservado
      // Nota: Este caso es raro pero posible si se aprueba por error y luego se rechaza
      if (transferencia.estado === EstadoTransferencia.APROBADA) {
        for (const item of transferencia.items) {
          if (item.estado === 'APROBADO') {
            const cantidadAprobada = item.cantidadAprobada || item.cantidadSolicitada;

            // LIBERAR stock reservado (decrementar stockReservado)
            await tx.productoStock.updateMany({
              where: {
                sedeId: transferencia.sedeOrigenId,
                productoId: item.productoId || null,
                varianteId: item.varianteId || null,
              },
              data: {
                stockReservado: { decrement: cantidadAprobada },
              },
            });
          }
        }
      }

      // Rechazar todos los items pendientes/aprobados
      await tx.transferenciaStockItem.updateMany({
        where: {
          transferenciaId,
          estado: { in: ['PENDIENTE', 'APROBADO'] },
        },
        data: {
          estado: 'RECHAZADO',
        },
      });

      // Actualizar transferencia
      return await tx.transferenciaStock.update({
        where: { id: transferenciaId },
        data: {
          estado: EstadoTransferencia.RECHAZADA,
          aprobadoPor: usuarioId,
          fechaAprobacion: new Date(),
          itemsRechazados: transferencia.totalItems,
          observaciones: `RECHAZADA: ${motivo}`,
        },
        include: {
          items: {
            include: {
              producto: true,
              variante: true,
            },
          },
        },
      });
    });

    this.logger.log(`Transferencia rechazada: ${transferencia.codigo} con ${transferencia.totalItems} items`);

    // Invalidar cache de productos (para reflejar cambio de estado)
    await this.invalidateStockCache(empresaId);

    return actualizada;
  }

  /**
   * Cancela una transferencia (solo si está pendiente o aprobada)
   */
  async cancelar(
    transferenciaId: string,
    empresaId: string,
    usuarioId: string,
    motivo: string,
  ) {
    const transferencia = await this.prisma.transferenciaStock.findFirst({
      where: {
        id: transferenciaId,
        empresaId,
      },
      include: {
        items: true,
      },
    });

    if (!transferencia) {
      throw new NotFoundException('Transferencia no encontrada');
    }

    if (
      transferencia.estado !== EstadoTransferencia.PENDIENTE &&
      transferencia.estado !== EstadoTransferencia.APROBADA
    ) {
      throw new BadRequestException(
        'Solo se pueden cancelar transferencias PENDIENTES o APROBADAS',
      );
    }

    // Cancelar transferencia y todos sus items
    const actualizada = await this.prisma.$transaction(async (tx) => {
      // Si la transferencia estaba APROBADA, liberar el stock reservado
      if (transferencia.estado === EstadoTransferencia.APROBADA) {
        for (const item of transferencia.items) {
          if (item.estado === 'APROBADO') {
            const cantidadAprobada = item.cantidadAprobada || item.cantidadSolicitada;

            // LIBERAR stock reservado (decrementar stockReservado)
            await tx.productoStock.updateMany({
              where: {
                sedeId: transferencia.sedeOrigenId,
                productoId: item.productoId || null,
                varianteId: item.varianteId || null,
              },
              data: {
                stockReservado: { decrement: cantidadAprobada },
              },
            });
          }
        }
      }

      // Marcar todos los items como rechazados
      await tx.transferenciaStockItem.updateMany({
        where: {
          transferenciaId,
          estado: { in: ['PENDIENTE', 'APROBADO'] },
        },
        data: {
          estado: 'RECHAZADO',
        },
      });

      // Actualizar transferencia
      return await tx.transferenciaStock.update({
        where: { id: transferenciaId },
        data: {
          estado: EstadoTransferencia.CANCELADA,
          itemsRechazados: transferencia.totalItems,
          observaciones: `CANCELADA: ${motivo}`,
        },
        include: {
          items: {
            include: {
              producto: true,
              variante: true,
            },
          },
        },
      });
    });

    this.logger.log(`Transferencia cancelada: ${transferencia.codigo}`);

    // Invalidar cache de productos (para reflejar cambio de estado)
    await this.invalidateStockCache(empresaId);

    return actualizada;
  }

  /**
   * Lista transferencias con filtros
   */
  async listar(
    empresaId: string,
    sedeId?: string,
    estado?: EstadoTransferencia,
    page: number = 1,
    limit: number = 50,
  ) {
    const skip = (page - 1) * limit;

    const where: any = { empresaId };

    if (sedeId) {
      where.OR = [{ sedeOrigenId: sedeId }, { sedeDestinoId: sedeId }];
    }

    if (estado) {
      where.estado = estado;
    }

    const [transferencias, total] = await Promise.all([
      this.prisma.transferenciaStock.findMany({
        where,
        include: {
          sedeOrigen: {
            select: { id: true, nombre: true, codigo: true },
          },
          sedeDestino: {
            select: { id: true, nombre: true, codigo: true },
          },
          items: {
            include: {
              producto: {
                select: { id: true, nombre: true, codigoEmpresa: true },
              },
              variante: {
                select: { id: true, nombre: true, sku: true },
              },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.transferenciaStock.count({ where }),
    ]);

    return {
      transferencias,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Obtiene una transferencia por ID
   */
  async obtener(transferenciaId: string, empresaId: string) {
    const transferencia = await this.prisma.transferenciaStock.findFirst({
      where: {
        id: transferenciaId,
        empresaId,
      },
      include: {
        sedeOrigen: true,
        sedeDestino: true,
        empresa: true,
        items: {
          include: {
            producto: true,
            variante: true,
          },
          orderBy: { creadoEn: 'asc' },
        },
        movimientos: {
          orderBy: { creadoEn: 'desc' },
        },
      },
    });

    if (!transferencia) {
      throw new NotFoundException('Transferencia no encontrada');
    }

    return transferencia;
  }

  /**
   * Invalida el cache de productos y estadísticas después de movimientos de stock
   * Se llama automáticamente cuando se modifica el stock (aprobar, enviar, recibir, etc.)
   */
  private async invalidateStockCache(empresaId: string) {
    try {
      // Invalidar estadísticas de la empresa
      const statsKey = this.cache.getEmpresaStatsKey(empresaId);
      await this.cache.invalidate(statsKey);

      // Invalidar TODAS las listas de productos de la empresa
      // Esto invalida todos los caches con diferentes filtros/búsquedas
      await this.cache.invalidateProductosLists(empresaId);

      this.logger.debug(
        `✅ Cache invalidado para empresa ${empresaId}: stats + listas de productos`,
      );
    } catch (error) {
      // No lanzar error si falla la invalidación del cache
      // El sistema debe seguir funcionando aunque Redis falle
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(`⚠️ Error al invalidar cache: ${errorMessage}`);
    }
  }
}
