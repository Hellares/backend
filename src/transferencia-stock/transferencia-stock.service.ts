import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CrearTransferenciaDto } from './dto/crear-transferencia.dto';
import { AprobarTransferenciaDto } from './dto/aprobar-transferencia.dto';
import { RecibirTransferenciaDto } from './dto/recibir-transferencia.dto';
import { EstadoTransferencia, TipoMovimientoStock } from '@prisma/client';

@Injectable()
export class TransferenciaStockService {
  private readonly logger = new Logger(TransferenciaStockService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly codigosService: ConfiguracionCodigosService,
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

    if (stockOrigen.stockActual < dto.cantidad) {
      throw new BadRequestException(
        `Stock insuficiente en sede origen. Disponible: ${stockOrigen.stockActual}, Solicitado: ${dto.cantidad}`,
      );
    }

    // Generar código único para la transferencia
    const codigo = await this.codigosService.generarCodigoTransferencia(
      empresaId,
      this.prisma,
    );

    // Crear transferencia
    const transferencia = await this.prisma.transferenciaStock.create({
      data: {
        empresaId,
        sedeOrigenId: dto.sedeOrigenId,
        sedeDestinoId: dto.sedeDestinoId,
        productoId: dto.productoId,
        varianteId: dto.varianteId,
        cantidad: dto.cantidad,
        codigo,
        motivo: dto.motivo,
        observaciones: dto.observaciones,
        solicitadoPor: usuarioId,
        estado: EstadoTransferencia.PENDIENTE,
      },
      include: {
        sedeOrigen: true,
        sedeDestino: true,
        empresa: true,
      },
    });

    this.logger.log(
      `Transferencia creada: ${codigo} | ${stockOrigen.producto?.nombre || stockOrigen.variante?.nombre} | ${dto.cantidad} unidades | ${sedeOrigen.nombre} → ${sedeDestino.nombre}`,
    );

    return transferencia;
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

    // Verificar stock nuevamente (por si cambió)
    const stockOrigen = await this.prisma.productoStock.findFirst({
      where: {
        sedeId: transferencia.sedeOrigenId,
        productoId: transferencia.productoId || null,
        varianteId: transferencia.varianteId || null,
      },
    });

    if (!stockOrigen || stockOrigen.stockActual < transferencia.cantidad) {
      throw new BadRequestException(
        'Stock insuficiente en sede origen para aprobar esta transferencia',
      );
    }

    const actualizado = await this.prisma.transferenciaStock.update({
      where: { id: transferenciaId },
      data: {
        estado: EstadoTransferencia.APROBADA,
        aprobadoPor: usuarioId,
        fechaAprobacion: new Date(),
        observaciones: dto?.observaciones || transferencia.observaciones,
      },
      include: {
        sedeOrigen: true,
        sedeDestino: true,
      },
    });

    this.logger.log(`Transferencia aprobada: ${transferencia.codigo}`);

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

    // Descontar stock de origen y registrar movimiento en transacción
    return await this.prisma.$transaction(async (tx) => {
      // Obtener stock origen
      const stockOrigen = await tx.productoStock.findFirst({
        where: {
          sedeId: transferencia.sedeOrigenId,
          productoId: transferencia.productoId || null,
          varianteId: transferencia.varianteId || null,
        },
      });

      if (!stockOrigen) {
        throw new NotFoundException('Stock origen no encontrado');
      }

      if (stockOrigen.stockActual < transferencia.cantidad) {
        throw new BadRequestException('Stock insuficiente para enviar');
      }

      const nuevoStockOrigen = stockOrigen.stockActual - transferencia.cantidad;

      // Actualizar stock origen
      await tx.productoStock.update({
        where: { id: stockOrigen.id },
        data: { stockActual: nuevoStockOrigen },
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
          cantidad: -transferencia.cantidad,
          cantidadNueva: nuevoStockOrigen,
          motivo: `Transferencia a ${transferencia.sedeDestino.nombre}`,
          observaciones: transferencia.observaciones,
          transferenciaId: transferencia.id,
          usuarioId,
        },
      });

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
        },
      });

      this.logger.log(
        `Transferencia enviada: ${transferencia.codigo} | Stock origen: ${stockOrigen.stockActual} → ${nuevoStockOrigen}`,
      );

      return actualizada;
    });
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

    if (dto.cantidadRecibida > transferencia.cantidad) {
      throw new BadRequestException(
        'La cantidad recibida no puede ser mayor a la cantidad enviada',
      );
    }

    // Recibir en transacción
    return await this.prisma.$transaction(async (tx) => {
      // Buscar o crear ProductoStock en sede destino
      let stockDestino = await tx.productoStock.findFirst({
        where: {
          sedeId: transferencia.sedeDestinoId,
          productoId: transferencia.productoId || null,
          varianteId: transferencia.varianteId || null,
        },
      });

      if (!stockDestino) {
        // 🎯 AUTO-CREAR ProductoStock si no existe en sede destino
        stockDestino = await tx.productoStock.create({
          data: {
            sedeId: transferencia.sedeDestinoId,
            empresaId,
            productoId: transferencia.productoId,
            varianteId: transferencia.varianteId,
            stockActual: 0,
            ubicacion: dto.ubicacion,
          },
        });

        this.logger.log(
          `ProductoStock creado automáticamente en ${transferencia.sedeDestino.nombre}`,
        );
      }

      const nuevoStockDestino = stockDestino.stockActual + dto.cantidadRecibida;

      // Actualizar stock destino
      const stockActualizado = await tx.productoStock.update({
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
          cantidad: dto.cantidadRecibida,
          cantidadNueva: nuevoStockDestino,
          motivo: `Transferencia desde ${transferencia.sedeOrigen.nombre}`,
          observaciones: dto.observaciones,
          transferenciaId: transferencia.id,
          usuarioId,
        },
      });

      // Si hubo merma, registrar movimiento de salida en origen
      const merma = transferencia.cantidad - dto.cantidadRecibida;
      if (merma > 0) {
        const stockOrigen = await tx.productoStock.findFirst({
          where: {
            sedeId: transferencia.sedeOrigenId,
            productoId: transferencia.productoId || null,
            varianteId: transferencia.varianteId || null,
          },
        });

        if (stockOrigen) {
          await tx.movimientoStock.create({
            data: {
              sedeId: transferencia.sedeOrigenId,
              empresaId,
              productoStockId: stockOrigen.id,
              tipo: TipoMovimientoStock.SALIDA_MERMA,
              tipoDocumento: 'TRANSFERENCIA',
              numeroDocumento: transferencia.codigo,
              cantidadAnterior: 0,
              cantidad: -merma,
              cantidadNueva: 0,
              motivo: `Merma en transferencia ${transferencia.codigo}`,
              observaciones: `Enviado: ${transferencia.cantidad}, Recibido: ${dto.cantidadRecibida}`,
              transferenciaId: transferencia.id,
              usuarioId,
            },
          });

          this.logger.warn(
            `Merma detectada en transferencia ${transferencia.codigo}: ${merma} unidades`,
          );
        }
      }

      // Actualizar transferencia
      const actualizada = await tx.transferenciaStock.update({
        where: { id: transferenciaId },
        data: {
          estado: EstadoTransferencia.RECIBIDA,
          recibidoPor: usuarioId,
          fechaRecepcion: new Date(),
          observaciones: dto.observaciones || transferencia.observaciones,
        },
        include: {
          sedeOrigen: true,
          sedeDestino: true,
        },
      });

      this.logger.log(
        `Transferencia recibida: ${transferencia.codigo} | Stock destino: ${stockDestino.stockActual} → ${nuevoStockDestino} | Merma: ${merma}`,
      );

      return actualizada;
    });
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
    });

    if (!transferencia) {
      throw new NotFoundException('Transferencia no encontrada');
    }

    if (transferencia.estado !== EstadoTransferencia.PENDIENTE) {
      throw new BadRequestException(
        'Solo se pueden rechazar transferencias PENDIENTES',
      );
    }

    const actualizada = await this.prisma.transferenciaStock.update({
      where: { id: transferenciaId },
      data: {
        estado: EstadoTransferencia.RECHAZADA,
        aprobadoPor: usuarioId,
        fechaAprobacion: new Date(),
        observaciones: `RECHAZADA: ${motivo}`,
      },
    });

    this.logger.log(`Transferencia rechazada: ${transferencia.codigo}`);

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

    const actualizada = await this.prisma.transferenciaStock.update({
      where: { id: transferenciaId },
      data: {
        estado: EstadoTransferencia.CANCELADA,
        observaciones: `CANCELADA: ${motivo}`,
      },
    });

    this.logger.log(`Transferencia cancelada: ${transferencia.codigo}`);

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
}
