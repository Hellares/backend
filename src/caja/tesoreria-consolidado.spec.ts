import { CajaService } from './caja.service';

/**
 * Tests de getTesoreriaConsolidado: bóveda(s) de efectivo por sede + bancos con
 * saldo y métodos que recaudan. Sin DB: mockeamos prisma.
 */
describe('CajaService.getTesoreriaConsolidado', () => {
  const EMPRESA = 'emp-1';
  let prisma: any;
  let service: CajaService;

  beforeEach(() => {
    prisma = {
      caja: { findMany: jest.fn() },
      movimientoCaja: { groupBy: jest.fn() },
      empresaBanco: { findMany: jest.fn() },
      cuentaRecaudacion: { findMany: jest.fn() },
    };
    service = new CajaService(prisma, {} as any);
  });

  it('calcula la bóveda (efectivo) por sede y lista bancos con sus métodos', async () => {
    prisma.caja.findMany.mockResolvedValue([
      { id: 'central-1', sedeId: 's1', sede: { id: 's1', nombre: 'Sede Principal' } },
    ]);
    // Efectivo: 500 ingreso - 100 egreso = 400. Digital histórico: 50 ingreso.
    prisma.movimientoCaja.groupBy.mockResolvedValue([
      { metodoPago: 'EFECTIVO', tipo: 'INGRESO', _sum: { monto: 500 } },
      { metodoPago: 'EFECTIVO', tipo: 'EGRESO', _sum: { monto: 100 } },
      { metodoPago: 'YAPE', tipo: 'INGRESO', _sum: { monto: 50 } },
    ]);
    prisma.empresaBanco.findMany.mockResolvedValue([
      { id: 'bcp', nombreBanco: 'BCP', numeroCuenta: '191', moneda: 'PEN', esPrincipal: true, saldoActual: 1200 },
      { id: 'wise', nombreBanco: 'Wise', numeroCuenta: '300', moneda: 'USD', esPrincipal: false, saldoActual: 300 },
    ]);
    prisma.cuentaRecaudacion.findMany.mockResolvedValue([
      { metodoPago: 'YAPE', bancoId: 'bcp' },
      { metodoPago: 'PLIN', bancoId: 'bcp' },
    ]);

    const res = await service.getTesoreriaConsolidado(EMPRESA);

    expect(res.bovedas).toHaveLength(1);
    expect(res.bovedas[0]).toMatchObject({
      sedeId: 's1',
      sedeNombre: 'Sede Principal',
      saldoEfectivo: 400,
      saldoDigitalHistorico: 50,
    });
    expect(res.totalEfectivo).toBe(400);
    expect(res.totalDigitalHistorico).toBe(50);

    const bcp = res.bancos.find((b) => b.id === 'bcp');
    expect(bcp).toMatchObject({ saldoActual: 1200, moneda: 'PEN' });
    expect(bcp!.metodos.sort()).toEqual(['PLIN', 'YAPE']);
    const wise = res.bancos.find((b) => b.id === 'wise');
    expect(wise!.metodos).toEqual([]);

    expect(res.bancosPorMoneda).toEqual({ PEN: 1200, USD: 300 });
  });

  it('soporta empresa sin bancos ni central (todo vacío/0)', async () => {
    prisma.caja.findMany.mockResolvedValue([]);
    prisma.empresaBanco.findMany.mockResolvedValue([]);
    prisma.cuentaRecaudacion.findMany.mockResolvedValue([]);

    const res = await service.getTesoreriaConsolidado(EMPRESA);
    expect(res).toMatchObject({
      bovedas: [],
      totalEfectivo: 0,
      totalDigitalHistorico: 0,
      bancos: [],
      bancosPorMoneda: {},
    });
    expect(prisma.movimientoCaja.groupBy).not.toHaveBeenCalled();
  });

  it('saldoActual null en un banco se trata como 0', async () => {
    prisma.caja.findMany.mockResolvedValue([]);
    prisma.empresaBanco.findMany.mockResolvedValue([
      { id: 'b1', nombreBanco: 'X', numeroCuenta: '1', moneda: 'PEN', esPrincipal: false, saldoActual: null },
    ]);
    prisma.cuentaRecaudacion.findMany.mockResolvedValue([]);

    const res = await service.getTesoreriaConsolidado(EMPRESA);
    expect(res.bancos[0].saldoActual).toBe(0);
    expect(res.bancosPorMoneda).toEqual({ PEN: 0 });
  });
});
