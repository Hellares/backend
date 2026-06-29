import { EstadoVenta } from '@prisma/client';

// Mock del helper de movimiento de stock (toca tx por dentro) — no nos interesa
// su efecto en este test, solo que crearYCobrar lo invoque sin romper.
jest.mock('../producto-stock/movimiento-stock.helper', () => ({
  crearMovimientoStockConValoracion: jest.fn().mockResolvedValue(undefined),
}));

import { VentaService } from './venta.service';

/**
 * Red de seguridad de `crearYCobrar` ANTES de agregarle el flag
 * `diferirComprobante` (flujo Yape diferido). Bloquea el comportamiento actual:
 *  - BOLETA pagada → emite comprobante, descuenta stock, estado PAGADA_COMPLETA.
 *  - TICKET → NO emite comprobante.
 * Más adelante se agrega el caso diferido (CONFIRMADA sin comprobante).
 *
 * Sin DB: mockeamos el cliente de transacción `tx` y las deps/métodos que tocan
 * BD; dejamos correr `calcularDetalle` (puro).
 */
describe('VentaService.crearYCobrar', () => {
  let service: VentaService;
  let prisma: any;
  let tx: any;
  let configuracionCodigos: any;
  let ordenServicioService: any;
  let cajaService: any;
  let facturacionService: any;
  let realtimeInvalidation: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  // tx mock: cubre todas las operaciones que crearYCobrar hace dentro de la tx
  // para una venta de 1 producto simple, sin combos/órdenes/VIP/descuentos.
  const buildTx = () => ({
    producto: { findMany: jest.fn().mockResolvedValue([]) },
    venta: {
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({
          id: 'venta-1',
          codigo: data.codigo,
          total: data.total,
          estado: data.estado,
          detalles: [{ productoId: 'prod-1', varianteId: null }],
        }),
      ),
    },
    descuentoUsoHistorial: { createMany: jest.fn() },
    productoStock: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'ps-1', productoId: 'prod-1', varianteId: null },
      ]),
      update: jest.fn().mockResolvedValue({}),
    },
    // Lock batch de stock (FOR UPDATE)
    $queryRawUnsafe: jest.fn().mockResolvedValue([
      {
        id: 'ps-1', stockActual: 10, stockReservado: 0, stockReservadoVenta: 0,
        stockReservadoCombo: 0, stockReservadoCotizacion: 0, stockDanado: 0,
        stockEnGarantia: 0,
      },
    ]),
    // Lock de sede para correlativo del comprobante (tagged template)
    $queryRaw: jest.fn().mockResolvedValue([
      {
        id: 'sede-1', serieFactura: 'F001', serieBoleta: 'B001',
        ultimoNumeroFactura: 0, ultimoNumeroBoleta: 5,
      },
    ]),
    sede: { update: jest.fn().mockResolvedValue({ ultimoNumeroBoleta: 6 }) },
    comprobanteElectronico: { create: jest.fn().mockResolvedValue({ id: 'comp-1' }) },
    pagoComprobante: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    pagoVenta: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    cuotaVenta: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
  });

  const dtoBase = (over: any = {}) => ({
    canalVenta: 'POS',
    sedeId: 'sede-1',
    vendedorId: 'vend-1',
    nombreCliente: 'CLIENTES VARIOS',
    documentoCliente: '00000000',
    moneda: 'PEN',
    tipoComprobante: 'BOLETA',
    esCredito: false,
    montoRecibido: 50,
    pagos: [{ metodoPago: 'EFECTIVO', monto: 50 }],
    detalles: [
      {
        productoId: 'prod-1',
        descripcion: 'Producto X',
        cantidad: 1,
        precioUnitario: 50,
        descuento: 0,
        porcentajeIGV: 18,
        precioIncluyeIgv: true,
      },
    ],
    ...over,
  });

  beforeEach(() => {
    tx = buildTx();
    prisma = {
      caja: { findFirst: jest.fn().mockResolvedValue({ id: 'caja-1' }) },
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
    };
    configuracionCodigos = {
      generarCodigoVenta: jest.fn().mockResolvedValue({ codigoVenta: 'VTA-SED-00000001' }),
    };
    ordenServicioService = {
      validarYBloquearCobroVenta: jest.fn().mockResolvedValue([]),
      marcarOrdenesCobradasPorVenta: jest.fn().mockResolvedValue([]),
      procesarPostCobroOrdenes: jest.fn().mockResolvedValue(undefined),
    };
    cajaService = { registrarMovimientoSiHayCaja: jest.fn().mockResolvedValue(undefined) };
    facturacionService = { enviarComprobante: jest.fn().mockResolvedValue(undefined) };
    realtimeInvalidation = { notifyStockCambiado: jest.fn() };

    service = new VentaService(
      prisma, null as any, configuracionCodigos, cajaService, null as any,
      facturacionService, ordenServicioService, null as any, realtimeInvalidation,
      null as any, logger as any, null as any,
    );

    // Métodos internos que tocan BD: stub para aislar la orquestación.
    jest.spyOn(service as any, '_validarPertenenciaTenant').mockResolvedValue(undefined);
    jest.spyOn(service as any, '_buildResolverVip').mockResolvedValue(null);
    jest.spyOn(service as any, 'aplicarPreciosBackendNivel').mockImplementation(
      async (detalles: any) => detalles,
    );
    jest.spyOn(service as any, 'validarVentaBajoCosto').mockResolvedValue(null);
    jest.spyOn(service as any, 'invalidateProductCache').mockResolvedValue(undefined);
  });

  it('BOLETA pagada en efectivo: emite comprobante, descuenta stock y queda PAGADA_COMPLETA', async () => {
    await service.crearYCobrar('emp-1', dtoBase() as any, 'caj-1');

    // Comprobante emitido
    expect(tx.comprobanteElectronico.create).toHaveBeenCalledTimes(1);
    // Estado PAGADA_COMPLETA (montoRecibido >= total)
    expect(tx.venta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: EstadoVenta.PAGADA_COMPLETA }),
      }),
    );
    // Stock descontado: 10 - 1 = 9
    expect(tx.productoStock.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ps-1' }, data: { stockActual: 9 } }),
    );
    // Pago registrado + caja
    expect(tx.pagoVenta.createMany).toHaveBeenCalledTimes(1);
    expect(cajaService.registrarMovimientoSiHayCaja).toHaveBeenCalled();
  });

  it('crédito pagado 100% al crear (adelanto = total, 0 cuotas) → PAGADA_COMPLETA, no CONFIRMADA', async () => {
    // Caso real (VTA-SED-00000650): venta marcada esCredito pero pagada completa
    // al momento → sin saldo financiado. Debe quedar PAGADA_COMPLETA, no colgada
    // en CONFIRMADA con saldo 0.
    await service.crearYCobrar(
      'emp-1',
      dtoBase({
        esCredito: true,
        montoRecibido: 50,
        pagos: [{ metodoPago: 'EFECTIVO', monto: 50 }],
      }) as any,
      'caj-1',
    );
    expect(tx.venta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: EstadoVenta.PAGADA_COMPLETA,
          esCredito: true,
        }),
      }),
    );
  });

  it('crédito con saldo financiado (adelanto < total) → CONFIRMADA', async () => {
    await service.crearYCobrar(
      'emp-1',
      dtoBase({
        esCredito: true,
        montoRecibido: 20,
        pagos: [{ metodoPago: 'EFECTIVO', monto: 20 }],
        numeroCuotas: 2,
      }) as any,
      'caj-1',
    );
    expect(tx.venta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: EstadoVenta.CONFIRMADA }),
      }),
    );
  });

  it('TICKET: NO emite comprobante electrónico', async () => {
    await service.crearYCobrar('emp-1', dtoBase({ tipoComprobante: 'TICKET' }) as any, 'caj-1');
    expect(tx.comprobanteElectronico.create).not.toHaveBeenCalled();
    // Pero sí descuenta stock y crea la venta
    expect(tx.productoStock.update).toHaveBeenCalled();
    expect(tx.venta.create).toHaveBeenCalled();
  });

  it('sin caja abierta (POS): rechaza antes de crear nada', async () => {
    prisma.caja.findFirst.mockResolvedValue(null);
    await expect(
      service.crearYCobrar('emp-1', dtoBase() as any, 'caj-1'),
    ).rejects.toThrow(/caja/i);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ── Flujo Yape DIFERIDO (opts.diferirComprobante) ──
  it('diferirComprobante=true: NO emite comprobante, queda CONFIRMADA y guarda la intención fiscal', async () => {
    const dto = dtoBase({ montoRecibido: undefined, pagos: undefined }); // sin pago al crear
    await service.crearYCobrar('emp-1', dto as any, 'caj-1', {
      diferirComprobante: true,
    });

    // NO se emite comprobante (se difiere al pago)
    expect(tx.comprobanteElectronico.create).not.toHaveBeenCalled();
    // Estado CONFIRMADA (pendiente de pago) + intención fiscal persistida
    expect(tx.venta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: EstadoVenta.CONFIRMADA,
          tipoComprobanteDiferido: 'BOLETA',
        }),
      }),
    );
    // Stock SÍ se descuenta (reuso del motor probado)
    expect(tx.productoStock.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ps-1' }, data: { stockActual: 9 } }),
    );
    // Sin pago ni caja al crear (se registran al confirmarse el pago)
    expect(tx.pagoVenta.createMany).not.toHaveBeenCalled();
    expect(cajaService.registrarMovimientoSiHayCaja).not.toHaveBeenCalled();
  });

  it('diferirComprobante con TICKET: tipoComprobanteDiferido queda null', async () => {
    const dto = dtoBase({
      tipoComprobante: 'TICKET',
      montoRecibido: undefined,
      pagos: undefined,
    });
    await service.crearYCobrar('emp-1', dto as any, 'caj-1', {
      diferirComprobante: true,
    });
    expect(tx.venta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tipoComprobanteDiferido: null }),
      }),
    );
  });

  // ── Guard: el descuento de línea no puede superar el precio ──
  describe('guard de descuento por línea', () => {
    it('rechaza si el descuento supera el precio (caso real: desc 3.40 sobre ítem de 3.00)', async () => {
      const dto = dtoBase({
        montoRecibido: 3,
        pagos: [{ metodoPago: 'EFECTIVO', monto: 3 }],
        detalles: [
          {
            productoId: 'prod-1',
            descripcion: 'PORTA AUDIFONOS',
            cantidad: 1,
            precioUnitario: 3,
            descuento: 3.4,
            porcentajeIGV: 18,
            precioIncluyeIgv: true,
          },
        ],
      });
      await expect(
        service.crearYCobrar('emp-1', dto as any, 'caj-1'),
      ).rejects.toThrow(/no puede superar el precio/i);
      expect(tx.venta.create).not.toHaveBeenCalled();
    });

    it('considera la cantidad: descuento 3.40 con 2 unidades a 3.00 (bruto 6) es válido', async () => {
      const dto = dtoBase({
        montoRecibido: 2.6,
        pagos: [{ metodoPago: 'EFECTIVO', monto: 2.6 }],
        detalles: [
          {
            productoId: 'prod-1',
            descripcion: 'PORTA AUDIFONOS',
            cantidad: 2,
            precioUnitario: 3,
            descuento: 3.4,
            porcentajeIGV: 18,
            precioIncluyeIgv: true,
          },
        ],
      });
      await service.crearYCobrar('emp-1', dto as any, 'caj-1');
      expect(tx.venta.create).toHaveBeenCalled();
    });
  });

  // ── crearVentaYapeDiferida: guard de alcance (sin órdenes/combos) ──
  describe('crearVentaYapeDiferida', () => {
    it('producto estándar: delega en crearYCobrar con diferirComprobante=true', async () => {
      const spy = jest
        .spyOn(service, 'crearYCobrar')
        .mockResolvedValue({ id: 'venta-1' } as any);
      await service.crearVentaYapeDiferida('emp-1', dtoBase() as any, 'caj-1');
      expect(spy).toHaveBeenCalledWith('emp-1', expect.anything(), 'caj-1', {
        diferirComprobante: true,
      });
    });

    it('PERMITE órdenes de servicio (entran al diferido): delega en crearYCobrar', async () => {
      const spy = jest
        .spyOn(service, 'crearYCobrar')
        .mockResolvedValue({ id: 'venta-1' } as any);
      const dto = dtoBase({
        detalles: [{ ordenServicioId: 'os-1', descripcion: 'OS', cantidad: 1, precioUnitario: 50 }],
      });
      await service.crearVentaYapeDiferida('emp-1', dto as any, 'caj-1');
      expect(spy).toHaveBeenCalledWith('emp-1', expect.anything(), 'caj-1', {
        diferirComprobante: true,
      });
    });

    it('rechaza si el carrito tiene un combo', async () => {
      const spy = jest.spyOn(service, 'crearYCobrar');
      const dto = dtoBase({
        detalles: [{ comboId: 'combo-1', descripcion: 'Combo', cantidad: 1, precioUnitario: 50 }],
      });
      await expect(
        service.crearVentaYapeDiferida('emp-1', dto as any, 'caj-1'),
      ).rejects.toThrow(/órdenes|combos/i);
      expect(spy).not.toHaveBeenCalled();
    });

    it('rechaza si el carrito tiene un componente de combo expandido (origenComboId)', async () => {
      const spy = jest.spyOn(service, 'crearYCobrar');
      const dto = dtoBase({
        detalles: [{
          productoId: 'prod-1', origenComboId: 'combo-1',
          descripcion: 'Componente', cantidad: 1, precioUnitario: 50,
        }],
      });
      await expect(
        service.crearVentaYapeDiferida('emp-1', dto as any, 'caj-1'),
      ).rejects.toThrow(/órdenes|combos/i);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // ── diferido con FACTURA (persiste la intención fiscal correcta) ──
  it('diferirComprobante con FACTURA: guarda tipoComprobanteDiferido=FACTURA', async () => {
    const dto = dtoBase({
      tipoComprobante: 'FACTURA',
      documentoCliente: '20614166674',
      tipoDocumentoCliente: '6',
      montoRecibido: undefined,
      pagos: undefined,
    });
    await service.crearYCobrar('emp-1', dto as any, 'caj-1', {
      diferirComprobante: true,
    });
    expect(tx.venta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estado: EstadoVenta.CONFIRMADA,
          tipoComprobanteDiferido: 'FACTURA',
          tipoDocumentoClienteDiferido: '6',
          cobroDiferido: true,
        }),
      }),
    );
    // No emite comprobante al crear
    expect(tx.comprobanteElectronico.create).not.toHaveBeenCalled();
  });

  it('diferido con ORDEN de servicio: NO marca la orden al crear (se difiere al pago)', async () => {
    ordenServicioService.validarYBloquearCobroVenta.mockResolvedValue([
      { id: 'os-1', codigo: 'ORD-1', estado: 'LISTO_ENTREGA', estadoDiagnostico: null },
    ]);
    const dto = dtoBase({
      montoRecibido: undefined,
      pagos: undefined,
      detalles: [{
        ordenServicioId: 'os-1', descripcion: 'Servicio X',
        cantidad: 1, precioUnitario: 50, porcentajeIGV: 18, precioIncluyeIgv: true,
      }],
    });

    await service.crearYCobrar('emp-1', dto as any, 'caj-1', {
      diferirComprobante: true,
    });

    // La orden NO se marca al crear (se marcará al confirmarse el pago).
    expect(ordenServicioService.marcarOrdenesCobradasPorVenta).not.toHaveBeenCalled();
    // Tampoco se emite comprobante al crear.
    expect(tx.comprobanteElectronico.create).not.toHaveBeenCalled();
    // La venta queda CONFIRMADA (pendiente de pago).
    expect(tx.venta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ estado: EstadoVenta.CONFIRMADA, cobroDiferido: true }),
      }),
    );
  });
});
