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

  // Estados que cierran el ciclo de una orden (ya no está "en taller")
  private static readonly ESTADOS_CERRADOS: EstadoOrdenServicio[] = [
    EstadoOrdenServicio.ENTREGADO,
    EstadoOrdenServicio.CANCELADO,
    EstadoOrdenServicio.FINALIZADO,
  ];

  /**
   * Dashboard consolidado de órdenes de servicio — UNA respuesta con KPIs,
   * embudo de estados, serie mensual, técnicos, equipos y calidad
   * (reingresos / vencidas). `getEstadisticas` queda por compatibilidad
   * con APKs anteriores.
   *
   * Criterios de dinero:
   *  - ingresoTotal   = Σ costoTotal de órdenes CERRADAS con éxito
   *                     (FINALIZADO/ENTREGADO)
   *  - adelantosCobrados = Σ adelanto de todas las órdenes del periodo
   *  - porCobrar      = Σ max(0, costoTotal − adelanto) de órdenes ACTIVAS
   *                     (la plata comprometida que aún no entra)
   */
  async getDashboard(empresaId: string, query: QueryEstadisticasDto) {
    const where: any = { empresaId };
    if (query.fechaDesde || query.fechaHasta) {
      where.creadoEn = {};
      if (query.fechaDesde) where.creadoEn.gte = new Date(query.fechaDesde);
      if (query.fechaHasta) where.creadoEn.lte = new Date(query.fechaHasta);
    }

    // Tercerizaciones del periodo (por fechaSolicitud): las ENVIADAS (yo
    // tercerizo a otro taller) y las RECIBIDAS (otro taller me manda).
    const whereTerceriza: any = {};
    if (where.creadoEn) whereTerceriza.fechaSolicitud = where.creadoEn;

    const [ordenes, tercerizadasEnviadas, tercerizadasRecibidas] =
      await Promise.all([
        this.prisma.ordenServicio.findMany({
          where,
          select: {
            estado: true,
            tipoServicio: true,
            prioridad: true,
            costoTotal: true,
            adelanto: true,
            creadoEn: true,
            actualizadoEn: true,
            fechaEntrega: true,
            cantidadReingresos: true,
            tipoEquipo: true,
            marcaEquipo: true,
            tecnicoId: true,
            tecnico: {
              select: {
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        }),
        this.prisma.tercerizacionServicio.findMany({
          where: { ...whereTerceriza, empresaOrigenId: empresaId },
          select: {
            estado: true,
            precioB2B: true,
            pagadoB2B: true,
            empresaDestino: { select: { nombre: true } },
            ordenOrigen: { select: { costoTotal: true } },
          },
        }),
        this.prisma.tercerizacionServicio.findMany({
          where: { ...whereTerceriza, empresaDestinoId: empresaId },
          select: {
            estado: true,
            precioB2B: true,
            pagadoB2B: true,
            empresaOrigen: { select: { nombre: true } },
          },
        }),
      ]);

    const cerrados = EstadisticasServicioService.ESTADOS_CERRADOS;
    const exitosas: EstadoOrdenServicio[] = [
      EstadoOrdenServicio.FINALIZADO,
      EstadoOrdenServicio.ENTREGADO,
    ];
    const ahora = new Date();
    const r2 = (n: number) => Math.round(n * 100) / 100;

    let ingresoTotal = 0;
    let adelantosCobrados = 0;
    let porCobrar = 0;
    let enTaller = 0;
    let entregadas = 0;
    let canceladas = 0;
    let vencidas = 0;
    let reingresos = 0;
    let sumaHorasCierre = 0;
    let cerradasConTiempo = 0;

    const porEstado = new Map<string, number>();
    const porTipo = new Map<string, { cantidad: number; ingreso: number }>();
    const porPrioridad = new Map<string, number>();
    const porMes = new Map<string, { cantidad: number; ingreso: number }>();
    const tecnicos = new Map<
      string,
      { nombre: string; ordenes: number; cerradas: number; ingreso: number }
    >();
    const equipos = new Map<string, number>();

    for (const o of ordenes) {
      const costo = o.costoTotal ? Number(o.costoTotal) : 0;
      const adelanto = o.adelanto ? Number(o.adelanto) : 0;
      const activa = !cerrados.includes(o.estado);
      const exitosa = exitosas.includes(o.estado);

      porEstado.set(o.estado, (porEstado.get(o.estado) ?? 0) + 1);
      porPrioridad.set(
        o.prioridad,
        (porPrioridad.get(o.prioridad) ?? 0) + 1,
      );

      const tipo = porTipo.get(o.tipoServicio) ?? { cantidad: 0, ingreso: 0 };
      tipo.cantidad += 1;
      if (exitosa) tipo.ingreso += costo;
      porTipo.set(o.tipoServicio, tipo);

      // Serie mensual (hora Perú: shift -5h)
      const peru = new Date(o.creadoEn.getTime() - 5 * 3600 * 1000);
      const mes = `${peru.getUTCFullYear()}-${String(peru.getUTCMonth() + 1).padStart(2, '0')}`;
      const m = porMes.get(mes) ?? { cantidad: 0, ingreso: 0 };
      m.cantidad += 1;
      if (exitosa) m.ingreso += costo;
      porMes.set(mes, m);

      adelantosCobrados += adelanto;
      if (activa) {
        enTaller += 1;
        porCobrar += Math.max(0, costo - adelanto);
        if (o.fechaEntrega && o.fechaEntrega < ahora) vencidas += 1;
      } else if (o.estado === EstadoOrdenServicio.CANCELADO) {
        canceladas += 1;
      } else {
        entregadas += 1;
        ingresoTotal += costo;
        const horas =
          (o.actualizadoEn.getTime() - o.creadoEn.getTime()) / 3600000;
        if (horas >= 0) {
          sumaHorasCierre += horas;
          cerradasConTiempo += 1;
        }
      }
      if (o.cantidadReingresos > 0) reingresos += 1;

      if (o.tecnicoId) {
        const nombre = [
          o.tecnico?.persona?.nombres,
          o.tecnico?.persona?.apellidos,
        ]
          .filter((s) => s && s.trim())
          .join(' ');
        const t = tecnicos.get(o.tecnicoId) ?? {
          nombre: nombre || 'Sin nombre',
          ordenes: 0,
          cerradas: 0,
          ingreso: 0,
        };
        t.ordenes += 1;
        if (exitosa) {
          t.cerradas += 1;
          t.ingreso += costo;
        }
        tecnicos.set(o.tecnicoId, t);
      }

      const equipo = [o.marcaEquipo, o.tipoEquipo]
        .filter((s) => s && s.trim())
        .join(' ');
      if (equipo) equipos.set(equipo, (equipos.get(equipo) ?? 0) + 1);
    }

    // Embudo en el orden real del flujo de trabajo
    const ordenFlujo: EstadoOrdenServicio[] = [
      EstadoOrdenServicio.RECIBIDO,
      EstadoOrdenServicio.EN_DIAGNOSTICO,
      EstadoOrdenServicio.ESPERANDO_APROBACION,
      EstadoOrdenServicio.EN_REPARACION,
      EstadoOrdenServicio.PENDIENTE_PIEZAS,
      EstadoOrdenServicio.TERCERIZADO,
      EstadoOrdenServicio.REPARADO,
      EstadoOrdenServicio.LISTO_ENTREGA,
      EstadoOrdenServicio.ENTREGADO,
      EstadoOrdenServicio.FINALIZADO,
      EstadoOrdenServicio.CANCELADO,
    ];

    return {
      resumen: {
        totalOrdenes: ordenes.length,
        enTaller,
        entregadas,
        canceladas,
        vencidas,
        ingresoTotal: r2(ingresoTotal),
        adelantosCobrados: r2(adelantosCobrados),
        porCobrar: r2(porCobrar),
        reingresos,
        reingresosPct:
          ordenes.length > 0 ? r2((reingresos / ordenes.length) * 100) : 0,
        tiempoPromedioResolucionHoras:
          cerradasConTiempo > 0
            ? r2(sumaHorasCierre / cerradasConTiempo)
            : null,
      },
      porEstado: ordenFlujo
        .filter((e) => porEstado.has(e))
        .map((e) => ({ estado: e, cantidad: porEstado.get(e)! })),
      porTipo: [...porTipo.entries()]
        .map(([tipo, v]) => ({
          tipo,
          cantidad: v.cantidad,
          ingreso: r2(v.ingreso),
        }))
        .sort((a, b) => b.cantidad - a.cantidad),
      porPrioridad: [...porPrioridad.entries()]
        .map(([prioridad, cantidad]) => ({ prioridad, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad),
      porMes: [...porMes.entries()]
        .map(([mes, v]) => ({
          mes,
          cantidad: v.cantidad,
          ingreso: r2(v.ingreso),
        }))
        .sort((a, b) => a.mes.localeCompare(b.mes)),
      topTecnicos: [...tecnicos.entries()]
        .map(([tecnicoId, t]) => ({
          tecnicoId,
          nombre: t.nombre,
          ordenes: t.ordenes,
          cerradas: t.cerradas,
          ingreso: r2(t.ingreso),
        }))
        .sort((a, b) => b.ordenes - a.ordenes)
        .slice(0, 10),
      topEquipos: [...equipos.entries()]
        .map(([equipo, cantidad]) => ({ equipo, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 10),
      tercerizaciones: this.resumirTercerizaciones(
        tercerizadasEnviadas,
        tercerizadasRecibidas,
      ),
    };
  }

  /**
   * Resumen B2B de tercerizaciones:
   *  - ENVIADAS: costoB2B = lo que pago a otros talleres; ganancia
   *    estimada = Σ (costoTotal al cliente − precioB2B) cuando ambos
   *    existen; porPagarB2B = precios acordados aún no pagados.
   *  - RECIBIDAS: ingresoB2B = Σ precioB2B; porCobrarB2B = no pagados.
   *  RECHAZADO/CANCELADO quedan fuera del dinero (solo cuentan en estados).
   */
  private resumirTercerizaciones(
    enviadas: Array<{
      estado: string;
      precioB2B: unknown;
      pagadoB2B: boolean;
      empresaDestino: { nombre: string } | null;
      ordenOrigen: { costoTotal: unknown } | null;
    }>,
    recibidas: Array<{
      estado: string;
      precioB2B: unknown;
      pagadoB2B: boolean;
      empresaOrigen: { nombre: string } | null;
    }>,
  ) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const num = (v: unknown) => (v == null ? 0 : Number(v));
    const muertas = ['RECHAZADO', 'CANCELADO'];

    const porEstado = (
      filas: Array<{ estado: string }>,
    ): Array<{ estado: string; cantidad: number }> => {
      const m = new Map<string, number>();
      for (const f of filas) m.set(f.estado, (m.get(f.estado) ?? 0) + 1);
      return [...m.entries()]
        .map(([estado, cantidad]) => ({ estado, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad);
    };

    let costoB2B = 0;
    let gananciaEstimada = 0;
    let porPagarB2B = 0;
    const partners = new Map<string, { enviadas: number; recibidas: number }>();

    for (const t of enviadas) {
      const nombre = t.empresaDestino?.nombre ?? 'Desconocido';
      const p = partners.get(nombre) ?? { enviadas: 0, recibidas: 0 };
      p.enviadas += 1;
      partners.set(nombre, p);
      if (muertas.includes(t.estado)) continue;
      const precio = num(t.precioB2B);
      costoB2B += precio;
      const costoCliente = num(t.ordenOrigen?.costoTotal);
      if (precio > 0 && costoCliente > 0) {
        gananciaEstimada += costoCliente - precio;
      }
      if (precio > 0 && !t.pagadoB2B) porPagarB2B += precio;
    }

    let ingresoB2B = 0;
    let porCobrarB2B = 0;
    for (const t of recibidas) {
      const nombre = t.empresaOrigen?.nombre ?? 'Desconocido';
      const p = partners.get(nombre) ?? { enviadas: 0, recibidas: 0 };
      p.recibidas += 1;
      partners.set(nombre, p);
      if (muertas.includes(t.estado)) continue;
      const precio = num(t.precioB2B);
      ingresoB2B += precio;
      if (precio > 0 && !t.pagadoB2B) porCobrarB2B += precio;
    }

    return {
      enviadas: {
        total: enviadas.length,
        porEstado: porEstado(enviadas),
        costoB2B: r2(costoB2B),
        gananciaEstimada: r2(gananciaEstimada),
        porPagarB2B: r2(porPagarB2B),
      },
      recibidas: {
        total: recibidas.length,
        porEstado: porEstado(recibidas),
        ingresoB2B: r2(ingresoB2B),
        porCobrarB2B: r2(porCobrarB2B),
      },
      partners: [...partners.entries()]
        .map(([nombre, p]) => ({
          nombre,
          enviadas: p.enviadas,
          recibidas: p.recibidas,
        }))
        .sort(
          (a, b) => b.enviadas + b.recibidas - (a.enviadas + a.recibidas),
        )
        .slice(0, 5),
    };
  }

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
