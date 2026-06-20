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
  let storage: any;
  let service: CuentasPorPagarService;

  /** Fila tal como la devuelve el SELECT ... FOR UPDATE. */
  const filaCompra = (
    over: Partial<{ total: number; estado: string; pagoPendiente: boolean; moneda: string }> = {},
  ) => ({
    id: COMPRA,
    total: over.total ?? 100,
    estado: over.estado ?? 'CONFIRMADA',
    pagoPendiente: over.pagoPendiente ?? true,
    sedeId: 'sede-1',
    nombreProveedor: 'Proveedor SAC',
    codigo: 'COM-001',
    moneda: over.moneda ?? 'PEN',
  });

  /**
   * Configura el `tx` mock que recibe el callback de `$transaction`.
   * @param pagosPrevios montos ya pagados (para simular el recálculo de saldo).
   * @param opts.cajaAbierta si hay caja operativa abierta (para fuente=CAJA).
   * @param opts.banco la cuenta que devuelve empresaBanco.findFirst (null = no existe).
   */
  const armarTx = (
    fila: ReturnType<typeof filaCompra> | undefined,
    pagosPrevios: number[] = [],
    opts: { cajaAbierta?: boolean; banco?: any } = {},
  ) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue(fila ? [fila] : []),
      pagoCompra: {
        findMany: jest.fn().mockResolvedValue(pagosPrevios.map((monto) => ({ monto }))),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'pago-1', ...data })),
      },
      caja: {
        findFirst: jest.fn().mockResolvedValue(opts.cajaAbierta ? { id: 'caja-op-1' } : null),
      },
      empresaBanco: {
        findFirst: jest.fn().mockResolvedValue('banco' in opts ? opts.banco : { id: 'banco-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));
    return tx;
  };

  beforeEach(() => {
    prisma = { $transaction: jest.fn() };
    caja = {
      getOrCreateCajaCentral: jest.fn().mockResolvedValue({ id: 'central-1' }),
      crearMovimientoAutomatico: jest.fn().mockResolvedValue({ id: 'mov-1' }),
    };
    storage = { uploadArchivo: jest.fn() };
    service = new CuentasPorPagarService(prisma, caja, storage);
  });

  // Pago en EFECTIVO (fuente por default = TESORERIA).
  const pagar = (monto: number, extra: any = {}) =>
    service.registrarPago(EMPRESA, COMPRA, USUARIO, {
      metodoPago: 'EFECTIVO' as any,
      monto,
      ...extra,
    });

  it('EFECTIVO por default sale de Tesorería (Caja Central) y guarda el movimiento', async () => {
    const tx = armarTx(filaCompra({ total: 100 }), []);
    const pago = await pagar(100);

    expect(caja.getOrCreateCajaCentral).toHaveBeenCalledWith(EMPRESA, 'sede-1', tx);
    expect(caja.crearMovimientoAutomatico).toHaveBeenCalledWith(
      EMPRESA,
      'central-1',
      expect.objectContaining({ tipo: 'EGRESO', categoria: 'PAGO_PROVEEDOR', monto: 100, compraId: COMPRA }),
      tx,
    );
    expect(tx.pagoCompra.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fuente: 'TESORERIA', movimientoCajaId: 'mov-1' }),
      }),
    );
    expect(pago).toMatchObject({ id: 'pago-1', monto: 100 });
  });

  it('lanza NotFoundException si la compra no existe (FOR UPDATE → vacío)', async () => {
    armarTx(undefined);
    await expect(pagar(50)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza si la compra no está CONFIRMADA', async () => {
    armarTx(filaCompra({ estado: 'BORRADOR' }));
    await expect(pagar(50)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza si la compra NO está pendiente de pago (contado ya pagado al confirmar)', async () => {
    armarTx(filaCompra({ pagoPendiente: false }));
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
    const pago = await pagar(0.001);
    expect(pago).toMatchObject({ monto: 0.001 });
  });

  // ─── Fuente del dinero ───

  it('fuente=CAJA sin caja abierta → BadRequest', async () => {
    armarTx(filaCompra({ total: 100 }), [], { cajaAbierta: false });
    await expect(pagar(100, { fuente: 'CAJA' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fuente=CAJA con caja abierta registra el EGRESO en la caja operativa', async () => {
    const tx = armarTx(filaCompra({ total: 100 }), [], { cajaAbierta: true });
    await pagar(100, { fuente: 'CAJA' });
    expect(caja.crearMovimientoAutomatico).toHaveBeenCalledWith(
      EMPRESA,
      'caja-op-1',
      expect.objectContaining({ categoria: 'PAGO_PROVEEDOR' }),
      tx,
    );
    expect(tx.pagoCompra.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fuente: 'CAJA', movimientoCajaId: 'mov-1' }) }),
    );
  });

  it('fuente=BANCO decrementa el saldo de la cuenta y persiste bancoId', async () => {
    const tx = armarTx(filaCompra({ total: 100 }), []);
    await service.registrarPago(EMPRESA, COMPRA, USUARIO, {
      metodoPago: 'TRANSFERENCIA' as any,
      monto: 100,
      fuente: 'BANCO' as any,
      bancoId: 'banco-1',
    });
    expect(tx.empresaBanco.update).toHaveBeenCalledWith({
      where: { id: 'banco-1' },
      data: { saldoActual: { decrement: 100 } },
    });
    expect(tx.pagoCompra.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fuente: 'BANCO', bancoId: 'banco-1' }) }),
    );
    expect(caja.crearMovimientoAutomatico).not.toHaveBeenCalled();
  });

  it('fuente=BANCO sin bancoId → BadRequest', async () => {
    armarTx(filaCompra({ total: 100 }), []);
    await expect(
      service.registrarPago(EMPRESA, COMPRA, USUARIO, {
        metodoPago: 'TRANSFERENCIA' as any,
        monto: 100,
        fuente: 'BANCO' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fuente=BANCO con cuenta inexistente → BadRequest', async () => {
    armarTx(filaCompra({ total: 100 }), [], { banco: null });
    await expect(
      service.registrarPago(EMPRESA, COMPRA, USUARIO, {
        metodoPago: 'TRANSFERENCIA' as any,
        monto: 100,
        fuente: 'BANCO' as any,
        bancoId: 'no-existe',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('EFECTIVO con fuente=BANCO → BadRequest (efectivo no sale de banco)', async () => {
    armarTx(filaCompra({ total: 100 }), []);
    await expect(pagar(100, { fuente: 'BANCO', bancoId: 'banco-1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('compra en USD pagada desde Tesorería → BadRequest (debe ser banco)', async () => {
    armarTx(filaCompra({ total: 15, moneda: 'USD' }), []);
    await expect(
      service.registrarPago(EMPRESA, COMPRA, USUARIO, {
        metodoPago: 'TRANSFERENCIA' as any,
        monto: 15,
        fuente: 'TESORERIA' as any,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persiste comprobanteUrl al registrar el pago si se provee', async () => {
    const tx = armarTx(filaCompra({ total: 100 }), []);
    await service.registrarPago(EMPRESA, COMPRA, USUARIO, {
      metodoPago: 'YAPE' as any,
      monto: 100,
      fuente: 'TESORERIA' as any,
      comprobanteUrl: 'https://s3/voucher.jpg',
    });
    expect(tx.pagoCompra.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comprobanteUrl: 'https://s3/voucher.jpg' }),
      }),
    );
  });
});

describe('CuentasPorPagarService comprobantes', () => {
  const EMPRESA = 'emp-1';
  const USUARIO = 'user-1';
  let prisma: any;
  let storage: any;
  let service: CuentasPorPagarService;

  beforeEach(() => {
    prisma = {
      pagoCompra: { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    storage = {
      uploadArchivo: jest.fn().mockResolvedValue({ id: 'arch-1', url: 'https://s3/v.jpg' }),
    };
    service = new CuentasPorPagarService(prisma, {} as any, storage);
  });

  const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', size: 10, originalname: 'v.jpg' };

  describe('subirComprobante', () => {
    it('sube a S3 con entidadTipo PAGO_COMPRA y devuelve la url (sin asociar a pago)', async () => {
      const res = await service.subirComprobante(EMPRESA, USUARIO, file);
      expect(storage.uploadArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ empresaId: EMPRESA, entidadTipo: 'PAGO_COMPRA', subidoPor: USUARIO }),
      );
      expect(res).toEqual({ archivoId: 'arch-1', url: 'https://s3/v.jpg' });
    });

    it('lanza BadRequest si no se envía archivo', async () => {
      await expect(service.subirComprobante(EMPRESA, USUARIO, null)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(storage.uploadArchivo).not.toHaveBeenCalled();
    });
  });

  describe('adjuntarComprobantePago', () => {
    it('valida que el pago sea de la empresa, sube y setea comprobanteUrl', async () => {
      prisma.pagoCompra.findFirst.mockResolvedValue({ id: 'pago-1' });
      const res = await service.adjuntarComprobantePago(EMPRESA, 'pago-1', USUARIO, file);
      expect(prisma.pagoCompra.findFirst).toHaveBeenCalledWith({
        where: { id: 'pago-1', compra: { empresaId: EMPRESA } },
        select: { id: true },
      });
      expect(storage.uploadArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ entidadTipo: 'PAGO_COMPRA', entidadId: 'pago-1' }),
      );
      expect(prisma.pagoCompra.update).toHaveBeenCalledWith({
        where: { id: 'pago-1' },
        data: { comprobanteUrl: 'https://s3/v.jpg' },
      });
      expect(res).toEqual({ archivoId: 'arch-1', url: 'https://s3/v.jpg' });
    });

    it('lanza NotFound si el pago no pertenece a la empresa', async () => {
      prisma.pagoCompra.findFirst.mockResolvedValue(null);
      await expect(
        service.adjuntarComprobantePago(EMPRESA, 'pago-x', USUARIO, file),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.uploadArchivo).not.toHaveBeenCalled();
    });
  });
});
