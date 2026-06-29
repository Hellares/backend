import { BadRequestException } from '@nestjs/common';
import { aplicarPagoCompra, revertirPagoCompra } from './aplicar-pago-compra.util';

/**
 * Tests del helper compartido de pago de compra (ruteo TESORERIA/CAJA/BANCO).
 * Lo usan tanto CxP (registrarPago) como la confirmación de compra al contado.
 */
describe('aplicarPagoCompra', () => {
  let tx: any;
  let caja: any;

  const base = {
    empresaId: 'emp-1',
    compraId: 'compra-1',
    usuarioId: 'user-1',
    sedeId: 'sede-1',
    nombreProveedor: 'Proveedor SAC',
    codigo: 'COM-1',
    moneda: 'PEN',
    monto: 100,
  };

  beforeEach(() => {
    tx = {
      empresaBanco: {
        findFirst: jest.fn().mockResolvedValue({ id: 'banco-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      caja: { findFirst: jest.fn().mockResolvedValue(null) },
      pagoCompra: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pago-1', ...data })) },
    };
    caja = {
      getOrCreateCajaCentral: jest.fn().mockResolvedValue({ id: 'central-1' }),
      crearMovimientoAutomatico: jest.fn().mockResolvedValue({ id: 'mov-1' }),
    };
  });

  it('EFECTIVO por default → TESORERIA (Caja Central) + pago con movimientoCajaId', async () => {
    const pago = await aplicarPagoCompra(tx, caja, { ...base, metodoPago: 'EFECTIVO' as any });
    expect(caja.getOrCreateCajaCentral).toHaveBeenCalledWith('emp-1', 'sede-1', tx);
    expect(caja.crearMovimientoAutomatico).toHaveBeenCalledWith(
      'emp-1', 'central-1',
      expect.objectContaining({ tipo: 'EGRESO', categoria: 'PAGO_PROVEEDOR', monto: 100 }),
      tx,
    );
    expect(pago).toMatchObject({ fuente: 'TESORERIA', movimientoCajaId: 'mov-1' });
  });

  it('fuente=CAJA con caja abierta → EGRESO en la operativa', async () => {
    tx.caja.findFirst.mockResolvedValue({ id: 'caja-op' });
    const pago = await aplicarPagoCompra(tx, caja, { ...base, metodoPago: 'EFECTIVO' as any, fuente: 'CAJA' as any });
    expect(caja.crearMovimientoAutomatico).toHaveBeenCalledWith('emp-1', 'caja-op', expect.anything(), tx);
    expect(pago).toMatchObject({ fuente: 'CAJA' });
  });

  it('fuente=CAJA sin caja abierta → BadRequest', async () => {
    tx.caja.findFirst.mockResolvedValue(null);
    await expect(
      aplicarPagoCompra(tx, caja, { ...base, metodoPago: 'EFECTIVO' as any, fuente: 'CAJA' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('CxP-4: fuente=CAJA pero el movimiento sale null → BadRequest, NO crea el pago', async () => {
    tx.caja.findFirst.mockResolvedValue({ id: 'caja-op' });
    caja.crearMovimientoAutomatico.mockResolvedValue(null);
    await expect(
      aplicarPagoCompra(tx, caja, { ...base, metodoPago: 'EFECTIVO' as any, fuente: 'CAJA' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.pagoCompra.create).not.toHaveBeenCalled();
  });

  it('CxP-4: fuente=TESORERIA pero el movimiento sale null → BadRequest, NO crea el pago', async () => {
    caja.crearMovimientoAutomatico.mockResolvedValue(null);
    await expect(
      aplicarPagoCompra(tx, caja, { ...base, metodoPago: 'EFECTIVO' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.pagoCompra.create).not.toHaveBeenCalled();
  });

  it('digital por default → BANCO, decrementa saldo + pago con bancoId', async () => {
    const pago = await aplicarPagoCompra(tx, caja, { ...base, metodoPago: 'YAPE' as any, bancoId: 'banco-1' });
    expect(tx.empresaBanco.update).toHaveBeenCalledWith({ where: { id: 'banco-1' }, data: { saldoActual: { decrement: 100 } } });
    expect(pago).toMatchObject({ fuente: 'BANCO', bancoId: 'banco-1' });
    expect(caja.crearMovimientoAutomatico).not.toHaveBeenCalled();
  });

  it('fuente=BANCO sin bancoId → BadRequest', async () => {
    await expect(
      aplicarPagoCompra(tx, caja, { ...base, metodoPago: 'YAPE' as any, fuente: 'BANCO' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('EFECTIVO con fuente=BANCO → BadRequest', async () => {
    await expect(
      aplicarPagoCompra(tx, caja, { ...base, metodoPago: 'EFECTIVO' as any, fuente: 'BANCO' as any, bancoId: 'banco-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moneda USD pagada desde Tesorería → BadRequest (debe ser banco)', async () => {
    await expect(
      aplicarPagoCompra(tx, caja, { ...base, moneda: 'USD', metodoPago: 'TRANSFERENCIA' as any, fuente: 'TESORERIA' as any }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('compra USD pagada desde banco PEN → BadRequest (moneda no coincide)', async () => {
    tx.empresaBanco.findFirst.mockResolvedValue({ id: 'banco-pen', moneda: 'PEN' });
    await expect(
      aplicarPagoCompra(tx, caja, {
        ...base, moneda: 'USD', metodoPago: 'TRANSFERENCIA' as any, fuente: 'BANCO' as any, bancoId: 'banco-pen',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.empresaBanco.update).not.toHaveBeenCalled();
  });

  it('compra USD pagada desde banco USD → OK, decrementa', async () => {
    tx.empresaBanco.findFirst.mockResolvedValue({ id: 'banco-usd', moneda: 'USD' });
    const pago = await aplicarPagoCompra(tx, caja, {
      ...base, moneda: 'USD', metodoPago: 'TRANSFERENCIA' as any, fuente: 'BANCO' as any, bancoId: 'banco-usd',
    });
    expect(tx.empresaBanco.update).toHaveBeenCalledWith({ where: { id: 'banco-usd' }, data: { saldoActual: { decrement: 100 } } });
    expect(pago).toMatchObject({ fuente: 'BANCO', bancoId: 'banco-usd' });
  });
});

describe('revertirPagoCompra', () => {
  let tx: any;
  let caja: any;

  beforeEach(() => {
    tx = {
      movimientoCaja: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'mov-rev' }),
        // Por default la caja origen está ABIERTA.
        findUnique: jest.fn().mockResolvedValue({
          id: 'mov-1',
          empresaId: 'emp-1',
          metodoPago: 'EFECTIVO',
          compraId: 'compra-1',
          caja: {
            id: 'caja-op',
            estado: 'ABIERTA',
            sedeId: 'sede-1',
            codigo: 'CAJA-01',
            fechaCierre: null,
          },
        }),
      },
      empresaBanco: { update: jest.fn().mockResolvedValue({}) },
      pagoCompra: { update: jest.fn().mockResolvedValue({ anulado: true }) },
    };
    caja = {
      getOrCreateCajaCentral: jest.fn().mockResolvedValue({ id: 'central-1' }),
    };
  });

  it('BANCO → devuelve el saldo (increment) y marca el pago anulado', async () => {
    await revertirPagoCompra(
      tx,
      caja,
      { id: 'pago-1', monto: 100, fuente: 'BANCO' as any, bancoId: 'banco-1', movimientoCajaId: null },
      'user-1',
      'motivo',
    );
    expect(tx.empresaBanco.update).toHaveBeenCalledWith({ where: { id: 'banco-1' }, data: { saldoActual: { increment: 100 } } });
    expect(tx.movimientoCaja.update).not.toHaveBeenCalled();
    expect(tx.movimientoCaja.create).not.toHaveBeenCalled();
    expect(tx.pagoCompra.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pago-1' }, data: expect.objectContaining({ anulado: true }) }),
    );
  });

  it('TESORERIA con caja ABIERTA → marca el MovimientoCaja anulado (sin compensación) y el pago anulado', async () => {
    await revertirPagoCompra(
      tx,
      caja,
      { id: 'pago-1', monto: 50, fuente: 'TESORERIA' as any, bancoId: null, movimientoCajaId: 'mov-1' },
      'user-1',
      'motivo',
    );
    expect(tx.movimientoCaja.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mov-1' }, data: expect.objectContaining({ anulado: true }) }),
    );
    expect(tx.movimientoCaja.create).not.toHaveBeenCalled();
    expect(caja.getOrCreateCajaCentral).not.toHaveBeenCalled();
    expect(tx.empresaBanco.update).not.toHaveBeenCalled();
    expect(tx.pagoCompra.update).toHaveBeenCalled();
  });

  it('CAJA con caja CERRADA → no toca el cierre, compensa con INGRESO en la Central', async () => {
    tx.movimientoCaja.findUnique.mockResolvedValue({
      id: 'mov-1',
      empresaId: 'emp-1',
      metodoPago: 'EFECTIVO',
      compraId: 'compra-1',
      caja: {
        id: 'caja-op',
        estado: 'CERRADA',
        sedeId: 'sede-1',
        codigo: 'CAJA-01',
        fechaCierre: new Date('2026-06-28T00:00:00Z'),
      },
    });

    await revertirPagoCompra(
      tx,
      caja,
      { id: 'pago-1', monto: 80, fuente: 'CAJA' as any, bancoId: null, movimientoCajaId: 'mov-1' },
      'user-1',
      'motivo',
    );

    // Marca el egreso original anulado (auditoría)
    expect(tx.movimientoCaja.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mov-1' }, data: expect.objectContaining({ anulado: true }) }),
    );
    // Compensa con un INGRESO anulado=false en la Caja Central de la sede
    expect(caja.getOrCreateCajaCentral).toHaveBeenCalledWith('emp-1', 'sede-1', tx);
    expect(tx.movimientoCaja.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cajaId: 'central-1',
          tipo: 'INGRESO',
          categoria: 'REVERSO_CAJA_CERRADA',
          monto: 80,
          anulado: false,
        }),
      }),
    );
    expect(tx.empresaBanco.update).not.toHaveBeenCalled();
    expect(tx.pagoCompra.update).toHaveBeenCalled();
  });
});
