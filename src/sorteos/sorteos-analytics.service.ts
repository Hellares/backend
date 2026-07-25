import { Injectable } from '@nestjs/common';
import {
  EstadoParticipanteSorteo,
  EstadoPremioSorteo,
  Prisma,
  TipoSorteo,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { round2 } from '../common/utils/money.util';
import { parseEndOfDay, parseStartOfDay } from '../common/utils/date-utils';

export interface SorteoAnalyticsQuery {
  fechaInicio?: string;
  fechaFin?: string;
  tipo?: TipoSorteo;
}

/**
 * Dashboard de analytics de SORTEOS/DINÁMICAS — consolidado en una sola
 * respuesta (mismo patrón que el dashboard de ventas). Todo se ancla en
 * los sorteos cuya fechaSorteo cae en el periodo; participaciones y
 * premios son los de ESOS sorteos.
 *
 * Recaudación por sorteo:
 *  - SORTEO/BINGO con precio: tickets ACTIVOS × precioParticipacion
 *  - DINÁMICA (o sin precio): Σ montoParticipacion de premios no anulados
 *    (en dinámica cada jugada termina registrada como premio)
 */
@Injectable()
export class SorteosAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext(SorteosAnalyticsService.name);
  }

  async getDashboard(empresaId: string, query: SorteoAnalyticsQuery) {
    this.logger.log('Obteniendo dashboard de sorteos');

    const whereSorteo: Prisma.SorteoWhereInput = { empresaId };
    if (query.tipo) whereSorteo.tipo = query.tipo;
    if (query.fechaInicio || query.fechaFin) {
      whereSorteo.fechaSorteo = {};
      if (query.fechaInicio)
        whereSorteo.fechaSorteo.gte = parseStartOfDay(query.fechaInicio);
      if (query.fechaFin)
        whereSorteo.fechaSorteo.lte = parseEndOfDay(query.fechaFin);
    }

    const sorteos = await this.prisma.sorteo.findMany({
      where: whereSorteo,
      select: {
        id: true,
        titulo: true,
        tipo: true,
        canal: true,
        estado: true,
        fechaSorteo: true,
        precioParticipacion: true,
      },
    });
    if (sorteos.length === 0) return this.vacio();

    const ids = sorteos.map((s) => s.id);
    const [participantes, premios] = await Promise.all([
      this.prisma.sorteoParticipante.findMany({
        where: { sorteoId: { in: ids } },
        select: {
          id: true,
          sorteoId: true,
          estado: true,
          dni: true,
          nombre: true,
          creadoEn: true,
          activadoEn: true,
        },
      }),
      this.prisma.sorteoPremio.findMany({
        where: {
          sorteoId: { in: ids },
          estado: { not: EstadoPremioSorteo.ANULADO },
        },
        select: {
          sorteoId: true,
          participanteId: true,
          estado: true,
          modalidad: true,
          esEfectivo: true,
          montoParticipacion: true,
          destinoDepartamento: true,
          destinoProvincia: true,
        },
      }),
    ]);

    // ── Recaudación por sorteo ─────────────────────────────────────────
    const activosPorSorteo = new Map<string, number>();
    for (const p of participantes) {
      if (p.estado === EstadoParticipanteSorteo.ACTIVO) {
        activosPorSorteo.set(
          p.sorteoId,
          (activosPorSorteo.get(p.sorteoId) ?? 0) + 1,
        );
      }
    }
    const premiosMontoPorSorteo = new Map<string, number>();
    for (const pr of premios) {
      premiosMontoPorSorteo.set(
        pr.sorteoId,
        (premiosMontoPorSorteo.get(pr.sorteoId) ?? 0) +
          Number(pr.montoParticipacion ?? 0),
      );
    }
    const recaudadoDe = (s: (typeof sorteos)[number]) => {
      const precio =
        s.precioParticipacion != null ? Number(s.precioParticipacion) : null;
      if (s.tipo !== TipoSorteo.DINAMICA && precio != null) {
        return (activosPorSorteo.get(s.id) ?? 0) * precio;
      }
      return premiosMontoPorSorteo.get(s.id) ?? 0;
    };

    // ── Resumen ────────────────────────────────────────────────────────
    const totalParticipaciones = participantes.length;
    const activas = participantes.filter(
      (p) => p.estado === EstadoParticipanteSorteo.ACTIVO,
    );
    const pendientes = participantes.filter(
      (p) => p.estado === EstadoParticipanteSorteo.PENDIENTE_PAGO,
    ).length;
    const dnisUnicos = new Set(
      participantes.map((p) => p.dni.trim()).filter((d) => d.length > 0),
    );
    const recaudadoTotal = sorteos.reduce((s, so) => s + recaudadoDe(so), 0);
    const entregados = premios.filter(
      (p) => p.estado === EstadoPremioSorteo.ENTREGADO,
    ).length;

    // Tiempo medio registro → activación (qué tan rápido se valida el pago)
    const tiemposMs = activas
      .filter((p) => p.activadoEn)
      .map((p) => p.activadoEn!.getTime() - p.creadoEn.getTime())
      .filter((t) => t >= 0);
    const tiempoValidacionHoras = tiemposMs.length
      ? round2(
          tiemposMs.reduce((a, b) => a + b, 0) /
            tiemposMs.length /
            3600000,
        )
      : null;

    // ── Agrupados por tipo y canal ─────────────────────────────────────
    const participacionesPorSorteo = new Map<string, number>();
    for (const p of participantes) {
      participacionesPorSorteo.set(
        p.sorteoId,
        (participacionesPorSorteo.get(p.sorteoId) ?? 0) + 1,
      );
    }
    const agruparSorteos = (keyDe: (s: (typeof sorteos)[number]) => string) => {
      const m = new Map<
        string,
        { sorteos: number; participaciones: number; recaudado: number }
      >();
      for (const s of sorteos) {
        const k = keyDe(s);
        const e = m.get(k) ?? { sorteos: 0, participaciones: 0, recaudado: 0 };
        e.sorteos += 1;
        e.participaciones += participacionesPorSorteo.get(s.id) ?? 0;
        e.recaudado += recaudadoDe(s);
        m.set(k, e);
      }
      return [...m.entries()]
        .map(([k, e]) => ({ ...e, clave: k, recaudado: round2(e.recaudado) }))
        .sort((a, b) => b.recaudado - a.recaudado);
    };

    // ── Top sorteos ────────────────────────────────────────────────────
    const premiosPorSorteo = new Map<
      string,
      { total: number; entregados: number }
    >();
    for (const pr of premios) {
      const e = premiosPorSorteo.get(pr.sorteoId) ?? {
        total: 0,
        entregados: 0,
      };
      e.total += 1;
      if (pr.estado === EstadoPremioSorteo.ENTREGADO) e.entregados += 1;
      premiosPorSorteo.set(pr.sorteoId, e);
    }
    const topSorteos = sorteos
      .map((s) => ({
        id: s.id,
        titulo: s.titulo,
        tipo: s.tipo,
        canal: s.canal,
        estado: s.estado,
        fechaSorteo: s.fechaSorteo,
        participaciones: participacionesPorSorteo.get(s.id) ?? 0,
        recaudado: round2(recaudadoDe(s)),
        premios: premiosPorSorteo.get(s.id)?.total ?? 0,
        premiosEntregados: premiosPorSorteo.get(s.id)?.entregados ?? 0,
      }))
      .sort((a, b) => b.recaudado - a.recaudado)
      .slice(0, 10);

    // ── Top jugadores (por DNI, solo participaciones pagadas) ──────────
    const sorteoDe = new Map(sorteos.map((s) => [s.id, s]));
    const premioPorParticipante = new Map<string, number>();
    for (const pr of premios) {
      if (pr.participanteId) {
        premioPorParticipante.set(
          pr.participanteId,
          Number(pr.montoParticipacion ?? 0),
        );
      }
    }
    const jugadores = new Map<
      string,
      {
        nombre: string;
        participaciones: number;
        sorteos: Set<string>;
        gastado: number;
      }
    >();
    for (const p of activas) {
      const dni = p.dni.trim();
      if (!dni) continue;
      const e = jugadores.get(dni) ?? {
        nombre: p.nombre,
        participaciones: 0,
        sorteos: new Set<string>(),
        gastado: 0,
      };
      e.participaciones += 1;
      e.sorteos.add(p.sorteoId);
      const s = sorteoDe.get(p.sorteoId);
      const precio =
        s?.precioParticipacion != null ? Number(s.precioParticipacion) : null;
      e.gastado +=
        s?.tipo !== TipoSorteo.DINAMICA && precio != null
          ? precio
          : (premioPorParticipante.get(p.id) ?? 0);
      jugadores.set(dni, e);
    }
    const topJugadores = [...jugadores.entries()]
      .map(([dni, j]) => ({
        dni,
        nombre: j.nombre,
        participaciones: j.participaciones,
        sorteosDistintos: j.sorteos.size,
        gastado: round2(j.gastado),
      }))
      .sort((a, b) => b.participaciones - a.participaciones)
      .slice(0, 10);

    // ── Premios: estado, modalidad y zonas ─────────────────────────────
    const porEstadoPremio = new Map<string, number>();
    const porModalidad = new Map<string, number>();
    const zonas = new Map<string, number>();
    for (const pr of premios) {
      porEstadoPremio.set(
        pr.estado,
        (porEstadoPremio.get(pr.estado) ?? 0) + 1,
      );
      const mod = pr.esEfectivo ? 'EFECTIVO' : pr.modalidad;
      porModalidad.set(mod, (porModalidad.get(mod) ?? 0) + 1);
      const zona =
        [pr.destinoDepartamento, pr.destinoProvincia]
          .filter((z) => z && z.trim())
          .join(' / ') || null;
      if (zona) zonas.set(zona, (zonas.get(zona) ?? 0) + 1);
    }

    // ── Serie diaria de participaciones (hora Perú) ────────────────────
    const MS_H = 3600 * 1000;
    const diaDe = (fecha: Date) => {
      const p = new Date(fecha.getTime() - 5 * MS_H);
      return `${String(p.getUTCDate()).padStart(2, '0')}/${String(
        p.getUTCMonth() + 1,
      ).padStart(2, '0')}`;
    };
    // Últimos 30 días (independiente del filtro de sorteos: mide la
    // actividad RECIENTE del bot registrando/validando jugadores)
    const serie: { dia: string; registradas: number; activadas: number }[] =
      [];
    const idxSerie = new Map<string, number>();
    const hoyPeru = new Date(Date.now() - 5 * MS_H);
    for (let off = 29; off >= 0; off--) {
      const d = new Date(
        Date.UTC(
          hoyPeru.getUTCFullYear(),
          hoyPeru.getUTCMonth(),
          hoyPeru.getUTCDate() - off,
        ) +
          5 * MS_H,
      );
      const key = diaDe(d);
      idxSerie.set(key, serie.length);
      serie.push({ dia: key, registradas: 0, activadas: 0 });
    }
    for (const p of participantes) {
      const iReg = idxSerie.get(diaDe(p.creadoEn));
      if (iReg != null) serie[iReg].registradas += 1;
      if (p.activadoEn) {
        const iAct = idxSerie.get(diaDe(p.activadoEn));
        if (iAct != null) serie[iAct].activadas += 1;
      }
    }

    return {
      resumen: {
        sorteos: sorteos.length,
        abiertos: sorteos.filter((s) => s.estado === 'ABIERTO').length,
        participaciones: totalParticipaciones,
        participantesUnicos: dnisUnicos.size,
        recaudado: round2(recaudadoTotal),
        ticketPromedio:
          dnisUnicos.size > 0
            ? round2(recaudadoTotal / dnisUnicos.size)
            : 0,
        conversionPagoPct:
          totalParticipaciones > 0
            ? round2((activas.length / totalParticipaciones) * 100)
            : 0,
        pendientesValidar: pendientes,
        premios: premios.length,
        premiosEntregados: entregados,
        tiempoValidacionHoras,
      },
      porTipo: agruparSorteos((s) => s.tipo).map((e) => ({
        tipo: e.clave,
        sorteos: e.sorteos,
        participaciones: e.participaciones,
        recaudado: e.recaudado,
      })),
      porCanal: agruparSorteos((s) => s.canal).map((e) => ({
        canal: e.clave,
        sorteos: e.sorteos,
        participaciones: e.participaciones,
        recaudado: e.recaudado,
      })),
      topSorteos,
      topJugadores,
      premiosPorEstado: [...porEstadoPremio.entries()]
        .map(([estado, cantidad]) => ({ estado, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad),
      premiosPorModalidad: [...porModalidad.entries()]
        .map(([modalidad, cantidad]) => ({ modalidad, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad),
      zonasPremios: [...zonas.entries()]
        .map(([zona, cantidad]) => ({ zona, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad)
        .slice(0, 10),
      serieDiaria: serie,
    };
  }

  private vacio() {
    return {
      resumen: {
        sorteos: 0,
        abiertos: 0,
        participaciones: 0,
        participantesUnicos: 0,
        recaudado: 0,
        ticketPromedio: 0,
        conversionPagoPct: 0,
        pendientesValidar: 0,
        premios: 0,
        premiosEntregados: 0,
        tiempoValidacionHoras: null,
      },
      porTipo: [],
      porCanal: [],
      topSorteos: [],
      topJugadores: [],
      premiosPorEstado: [],
      premiosPorModalidad: [],
      zonasPremios: [],
      serieDiaria: [],
    };
  }
}
