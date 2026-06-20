import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CuentasPorPagarService } from './cuentas-por-pagar.service';

/**
 * Tests de `registrarPago` — el pago/abono a proveedor sobre una compra a
 * crédito (CxP). Cubre:
 *  - guard de estado (solo compras CONFIRMADAS) y de términos (no CONTADO),
 *  - validación de sobre-pago (monto > saldo),
 *  - recálculo del saldo DENTRO de la transacción con lock (FOR UPDATE), que es
 *    lo que evita el sobre-pago por carrera entre dos pagos concurrentes,
 *  - registro del EGRESO en caja en el happy path.
 *
 * Sin DB: mockeamos `$transaction` (ejecuta el callback con un `tx` mock),
 * `$queryRaw` (el SELECT ... FOR UPDATE), `pagoCompra.*` y `compra.findFirst`.
 */
describe('CuentasPorPagarService.registrarPago', () => {
  const EMPRESA = 'emp-1';
  const COMPRA = 'compra-1';
  const USUARIO = 'user-1';

  let prisma: any;
  let caja: any;
  let service: CuentasPorPagarService;

  /** Fila tal como la devuelve el SELECT ... FOR UPDATE. */
  const filaCompra = (over: Partial<{ total: number; estado: string; terminosPago: string | null }> = {}) => ({
    id: COMPRA,
    total: over.total ?? 100,
    estado: over.estado ?? 'CONFIRMADA',
    terminosPago: over.terminosPago === undefined ? 'CREDITO' : over.terminosPago,
  });

  /**
   * Configura el `tx` mock que recibe el callback de `$transaction`.
   * @param pagosPrevios montos ya pagados (para simular el recálculo de saldo).
   */
  const armarTx = (
    fila: ReturnType<typeof filaCompra> | undefined,
    pagosPrevios: number[] = [],
  ) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue(fila ? [fila] : []),
      pagoCompra: {
        findMany: jest.fn().mockResolvedValue(pagosPrevios.map((monto) => ({ monto }))),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pago-1', ...data })),
      },
    };
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));
    return tx;
  };

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      compra: {
        findFirst: jest.fn().mockResolvedValue({
          sedeId: 'sede-1',
          nombreProveedor: 'Proveedor SAC',
          codigo: 'COM-001',
        }),
      },
    };
    caja = { registrarMovimientoSiHayCaja: jest.fn().mockResolvedValue(undefined) };
    service = new CuentasPorPagarService(prisma, caja);
  });

  const pagar = (monto: number) =>
    service.registrarPago(EMPRESA, COMPRA, USUARIO, {
      metodoPago: 'EFECTIVO' as any,
      monto,
    });

  it('registra el pago y el EGRESO en caja (happy path)', async () => {
    const tx = armarTx(filaCompra({ total: 100 }), []);
    const pago = await pagar(100);

    expect(tx.pagoCompra.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ compraId: COMPRA, monto: 100 }) }),
    );
    expect(pago).toMatchObject({ id: 'pago-1', monto: 100 });
    expect(caja.registrarMovimientoSiHayCaja).toHaveBeenCalledWith(
      EMPRESA,
      'sede-1',
      USUARIO,
      expect.objectContaining({ tipo: 'EGRESO', categoria: 'PAGO_PROVEEDOR', monto: 100, compraId: COMPRA }),
    );
  });

  it('lanza NotFoundException si la compra no existe (FOR UPDATE → vacío)', async () => {
    armarTx(undefined);
    await expect(pagar(50)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza si la compra no está CONFIRMADA', async () => {
    armarTx(filaCompra({ estado: 'BORRADOR' }));
    await expect(pagar(50)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza si la compra es al CONTADO (no genera CxP)', async () => {
    armarTx(filaCompra({ terminosPago: 'CONTADO' }));
    await expect(pagar(50)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza si la compra no tiene términos de pago (null)', async () => {
    armarTx(filaCompra({ terminosPago: null }));
    await expect(pagar(50)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza si el monto excede el saldo pendiente', async () => {
    armarTx(filaCompra({ total: 100 }), []);
    await expect(pagar(120)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recalcula el saldo con los pagos previos: un abono que excede el saldo restante se rechaza', async () => {
    // total 100, ya pagados 80 → saldo restante 20. Un pago de 30 debe fallar.
    armarTx(filaCompra({ total: 100 }), [50, 30]);
    await expect(pagar(30)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta un abono parcial dentro del saldo restante', async () => {
    // total 100, ya pagados 80 → saldo restante 20. Un pago de 20 pasa.
    const tx = armarTx(filaCompra({ total: 100 }), [80]);
    const pago = await pagar(20);
    expect(pago).toMatchObject({ monto: 20 });
    expect(tx.pagoCompra.create).toHaveBeenCalled();
  });

  it('tolera redondeo de céntimos al cubrir el saldo exacto (+0.001)', async () => {
    armarTx(filaCompra({ total: 100 }), [99.999]);
    // saldo ~0.001 → pagar 0.001 no debe romper por float
    const pago = await pagar(0.001);
    expect(pago).toMatchObject({ monto: 0.001 });
  });

  it('si la creación del pago falla, NO registra movimiento en caja', async () => {
    const tx = armarTx(filaCompra({ total: 100 }), []);
    tx.pagoCompra.create.mockRejectedValue(new Error('db down'));
    await expect(pagar(50)).rejects.toThrow('db down');
    expect(caja.registrarMovimientoSiHayCaja).not.toHaveBeenCalled();
  });

  it('un fallo al registrar la caja NO revierte el pago (se loguea y se devuelve el pago)', async () => {
    armarTx(filaCompra({ total: 100 }), []);
    caja.registrarMovimientoSiHayCaja.mockRejectedValue(new Error('sin caja abierta'));
    const pago = await pagar(100);
    expect(pago).toMatchObject({ id: 'pago-1', monto: 100 });
  });
});
