import { BadRequestException } from '@nestjs/common';
import { DepositosClienteService } from './depositos-cliente.service';

/**
 * Depósitos del cliente sin repartir + saldo a favor.
 *
 * Invariantes:
 * - Repartir crea un abono por venta SIN ingreso propio (la plata entró con
 *   el depósito) y sube `montoAplicado`. El saldo se consume del depósito
 *   más viejo al más nuevo.
 * - No se reparte más de lo disponible, ni a ventas de otro cliente.
 * - Un depósito con algo repartido no se anula.
 * - La propuesta cubre cuotas COMPLETAS, la que vence primero; lo que no
 *   alcanza para ninguna queda como sobrante (saldo a favor).
 */

const dia = (d: string) => new Date(`${d}T12:00:00Z`);

const deposito = (extra: any = {}) => ({
  id: 'd1', empresaId: 'e1', clienteId: 'ep1', clienteEmpresaId: null,
  monto: 4000, montoAplicado: 0, metodoPago: 'TRANSFERENCIA', referencia: 'OP-9',
  fuente: 'BANCO', bancoId: 'b1', movimientoCajaId: null, anulado: false, ...extra,
});

const make = (opts: { deposito?: any; depositos?: any[]; ventas?: any[] } = {}) => {
  const dep = opts.deposito ?? deposito();
  const tx: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: dep.id }]),
    depositoCliente: {
      findUnique: jest.fn().mockResolvedValue(dep),
      findMany: jest.fn().mockResolvedValue(opts.depositos ?? [dep]),
      update: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { monto: 0, montoAplicado: 0 } }),
    },
    venta: { findMany: jest.fn().mockResolvedValue(opts.ventas ?? []) },
    aplicacionDeposito: { create: jest.fn().mockResolvedValue({}) },
    empresaPersona: { findFirst: jest.fn().mockResolvedValue({ persona: { nombres: 'Ana', apellidos: 'Rios' } }) },
    empresaBanco: { update: jest.fn().mockResolvedValue({}) },
    movimientoCaja: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    ...tx,
    $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    empresaPersona: { findFirst: jest.fn().mockResolvedValue({ persona: { nombres: 'Ana', apellidos: 'Ríos' } }) },
  };
  let n = 0;
  const cxc: any = {
    registrarAbonoEnTx: jest.fn().mockImplementation(() => Promise.resolve({ pagoId: `pago-${++n}` })),
    _configMora: jest.fn().mockResolvedValue(null),
    _toImputable: (c: any) => c,
  };
  return { service: new DepositosClienteService(prisma, {} as any, cxc), prisma, tx, cxc };
};

const venta = (id: string, extra: any = {}) => ({
  id, codigo: id.toUpperCase(), moneda: 'PEN', clienteId: 'ep1', clienteEmpresaId: null, ...extra,
});

describe('Depósitos del cliente (CxC)', () => {
  it('repartir crea un abono por venta sin volver a ingresar la plata', async () => {
    const { service, tx, cxc } = make({ ventas: [venta('v1'), venta('v2')] });
    const res = await service.aplicarSaldo('e1', { clienteId: 'ep1' }, 'u1', [
      { ventaId: 'v1', monto: 2500 },
      { ventaId: 'v2', monto: 1480 },
    ]);
    expect(cxc.registrarAbonoEnTx).toHaveBeenCalledTimes(2);
    expect(cxc.registrarAbonoEnTx).toHaveBeenCalledWith(
      tx, 'e1', 'v1',
      { monto: 2500, metodoPago: 'TRANSFERENCIA', referencia: 'OP-9' },
      'u1',
      { fuente: 'BANCO', bancoId: 'b1' },
    );
    expect(tx.aplicacionDeposito.create).toHaveBeenCalledWith({
      data: { depositoId: 'd1', ventaId: 'v2', monto: 1480, pagoVentaId: 'pago-2', creadoPorId: 'u1' },
    });
    expect(tx.depositoCliente.update).toHaveBeenCalledWith({
      where: { id: 'd1' },
      data: { montoAplicado: { increment: 3980 } },
    });
    expect(res.aplicado).toBe(3980);
    expect(res.saldoAFavor).toBe(20);
  });

  it('el saldo repartido en dos depósitos se consume del más viejo al más nuevo', async () => {
    const { service, tx, cxc } = make({
      depositos: [
        deposito({ id: 'viejo', monto: 4000, montoAplicado: 3980, metodoPago: 'YAPE', referencia: 'A' }),
        deposito({ id: 'nuevo', monto: 1000, montoAplicado: 0, referencia: 'B' }),
      ],
      ventas: [venta('v1')],
    });
    await service.aplicarSaldo('e1', { clienteId: 'ep1' }, 'u1', [{ ventaId: 'v1', monto: 520 }]);
    // S/ 20 del viejo + S/ 500 del nuevo: dos abonos a la misma venta.
    expect(cxc.registrarAbonoEnTx).toHaveBeenNthCalledWith(
      1, tx, 'e1', 'v1', { monto: 20, metodoPago: 'YAPE', referencia: 'A' }, 'u1', { fuente: 'BANCO', bancoId: 'b1' },
    );
    expect(cxc.registrarAbonoEnTx).toHaveBeenNthCalledWith(
      2, tx, 'e1', 'v1', { monto: 500, metodoPago: 'TRANSFERENCIA', referencia: 'B' }, 'u1', { fuente: 'BANCO', bancoId: 'b1' },
    );
    expect(tx.depositoCliente.update).toHaveBeenCalledWith({ where: { id: 'viejo' }, data: { montoAplicado: { increment: 20 } } });
    expect(tx.depositoCliente.update).toHaveBeenCalledWith({ where: { id: 'nuevo' }, data: { montoAplicado: { increment: 500 } } });
  });

  it('no deja repartir más de lo disponible', async () => {
    const { service, cxc } = make({ deposito: deposito({ montoAplicado: 3900 }), ventas: [venta('v1')] });
    await expect(service.aplicarSaldo('e1', { clienteId: 'ep1' }, 'u1', [{ ventaId: 'v1', monto: 150 }])).rejects.toThrow(/supera el saldo a favor/);
    expect(cxc.registrarAbonoEnTx).not.toHaveBeenCalled();
  });

  it('la plata de un cliente no paga la venta de otro', async () => {
    const { service, cxc } = make({ ventas: [venta('v1', { clienteId: 'otro' })] });
    await expect(service.aplicarSaldo('e1', { clienteId: 'ep1' }, 'u1', [{ ventaId: 'v1', monto: 100 }])).rejects.toThrow(/no es de este cliente/);
    expect(cxc.registrarAbonoEnTx).not.toHaveBeenCalled();
  });

  it('el depósito personal no paga una venta de la empresa del mismo contacto', async () => {
    const { service } = make({ ventas: [venta('v1', { clienteEmpresaId: 'ce1' })] });
    await expect(service.aplicarSaldo('e1', { clienteId: 'ep1' }, 'u1', [{ ventaId: 'v1', monto: 100 }])).rejects.toThrow(/no es de este cliente/);
  });

  it('un depósito con algo repartido no se anula', async () => {
    const { service, tx } = make({ deposito: deposito({ montoAplicado: 500 }) });
    await expect(service.anular('e1', 'd1', 'u1', 'error')).rejects.toThrow(BadRequestException);
    expect(tx.empresaBanco.update).not.toHaveBeenCalled();
  });

  it('anular un depósito sin repartir devuelve la plata al banco', async () => {
    const { service, tx } = make();
    await service.anular('e1', 'd1', 'u1', 'se registró dos veces');
    expect(tx.empresaBanco.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { saldoActual: { decrement: 4000 } } });
    expect(tx.depositoCliente.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ anulado: true }) }),
    );
  });

  describe('propuesta de reparto', () => {
    const cuota = (numero: number, saldo: number, vence: string) => ({
      numero, saldoPendiente: saldo, fechaVencimiento: dia(vence), estado: 'PENDIENTE',
    });
    const conCuotas = (id: string, cuotas: any[]) => ({
      id, codigo: id.toUpperCase(), fechaVenta: dia('2026-06-01'), total: 0, totalConInteres: null,
      fechaVencimientoPago: null, pagos: [], cuotas,
    });

    it('cubre cuotas completas por vencimiento y deja el resto a favor', async () => {
      const { service, prisma } = make();
      prisma.venta.findMany.mockResolvedValue([
        conCuotas('v1', [cuota(1, 1000, '2026-07-10'), cuota(2, 1000, '2026-08-10')]),
        conCuotas('v2', [cuota(1, 1500, '2026-07-20'), cuota(2, 1500, '2026-08-20')]),
      ]);
      const res = await service.sugerirReparto('e1', { clienteId: 'ep1' }, 4020);
      // 1000 (v1 c1) + 1500 (v2 c1) + 1000 (v1 c2) = 3500; la c2 de v2 (1500) ya no entra.
      const de = (id: string) => res.ventas.find((v) => v.ventaId === id)!;
      expect(de('v1').sugerido).toBe(2000);
      expect(de('v2').sugerido).toBe(1500);
      expect(res.sugerido).toBe(3500);
      expect(res.sobrante).toBe(520);
      expect(res.deuda).toBe(5000);
    });

    it('S/ 20 que no cubren ninguna cuota quedan enteros a favor', async () => {
      const { service, prisma } = make();
      prisma.venta.findMany.mockResolvedValue([conCuotas('v1', [cuota(1, 300, '2026-07-10')])]);
      const res = await service.sugerirReparto('e1', { clienteId: 'ep1' }, 20);
      expect(res.sugerido).toBe(0);
      expect(res.sobrante).toBe(20);
    });

    it('una cuota que no entra bloquea las siguientes de SU venta, no las de otra', async () => {
      const { service, prisma } = make();
      prisma.venta.findMany.mockResolvedValue([
        conCuotas('v1', [cuota(1, 900, '2026-07-01'), cuota(2, 50, '2026-08-01')]),
        conCuotas('v2', [cuota(1, 200, '2026-09-01')]),
      ]);
      const res = await service.sugerirReparto('e1', { clienteId: 'ep1' }, 300);
      const de = (id: string) => res.ventas.find((v) => v.ventaId === id)!;
      expect(de('v1').sugerido).toBe(0);
      expect(de('v2').sugerido).toBe(200);
      expect(res.sobrante).toBe(100);
    });

    it('una venta sin cuotas se cubre entera o nada', async () => {
      const { service, prisma } = make();
      prisma.venta.findMany.mockResolvedValue([
        { ...conCuotas('v1', []), total: 800, pagos: [{ monto: 300 }], fechaVencimientoPago: dia('2026-07-01') },
      ]);
      const res = await service.sugerirReparto('e1', { clienteId: 'ep1' }, 600);
      expect(res.ventas[0].saldo).toBe(500);
      expect(res.ventas[0].sugerido).toBe(500);
      expect(res.sobrante).toBe(100);
    });
  });
});
