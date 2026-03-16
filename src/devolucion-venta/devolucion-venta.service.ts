import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { CreateDevolucionVentaDto } from './dto/create-devolucion-venta.dto';
import { QueryDevolucionVentaDto } from './dto/query-devolucion-venta.dto';
import {
  EstadoDevolucion,
  TipoDevolucion,
  TipoMovimientoStock,
  Prisma,
} from '@prisma/client';

@Injectable()
export class DevolucionVentaService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(DevolucionVentaService.name);
  }

  private async generateCodigo(empresaId: string): Promise<string> {
    const count = await this.prisma.devolucion.count({ where: { empresaId } });
    return `DEV-${(count + 1).toString().padStart(5, '0')}`;
  }

  async create(empresaId: string, userId: string, dto: CreateDevolucionVentaDto) {
    return this.prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findFirst({
        where: { id: dto.ventaId, empresaId },
        include: { detalles: true },
      });
      if (!venta) throw new NotFoundException('Venta no encontrada');

      const estadosValidos = ['CONFIRMADA', 'PAGADA_PARCIAL', 'PAGADA_COMPLETA'];
      if (!estadosValidos.includes(venta.estado)) {
        throw new BadRequestException(
          `La venta debe estar CONFIRMADA o PAGADA. Estado actual: ${venta.estado}`,
        );
      }

      for (const item of dto.items) {
        const detalle = venta.detalles.find(
          (d) =>
            d.productoId === item.productoId &&
            (d.varianteId || null) === (item.varianteId || null),
        );
        if (!detalle) {
          throw new BadRequestException(
            `Producto ${item.productoId} no encontrado en la venta`,
          );
        }
        if (item.cantidad > Number(detalle.cantidad)) {
          throw new BadRequestException(
            `Cantidad a devolver (${item.cantidad}) excede la vendida (${detalle.cantidad})`,
          );
        }
      }

      const codigo = await this.generateCodigo(empresaId);

      const devolucion = await tx.devolucion.create({
        data: {
          codigo,
          empresaId,
          sedeId: dto.sedeId,
          ventaId: dto.ventaId,
          tipo: TipoDevolucion.CLIENTE_A_TIENDA,
          estado: EstadoDevolucion.PENDIENTE,
          clienteId: venta.clienteId,
          motivo: dto.motivo,
          observaciones: dto.observaciones,
          creadoPor: userId,
          items: {
            create: dto.items.map((item) => ({
              empresaId,
              productoId: item.productoId,
              varianteId: item.varianteId,
              cantidad: item.cantidad,
              motivo: item.motivo,
              estadoProducto: item.estadoProducto,
              accion: item.accion,
              observaciones: item.observaciones,
            })),
          },
        },
        include: {
          items: {
            include: {
              producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
              variante: { select: { id: true, nombre: true, sku: true } },
            },
          },
          venta: { select: { id: true, codigo: true, nombreCliente: true } },
          sede: { select: { id: true, nombre: true } },
        },
      });

      this.logger.log(`Devolucion ${codigo} creada para venta ${venta.codigo}`);
      return devolucion;
    });
  }

  async findAll(empresaId: string, query: QueryDevolucionVentaDto) {
    const where: Prisma.DevolucionWhereInput = {
      empresaId,
      tipo: TipoDevolucion.CLIENTE_A_TIENDA,
    };

    if (query.estado) where.estado = query.estado as EstadoDevolucion;
    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.ventaId) where.ventaId = query.ventaId;
    if (query.fechaDesde || query.fechaHasta) {
      where.creadoEn = {};
      if (query.fechaDesde) where.creadoEn.gte = new Date(query.fechaDesde);
      if (query.fechaHasta) where.creadoEn.lte = new Date(query.fechaHasta);
    }
    if (query.search) {
      where.codigo = { contains: query.search, mode: 'insensitive' };
    }

    return this.prisma.devolucion.findMany({
      where,
      include: {
        sede: { select: { id: true, nombre: true } },
        venta: { select: { id: true, codigo: true, nombreCliente: true } },
        _count: { select: { items: true } },
      },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async findOne(id: string, empresaId: string) {
    const devolucion = await this.prisma.devolucion.findFirst({
      where: { id, empresaId },
      include: {
        items: {
          include: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
          },
        },
        venta: { select: { id: true, codigo: true, nombreCliente: true } },
        sede: { select: { id: true, nombre: true } },
        movimientos: true,
      },
    });
    if (!devolucion) throw new NotFoundException('Devolucion no encontrada');
    return devolucion;
  }

  async aprobar(id: string, empresaId: string, userId: string) {
    const devolucion = await this.prisma.devolucion.findFirst({
      where: { id, empresaId },
    });
    if (!devolucion) throw new NotFoundException('Devolucion no encontrada');
    if (devolucion.estado !== EstadoDevolucion.PENDIENTE) {
      throw new BadRequestException(
        `Solo se pueden aprobar devoluciones PENDIENTES. Estado: ${devolucion.estado}`,
      );
    }

    return this.prisma.devolucion.update({
      where: { id },
      data: {
        estado: EstadoDevolucion.APROBADA,
        aprobadoPor: userId,
        aprobadoEn: new Date(),
      },
      include: {
        items: true,
        venta: { select: { id: true, codigo: true } },
      },
    });
  }

  async procesar(id: string, empresaId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const devolucion = await tx.devolucion.findFirst({
        where: { id, empresaId },
        include: { items: true },
      });
      if (!devolucion) throw new NotFoundException('Devolucion no encontrada');
      if (devolucion.estado !== EstadoDevolucion.APROBADA) {
        throw new BadRequestException(
          `Solo se pueden procesar devoluciones APROBADAS. Estado: ${devolucion.estado}`,
        );
      }

      for (const item of devolucion.items) {
        if (!item.productoId && !item.varianteId) continue;

        const productoStock = await tx.productoStock.findFirst({
          where: {
            sedeId: devolucion.sedeId,
            productoId: item.productoId ?? null,
            varianteId: item.varianteId ?? null,
          },
        });
        if (!productoStock) continue;

        const stockAnterior = productoStock.stockActual;
        const cantidad = item.cantidad;

        const createMov = (tipo: TipoMovimientoStock, motivo: string) =>
          tx.movimientoStock.create({
            data: {
              sedeId: devolucion.sedeId,
              empresaId,
              productoStockId: productoStock.id,
              tipo,
              tipoDocumento: 'DEVOLUCION',
              numeroDocumento: devolucion.codigo,
              cantidadAnterior: stockAnterior,
              cantidad,
              cantidadNueva: stockAnterior + cantidad,
              motivo: `Devolucion ${devolucion.codigo} - ${motivo}`,
              devolucionId: devolucion.id,
              usuarioId: userId,
            },
          });

        switch (item.accion) {
          case 'REINGRESAR_STOCK':
            await tx.productoStock.update({
              where: { id: productoStock.id },
              data: { stockActual: { increment: cantidad } },
            });
            await createMov(TipoMovimientoStock.ENTRADA_DEVOLUCION_CLIENTE, 'Reingreso a stock');
            break;
          case 'MARCAR_DANADO':
            await tx.productoStock.update({
              where: { id: productoStock.id },
              data: { stockDanado: { increment: cantidad } },
            });
            await createMov(TipoMovimientoStock.ENTRADA_DEVOLUCION_CLIENTE, 'Marcado como danado');
            break;
          case 'ENVIAR_REPARACION':
            await tx.productoStock.update({
              where: { id: productoStock.id },
              data: { stockEnGarantia: { increment: cantidad } },
            });
            await createMov(TipoMovimientoStock.ENTRADA_DEVOLUCION_CLIENTE, 'Enviado a reparacion');
            break;
          case 'DAR_DE_BAJA':
            await createMov(TipoMovimientoStock.SALIDA_BAJA, 'Dado de baja');
            break;
          default:
            await createMov(TipoMovimientoStock.ENTRADA_DEVOLUCION_CLIENTE, item.accion);
            break;
        }
      }

      return tx.devolucion.update({
        where: { id },
        data: {
          estado: EstadoDevolucion.PROCESADA,
          procesadoPor: userId,
          procesadoEn: new Date(),
        },
        include: {
          items: {
            include: {
              producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
              variante: { select: { id: true, nombre: true, sku: true } },
            },
          },
          movimientos: true,
        },
      });
    });
  }

  async rechazar(id: string, empresaId: string, userId: string, motivo?: string) {
    const devolucion = await this.prisma.devolucion.findFirst({
      where: { id, empresaId },
    });
    if (!devolucion) throw new NotFoundException('Devolucion no encontrada');
    if (
      devolucion.estado !== EstadoDevolucion.PENDIENTE &&
      devolucion.estado !== EstadoDevolucion.APROBADA
    ) {
      throw new BadRequestException(
        `Solo PENDIENTES o APROBADAS pueden rechazarse. Estado: ${devolucion.estado}`,
      );
    }

    return this.prisma.devolucion.update({
      where: { id },
      data: {
        estado: EstadoDevolucion.RECHAZADA,
        ...(motivo ? { observaciones: `[RECHAZADA] ${motivo}` } : {}),
      },
    });
  }

  async cancelar(id: string, empresaId: string, userId: string) {
    const devolucion = await this.prisma.devolucion.findFirst({
      where: { id, empresaId },
    });
    if (!devolucion) throw new NotFoundException('Devolucion no encontrada');
    if (devolucion.estado !== EstadoDevolucion.PENDIENTE) {
      throw new BadRequestException(
        `Solo PENDIENTES pueden cancelarse. Estado: ${devolucion.estado}`,
      );
    }

    return this.prisma.devolucion.update({
      where: { id },
      data: { estado: EstadoDevolucion.CANCELADA },
    });
  }
}
