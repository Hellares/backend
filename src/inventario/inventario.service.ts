import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import {
  EstadoInventario,
  EstadoConteoItem,
  TipoDiferenciaInventario,
  TipoMovimientoStock,
  TipoReporteIncidencia,
  TipoIncidenciaProducto,
  Prisma,
} from '@prisma/client';
import {
  CrearInventarioDto,
  ActualizarInventarioDto,
  RegistrarConteoDto,
} from './dto';

@Injectable()
export class InventarioService {
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
  ) {}

  /**
   * Genera el código único para un inventario
   * Usa el servicio centralizado de códigos
   */
  private async generarCodigoInventario(empresaId: string): Promise<string> {
    return this.configuracionCodigosService.generarCodigoInventario(empresaId);
  }

  /**
   * Crear un nuevo inventario
   */
  async crear(
    empresaId: string,
    dto: CrearInventarioDto,
    usuarioId: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      // Validar que la sede pertenezca a la empresa
      const sede = await tx.sede.findFirst({
        where: {
          id: dto.sedeId,
          empresaId,
        },
      });

      if (!sede) {
        throw new NotFoundException('Sede no encontrada');
      }

      // Generar código único
      const codigo = await this.generarCodigoInventario(empresaId);

      // Crear el inventario
      const inventario = await tx.inventario.create({
        data: {
          codigo,
          empresaId,
          sedeId: dto.sedeId,
          nombre: dto.nombre,
          descripcion: dto.descripcion,
          tipoInventario: dto.tipoInventario,
          fechaPlanificada: new Date(dto.fechaPlanificada),
          responsableId: usuarioId,
          supervisorId: dto.supervisorId,
          incluirTodosProductos: dto.incluirTodosProductos ?? true,
          permitirAjusteAutomatico: dto.permitirAjusteAutomatico ?? false,
          generarReporteIncidencias: dto.generarReporteIncidencias ?? true,
          observaciones: dto.observaciones,
        },
        include: {
          sede: true,
          responsable: {
            include: {
              persona: true,
            },
          },
          supervisor: {
            include: {
              persona: true,
            },
          },
        },
      });

      // Si incluye todos los productos, crear items automáticamente
      if (dto.incluirTodosProductos) {
        await this.generarItemsAutomaticos(tx, inventario.id, empresaId, dto.sedeId);
      }

      return inventario;
    });
  }

  /**
   * Generar items automáticamente para todos los productos de la sede
   */
  private async generarItemsAutomaticos(
    tx: Prisma.TransactionClient,
    inventarioId: string,
    empresaId: string,
    sedeId: string,
  ) {
    const productosStock = await tx.productoStock.findMany({
      where: {
        sedeId,
        empresaId,
      },
      include: {
        producto: true,
        variante: true,
      },
    });

    for (const stock of productosStock) {
      await tx.inventarioItem.create({
        data: {
          inventarioId,
          empresaId,
          sedeId,
          productoStockId: stock.id,
          nombreProducto: stock.variante
            ? `${stock.producto.nombre} - ${stock.variante.nombre}`
            : stock.producto.nombre,
          codigoProducto: stock.producto.codigoSistema,
          cantidadSistema: stock.stockActual,
        },
      });
    }

    // Actualizar total de productos esperados
    await tx.inventario.update({
      where: { id: inventarioId },
      data: {
        totalProductosEsperados: productosStock.length,
      },
    });
  }

  /**
   * Listar inventarios con filtros
   */
  async listar(
    empresaId: string,
    filtros?: {
      sedeId?: string;
      estado?: EstadoInventario;
      tipoInventario?: string;
      fechaDesde?: string;
      fechaHasta?: string;
    },
  ) {
    const where: Prisma.InventarioWhereInput = {
      empresaId,
    };

    if (filtros?.sedeId) {
      where.sedeId = filtros.sedeId;
    }

    if (filtros?.estado) {
      where.estado = filtros.estado;
    }

    if (filtros?.tipoInventario) {
      where.tipoInventario = filtros.tipoInventario as any;
    }

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fechaPlanificada = {};
      if (filtros.fechaDesde) {
        where.fechaPlanificada.gte = new Date(filtros.fechaDesde);
      }
      if (filtros.fechaHasta) {
        where.fechaPlanificada.lte = new Date(filtros.fechaHasta);
      }
    }

    const inventarios = await this.prisma.inventario.findMany({
      where,
      include: {
        sede: true,
        responsable: {
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
        fechaPlanificada: 'desc',
      },
    });

    return inventarios;
  }

  /**
   * Obtener detalle completo de un inventario
   */
  async obtenerPorId(empresaId: string, inventarioId: string) {
    const inventario = await this.prisma.inventario.findFirst({
      where: {
        id: inventarioId,
        empresaId,
      },
      include: {
        sede: true,
        responsable: {
          include: {
            persona: true,
          },
        },
        supervisor: {
          include: {
            persona: true,
          },
        },
        aprobadoPor: {
          include: {
            persona: true,
          },
        },
        reporteIncidencia: true,
        items: {
          include: {
            productoStock: {
              select: {
                id: true,
                producto: { select: { id: true, nombre: true, codigoEmpresa: true, codigoBarras: true } },
                variante: { select: { id: true, nombre: true, sku: true, codigoBarras: true } },
              },
            },
            contadoPor: {
              include: {
                persona: true,
              },
            },
            movimientoStock: true,
          },
          orderBy: {
            nombreProducto: 'asc',
          },
        },
      },
    });

    if (!inventario) {
      throw new NotFoundException('Inventario no encontrado');
    }

    return inventario;
  }

  /**
   * Actualizar inventario
   */
  async actualizar(
    empresaId: string,
    inventarioId: string,
    dto: ActualizarInventarioDto,
  ) {
    const inventario = await this.prisma.inventario.findFirst({
      where: {
        id: inventarioId,
        empresaId,
      },
    });

    if (!inventario) {
      throw new NotFoundException('Inventario no encontrado');
    }

    // Solo se puede editar si está PLANIFICADO o EN_PROCESO
    if (
      inventario.estado !== EstadoInventario.PLANIFICADO &&
      inventario.estado !== EstadoInventario.EN_PROCESO &&
      dto.estado === undefined
    ) {
      throw new BadRequestException(
        'Solo se pueden editar inventarios en estado PLANIFICADO o EN_PROCESO',
      );
    }

    const actualizado = await this.prisma.inventario.update({
      where: { id: inventarioId },
      data: {
        nombre: dto.nombre,
        descripcion: dto.descripcion,
        tipoInventario: dto.tipoInventario,
        estado: dto.estado,
        fechaPlanificada: dto.fechaPlanificada
          ? new Date(dto.fechaPlanificada)
          : undefined,
        supervisorId: dto.supervisorId,
        incluirTodosProductos: dto.incluirTodosProductos,
        permitirAjusteAutomatico: dto.permitirAjusteAutomatico,
        generarReporteIncidencias: dto.generarReporteIncidencias,
        observaciones: dto.observaciones,
        observacionesFinales: dto.observacionesFinales,
      },
      include: {
        sede: true,
        items: true,
      },
    });

    return actualizado;
  }

  /**
   * Iniciar inventario (cambiar a EN_PROCESO)
   */
  async iniciar(empresaId: string, inventarioId: string) {
    const inventario = await this.prisma.inventario.findFirst({
      where: {
        id: inventarioId,
        empresaId,
      },
    });

    if (!inventario) {
      throw new NotFoundException('Inventario no encontrado');
    }

    if (inventario.estado !== EstadoInventario.PLANIFICADO) {
      throw new BadRequestException(
        'Solo se pueden iniciar inventarios en estado PLANIFICADO',
      );
    }

    return await this.prisma.inventario.update({
      where: { id: inventarioId },
      data: {
        estado: EstadoInventario.EN_PROCESO,
        fechaInicio: new Date(),
      },
      include: {
        items: true,
      },
    });
  }

  /**
   * Registrar conteo de un item
   */
  async registrarConteo(
    empresaId: string,
    inventarioId: string,
    itemId: string,
    dto: RegistrarConteoDto,
    usuarioId: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const inventario = await tx.inventario.findFirst({
        where: {
          id: inventarioId,
          empresaId,
        },
      });

      if (!inventario) {
        throw new NotFoundException('Inventario no encontrado');
      }

      if (inventario.estado !== EstadoInventario.EN_PROCESO) {
        throw new BadRequestException(
          'Solo se pueden registrar conteos en inventarios EN_PROCESO',
        );
      }

      const item = await tx.inventarioItem.findFirst({
        where: {
          id: itemId,
          inventarioId,
        },
      });

      if (!item) {
        throw new NotFoundException('Item no encontrado');
      }

      // Calcular diferencia
      const diferencia = dto.cantidadContada - item.cantidadSistema;
      const esDiferencia = diferencia !== 0;

      let tipoRestante: TipoDiferenciaInventario;
      if (diferencia > 0) {
        tipoRestante = TipoDiferenciaInventario.SOBRANTE;
      } else if (diferencia < 0) {
        tipoRestante = TipoDiferenciaInventario.FALTANTE;
      } else {
        tipoRestante = TipoDiferenciaInventario.SIN_DIFERENCIA;
      }

      // Actualizar item
      const itemActualizado = await tx.inventarioItem.update({
        where: { id: itemId },
        data: {
          cantidadContada: dto.cantidadContada,
          diferencia,
          esDiferencia,
          tipoRestante,
          estadoConteo: EstadoConteoItem.CONTADO,
          contadoPorId: usuarioId,
          fechaConteo: new Date(),
          ubicacionFisica: dto.ubicacionFisica,
          loteNumero: dto.loteNumero,
          fechaVencimiento: dto.fechaVencimiento
            ? new Date(dto.fechaVencimiento)
            : null,
          observaciones: dto.observaciones,
          fotoEvidenciaUrl: dto.fotoEvidenciaUrl,
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

      // Actualizar totales del inventario
      await this.actualizarTotalesInventario(tx, inventarioId);

      return itemActualizado;
    });
  }

  /**
   * Finalizar conteo (marcar todos como contados)
   */
  async finalizarConteo(empresaId: string, inventarioId: string) {
    const inventario = await this.prisma.inventario.findFirst({
      where: {
        id: inventarioId,
        empresaId,
      },
      include: {
        items: true,
      },
    });

    if (!inventario) {
      throw new NotFoundException('Inventario no encontrado');
    }

    if (inventario.estado !== EstadoInventario.EN_PROCESO) {
      throw new BadRequestException(
        'Solo se pueden finalizar inventarios EN_PROCESO',
      );
    }

    // Verificar que todos los items estén contados
    const itemsPendientes = inventario.items.filter(
      (item) => item.estadoConteo === EstadoConteoItem.PENDIENTE,
    );

    if (itemsPendientes.length > 0) {
      throw new BadRequestException(
        `Hay ${itemsPendientes.length} items sin contar`,
      );
    }

    return await this.prisma.inventario.update({
      where: { id: inventarioId },
      data: {
        estado: EstadoInventario.CONTEO_COMPLETO,
        fechaFinConteo: new Date(),
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
   * Aprobar inventario
   */
  async aprobar(empresaId: string, inventarioId: string, usuarioId: string) {
    const inventario = await this.prisma.inventario.findFirst({
      where: {
        id: inventarioId,
        empresaId,
      },
    });

    if (!inventario) {
      throw new NotFoundException('Inventario no encontrado');
    }

    if (
      inventario.estado !== EstadoInventario.CONTEO_COMPLETO &&
      inventario.estado !== EstadoInventario.EN_REVISION
    ) {
      throw new BadRequestException(
        'Solo se pueden aprobar inventarios con conteo completo o en revisión',
      );
    }

    return await this.prisma.inventario.update({
      where: { id: inventarioId },
      data: {
        estado: EstadoInventario.APROBADO,
        aprobadoPorId: usuarioId,
        fechaAprobacion: new Date(),
      },
      include: {
        items: {
          where: {
            esDiferencia: true,
          },
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
   * Aplicar ajustes al sistema (actualizar stock según conteo)
   */
  async aplicarAjustes(
    empresaId: string,
    inventarioId: string,
    usuarioId: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      const inventario = await tx.inventario.findFirst({
        where: {
          id: inventarioId,
          empresaId,
        },
        include: {
          items: {
            where: {
              esDiferencia: true,
              ajusteAplicado: false,
            },
            include: {
              productoStock: true,
            },
          },
        },
      });

      if (!inventario) {
        throw new NotFoundException('Inventario no encontrado');
      }

      if (inventario.estado !== EstadoInventario.APROBADO) {
        throw new BadRequestException(
          'Solo se pueden aplicar ajustes a inventarios aprobados',
        );
      }

      // Aplicar ajustes a cada item con diferencia
      for (const item of inventario.items) {
        const stock = item.productoStock;

        // Actualizar stock
        await tx.productoStock.update({
          where: { id: stock.id },
          data: {
            stockActual: item.cantidadContada,
          },
        });

        // Crear movimiento de stock
        const tipoMovimiento =
          item.diferencia > 0
            ? TipoMovimientoStock.AJUSTE_ENTRADA
            : TipoMovimientoStock.AJUSTE_SALIDA;

        const movimiento = await tx.movimientoStock.create({
          data: {
            empresaId,
            sedeId: inventario.sedeId,
            productoStockId: stock.id,
            tipo: tipoMovimiento,
            tipoDocumento: 'INVENTARIO',
            numeroDocumento: inventario.codigo,
            cantidadAnterior: stock.stockActual,
            cantidad: item.diferencia,
            cantidadNueva: item.cantidadContada,
            motivo: `Ajuste por inventario: ${inventario.nombre}`,
            observaciones: item.observaciones || undefined,
            usuarioId,
          },
        });

        // Marcar item como ajustado
        await tx.inventarioItem.update({
          where: { id: item.id },
          data: {
            ajusteAplicado: true,
            movimientoStockId: movimiento.id,
            estadoConteo: EstadoConteoItem.AJUSTADO,
          },
        });
      }

      // Actualizar inventario
      await tx.inventario.update({
        where: { id: inventarioId },
        data: {
          estado: EstadoInventario.AJUSTADO,
          fechaAjuste: new Date(),
        },
      });

      // Si está configurado, generar reporte de incidencias
      if (inventario.generarReporteIncidencias && inventario.items.length > 0) {
        await this.generarReporteIncidencias(
          tx,
          inventarioId,
          empresaId,
          usuarioId,
        );
      }

      return await tx.inventario.findUnique({
        where: { id: inventarioId },
        include: {
          items: {
            include: {
              productoStock: {
                include: {
                  producto: true,
                  variante: true,
                },
              },
              movimientoStock: true,
            },
          },
          reporteIncidencia: true,
        },
      });
    });
  }

  /**
   * Generar reporte de incidencias automáticamente para diferencias
   */
  private async generarReporteIncidencias(
    tx: Prisma.TransactionClient,
    inventarioId: string,
    empresaId: string,
    usuarioId: string,
  ) {
    const inventario = await tx.inventario.findUnique({
      where: { id: inventarioId },
      include: {
        items: {
          where: {
            esDiferencia: true,
          },
          include: {
            productoStock: true,
          },
        },
      },
    });

    if (!inventario || inventario.items.length === 0) {
      return;
    }

    // Generar código para el reporte via servicio centralizado
    const codigo = await this.configuracionCodigosService.generarCodigoReporteIncidencia(empresaId, tx);

    // Crear reporte de incidencias
    const reporte = await tx.reporteIncidencia.create({
      data: {
        codigo,
        empresaId,
        sedeId: inventario.sedeId,
        titulo: `Diferencias de Inventario: ${inventario.nombre}`,
        descripcionGeneral: `Reporte generado automáticamente por el inventario ${inventario.codigo}`,
        tipoReporte: TipoReporteIncidencia.INVENTARIO_COMPLETO,
        fechaIncidente: inventario.fechaFinConteo || new Date(),
        reportadoPorId: usuarioId,
        supervisorId: inventario.supervisorId,
      },
    });

    // Crear items del reporte para cada diferencia
    let totalDanados = 0;
    let totalPerdidos = 0;
    let totalOtros = 0;

    for (const item of inventario.items) {
      const cantidad = Math.abs(item.diferencia);

      // Determinar tipo de incidencia
      let tipo: TipoIncidenciaProducto;
      if (item.diferencia < 0) {
        tipo = TipoIncidenciaProducto.DIFERENCIA_INVENTARIO;
        totalPerdidos += cantidad;
      } else {
        tipo = TipoIncidenciaProducto.DIFERENCIA_INVENTARIO;
        totalOtros += cantidad;
      }

      await tx.reporteIncidenciaItem.create({
        data: {
          reporteId: reporte.id,
          empresaId,
          sedeId: inventario.sedeId,
          productoStockId: item.productoStockId,
          nombreProducto: item.nombreProducto,
          codigoProducto: item.codigoProducto,
          tipo,
          cantidadAfectada: cantidad,
          descripcion: `Diferencia encontrada en inventario: Sistema=${item.cantidadSistema}, Físico=${item.cantidadContada}, Diferencia=${item.diferencia}`,
          observaciones: item.observaciones,
        },
      });
    }

    // Actualizar totales del reporte
    await tx.reporteIncidencia.update({
      where: { id: reporte.id },
      data: {
        totalProductosAfectados: inventario.items.length,
        totalCantidadAfectada: inventario.items.reduce(
          (sum, item) => sum + Math.abs(item.diferencia),
          0,
        ),
        totalDanados,
        totalPerdidos,
        totalOtros,
      },
    });

    // Vincular reporte con inventario
    await tx.inventario.update({
      where: { id: inventarioId },
      data: {
        reporteIncidenciaId: reporte.id,
      },
    });

    return reporte;
  }

  /**
   * Actualizar totales del inventario
   */
  private async actualizarTotalesInventario(
    tx: Prisma.TransactionClient,
    inventarioId: string,
  ) {
    const items = await tx.inventarioItem.findMany({
      where: { inventarioId },
    });

    const itemsContados = items.filter(
      (item) => item.cantidadContada !== null,
    );

    const totalProductosContados = itemsContados.length;
    const totalDiferencias = items.filter((item) => item.esDiferencia).length;
    const totalSobrantes = items
      .filter((item) => item.diferencia > 0)
      .reduce((sum, item) => sum + item.diferencia, 0);
    const totalFaltantes = items
      .filter((item) => item.diferencia < 0)
      .reduce((sum, item) => sum + Math.abs(item.diferencia), 0);

    await tx.inventario.update({
      where: { id: inventarioId },
      data: {
        totalProductosContados,
        totalDiferencias,
        totalSobrantes,
        totalFaltantes,
      },
    });
  }

  /**
   * Cancelar inventario
   */
  async cancelar(empresaId: string, inventarioId: string) {
    const inventario = await this.prisma.inventario.findFirst({
      where: {
        id: inventarioId,
        empresaId,
      },
    });

    if (!inventario) {
      throw new NotFoundException('Inventario no encontrado');
    }

    if (inventario.estado === EstadoInventario.AJUSTADO) {
      throw new BadRequestException(
        'No se puede cancelar un inventario ya ajustado',
      );
    }

    return await this.prisma.inventario.update({
      where: { id: inventarioId },
      data: {
        estado: EstadoInventario.CANCELADO,
      },
    });
  }
}
