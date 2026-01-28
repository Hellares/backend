import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EstadoReporteIncidencia,
  EstadoItemIncidencia,
  AccionIncidenciaProducto,
  TipoMovimientoStock,
  EstadoTransferencia,
  TipoIncidenciaProducto,
  Prisma,
} from '@prisma/client';
import {
  CrearReporteIncidenciaDto,
  ActualizarReporteIncidenciaDto,
  AgregarItemReporteDto,
  ResolverItemDto,
} from './dto';

@Injectable()
export class ReporteIncidenciaService {
  constructor(private prisma: PrismaService) {}

  /**
   * Genera el código único para un reporte de incidencia
   * Formato: RPI-YYYY-NNNN (Reporte de Productos - Año - Número secuencial)
   */
  private async generarCodigoReporte(empresaId: string): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RPI-${year}`;

    // Buscar el último reporte del año actual
    const ultimoReporte = await this.prisma.reporteIncidencia.findFirst({
      where: {
        empresaId,
        codigo: {
          startsWith: prefix,
        },
      },
      orderBy: {
        codigo: 'desc',
      },
    });

    let numeroSecuencial = 1;
    if (ultimoReporte) {
      // Extraer el número del último código (RPI-2025-0001 -> 0001)
      const match = ultimoReporte.codigo.match(/-(\d+)$/);
      if (match) {
        numeroSecuencial = parseInt(match[1], 10) + 1;
      }
    }

    // Formatear con ceros a la izquierda (4 dígitos)
    const numero = numeroSecuencial.toString().padStart(4, '0');
    return `${prefix}-${numero}`;
  }

  /**
   * Crear un nuevo reporte de incidencia
   */
  async crear(
    empresaId: string,
    dto: CrearReporteIncidenciaDto,
    usuarioId: string,
  ) {
    // Validar que la sede pertenezca a la empresa
    const sede = await this.prisma.sede.findFirst({
      where: {
        id: dto.sedeId,
        empresaId,
      },
    });

    if (!sede) {
      throw new NotFoundException('Sede no encontrada o no pertenece a la empresa');
    }

    // Generar código único
    const codigo = await this.generarCodigoReporte(empresaId);

    // Crear el reporte
    const reporte = await this.prisma.reporteIncidencia.create({
      data: {
        codigo,
        empresaId,
        sedeId: dto.sedeId,
        titulo: dto.titulo,
        descripcionGeneral: dto.descripcionGeneral,
        tipoReporte: dto.tipoReporte,
        fechaIncidente: new Date(dto.fechaIncidente),
        reportadoPorId: usuarioId,
        supervisorId: dto.supervisorId,
        observacionesFinales: dto.observacionesFinales,
      },
      include: {
        sede: true,
        reportadoPor: {
          include: {
            persona: true,
          },
        },
        supervisor: {
          include: {
            persona: true,
          },
        },
        items: {
          include: {
            productoStock: {
              include: {
                producto: true,
                variante: true,
              },
            },
          },
        },
      },
    });

    return reporte;
  }

  /**
   * Listar reportes de incidencia con filtros
   */
  async listar(
    empresaId: string,
    filtros?: {
      sedeId?: string;
      estado?: EstadoReporteIncidencia;
      tipoReporte?: string;
      fechaDesde?: string;
      fechaHasta?: string;
    },
  ) {
    const where: Prisma.ReporteIncidenciaWhereInput = {
      empresaId,
    };

    if (filtros?.sedeId) {
      where.sedeId = filtros.sedeId;
    }

    if (filtros?.estado) {
      where.estado = filtros.estado;
    }

    if (filtros?.tipoReporte) {
      where.tipoReporte = filtros.tipoReporte as any;
    }

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fechaIncidente = {};
      if (filtros.fechaDesde) {
        where.fechaIncidente.gte = new Date(filtros.fechaDesde);
      }
      if (filtros.fechaHasta) {
        where.fechaIncidente.lte = new Date(filtros.fechaHasta);
      }
    }

    const reportes = await this.prisma.reporteIncidencia.findMany({
      where,
      include: {
        sede: true,
        reportadoPor: {
          include: {
            persona: true,
          },
        },
        supervisor: {
          include: {
            persona: true,
          },
        },
        _count: {
          select: {
            items: true,
          },
        },
      },
      orderBy: {
        fechaReporte: 'desc',
      },
    });

    return reportes;
  }

  /**
   * Obtener detalle completo de un reporte
   */
  async obtenerPorId(empresaId: string, reporteId: string) {
    const reporte = await this.prisma.reporteIncidencia.findFirst({
      where: {
        id: reporteId,
        empresaId,
      },
      include: {
        sede: true,
        reportadoPor: {
          include: {
            persona: true,
          },
        },
        supervisor: {
          include: {
            persona: true,
          },
        },
        resolvidoPor: {
          include: {
            persona: true,
          },
        },
        aprobadoPor: {
          include: {
            persona: true,
          },
        },
        items: {
          include: {
            productoStock: {
              include: {
                producto: true,
                variante: true,
                sede: true,
              },
            },
            movimientoStock: true,
            transferenciaDevolucion: true,
            resolvidoPor: {
              include: {
                persona: true,
              },
            },
          },
          orderBy: {
            creadoEn: 'asc',
          },
        },
      },
    });

    if (!reporte) {
      throw new NotFoundException('Reporte de incidencia no encontrado');
    }

    return reporte;
  }

  /**
   * Actualizar información del reporte
   */
  async actualizar(
    empresaId: string,
    reporteId: string,
    dto: ActualizarReporteIncidenciaDto,
  ) {
    const reporte = await this.prisma.reporteIncidencia.findFirst({
      where: {
        id: reporteId,
        empresaId,
      },
    });

    if (!reporte) {
      throw new NotFoundException('Reporte de incidencia no encontrado');
    }

    // Solo se puede editar si está en BORRADOR
    if (reporte.estado !== EstadoReporteIncidencia.BORRADOR && dto.estado === undefined) {
      throw new BadRequestException(
        'Solo se pueden editar reportes en estado BORRADOR',
      );
    }

    const actualizado = await this.prisma.reporteIncidencia.update({
      where: { id: reporteId },
      data: {
        titulo: dto.titulo,
        descripcionGeneral: dto.descripcionGeneral,
        tipoReporte: dto.tipoReporte,
        estado: dto.estado,
        fechaIncidente: dto.fechaIncidente ? new Date(dto.fechaIncidente) : undefined,
        supervisorId: dto.supervisorId,
        observacionesFinales: dto.observacionesFinales,
      },
      include: {
        sede: true,
        items: {
          include: {
            productoStock: {
              include: {
                producto: true,
                variante: true,
              },
            },
          },
        },
      },
    });

    return actualizado;
  }

  /**
   * Agregar item (producto) al reporte
   */
  async agregarItem(
    empresaId: string,
    reporteId: string,
    dto: AgregarItemReporteDto,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // Verificar que el reporte existe y está en BORRADOR
      const reporte = await tx.reporteIncidencia.findFirst({
        where: {
          id: reporteId,
          empresaId,
        },
      });

      if (!reporte) {
        throw new NotFoundException('Reporte de incidencia no encontrado');
      }

      if (reporte.estado !== EstadoReporteIncidencia.BORRADOR) {
        throw new BadRequestException(
          'Solo se pueden agregar items a reportes en BORRADOR',
        );
      }

      // Verificar que el producto stock existe y pertenece a la sede del reporte
      const productoStock = await tx.productoStock.findFirst({
        where: {
          id: dto.productoStockId,
          sedeId: reporte.sedeId,
          empresaId,
        },
        include: {
          producto: true,
          variante: true,
        },
      });

      if (!productoStock) {
        throw new NotFoundException(
          'Producto no encontrado en la sede del reporte',
        );
      }

      // Crear el item
      const item = await tx.reporteIncidenciaItem.create({
        data: {
          reporteId,
          empresaId,
          sedeId: reporte.sedeId,
          productoStockId: dto.productoStockId,
          nombreProducto: productoStock.variante
            ? `${productoStock.producto.nombre} - ${productoStock.variante.nombre}`
            : productoStock.producto.nombre,
          codigoProducto: productoStock.producto.codigoSistema,
          tipo: dto.tipo,
          cantidadAfectada: dto.cantidadAfectada,
          descripcion: dto.descripcion,
          observaciones: dto.observaciones,
        },
        include: {
          productoStock: {
            include: {
              producto: true,
              variante: true,
            },
          },
        },
      });

      // Actualizar totales del reporte
      await this.actualizarTotalesReporte(tx, reporteId);

      return item;
    });
  }

  /**
   * Eliminar item del reporte (solo si está en BORRADOR)
   */
  async eliminarItem(empresaId: string, reporteId: string, itemId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const reporte = await tx.reporteIncidencia.findFirst({
        where: {
          id: reporteId,
          empresaId,
        },
      });

      if (!reporte) {
        throw new NotFoundException('Reporte de incidencia no encontrado');
      }

      if (reporte.estado !== EstadoReporteIncidencia.BORRADOR) {
        throw new BadRequestException(
          'Solo se pueden eliminar items de reportes en BORRADOR',
        );
      }

      await tx.reporteIncidenciaItem.delete({
        where: {
          id: itemId,
          reporteId,
        },
      });

      // Actualizar totales del reporte
      await this.actualizarTotalesReporte(tx, reporteId);

      return { mensaje: 'Item eliminado correctamente' };
    });
  }

  /**
   * Enviar reporte para revisión
   */
  async enviarParaRevision(empresaId: string, reporteId: string) {
    const reporte = await this.prisma.reporteIncidencia.findFirst({
      where: {
        id: reporteId,
        empresaId,
      },
      include: {
        items: true,
      },
    });

    if (!reporte) {
      throw new NotFoundException('Reporte de incidencia no encontrado');
    }

    if (reporte.estado !== EstadoReporteIncidencia.BORRADOR) {
      throw new BadRequestException('El reporte ya fue enviado');
    }

    if (reporte.items.length === 0) {
      throw new BadRequestException(
        'El reporte debe tener al menos un producto reportado',
      );
    }

    return await this.prisma.reporteIncidencia.update({
      where: { id: reporteId },
      data: {
        estado: EstadoReporteIncidencia.ENVIADO,
      },
      include: {
        items: {
          include: {
            productoStock: {
              include: {
                producto: true,
                variante: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Aprobar reporte (cambiar a estado APROBADO)
   */
  async aprobar(empresaId: string, reporteId: string, usuarioId: string) {
    const reporte = await this.prisma.reporteIncidencia.findFirst({
      where: {
        id: reporteId,
        empresaId,
      },
    });

    if (!reporte) {
      throw new NotFoundException('Reporte de incidencia no encontrado');
    }

    if (reporte.estado !== EstadoReporteIncidencia.ENVIADO &&
        reporte.estado !== EstadoReporteIncidencia.EN_REVISION) {
      throw new BadRequestException(
        'Solo se pueden aprobar reportes enviados o en revisión',
      );
    }

    return await this.prisma.reporteIncidencia.update({
      where: { id: reporteId },
      data: {
        estado: EstadoReporteIncidencia.APROBADO,
        aprobadoPorId: usuarioId,
        fechaAprobacion: new Date(),
      },
      include: {
        items: {
          include: {
            productoStock: {
              include: {
                producto: true,
                variante: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Rechazar reporte
   */
  async rechazar(
    empresaId: string,
    reporteId: string,
    usuarioId: string,
    motivo?: string,
  ) {
    const reporte = await this.prisma.reporteIncidencia.findFirst({
      where: {
        id: reporteId,
        empresaId,
      },
    });

    if (!reporte) {
      throw new NotFoundException('Reporte de incidencia no encontrado');
    }

    if (reporte.estado !== EstadoReporteIncidencia.ENVIADO &&
        reporte.estado !== EstadoReporteIncidencia.EN_REVISION) {
      throw new BadRequestException(
        'Solo se pueden rechazar reportes enviados o en revisión',
      );
    }

    return await this.prisma.reporteIncidencia.update({
      where: { id: reporteId },
      data: {
        estado: EstadoReporteIncidencia.RECHAZADO,
        aprobadoPorId: usuarioId,
        fechaAprobacion: new Date(),
        observacionesFinales: motivo
          ? `RECHAZADO: ${motivo}`
          : reporte.observacionesFinales,
      },
    });
  }

  /**
   * Resolver un item individual con una acción específica
   */
  async resolverItem(
    empresaId: string,
    reporteId: string,
    itemId: string,
    dto: ResolverItemDto,
    usuarioId: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // Verificar reporte y item
      const item = await tx.reporteIncidenciaItem.findFirst({
        where: {
          id: itemId,
          reporteId,
          empresaId,
        },
        include: {
          reporte: true,
          productoStock: {
            include: {
              producto: true,
              variante: true,
              sede: true,
            },
          },
        },
      });

      if (!item) {
        throw new NotFoundException('Item no encontrado');
      }

      if (item.estadoItem === EstadoItemIncidencia.RESUELTO) {
        throw new BadRequestException('El item ya fue resuelto');
      }

      if (item.reporte.estado !== EstadoReporteIncidencia.APROBADO &&
          item.reporte.estado !== EstadoReporteIncidencia.EN_PROCESO) {
        throw new BadRequestException(
          'Solo se pueden resolver items de reportes aprobados o en proceso',
        );
      }

      let movimientoStockId: string | undefined;
      let transferenciaDevolucionId: string | undefined;

      // Ejecutar la acción correspondiente
      switch (dto.accionTomada) {
        case AccionIncidenciaProducto.MARCAR_DANADO:
          movimientoStockId = await this.marcarComoDanado(
            tx,
            item,
            usuarioId,
            dto.observaciones,
          );
          break;

        case AccionIncidenciaProducto.DAR_DE_BAJA:
          movimientoStockId = await this.darDeBaja(
            tx,
            item,
            usuarioId,
            dto.observaciones,
          );
          break;

        case AccionIncidenciaProducto.ENVIAR_GARANTIA:
          movimientoStockId = await this.enviarGarantia(
            tx,
            item,
            usuarioId,
            dto.observaciones,
          );
          break;

        case AccionIncidenciaProducto.ACEPTAR_PERDIDA:
          movimientoStockId = await this.aceptarPerdida(
            tx,
            item,
            usuarioId,
            dto.observaciones,
          );
          break;

        case AccionIncidenciaProducto.DEVOLVER_SEDE_PRINCIPAL:
          if (!dto.sedeDestinoId) {
            throw new BadRequestException(
              'Se requiere sedeDestinoId para devolver a sede principal',
            );
          }
          transferenciaDevolucionId = await this.crearTransferenciaDevolucion(
            tx,
            item,
            dto.sedeDestinoId,
            usuarioId,
            dto.observaciones,
          );
          break;

        case AccionIncidenciaProducto.AJUSTAR_SISTEMA:
          // No genera movimiento, solo marca como resuelto
          break;

        default:
          throw new BadRequestException('Acción no implementada');
      }

      // Actualizar el item
      const itemActualizado = await tx.reporteIncidenciaItem.update({
        where: { id: itemId },
        data: {
          estadoItem: EstadoItemIncidencia.RESUELTO,
          accionTomada: dto.accionTomada,
          movimientoStockId,
          transferenciaDevolucionId,
          fechaResolucion: new Date(),
          resolvidoPorId: usuarioId,
          observaciones: dto.observaciones
            ? `${item.observaciones || ''}\n\nRESOLUCIÓN: ${dto.observaciones}`
            : item.observaciones,
        },
        include: {
          productoStock: {
            include: {
              producto: true,
              variante: true,
            },
          },
          movimientoStock: true,
          transferenciaDevolucion: true,
        },
      });

      // Verificar si todos los items están resueltos
      await this.verificarYActualizarEstadoReporte(tx, reporteId);

      return itemActualizado;
    });
  }

  /**
   * Marcar producto como dañado
   */
  private async marcarComoDanado(
    tx: Prisma.TransactionClient,
    item: any,
    usuarioId: string,
    observaciones?: string,
  ): Promise<string> {
    const stock = item.productoStock;

    // Actualizar stock (marcar como dañado)
    await tx.productoStock.update({
      where: { id: stock.id },
      data: {
        stockDanado: stock.stockDanado + item.cantidadAfectada,
      },
    });

    // Crear movimiento de stock
    const movimiento = await tx.movimientoStock.create({
      data: {
        empresaId: item.empresaId,
        sedeId: item.sedeId,
        productoStockId: stock.id,
        tipo: TipoMovimientoStock.AJUSTE_MERMA,
        tipoDocumento: 'REPORTE_INCIDENCIA',
        numeroDocumento: item.reporte.codigo,
        cantidadAnterior: stock.stockDanado,
        cantidad: item.cantidadAfectada,
        cantidadNueva: stock.stockDanado + item.cantidadAfectada,
        motivo: `Incidencia: ${item.tipo} - ${item.descripcion}`,
        observaciones,
        usuarioId,
      },
    });

    return movimiento.id;
  }

  /**
   * Dar de baja producto (eliminar del inventario)
   */
  private async darDeBaja(
    tx: Prisma.TransactionClient,
    item: any,
    usuarioId: string,
    observaciones?: string,
  ): Promise<string> {
    const stock = item.productoStock;

    // Actualizar stock (reduce stock total)
    await tx.productoStock.update({
      where: { id: stock.id },
      data: {
        stockActual: stock.stockActual - item.cantidadAfectada,
      },
    });

    // Crear movimiento de stock
    const movimiento = await tx.movimientoStock.create({
      data: {
        empresaId: item.empresaId,
        sedeId: item.sedeId,
        productoStockId: stock.id,
        tipo: TipoMovimientoStock.SALIDA_BAJA,
        tipoDocumento: 'REPORTE_INCIDENCIA',
        numeroDocumento: item.reporte.codigo,
        cantidadAnterior: stock.stockActual,
        cantidad: -item.cantidadAfectada,
        cantidadNueva: stock.stockActual - item.cantidadAfectada,
        motivo: `Baja por incidencia: ${item.tipo} - ${item.descripcion}`,
        observaciones,
        usuarioId,
      },
    });

    return movimiento.id;
  }

  /**
   * Enviar producto a garantía
   */
  private async enviarGarantia(
    tx: Prisma.TransactionClient,
    item: any,
    usuarioId: string,
    observaciones?: string,
  ): Promise<string> {
    const stock = item.productoStock;

    // Actualizar stock (enviar a garantía)
    await tx.productoStock.update({
      where: { id: stock.id },
      data: {
        stockEnGarantia: stock.stockEnGarantia + item.cantidadAfectada,
      },
    });

    // Crear movimiento de stock
    const movimiento = await tx.movimientoStock.create({
      data: {
        empresaId: item.empresaId,
        sedeId: item.sedeId,
        productoStockId: stock.id,
        tipo: TipoMovimientoStock.SALIDA_GARANTIA,
        tipoDocumento: 'REPORTE_INCIDENCIA',
        numeroDocumento: item.reporte.codigo,
        cantidadAnterior: stock.stockEnGarantia,
        cantidad: item.cantidadAfectada,
        cantidadNueva: stock.stockEnGarantia + item.cantidadAfectada,
        motivo: `Envío a garantía: ${item.tipo} - ${item.descripcion}`,
        observaciones,
        usuarioId,
      },
    });

    return movimiento.id;
  }

  /**
   * Aceptar pérdida del producto
   */
  private async aceptarPerdida(
    tx: Prisma.TransactionClient,
    item: any,
    usuarioId: string,
    observaciones?: string,
  ): Promise<string> {
    const stock = item.productoStock;

    // Actualizar stock (reduce stock total)
    await tx.productoStock.update({
      where: { id: stock.id },
      data: {
        stockActual: stock.stockActual - item.cantidadAfectada,
      },
    });

    // Crear movimiento de stock
    const movimiento = await tx.movimientoStock.create({
      data: {
        empresaId: item.empresaId,
        sedeId: item.sedeId,
        productoStockId: stock.id,
        tipo: TipoMovimientoStock.AJUSTE_PERDIDA,
        tipoDocumento: 'REPORTE_INCIDENCIA',
        numeroDocumento: item.reporte.codigo,
        cantidadAnterior: stock.stockActual,
        cantidad: -item.cantidadAfectada,
        cantidadNueva: stock.stockActual - item.cantidadAfectada,
        motivo: `Pérdida aceptada: ${item.tipo} - ${item.descripcion}`,
        observaciones,
        usuarioId,
      },
    });

    return movimiento.id;
  }

  /**
   * Crear transferencia para devolver productos a otra sede
   */
  private async crearTransferenciaDevolucion(
    tx: Prisma.TransactionClient,
    item: any,
    sedeDestinoId: string,
    usuarioId: string,
    observaciones?: string,
  ): Promise<string> {
    // Verificar que la sede destino existe y pertenece a la empresa
    const sedeDestino = await tx.sede.findFirst({
      where: {
        id: sedeDestinoId,
        empresaId: item.empresaId,
      },
    });

    if (!sedeDestino) {
      throw new NotFoundException('Sede destino no encontrada');
    }

    // Generar código de transferencia
    const year = new Date().getFullYear();
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const codigoBase = `TRF-${year}${month}`;

    const ultimaTransferencia = await tx.transferenciaStock.findFirst({
      where: {
        empresaId: item.empresaId,
        codigo: {
          startsWith: codigoBase,
        },
      },
      orderBy: {
        codigo: 'desc',
      },
    });

    let numeroSecuencial = 1;
    if (ultimaTransferencia) {
      const match = ultimaTransferencia.codigo.match(/-(\d+)$/);
      if (match) {
        numeroSecuencial = parseInt(match[1], 10) + 1;
      }
    }

    const codigo = `${codigoBase}-${numeroSecuencial.toString().padStart(4, '0')}`;

    // Crear la transferencia
    const transferencia = await tx.transferenciaStock.create({
      data: {
        empresaId: item.empresaId,
        sedeOrigenId: item.sedeId,
        sedeDestinoId,
        codigo,
        estado: EstadoTransferencia.PENDIENTE,
        motivo: `Devolución por incidencia: ${item.reporte.codigo}`,
        observaciones: observaciones || `Item: ${item.nombreProducto} - ${item.descripcion}`,
        solicitadoPor: usuarioId,
        items: {
          create: {
            empresaId: item.empresaId,
            productoId: item.productoStock.productoId,
            varianteId: item.productoStock.varianteId,
            cantidadSolicitada: item.cantidadAfectada,
            motivo: `Incidencia: ${item.tipo}`,
          },
        },
      },
    });

    return transferencia.id;
  }

  /**
   * Actualizar los totales calculados del reporte
   */
  private async actualizarTotalesReporte(
    tx: Prisma.TransactionClient,
    reporteId: string,
  ) {
    const items = await tx.reporteIncidenciaItem.findMany({
      where: { reporteId },
    });

    const totalProductosAfectados = items.length;
    const totalCantidadAfectada = items.reduce(
      (sum, item) => sum + item.cantidadAfectada,
      0,
    );
    const totalDanados = items
      .filter((item) => item.tipo === TipoIncidenciaProducto.DANADO)
      .reduce((sum, item) => sum + item.cantidadAfectada, 0);
    const totalPerdidos = items
      .filter((item) => item.tipo === TipoIncidenciaProducto.PERDIDO)
      .reduce((sum, item) => sum + item.cantidadAfectada, 0);
    const totalOtros = items
      .filter(
        (item) =>
          item.tipo !== TipoIncidenciaProducto.DANADO &&
          item.tipo !== TipoIncidenciaProducto.PERDIDO,
      )
      .reduce((sum, item) => sum + item.cantidadAfectada, 0);

    await tx.reporteIncidencia.update({
      where: { id: reporteId },
      data: {
        totalProductosAfectados,
        totalCantidadAfectada,
        totalDanados,
        totalPerdidos,
        totalOtros,
      },
    });
  }

  /**
   * Verificar si todos los items están resueltos y actualizar estado del reporte
   */
  private async verificarYActualizarEstadoReporte(
    tx: Prisma.TransactionClient,
    reporteId: string,
  ) {
    const items = await tx.reporteIncidenciaItem.findMany({
      where: { reporteId },
    });

    const todosResueltos = items.every(
      (item) => item.estadoItem === EstadoItemIncidencia.RESUELTO,
    );
    const algunoEnProceso = items.some(
      (item) => item.estadoItem === EstadoItemIncidencia.EN_PROCESO ||
               item.estadoItem === EstadoItemIncidencia.RESUELTO,
    );

    const reporte = await tx.reporteIncidencia.findUnique({
      where: { id: reporteId },
    });

    if (todosResueltos) {
      await tx.reporteIncidencia.update({
        where: { id: reporteId },
        data: {
          estado: EstadoReporteIncidencia.RESUELTO,
          fechaResolucion: new Date(),
        },
      });
    } else if (algunoEnProceso && reporte?.estado === EstadoReporteIncidencia.APROBADO) {
      await tx.reporteIncidencia.update({
        where: { id: reporteId },
        data: {
          estado: EstadoReporteIncidencia.EN_PROCESO,
        },
      });
    }
  }
}
