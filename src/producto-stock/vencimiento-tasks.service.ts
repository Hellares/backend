import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, TipoNotificacion } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { diaCalendario, inicioDeHoyCalendario } from '../common/utils/date-utils';
import { ESTADOS_LOTE_PRESENTE } from './lote-consumo.helper';

/** Con cuántos días de anticipación se avisa si el producto no dice otra cosa. */
export const DIAS_ALERTA_VENCIMIENTO_DEFAULT = 30;

export interface ResumenVencimientos {
  empresaId: string;
  /** Lotes ACTIVO cuyo día ya pasó y quedaron marcados VENCIDO. */
  lotesMarcadosVencidos: number;
  /** Lotes presentes (con unidades) ya vencidos, marcados hoy o antes. */
  lotesVencidos: number;
  /** Lotes presentes que vencen dentro de la ventana de alerta del producto. */
  lotesPorVencer: number;
  liquidacionesActivadas: number;
  liquidacionesDesactivadas: number;
}

const POLITICA = {
  tipoVencimiento: true,
  diasAlertaVencimiento: true,
  descuentoVencimientoPct: true,
} as const;

/**
 * Fase 3 de lotes: lo que pasa SOLO, cada día, con lo que vence.
 *
 * 1. **Marca VENCIDO** el lote ACTIVO cuyo día ya pasó — por día de
 *    calendario en Perú, no por instante. Sigue contando para el stock
 *    (`ESTADOS_LOTE_PRESENTE`): que se pueda vender lo decide la política del
 *    producto en el guard de la venta, y sacarlo del inventario es una
 *    decisión de una persona (dar de baja).
 * 2. **Liquidación automática**: cuando un lote entra en la ventana de alerta
 *    del producto y el producto tiene `descuentoVencimientoPct`, el stock de
 *    esa sede pasa a liquidación con ese % sobre el precio de venta, motivo
 *    PROXIMO_A_VENCER y SIN autorizador — eso es lo que la distingue de una
 *    liquidación manual con el mismo motivo, que nunca se toca. Y la saca sola
 *    cuando ya no queda ningún lote en la ventana (se vendió, se dio de baja,
 *    se corrigió la fecha).
 * 3. **Avisa** a los administradores de la empresa qué venció, qué está por
 *    vencer y qué entró en liquidación. Una vez por día, solo si hubo algo.
 *
 * ⚠️ Tensión conocida: la liquidación vive en `ProductoStock` (producto +
 * sede), no en el lote. Con dos lotes y uno por vencer se rebaja el stock
 * entero de esa sede; con FEFO el que vence sale primero igual.
 *
 * 🔴 Corre solo con el motor de lotes prendido (`LOTES_FEFO_ENABLED`). Con
 * los lotes sin consumir nunca se agotarían y la liquidación nunca se
 * apagaría.
 */
@Injectable()
export class VencimientoTasksService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly notificacionService: NotificacionService,
    private readonly realtimeInvalidation: RealtimeInvalidationService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(VencimientoTasksService.name);
  }

  /** 05:10 UTC = 00:10 en Lima: recién cambió el día en Perú. */
  @Cron('10 5 * * *')
  async procesarTodas(): Promise<void> {
    if (process.env.LOTES_FEFO_ENABLED !== 'true') {
      this.logger.log('Vencimientos: motor de lotes apagado, no se procesa');
      return;
    }
    // Solo las empresas con algún producto que controle vencimiento: el resto
    // (casi todas hoy) no paga ni una query más.
    const empresas = await this.prisma.producto.findMany({
      where: { tipoVencimiento: { not: 'NINGUNO' }, deletedAt: null },
      distinct: ['empresaId'],
      select: { empresaId: true },
    });
    for (const { empresaId } of empresas) {
      try {
        const r = await this.procesarEmpresa(empresaId);
        this.logger.log(
          `Vencimientos ${empresaId}: ${r.lotesMarcadosVencidos} marcados, ` +
            `${r.lotesVencidos} vencidos, ${r.lotesPorVencer} por vencer, ` +
            `${r.liquidacionesActivadas} liquidaciones nuevas, ` +
            `${r.liquidacionesDesactivadas} cerradas`,
        );
      } catch (e) {
        this.logger.error(
          `Vencimientos ${empresaId}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
  }

  /**
   * Procesa UNA empresa. También se expone por endpoint para probarlo sin
   * esperar a la medianoche.
   */
  async procesarEmpresa(
    empresaId: string,
    opts: { notificar?: boolean } = {},
  ): Promise<ResumenVencimientos> {
    const hoy = inicioDeHoyCalendario();

    // 1. Lo que ya pasó su día: ACTIVO → VENCIDO. Por calendario: el envase
    // vale el día entero.
    const marcados = await this.prisma.lote.updateMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        fechaVencimiento: { not: null, lt: hoy },
      },
      data: { estado: 'VENCIDO' },
    });

    // 2. Cada stock que tiene lotes presentes CON fecha, con la política de
    // su producto (la variante la hereda del padre) y sus lotes en orden.
    const lotesConFecha: Prisma.LoteWhereInput = {
      estado: { in: [...ESTADOS_LOTE_PRESENTE] },
      cantidadActual: { gt: 0 },
      fechaVencimiento: { not: null },
    };
    const stocks = await this.prisma.productoStock.findMany({
      where: { empresaId, lotes: { some: lotesConFecha } },
      select: {
        id: true,
        sedeId: true,
        productoId: true,
        varianteId: true,
        precio: true,
        enLiquidacion: true,
        producto: { select: POLITICA },
        variante: { select: { producto: { select: POLITICA } } },
        lotes: {
          where: lotesConFecha,
          select: { id: true, codigo: true, fechaVencimiento: true },
          orderBy: { fechaVencimiento: 'asc' },
        },
      },
    });

    let lotesVencidos = 0;
    let lotesPorVencer = 0;
    let activadas = 0;
    let desactivadas = 0;
    const cambiados: Array<{
      productoId: string | null;
      varianteId: string | null;
      sedeId: string;
    }> = [];
    // Los stocks que HOY califican para liquidación automática. Lo que esté
    // en liquidación automática y no esté acá, se cierra.
    const vigentes = new Set<string>();

    for (const s of stocks) {
      const politica = s.producto ?? s.variante?.producto;
      if (!politica || politica.tipoVencimiento === 'NINGUNO') continue;

      const dias = politica.diasAlertaVencimiento ?? DIAS_ALERTA_VENCIMIENTO_DEFAULT;
      const limite = inicioDeHoyCalendario(dias);
      lotesVencidos += s.lotes.filter((l) => l.fechaVencimiento! < hoy).length;
      lotesPorVencer += s.lotes.filter(
        (l) => l.fechaVencimiento! >= hoy && l.fechaVencimiento! <= limite,
      ).length;

      // El primero en la fila (FEFO) es el que decide: si ESE está dentro de
      // la ventana, el stock califica.
      const proximo = s.lotes.find((l) => l.fechaVencimiento! <= limite);
      const pct = politica.descuentoVencimientoPct ?? 0;
      if (!proximo || pct <= 0) continue;
      vigentes.add(s.id);

      // Ya está en liquidación (manual o automática): no se pisa.
      if (s.enLiquidacion) continue;
      const precio = s.precio != null ? Number(s.precio) : 0;
      if (precio <= 0) continue;
      const precioLiq = Math.max(0.01, Math.round(precio * (1 - pct / 100) * 100) / 100);

      // `updateMany` con `enLiquidacion: false` en el where: si un admin la
      // activó a mano entre la lectura y acá, gana el admin.
      const r = await this.prisma.productoStock.updateMany({
        where: { id: s.id, enLiquidacion: false },
        data: {
          enLiquidacion: true,
          precioLiquidacion: new Prisma.Decimal(precioLiq),
          motivoLiquidacion: 'PROXIMO_A_VENCER',
          observacionesLiquidacion:
            `Automática: el lote ${proximo.codigo} vence el ` +
            `${diaCalendario(proximo.fechaVencimiento!)} ` +
            `(−${pct}% sobre S/ ${precio.toFixed(2)})`,
          fechaInicioLiquidacion: new Date(),
          fechaFinLiquidacion: null,
          liquidacionAutorizadaPorId: null,
        },
      });
      if (r.count > 0) {
        activadas++;
        cambiados.push({ productoId: s.productoId, varianteId: s.varianteId, sedeId: s.sedeId });
      }
    }

    // 3. Las automáticas que ya no califican se cierran solas. Automática =
    // motivo PROXIMO_A_VENCER y SIN autorizador; una manual con el mismo
    // motivo tiene autorizador y no se toca.
    const automaticas = await this.prisma.productoStock.findMany({
      where: {
        empresaId,
        enLiquidacion: true,
        motivoLiquidacion: 'PROXIMO_A_VENCER',
        liquidacionAutorizadaPorId: null,
      },
      select: { id: true, sedeId: true, productoId: true, varianteId: true },
    });
    for (const a of automaticas) {
      if (vigentes.has(a.id)) continue;
      await this.prisma.productoStock.update({
        where: { id: a.id },
        data: {
          enLiquidacion: false,
          precioLiquidacion: null,
          motivoLiquidacion: null,
          observacionesLiquidacion: null,
          fechaInicioLiquidacion: null,
          fechaFinLiquidacion: null,
          liquidacionAutorizadaPorId: null,
        },
      });
      desactivadas++;
      cambiados.push({ productoId: a.productoId, varianteId: a.varianteId, sedeId: a.sedeId });
    }

    if (cambiados.length) {
      await this.invalidar(empresaId, cambiados);
    }

    const resumen: ResumenVencimientos = {
      empresaId,
      lotesMarcadosVencidos: marcados.count,
      lotesVencidos,
      lotesPorVencer,
      liquidacionesActivadas: activadas,
      liquidacionesDesactivadas: desactivadas,
    };
    if (opts.notificar !== false) await this.avisar(resumen);
    return resumen;
  }

  private async invalidar(
    empresaId: string,
    cambiados: Array<{ productoId: string | null; varianteId: string | null; sedeId: string }>,
  ): Promise<void> {
    try {
      await this.cacheService.invalidate(this.cacheService.getEmpresaStatsKey(empresaId));
      await this.cacheService.invalidateProductosLists(empresaId);
    } catch (e) {
      this.logger.warn(`Vencimientos: no se pudo invalidar cache: ${e instanceof Error ? e.message : e}`);
    }
    for (const c of cambiados) {
      this.realtimeInvalidation.notifyPrecioCambiado({
        empresaId,
        productoId: c.productoId,
        varianteId: c.varianteId,
        sedeId: c.sedeId,
      });
    }
  }

  /** Un aviso por día a los administradores, solo si hubo algo que decir. */
  private async avisar(r: ResumenVencimientos): Promise<void> {
    const partes: string[] = [];
    if (r.lotesMarcadosVencidos > 0) {
      partes.push(`${r.lotesMarcadosVencidos} ${r.lotesMarcadosVencidos === 1 ? 'lote venció' : 'lotes vencieron'}`);
    } else if (r.lotesVencidos > 0) {
      partes.push(`${r.lotesVencidos} ${r.lotesVencidos === 1 ? 'lote vencido sigue' : 'lotes vencidos siguen'} en stock`);
    }
    if (r.lotesPorVencer > 0) partes.push(`${r.lotesPorVencer} por vencer`);
    if (r.liquidacionesActivadas > 0) {
      partes.push(`${r.liquidacionesActivadas} ${r.liquidacionesActivadas === 1 ? 'producto pasó' : 'productos pasaron'} a liquidación`);
    }
    if (!partes.length) return;

    const admins = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId: r.empresaId,
        rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN'] },
        isActive: true,
      },
      select: { usuarioId: true },
    });
    const ids = [...new Set(admins.map((a) => a.usuarioId))];
    if (!ids.length) return;

    try {
      await this.notificacionService.enviarAUsuarios(
        ids,
        'Vencimientos',
        `${partes.join(' · ')}. Revisá el módulo de lotes.`,
        { tipo: TipoNotificacion.SISTEMA, empresaId: r.empresaId },
      );
    } catch (e) {
      this.logger.warn(`Vencimientos: no se pudo avisar: ${e instanceof Error ? e.message : e}`);
    }
  }
}
