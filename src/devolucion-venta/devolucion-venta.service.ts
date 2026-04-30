import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { CacheService } from '../redis/cache.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { CreateDevolucionVentaDto } from './dto/create-devolucion-venta.dto';
import { QueryDevolucionVentaDto } from './dto/query-devolucion-venta.dto';
import {
  EstadoDevolucion,
  TipoDevolucion,
  TipoMovimientoStock,
  TipoReembolso,
  Rol,
  Prisma,
} from '@prisma/client';

/** Roles que pueden procesar una reversión total sin caja abierta. */
const ROLES_ESCAPE_CAJA: Set<Rol> = new Set<Rol>([
  Rol.SUPER_ADMIN,
  Rol.EMPRESA_ADMIN,
  Rol.SEDE_ADMIN,
]);

@Injectable()
export class DevolucionVentaService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly cajaService: CajaService,
    private readonly notificacionService: NotificacionService,
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
          tipoReembolso: (dto.tipoReembolso as TipoReembolso) || TipoReembolso.EFECTIVO,
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
              productoReemplazoId: item.productoReemplazoId || null,
              varianteReemplazoId: item.varianteReemplazoId || null,
            })),
          },
        },
        include: {
          items: {
            include: {
              producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
              variante: { select: { id: true, nombre: true, sku: true } },
              productoReemplazo: { select: { id: true, nombre: true, codigoEmpresa: true } },
              varianteReemplazo: { select: { id: true, nombre: true, sku: true } },
            },
          },
          venta: { select: { id: true, codigo: true, nombreCliente: true } },
          sede: { select: { id: true, nombre: true } },
        },
      });

      // Calculate prices for CAMBIO_PRODUCTO items
      const createdItems = await tx.devolucionItem.findMany({
        where: { devolucionId: devolucion.id },
      });
      for (const item of createdItems) {
        if (item.accion === 'CAMBIO_PRODUCTO' && item.productoReemplazoId) {
          // Look up original price from venta detalles
          const detalleVenta = venta.detalles.find(
            (d) =>
              d.productoId === item.productoId &&
              (d.varianteId || null) === (item.varianteId || null),
          );
          const precioOriginal = detalleVenta ? Number(detalleVenta.precioUnitario) : 0;

          // Look up replacement price from ProductoStock (precio de venta en la sede)
          const reemplazoStock = await tx.productoStock.findFirst({
            where: {
              sedeId: dto.sedeId,
              productoId: item.productoReemplazoId,
              varianteId: item.varianteReemplazoId ?? null,
            },
          });

          const precioReemplazo = reemplazoStock?.precio
            ? Number(reemplazoStock.precio)
            : 0;

          const diferenciaPrecio = precioReemplazo - precioOriginal;

          await tx.devolucionItem.update({
            where: { id: item.id },
            data: {
              precioOriginal,
              precioReemplazo,
              diferenciaPrecio,
            },
          });
        }
      }

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
            productoReemplazo: { select: { id: true, nombre: true, codigoEmpresa: true } },
            varianteReemplazo: { select: { id: true, nombre: true, sku: true } },
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
    const result = await this.prisma.$transaction(async (tx) => {
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
          case 'CAMBIO_PRODUCTO': {
            // 1. Restock original product (BUENO) or mark as damaged
            if (item.estadoProducto === 'BUENO') {
              await tx.productoStock.update({
                where: { id: productoStock.id },
                data: { stockActual: { increment: cantidad } },
              });
              await createMov(TipoMovimientoStock.ENTRADA_DEVOLUCION_CLIENTE, 'Reingreso por cambio de producto');
            } else {
              await tx.productoStock.update({
                where: { id: productoStock.id },
                data: { stockDanado: { increment: cantidad } },
              });
              await createMov(TipoMovimientoStock.ENTRADA_DEVOLUCION_CLIENTE, 'Marcado como danado por cambio de producto');
            }

            // 2. Deduct replacement product from stock
            if (item.productoReemplazoId) {
              const reemplazoStock = await tx.productoStock.findFirst({
                where: {
                  sedeId: devolucion.sedeId,
                  productoId: item.productoReemplazoId,
                  varianteId: item.varianteReemplazoId ?? null,
                },
              });

              if (reemplazoStock) {
                const stockAnteriorReemplazo = reemplazoStock.stockActual;
                await tx.productoStock.update({
                  where: { id: reemplazoStock.id },
                  data: { stockActual: { decrement: cantidad } },
                });
                await tx.movimientoStock.create({
                  data: {
                    sedeId: devolucion.sedeId,
                    empresaId,
                    productoStockId: reemplazoStock.id,
                    tipo: TipoMovimientoStock.SALIDA_VENTA,
                    tipoDocumento: 'DEVOLUCION',
                    numeroDocumento: devolucion.codigo,
                    cantidadAnterior: stockAnteriorReemplazo,
                    cantidad,
                    cantidadNueva: stockAnteriorReemplazo - cantidad,
                    motivo: `Devolucion ${devolucion.codigo} - Entrega producto reemplazo`,
                    devolucionId: devolucion.id,
                    usuarioId: userId,
                  },
                });
              }
            }
            break;
          }
          default:
            await createMov(TipoMovimientoStock.ENTRADA_DEVOLUCION_CLIENTE, item.accion);
            break;
        }
      }

      // Registrar movimiento en caja según tipoReembolso
      if (devolucion.tipoReembolso === 'EFECTIVO') {
        // Calcular monto desde items de la venta original — devolucion en efectivo
        let montoDevolucion = 0;
        if (devolucion.ventaId) {
          const ventaOriginal = await tx.venta.findUnique({
            where: { id: devolucion.ventaId },
            include: { detalles: true },
          });
          if (ventaOriginal) {
            for (const item of devolucion.items) {
              const detalleVenta = ventaOriginal.detalles.find(
                (d) => d.productoId === item.productoId && d.varianteId === item.varianteId,
              );
              if (detalleVenta) {
                montoDevolucion += Number(detalleVenta.precioUnitario) * item.cantidad;
              }
            }
          }
        }
        if (montoDevolucion > 0) {
          try {
            await this.cajaService.registrarMovimientoSiHayCaja(
              empresaId,
              devolucion.sedeId,
              userId,
              {
                tipo: 'EGRESO',
                categoria: 'DEVOLUCION',
                metodoPago: 'EFECTIVO',
                monto: montoDevolucion,
                descripcion: `Devolución ${devolucion.codigo}`,
                devolucionId: devolucion.id,
              },
              tx,
            );
          } catch (e) {
            this.logger.warn(`Error registrando egreso caja para devolución ${devolucion.codigo}: ${e?.message ?? e}`);
          }
        }
      } else if (devolucion.tipoReembolso === 'CAMBIO_PRODUCTO') {
        // Calculate net difference from all CAMBIO items
        let diferenciaNeta = 0;
        for (const item of devolucion.items) {
          if (item.accion === 'CAMBIO_PRODUCTO' && item.diferenciaPrecio !== null) {
            diferenciaNeta += Number(item.diferenciaPrecio) * item.cantidad;
          }
        }

        if (diferenciaNeta > 0) {
          // Customer pays difference (replacement is more expensive) — INGRESO
          try {
            await this.cajaService.registrarMovimientoSiHayCaja(
              empresaId,
              devolucion.sedeId,
              userId,
              {
                tipo: 'INGRESO',
                categoria: 'DEVOLUCION',
                metodoPago: 'EFECTIVO',
                monto: diferenciaNeta,
                descripcion: `Diferencia cambio producto - Devolución ${devolucion.codigo}`,
                devolucionId: devolucion.id,
              },
              tx,
            );
          } catch (e) {
            this.logger.warn(`Error registrando ingreso caja para devolución ${devolucion.codigo}: ${e?.message ?? e}`);
          }
        } else if (diferenciaNeta < 0) {
          // Refund difference (replacement is cheaper) — EGRESO
          try {
            await this.cajaService.registrarMovimientoSiHayCaja(
              empresaId,
              devolucion.sedeId,
              userId,
              {
                tipo: 'EGRESO',
                categoria: 'DEVOLUCION',
                metodoPago: 'EFECTIVO',
                monto: Math.abs(diferenciaNeta),
                descripcion: `Diferencia cambio producto - Devolución ${devolucion.codigo}`,
                devolucionId: devolucion.id,
              },
              tx,
            );
          } catch (e) {
            this.logger.warn(`Error registrando egreso caja para devolución ${devolucion.codigo}: ${e?.message ?? e}`);
          }
        }
        // If diferenciaNeta === 0, no caja movement needed
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
              productoReemplazo: { select: { id: true, nombre: true, codigoEmpresa: true } },
              varianteReemplazo: { select: { id: true, nombre: true, sku: true } },
            },
          },
          movimientos: true,
        },
      });
    });

    // Invalidar cache de productos después de modificar stock por devolución
    await this.invalidateProductCache(empresaId);

    return result;
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

  /**
   * Reversión total post-anulación: el comprobante de la venta y todas sus
   * notas relacionadas ya fueron anulados ante SUNAT. Esta acción genera la
   * Devolucion espejo que reversiona stock + caja + cancela cuotas pendientes.
   *
   * Política de caja:
   *  - Cajeros/vendedores → requieren caja propia abierta. Si no hay → 400.
   *  - Roles ADMIN (SUPER/EMPRESA/SEDE_ADMIN) → pueden procesar sin caja
   *    abierta; en ese caso `pendienteRegistroCaja=true` para que tesorería
   *    haga el ajuste manual después.
   */
  async crearReversionTotal(
    empresaId: string,
    userId: string,
    userRol: Rol | null | undefined,
    ventaId: string,
    motivo?: string,
  ) {
    const esRolAdmin = !!userRol && ROLES_ESCAPE_CAJA.has(userRol);

    // Caja del usuario que procesa hoy (puede ser cualquier sede de la empresa).
    const cajaAbierta = await this.prisma.caja.findFirst({
      where: { empresaId, usuarioId: userId, estado: 'ABIERTA' },
      select: { id: true, sedeId: true },
    });
    if (!cajaAbierta && !esRolAdmin) {
      throw new BadRequestException(
        'Necesitas una caja abierta para procesar reversiones. Vaya a Caja → Abrir Caja.',
      );
    }

    // Cargar venta + dependencias.
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId },
      include: {
        detalles: true,
        pagos: true,
        cuotas: true,
        comprobante: { include: { notasRelacionadas: true } },
        devoluciones: { include: { items: true } },
      },
    });
    if (!venta) throw new NotFoundException('Venta no encontrada');
    if (!venta.comprobante) {
      throw new BadRequestException(
        'La venta no tiene comprobante electrónico — la reversión total no aplica',
      );
    }
    if (!venta.comprobante.anulado) {
      throw new BadRequestException(
        'El comprobante no está anulado todavía. Anula primero vía Comunicación de Baja o Resumen Diario.',
      );
    }
    const notasNoAnuladas = (venta.comprobante.notasRelacionadas ?? []).filter(
      (n) => !n.anulado,
    );
    if (notasNoAnuladas.length > 0) {
      const codigos = notasNoAnuladas.map((n) => n.codigoGenerado).join(', ');
      throw new BadRequestException(
        `Faltan anular ${notasNoAnuladas.length} nota(s) asociada(s): ${codigos}. Anular antes de reversionar.`,
      );
    }
    const yaTieneReversion = venta.devoluciones.some(
      (d) =>
        d.esReversionTotal &&
        d.estado !== EstadoDevolucion.CANCELADA &&
        d.estado !== EstadoDevolucion.RECHAZADA,
    );
    if (yaTieneReversion) {
      throw new BadRequestException(
        'Esta venta ya tiene una reversión total procesada',
      );
    }

    // Calcular cantidades pendientes (descontando devoluciones parciales previas).
    const yaDevuelto = new Map<string, number>();
    for (const d of venta.devoluciones) {
      if (
        d.estado === EstadoDevolucion.CANCELADA ||
        d.estado === EstadoDevolucion.RECHAZADA
      ) {
        continue;
      }
      for (const it of d.items) {
        const k = `${it.productoId ?? ''}|${it.varianteId ?? ''}`;
        yaDevuelto.set(k, (yaDevuelto.get(k) ?? 0) + it.cantidad);
      }
    }
    const itemsReversion: Array<{
      productoId: string | null;
      varianteId: string | null;
      cantidad: number;
    }> = [];
    for (const det of venta.detalles) {
      if (!det.productoId && !det.varianteId) continue; // servicios sin stock
      const k = `${det.productoId ?? ''}|${det.varianteId ?? ''}`;
      const ya = yaDevuelto.get(k) ?? 0;
      const pendiente = Math.floor(Number(det.cantidad)) - ya;
      if (pendiente <= 0) continue;
      itemsReversion.push({
        productoId: det.productoId,
        varianteId: det.varianteId,
        cantidad: pendiente,
      });
    }

    const codigo = await this.generateCodigo(empresaId);
    const sedeIdDevolucion = cajaAbierta?.sedeId ?? venta.sedeId;
    const motivoFinal =
      motivo?.trim() || 'Reversión total por anulación de comprobante';

    this.logger.info(
      `Iniciando reversión total ${codigo} sobre venta ${venta.codigo} (procesador=${userId}, cajaAbierta=${!!cajaAbierta}, esAdmin=${esRolAdmin})`,
    );

    const devolucion = await this.prisma.$transaction(
      async (tx) => {
        // 1. Crear Devolucion (PROCESADA directo: la baja oficial ya autorizó)
        const dev = await tx.devolucion.create({
          data: {
            codigo,
            empresaId,
            sedeId: sedeIdDevolucion,
            ventaId,
            tipo: TipoDevolucion.CLIENTE_A_TIENDA,
            estado: EstadoDevolucion.PROCESADA,
            clienteId: venta.clienteId,
            motivo: motivoFinal,
            observaciones: `Reversión generada al anular ${venta.comprobante!.codigoGenerado}`,
            tipoReembolso: TipoReembolso.EFECTIVO,
            creadoPor: userId,
            procesadoPor: userId,
            procesadoEn: new Date(),
            esReversionTotal: true,
            cajeroOriginalId: venta.cajeroId,
            pendienteRegistroCaja: !cajaAbierta,
            items: {
              create: itemsReversion.map((it) => ({
                empresaId,
                productoId: it.productoId,
                varianteId: it.varianteId,
                cantidad: it.cantidad,
                motivo: 'OTRO' as any,
                estadoProducto: 'BUENO' as any,
                accion: 'REINGRESAR_STOCK' as any,
                observaciones:
                  'Reingreso por reversión total de venta anulada',
              })),
            },
          },
          include: { items: true },
        });

        // 2. Stock back: ENTRADA_DEVOLUCION_CLIENTE en sede ORIGINAL de la venta.
        for (const item of dev.items) {
          if (!item.productoId && !item.varianteId) continue;
          const stock = await tx.productoStock.findFirst({
            where: {
              sedeId: venta.sedeId,
              productoId: item.productoId ?? null,
              varianteId: item.varianteId ?? null,
            },
          });
          if (!stock) {
            this.logger.warn(
              `Reversión ${dev.codigo}: sin stock record para item ${item.id} (${item.productoId}/${item.varianteId}), saltando movimiento`,
            );
            continue;
          }
          const stockAnterior = stock.stockActual;
          await tx.productoStock.update({
            where: { id: stock.id },
            data: { stockActual: { increment: item.cantidad } },
          });
          await tx.movimientoStock.create({
            data: {
              sedeId: venta.sedeId,
              empresaId,
              productoStockId: stock.id,
              tipo: TipoMovimientoStock.ENTRADA_DEVOLUCION_CLIENTE,
              tipoDocumento: 'DEVOLUCION',
              numeroDocumento: dev.codigo,
              cantidadAnterior: stockAnterior,
              cantidad: item.cantidad,
              cantidadNueva: stockAnterior + item.cantidad,
              motivo: `Reversión total ${dev.codigo} — venta ${venta.codigo} anulada`,
              devolucionId: dev.id,
              usuarioId: userId,
            },
          });
        }

        // 3. Caja: 1 EGRESO por cada PagoVenta no-CREDITO, en la caja del procesador.
        // Si no hay caja abierta y es admin → se omite y queda flag pendiente.
        if (cajaAbierta) {
          for (const pago of venta.pagos) {
            if (pago.metodoPago === 'CREDITO') continue;
            try {
              await this.cajaService.registrarMovimientoSiHayCaja(
                empresaId,
                sedeIdDevolucion,
                userId,
                {
                  tipo: 'EGRESO' as any,
                  categoria: 'DEVOLUCION' as any,
                  metodoPago: pago.metodoPago as any,
                  monto: Number(pago.monto),
                  descripcion: `Reversión venta ${venta.codigo} (${venta.comprobante!.codigoGenerado} anulado)`,
                  devolucionId: dev.id,
                },
                tx,
              );
            } catch (e: any) {
              this.logger.warn(
                `Reversión ${dev.codigo}: error registrando egreso caja (${pago.metodoPago}): ${e?.message ?? e}`,
              );
            }
          }
        }

        // 4. Cuotas pendientes → ANULADA (si era venta a crédito).
        if (venta.esCredito) {
          await tx.cuotaVenta.updateMany({
            where: {
              ventaId,
              estado: { in: ['PENDIENTE', 'PAGADA_PARCIAL', 'VENCIDA'] as any },
            },
            data: { estado: 'ANULADA' as any },
          });
        }

        return dev;
      },
      { timeout: 30000 },
    );

    // 5. Notificar al cajero original (si distinto del procesador). Best-effort.
    if (venta.cajeroId && venta.cajeroId !== userId) {
      try {
        await this.notificacionService.enviarAUsuario(
          venta.cajeroId,
          'Venta revertida',
          `Tu venta ${venta.codigo} fue revertida hoy. Comprobante ${venta.comprobante!.codigoGenerado} anulado.`,
          {
            empresaId,
            data: {
              ventaId,
              devolucionId: devolucion.id,
              tipo: 'REVERSION_TOTAL',
            },
          },
        );
      } catch (e: any) {
        this.logger.warn(
          `Notificación reversión a cajero original falló: ${e?.message ?? e}`,
        );
      }
    }

    await this.invalidateProductCache(empresaId);

    this.logger.info(
      `Reversión total ${devolucion.codigo} procesada (venta ${venta.codigo}, cajeroOrig=${venta.cajeroId}, procesador=${userId}, pendienteCaja=${devolucion.pendienteRegistroCaja})`,
    );

    return devolucion;
  }

  /**
   * Devuelve la reversión total existente para una venta (si ya fue procesada),
   * o null. Útil para que la UI sepa si mostrar el banner "VENTA REVERTIDA".
   */
  async obtenerReversionTotal(ventaId: string, empresaId: string) {
    return this.prisma.devolucion.findFirst({
      where: {
        ventaId,
        empresaId,
        esReversionTotal: true,
        estado: {
          notIn: [EstadoDevolucion.CANCELADA, EstadoDevolucion.RECHAZADA],
        },
      },
      include: {
        items: {
          include: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
          },
        },
      },
    });
  }

  /**
   * Invalidar cache de productos y estadísticas de la empresa
   */
  private async invalidateProductCache(empresaId: string): Promise<void> {
    try {
      const statsKey = this.cacheService.getEmpresaStatsKey(empresaId);
      await this.cacheService.invalidate(statsKey);
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Error al invalidar cache: ${errorMessage}`);
    }
  }
}
