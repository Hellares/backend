import { Prisma } from '@prisma/client';
import { inicioDeHoyCalendario } from '../common/utils/date-utils';
import {
  DIAS_ALERTA_VENCIMIENTO_DEFAULT,
  VencimientoTasksService,
} from './vencimiento-tasks.service';

/**
 * Fase 3 de lotes: lo que pasa SOLO cada día con lo que vence.
 *
 * Lo que se fija:
 *  1. Marca VENCIDO por DÍA de calendario (`lt` la medianoche de hoy en
 *     Perú), no por instante.
 *  2. La liquidación automática se prende cuando el primer lote de la fila
 *     entra en la ventana y el producto tiene %, con el precio correcto; no
 *     pisa una liquidación que ya está (manual o automática).
 *  3. Se apaga sola cuando el stock ya no califica — y SOLO la automática
 *     (sin autorizador): una manual con el mismo motivo no se toca.
 *  4. Sin % solo avisa. Sin nada que decir, no avisa.
 */
describe('VencimientoTasksService', () => {
  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  let prisma: any;
  let cache: any;
  let notif: any;
  let realtime: any;
  let service: VencimientoTasksService;

  const HOY = inicioDeHoyCalendario();
  const enDias = (n: number) => inicioDeHoyCalendario(n);

  const politica = (over: Partial<{
    tipoVencimiento: string;
    diasAlertaVencimiento: number | null;
    descuentoVencimientoPct: number | null;
  }> = {}) => ({
    tipoVencimiento: 'CADUCIDAD',
    diasAlertaVencimiento: null,
    descuentoVencimientoPct: 20,
    ...over,
  });

  const stock = (over: any = {}) => ({
    id: 'ps-1',
    sedeId: 'sede-1',
    productoId: 'prod-1',
    varianteId: null,
    precio: new Prisma.Decimal(10),
    enLiquidacion: false,
    producto: politica(),
    variante: null,
    lotes: [{ id: 'l1', codigo: 'LOTE-1', fechaVencimiento: enDias(5) }],
    ...over,
  });

  /**
   * @param stocks lo que devuelve la primera consulta (stocks con lotes con fecha)
   * @param automaticas lo que devuelve la segunda (liquidaciones automáticas vigentes)
   */
  const build = (stocks: any[], automaticas: any[] = []) => {
    prisma = {
      lote: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      productoStock: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(stocks)
          .mockResolvedValueOnce(automaticas),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      producto: { findMany: jest.fn().mockResolvedValue([]) },
      empresaUsuarioRol: {
        findMany: jest.fn().mockResolvedValue([{ usuarioId: 'admin-1' }]),
      },
    };
    cache = {
      getEmpresaStatsKey: jest.fn().mockReturnValue('k'),
      invalidate: jest.fn().mockResolvedValue(undefined),
      invalidateProductosLists: jest.fn().mockResolvedValue(undefined),
    };
    notif = { enviarAUsuarios: jest.fn().mockResolvedValue(undefined) };
    realtime = { notifyPrecioCambiado: jest.fn() };
    service = new VencimientoTasksService(prisma, cache, notif, realtime, logger as any);
  };

  beforeEach(() => jest.clearAllMocks());

  it('🔴 marca VENCIDO por día de calendario, no por instante', async () => {
    build([]);
    await service.procesarEmpresa('emp-1');

    const where = prisma.lote.updateMany.mock.calls[0][0].where;
    expect(where.estado).toBe('ACTIVO');
    // El umbral es la medianoche UTC de HOY en Perú: el envase vale el día entero.
    expect(where.fechaVencimiento.lt.toISOString()).toBe(HOY.toISOString());
    expect(prisma.lote.updateMany.mock.calls[0][0].data).toEqual({ estado: 'VENCIDO' });
  });

  it('🔑 prende la liquidación automática con el % del producto sobre el precio de venta', async () => {
    build([stock()]);
    const r = await service.procesarEmpresa('emp-1');

    expect(r.liquidacionesActivadas).toBe(1);
    const call = prisma.productoStock.updateMany.mock.calls[0][0];
    // Solo si sigue sin liquidación: si un admin la activó en el medio, gana él.
    expect(call.where).toEqual({ id: 'ps-1', enLiquidacion: false });
    expect(call.data.enLiquidacion).toBe(true);
    expect(call.data.motivoLiquidacion).toBe('PROXIMO_A_VENCER');
    // 10 − 20% = 8.
    expect(Number(call.data.precioLiquidacion)).toBe(8);
    // Sin autorizador: es lo que la marca como AUTOMÁTICA.
    expect(call.data.liquidacionAutorizadaPorId).toBeNull();
    expect(call.data.observacionesLiquidacion).toContain('LOTE-1');
    // Y el catálogo se entera.
    expect(cache.invalidateProductosLists).toHaveBeenCalledWith('emp-1');
    expect(realtime.notifyPrecioCambiado).toHaveBeenCalledTimes(1);
  });

  it('respeta la ventana del producto; sin ventana propia son 30 días', async () => {
    // Vence en 40 días: fuera de la ventana por defecto (30).
    build([stock({ lotes: [{ id: 'l1', codigo: 'L', fechaVencimiento: enDias(40) }] })]);
    const r = await service.procesarEmpresa('emp-1');
    expect(r.liquidacionesActivadas).toBe(0);
    expect(r.lotesPorVencer).toBe(0);
    expect(DIAS_ALERTA_VENCIMIENTO_DEFAULT).toBe(30);

    // Con ventana de 45 días sí entra.
    build([stock({
      producto: politica({ diasAlertaVencimiento: 45 }),
      lotes: [{ id: 'l1', codigo: 'L', fechaVencimiento: enDias(40) }],
    })]);
    const r2 = await service.procesarEmpresa('emp-1');
    expect(r2.liquidacionesActivadas).toBe(1);
    expect(r2.lotesPorVencer).toBe(1);
  });

  it('sin % solo avisa: no toca precios', async () => {
    build([stock({ producto: politica({ descuentoVencimientoPct: 0 }) })]);
    const r = await service.procesarEmpresa('emp-1');

    expect(r.liquidacionesActivadas).toBe(0);
    expect(r.lotesPorVencer).toBe(1);
    expect(prisma.productoStock.updateMany).not.toHaveBeenCalled();
    expect(notif.enviarAUsuarios).toHaveBeenCalledTimes(1);
    expect(notif.enviarAUsuarios.mock.calls[0][2]).toContain('1 por vencer');
  });

  it('🔴 no pisa una liquidación que ya está', async () => {
    build([stock({ enLiquidacion: true })]);
    const r = await service.procesarEmpresa('emp-1');
    expect(r.liquidacionesActivadas).toBe(0);
    expect(prisma.productoStock.updateMany).not.toHaveBeenCalled();
  });

  it('🔑 apaga sola la automática cuando ya no queda lote en la ventana', async () => {
    // El stock ya no aparece entre los que tienen lotes con fecha (se vendió
    // todo / se dio de baja), pero sigue en liquidación automática.
    build([], [{ id: 'ps-1', sedeId: 'sede-1', productoId: 'prod-1', varianteId: null }]);
    const r = await service.procesarEmpresa('emp-1');

    expect(r.liquidacionesDesactivadas).toBe(1);
    const call = prisma.productoStock.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'ps-1' });
    expect(call.data.enLiquidacion).toBe(false);
    expect(call.data.precioLiquidacion).toBeNull();
    // Solo las SIN autorizador: así se pidieron.
    const whereAuto = prisma.productoStock.findMany.mock.calls[1][0].where;
    expect(whereAuto.motivoLiquidacion).toBe('PROXIMO_A_VENCER');
    expect(whereAuto.liquidacionAutorizadaPorId).toBeNull();
  });

  it('la automática que SIGUE calificando no se apaga', async () => {
    build(
      [stock({ enLiquidacion: true })],
      [{ id: 'ps-1', sedeId: 'sede-1', productoId: 'prod-1', varianteId: null }],
    );
    const r = await service.procesarEmpresa('emp-1');
    expect(r.liquidacionesDesactivadas).toBe(0);
    expect(prisma.productoStock.update).not.toHaveBeenCalled();
  });

  it('la variante hereda la política del producto padre', async () => {
    build([stock({
      productoId: null,
      varianteId: 'var-1',
      producto: null,
      variante: { producto: politica() },
    })]);
    const r = await service.procesarEmpresa('emp-1');
    expect(r.liquidacionesActivadas).toBe(1);
  });

  it('un producto que no controla vencimiento no se toca aunque tenga lotes con fecha', async () => {
    build([stock({ producto: politica({ tipoVencimiento: 'NINGUNO' }) })]);
    const r = await service.procesarEmpresa('emp-1');
    expect(r.liquidacionesActivadas).toBe(0);
    expect(r.lotesPorVencer).toBe(0);
    expect(notif.enviarAUsuarios).not.toHaveBeenCalled();
  });

  it('🔴 con el motor de lotes apagado, el cron no corre', async () => {
    const antes = process.env.LOTES_FEFO_ENABLED;
    process.env.LOTES_FEFO_ENABLED = 'false';
    build([]);
    await service.procesarTodas();
    expect(prisma.producto.findMany).not.toHaveBeenCalled();
    process.env.LOTES_FEFO_ENABLED = antes;
  });
});
