import { BadRequestException } from '@nestjs/common';
import { aplicarPagoCompra } from './aplicar-pago-compra.util';

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
});
