import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstadoOrdenServicio } from '@prisma/client';
import {
  QueryEstadisticasDto,
  EstadisticasServicioResponse,
} from './dto/estadisticas-servicio.dto';

@Injectable()
export class EstadisticasServicioService {
  constructor(private prisma: PrismaService) {}

  async getEstadisticas(
    empresaId: string,
    query: QueryEstadisticasDto,
  ): Promise<EstadisticasServicioResponse> {
    const where: any = { empresaId };

    if (query.fechaDesde && query.fechaHasta) {
      if (new Date(query.fechaDesde) > new Date(query.fechaHasta)) {
        throw new BadRequestException('fechaDesde debe ser anterior a fechaHasta');
      }
    }

    if (query.fechaDesde || query.fechaHasta) {
      where.creadoEn = {};
      if (query.fechaDesde) where.creadoEn.gte = new Date(query.fechaDesde);
      if (query.fechaHasta) where.creadoEn.lte = new Date(query.fechaHasta);
    }

    // Total ordenes
    const totalOrdenes = await this.prisma.ordenServicio.count({ where });

    // Ordenes por estado
    const estadoGroups = await this.prisma.ordenServicio.groupBy({
      by: ['estado'],
      where,
      _count: { id: true },
    });
    const ordenesPorEstado: Record<string, number> = {};
    for (const g of estadoGroups) {
      ordenesPorEstado[g.estado] = g._count.id;
    }

    // Ordenes por tipo
    const tipoGroups = await this.prisma.ordenServicio.groupBy({
      by: ['tipoServicio'],
      where,
      _count: { id: true },
    });
    const ordenesPorTipo: Record<string, number> = {};
    for (const g of tipoGroups) {
      ordenesPorTipo[g.tipoServicio] = g._count.id;
    }

    // Ordenes por mes (optimized)
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const monthStartDate = query.fechaDesde ? new Date(query.fechaDesde) : twelveMonthsAgo;
    const monthEndDate = query.fechaHasta ? new Date(query.fechaHasta) : now;

    const ordenesPorMesRaw: { mes: string; cantidad: bigint }[] =
      await this.prisma.$queryRaw`
        SELECT TO_CHAR("creadoEn", 'YYYY-MM') as mes, COUNT(*)::bigint as cantidad
        FROM "OrdenServicio"
        WHERE "empresaId" = ${empresaId}
          AND "creadoEn" >= ${monthStartDate}
          AND "creadoEn" <= ${monthEndDate}
        GROUP BY TO_CHAR("creadoEn", 'YYYY-MM')
        ORDER BY mes ASC
      `;

    const ordenesPorMes = ordenesPorMesRaw.map((r) => ({
      mes: r.mes,
      cantidad: Number(r.cantidad),
    }));

    // Tiempo promedio de resolucion (RECIBIDO -> FINALIZADO) via SQL
    const avgWhere: any = {
      ...where,
      estado: EstadoOrdenServicio.FINALIZADO,
    };
    const avgResult = await this.prisma.ordenServicio.aggregate({
      where: avgWhere,
      _count: { id: true },
    });

    let tiempoPromedioResolucion = 0;
    if (avgResult._count.id > 0) {
      const tiempoRaw: { avg_hours: bigint | null }[] =
        await this.prisma.$queryRaw`
          SELECT ROUND(AVG(EXTRACT(EPOCH FROM ("actualizadoEn" - "creadoEn")) / 3600))::bigint as avg_hours
          FROM "OrdenServicio"
          WHERE "empresaId" = ${empresaId}
            AND "estado" = 'FINALIZADO'
            AND "creadoEn" >= ${query.fechaDesde ? new Date(query.fechaDesde) : new Date('2000-01-01')}
            AND "creadoEn" <= ${query.fechaHasta ? new Date(query.fechaHasta) : new Date('2100-01-01')}
        `;
      tiempoPromedioResolucion = Number(tiempoRaw[0]?.avg_hours ?? 0);
    }

    // Ingreso total (suma de costoTotal de ordenes finalizadas)
    const ingresoResult = await this.prisma.ordenServicio.aggregate({
      where: {
        ...where,
        estado: EstadoOrdenServicio.FINALIZADO,
        costoTotal: { not: null },
      },
      _sum: { costoTotal: true },
    });
    const ingresoTotal = Number(ingresoResult._sum.costoTotal || 0);

    return {
      totalOrdenes,
      ordenesPorEstado,
      ordenesPorTipo,
      ordenesPorMes,
      tiempoPromedioResolucion,
      ingresoTotal,
    };
  }
}
