import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccionAudit } from '@prisma/client';

export interface AuditLogData {
  usuarioId?: string;
  usuarioEmail?: string;
  empresaId?: string;
  empresaNombre?: string;
  accion: AccionAudit;
  entidad: string;
  entidadId?: string;
  detalle?: string;
  metadata?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(data: AuditLogData) {
    try {
      await this.prisma.auditLog.create({ data });
    } catch (e) {
      // Never fail the main operation because of audit logging
      console.error('[Audit] Error logging:', e?.message);
    }
  }

  async logFromRequest(
    request: any,
    accion: AccionAudit,
    entidad: string,
    detalle: string,
    extra?: { entidadId?: string; metadata?: Record<string, any>; empresaId?: string; empresaNombre?: string },
  ) {
    const user = request?.user;
    const empresa = request?.currentEmpresa;

    await this.log({
      usuarioId: user?.sub || user?.id,
      usuarioEmail: user?.email,
      empresaId: extra?.empresaId || empresa?.id,
      empresaNombre: extra?.empresaNombre || empresa?.nombre,
      accion,
      entidad,
      entidadId: extra?.entidadId,
      detalle,
      metadata: extra?.metadata,
      ip: request?.ip || request?.connection?.remoteAddress,
      userAgent: request?.get?.('user-agent'),
    });
  }

  async query(filters: {
    usuarioId?: string;
    empresaId?: string;
    accion?: AccionAudit;
    entidad?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    search?: string;
    page?: number;
    pageSize?: number;
  }) {
    const { usuarioId, empresaId, accion, entidad, fechaDesde, fechaHasta, search, page = 1, pageSize = 50 } = filters;

    const where: any = {};
    if (usuarioId) where.usuarioId = usuarioId;
    if (empresaId) where.empresaId = empresaId;
    if (accion) where.accion = accion;
    if (entidad) where.entidad = entidad;
    if (search) {
      where.OR = [
        { detalle: { contains: search, mode: 'insensitive' } },
        { usuarioEmail: { contains: search, mode: 'insensitive' } },
        { empresaNombre: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (fechaDesde || fechaHasta) {
      where.creadoEn = {};
      if (fechaDesde) where.creadoEn.gte = new Date(fechaDesde);
      if (fechaHasta) where.creadoEn.lte = new Date(fechaHasta);
    }

    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async getStats() {
    const ahora = new Date();
    const hace24h = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
    const hace7d = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [total, hoy, semana, porAccion] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.count({ where: { creadoEn: { gte: hace24h } } }),
      this.prisma.auditLog.count({ where: { creadoEn: { gte: hace7d } } }),
      this.prisma.$queryRaw<{ accion: string; count: bigint }[]>`
        SELECT "accion", COUNT(*) as count
        FROM "AuditLog"
        WHERE "creadoEn" >= ${hace7d}
        GROUP BY "accion"
        ORDER BY count DESC
      `,
    ]);

    return {
      total,
      hoy,
      semana,
      porAccion: porAccion.map(p => ({
        accion: p.accion,
        count: Number(p.count),
      })),
    };
  }
}
