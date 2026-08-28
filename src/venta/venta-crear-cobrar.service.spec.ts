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
      // sellarCodigoVenta reemplaza el código temporal por el definitivo
      update: jest.fn().mockResolvedValue({}),
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
    // Parches del código temporal al sellar (sellarCodigoVenta)
    $executeRaw: jest.fn().mockResolvedValue(1),
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

  // ── Numeración sin huecos, con el lock lo más corto posible ──────────────
  //
  // El contador de VENTA queda bloqueado hasta el commit — eso es lo que hace
  // que la numeración no tenga huecos, y no se puede evitar. Lo único que se
  // puede hacer es tomarlo al final. Medido en beta antes del cambio: el
  // contador quedaba tomado ~200 ms sobre ventas de ~420 ms.
  describe('sellado del código de venta', () => {
    it('la venta nace con un código TEMPORAL, no con el definitivo', async () => {
      await service.crearYCobrar('emp-1', dtoBase() as any, 'caj-1');

      expect(tx.venta.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            codigo: expect.stringMatching(/^TMP-[0-9a-f-]{36}$/),
          }),
        }),
      );
    });

    it('el contador se reserva DESPUÉS de todo lo demás (último lock posible)', async () => {
      await service.crearYCobrar('emp-1', dtoBase() as any, 'caj-1');

      const crear = tx.venta.create.mock.invocationCallOrder[0];
      const stock = tx.productoStock.update.mock.invocationCallOrder[0];
      const comprobante =
        tx.comprobanteElectronico.create.mock.invocationCallOrder[0];
      const caja =
        cajaService.registrarMovimientoSiHayCaja.mock.invocationCallOrder[0];
      const contador =
        configuracionCodigos.generarCodigoVenta.mock.invocationCallOrder[0];

      expect(contador).toBeGreaterThan(crear);
      expect(contador).toBeGreaterThan(stock);
      expect(contador).toBeGreaterThan(comprobante);
      expect(contador).toBeGreaterThan(caja);
    });

    // Sin esto la venta queda BIEN en la base pero el ticket que se imprime
    // sale con el TMP-…: es el objeto que viaja al cajero.
    it('el objeto devuelto lleva el código definitivo, no el temporal', async () => {
      const venta = await service.crearYCobrar('emp-1', dtoBase() as any, 'caj-1');

      expect(venta.codigo).toBe('VTA-SED-00000001');
      expect(venta.codigo).not.toMatch(/^TMP-/);
    });

    it('persiste el código definitivo en la fila de la venta', async () => {
      await service.crearYCobrar('emp-1', dtoBase() as any, 'caj-1');

      expect(tx.venta.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'venta-1' },
          data: { codigo: 'VTA-SED-00000001' },
        }),
      );
    });

    // La ventana del lock tiene que ser de tamaño FIJO: si alguien la hace
    // crecer con las líneas o los pagos, volvemos al problema de origen.
    it('los parches son de cantidad fija, no crecen con las líneas', async () => {
      const dosLineas = dtoBase();
      dosLineas.detalles = [
        ...dosLineas.detalles,
        {
          productoId: 'prod-1',
          descripcion: 'Otro item',
          cantidad: 2,
          precioUnitario: 30,
          descuento: 0,
          porcentajeIGV: 18,
          precioIncluyeIgv: true,
        },
      ];

      await service.crearYCobrar('emp-1', dosLineas as any, 'caj-1');
      const conDos = tx.$executeRaw.mock.calls.length;

      tx = buildTx();
      prisma.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(tx));
      await service.crearYCobrar('emp-1', dtoBase() as any, 'caj-1');
      const conUna = tx.$executeRaw.mock.calls.length;

      expect(conDos).toBe(conUna);
    });
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

  // ── Frecuencia de pago del crédito (diario / semanal / cada 3 días) ──
  // El app manda `plazoCredito = frecuencia × numeroCuotas`; el backend saca
  // el intervalo con `plazo ÷ cuotas`, así que debe caer exacto en la
  // frecuencia elegida. Casos reales: el cliente que abona todos los días o
  // cada semana.
  const cuotasGeneradas = () =>
    tx.cuotaVenta.createMany.mock.calls[0][0].data as Array<{
      numero: number;
      monto: number;
      fechaVencimiento: Date;
    }>;

  const diasEntre = (a: Date, b: Date) =>
    Math.round((b.getTime() - a.getTime()) / 86400000);

  const cobrarACredito = (numeroCuotas: number, plazoCredito: number) =>
    service.crearYCobrar(
      'emp-1',
      dtoBase({
        esCredito: true,
        numeroCuotas,
        plazoCredito,
        montoRecibido: undefined,
        pagos: undefined,
      }) as any,
      'caj-1',
    );

  it.each([
    ['semanal', 4, 28, 7],
    ['diario', 20, 20, 1],
    ['cada 3 dias', 10, 30, 3],
    ['quincenal', 6, 90, 15],
  ])(
    'crédito %s: %i cuotas con plazo %i → vencimientos cada %i día(s)',
    async (_label, numeroCuotas, plazoCredito, intervaloEsperado) => {
      await cobrarACredito(numeroCuotas as number, plazoCredito as number);

      const cuotas = cuotasGeneradas();
      expect(cuotas).toHaveLength(numeroCuotas as number);

      // Separación constante entre vencimientos consecutivos
      for (let i = 1; i < cuotas.length; i++) {
        expect(
          diasEntre(cuotas[i - 1].fechaVencimiento, cuotas[i].fechaVencimiento),
        ).toBe(intervaloEsperado);
      }
      // Las cuotas SIEMPRE suman el total del documento (requisito SUNAT)
      const suma = cuotas.reduce((s, c) => s + Number(c.monto), 0);
      expect(Math.round(suma * 100) / 100).toBe(50);
    },
  );

  it('plazo menor que el número de cuotas: NO vencen todas el mismo día (intervalo mínimo 1)', async () => {
    // Combinación que la API acepta aunque el app ya no la produzca (plazo 7
    // con 12 cuotas): antes floor(7/12)=0 y las 12 cuotas vencían hoy.
    await cobrarACredito(12, 7);

    const cuotas = cuotasGeneradas();
    for (let i = 1; i < cuotas.length; i++) {
      expect(
        diasEntre(cuotas[i - 1].fechaVencimiento, cuotas[i].fechaVencimiento),
      ).toBe(1);
    }
    const fechas = new Set(cuotas.map((c) => c.fechaVencimiento.getTime()));
    expect(fechas.size).toBe(12);
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
