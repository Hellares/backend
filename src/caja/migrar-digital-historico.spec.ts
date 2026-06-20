import { CajaService } from './caja.service';

/**
 * Tests de migrarDigitalHistorico (F3c): mueve el digital de tesorería a los
 * bancos según el mapeo de recaudación. Sin DB: mock de prisma + tx.
 */
describe('CajaService.migrarDigitalHistorico', () => {
  const EMPRESA = 'emp-1';
  const USER = 'user-1';
  let prisma: any;
  let tx: any;
  let service: CajaService;

  const setup = (opts: {
    grupos: { metodoPago: string; tipo: string; _sum: { monto: number } }[];
    recaud?: { metodoPago: string; banco: any }[];
    saldoBanco?: number;
  }) => {
    tx = {
      caja: { findMany: jest.fn().mockResolvedValue([{ id: 'central-1', sedeId: 's1', codigo: 'TES-1' }]) },
      cuentaRecaudacion: { findMany: jest.fn().mockResolvedValue(opts.recaud ?? []) },
      movimientoCaja: { groupBy: jest.fn().mockResolvedValue(opts.grupos), create: jest.fn().mockResolvedValue({}) },
      empresaBanco: {
        findUnique: jest.fn().mockResolvedValue({ saldoActual: opts.saldoBanco ?? 1000 }),
        update: jest.fn().mockResolvedValue({}),
      },
      ajusteBanco: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = { $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)) };
    service = new CajaService(prisma, {} as any);
  };

  const bancoPEN = { id: 'bcp', isActive: true, moneda: 'PEN', nombreBanco: 'BCP' };

  it('mueve un método mapeado: EGRESO en central + incrementa banco + AjusteBanco', async () => {
    setup({
      grupos: [{ metodoPago: 'YAPE', tipo: 'INGRESO', _sum: { monto: 200 } }],
      recaud: [{ metodoPago: 'YAPE', banco: bancoPEN }],
      saldoBanco: 1000,
    });
    const res = await service.migrarDigitalHistorico(EMPRESA, USER);

    expect(tx.movimientoCaja.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: 'EGRESO', categoria: 'AJUSTE_TESORERIA', metodoPago: 'YAPE', monto: 200 }),
      }),
    );
    expect(tx.empresaBanco.update).toHaveBeenCalledWith({ where: { id: 'bcp' }, data: { saldoActual: 1200 } });
    expect(tx.ajusteBanco.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipo: 'INGRESO', monto: 200, saldoAnterior: 1000, saldoNuevo: 1200 }),
      }),
    );
    expect(res.totalMovido).toBe(200);
    expect(res.movido).toHaveLength(1);
    expect(res.omitido).toHaveLength(0);
  });

  it('omite método SIN mapeo (queda en tesorería)', async () => {
    setup({
      grupos: [{ metodoPago: 'TARJETA', tipo: 'INGRESO', _sum: { monto: 30 } }],
      recaud: [],
    });
    const res = await service.migrarDigitalHistorico(EMPRESA, USER);
    expect(tx.empresaBanco.update).not.toHaveBeenCalled();
    expect(res.movido).toHaveLength(0);
    expect(res.omitido[0]).toMatchObject({ metodo: 'TARJETA', monto: 30, razon: 'sin cuenta de recaudación' });
  });

  it('omite método con banco no-PEN', async () => {
    setup({
      grupos: [{ metodoPago: 'TRANSFERENCIA', tipo: 'INGRESO', _sum: { monto: 40 } }],
      recaud: [{ metodoPago: 'TRANSFERENCIA', banco: { id: 'usd', isActive: true, moneda: 'USD', nombreBanco: 'Wise' } }],
    });
    const res = await service.migrarDigitalHistorico(EMPRESA, USER);
    expect(tx.empresaBanco.update).not.toHaveBeenCalled();
    expect(res.omitido[0]).toMatchObject({ metodo: 'TRANSFERENCIA', razon: 'banco inactivo o no-PEN' });
  });

  it('NO toca EFECTIVO (bóveda) y es idempotente con saldo 0', async () => {
    setup({
      grupos: [
        { metodoPago: 'EFECTIVO', tipo: 'INGRESO', _sum: { monto: 500 } },
        // Yape ya migrado: ingreso 200 - egreso 200 = 0
        { metodoPago: 'YAPE', tipo: 'INGRESO', _sum: { monto: 200 } },
        { metodoPago: 'YAPE', tipo: 'EGRESO', _sum: { monto: 200 } },
      ],
      recaud: [{ metodoPago: 'YAPE', banco: bancoPEN }],
    });
    const res = await service.migrarDigitalHistorico(EMPRESA, USER);
    expect(tx.empresaBanco.update).not.toHaveBeenCalled();
    expect(res.movido).toHaveLength(0);
    expect(res.totalMovido).toBe(0);
  });
});
