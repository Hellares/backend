import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ArchivingService {
  private readonly logger = new Logger(ArchivingService.name);

  // Thresholds for partition monitoring alerts
  private static readonly PARTITION_THRESHOLDS: Record<string, number> = {
    // 5M - Logs/Audit
    HistorialOrdenServicio: 5_000_000,
    MovimientoStock: 5_000_000,
    PrecioHistorialSede: 5_000_000,
    // 10M - Transactional
    ServicioComponente: 10_000_000,
    CompraDetalle: 10_000_000,
    CotizacionDetalle: 10_000_000,
    TransferenciaStockItem: 10_000_000,
    ReporteIncidenciaItem: 10_000_000,
    // 20M - Main documents
    OrdenServicio: 20_000_000,
    Compra: 20_000_000,
    Cotizacion: 20_000_000,
    Lote: 20_000_000,
    TransferenciaStock: 20_000_000,
    ReporteIncidencia: 20_000_000,
  };

  constructor(private prisma: PrismaService) {}

  /**
   * CRON: Monthly archiving of old orders (runs 1st of each month at 3 AM)
   * Archives FINALIZADO/CANCELADO orders older than 2 years
   */
  @Cron('0 3 1 * *')
  async archiveOldOrders() {
    this.logger.log('Starting monthly order archiving...');

    const cutoffDate = new Date();
    cutoffDate.setFullYear(cutoffDate.getFullYear() - 2);

    try {
      // Find orders to archive
      const ordersToArchive = await this.prisma.ordenServicio.findMany({
        where: {
          estado: { in: ['FINALIZADO', 'CANCELADO'] },
          actualizadoEn: { lt: cutoffDate },
        },
        select: { id: true },
        take: 1000, // Process in batches
      });

      if (ordersToArchive.length === 0) {
        this.logger.log('No orders to archive.');
        return { archived: 0 };
      }

      const orderIds = ordersToArchive.map(o => o.id);

      // Use raw SQL for bulk archive (much faster than individual inserts)
      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Copy HistorialOrdenServicio to archive
        const archivedHistorial = await tx.$executeRaw`
          INSERT INTO "HistorialOrdenServicioArchivo"
            ("id", "ordenServicioId", "estadoAnterior", "estadoNuevo", "notas",
             "diagnostico", "costoTotal", "comunicarCliente", "creadoPor",
             "creadoEn", "motivoReingreso", "archivedAt", "archivedBy")
          SELECT h."id", h."ordenServicioId", h."estadoAnterior", h."estadoNuevo",
            h."notas", h."diagnostico", h."costoTotal", h."comunicarCliente",
            h."creadoPor", h."creadoEn", h."motivoReingreso",
            NOW(), 'SYSTEM_CRON'
          FROM "HistorialOrdenServicio" h
          WHERE h."ordenServicioId" = ANY(${orderIds})
        `;

        // 2. Copy ServicioComponente to archive
        const archivedComponentes = await tx.$executeRaw`
          INSERT INTO "ServicioComponenteArchivo"
            ("id", "ordenServicioId", "componenteId", "tipoAccion", "estadoComponente",
             "descripcionAccion", "detallesAccion", "costoAccion", "tiempoAccion",
             "costoRepuestos", "resultadoAccion", "pruebaRealizada", "observaciones",
             "garantiaMeses", "fechaGarantia", "creadoEn", "actualizadoEn",
             "archivedAt", "archivedBy")
          SELECT sc."id", sc."ordenServicioId", sc."componenteId", sc."tipoAccion"::text,
            sc."estadoComponente"::text, sc."descripcionAccion", sc."detallesAccion",
            sc."costoAccion", sc."tiempoAccion", sc."costoRepuestos", sc."resultadoAccion",
            sc."pruebaRealizada", sc."observaciones", sc."garantiaMeses", sc."fechaGarantia",
            sc."creadoEn", sc."actualizadoEn", NOW(), 'SYSTEM_CRON'
          FROM "ServicioComponente" sc
          WHERE sc."ordenServicioId" = ANY(${orderIds})
        `;

        // 3. Copy OrdenServicio to archive
        const archivedOrdenes = await tx.$executeRaw`
          INSERT INTO "OrdenServicioArchivo"
            ("id", "empresaId", "clienteId", "tecnicoId", "sedeId", "codigo",
             "tipoServicio", "prioridad", "tipoEquipo", "marcaEquipo", "numeroSerie",
             "modeloEquipoId", "diagnostico", "descripcionProblema", "sintomas",
             "costoTotal", "adelanto", "descuento", "metodoPagoAdelanto",
             "tiempoEstimado", "fechaEntrega", "estado",
             "estadoDiagnostico", "notas", "accesorios", "condicionEquipo",
             "datosPersonalizados", "servicioId", "comprobanteId",
             "cantidadReingresos", "motivoReingreso", "creadoEn", "actualizadoEn",
             "archivedAt", "archivedBy")
          SELECT os."id", os."empresaId", os."clienteId", os."tecnicoId", os."sedeId",
            os."codigo", os."tipoServicio"::text, os."prioridad"::text, os."tipoEquipo",
            os."marcaEquipo", os."numeroSerie", os."modeloEquipoId", os."diagnostico",
            os."descripcionProblema", os."sintomas", os."costoTotal", os."adelanto",
            os."descuento", os."metodoPagoAdelanto", os."tiempoEstimado",
            os."fechaEntrega", os."estado"::text, os."estadoDiagnostico"::text, os."notas",
            os."accesorios", os."condicionEquipo", os."datosPersonalizados", os."servicioId",
            os."comprobanteId", os."cantidadReingresos", os."motivoReingreso",
            os."creadoEn", os."actualizadoEn", NOW(), 'SYSTEM_CRON'
          FROM "OrdenServicio" os
          WHERE os."id" = ANY(${orderIds})
        `;

        // 4. Delete from source tables (order matters due to FK constraints)
        await tx.$executeRaw`
          DELETE FROM "HistorialOrdenServicio"
          WHERE "ordenServicioId" = ANY(${orderIds})
        `;
        await tx.$executeRaw`
          DELETE FROM "ServicioComponente"
          WHERE "ordenServicioId" = ANY(${orderIds})
        `;
        await tx.$executeRaw`
          DELETE FROM "OrdenServicio"
          WHERE "id" = ANY(${orderIds})
        `;

        return {
          ordenes: archivedOrdenes,
          componentes: archivedComponentes,
          historial: archivedHistorial
        };
      }, { timeout: 120000 }); // 2 min timeout for large batches

      this.logger.log(
        `Archived ${result.ordenes} orders, ${result.componentes} components, ${result.historial} history entries`
      );

      return { archived: result.ordenes, details: result };
    } catch (error) {
      this.logger.error('Error archiving orders:', error);
      throw error;
    }
  }

  /**
   * CRON: Monthly table size monitoring (runs 1st of each month at 4 AM)
   * Checks table sizes against partition thresholds
   */
  @Cron('0 4 1 * *')
  async monitorTableSizes() {
    this.logger.log('Starting monthly table size monitoring...');

    const alerts: { table: string; count: number; threshold: number }[] = [];

    for (const [table, threshold] of Object.entries(ArchivingService.PARTITION_THRESHOLDS)) {
      try {
        const allowedTables = Object.keys(ArchivingService.PARTITION_THRESHOLDS);
        if (!allowedTables.includes(table)) continue;
        const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM ${Prisma.raw(`"${table}"`)}
        `;
        const count = Number(result[0].count);

        if (count >= threshold) {
          alerts.push({ table, count, threshold });
          this.logger.warn(
            `TABLE "${table}" has ${count.toLocaleString()} rows (threshold: ${threshold.toLocaleString()}). Consider partitioning.`
          );
        } else {
          this.logger.log(
            `"${table}": ${count.toLocaleString()} / ${threshold.toLocaleString()} rows`
          );
        }
      } catch (error) {
        // Table might not exist yet, skip
        this.logger.debug(`Skipping "${table}": ${error.message}`);
      }
    }

    if (alerts.length > 0) {
      this.logger.warn(
        `${alerts.length} table(s) exceeded partition thresholds!`
      );
    }

    return { alerts, checkedAt: new Date() };
  }

  /**
   * Manual trigger: Get current table sizes (for admin dashboard)
   */
  async getTableSizes(): Promise<{ table: string; count: number; threshold: number; percentage: number }[]> {
    const sizes: { table: string; count: number; threshold: number; percentage: number }[] = [];

    for (const [table, threshold] of Object.entries(ArchivingService.PARTITION_THRESHOLDS)) {
      try {
        const allowedTables = Object.keys(ArchivingService.PARTITION_THRESHOLDS);
        if (!allowedTables.includes(table)) continue;
        const result = await this.prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM ${Prisma.raw(`"${table}"`)}
        `;
        const count = Number(result[0].count);
        sizes.push({
          table,
          count,
          threshold,
          percentage: Math.round((count / threshold) * 100)
        });
      } catch {
        sizes.push({ table, count: 0, threshold, percentage: 0 });
      }
    }

    return sizes.sort((a, b) => b.percentage - a.percentage);
  }
}
