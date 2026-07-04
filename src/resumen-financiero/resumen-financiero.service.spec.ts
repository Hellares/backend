import { ResumenFinancieroService } from './resumen-financiero.service';

/**
 * Tests de las REGLAS DE COHERENCIA del resumen financiero:
 *  - pagos anulados nunca suman (query los filtra),
 *  - ventas BORRADOR (Yape diferido) fuera de ventas/CxC,
 *  - "cobrado" es base caja del período (PagoVenta.fechaPago), no por venta,
 *  - pedidos marketplace: totalPorFacturar solo pre-venta-interna y sin
 *    CONTRAENTREGA (evita doble conteo con las ventas creadas al ENVIAR),
 *  - CxC canónica: saldo desde cuotas + totalConInteres, vencido POR CUOTA,
 *  - préstamos: pagos del período consultado (no siempre inicio de mes),
 *  - fechas date-only interpretadas como día calendario PERÚ completo,
 *  - liquidez = bóvedas + cajas abiertas + caja chica + bancos.
 *
 * Sin DB: prisma mockeado por método.
 */
describe('ResumenFinancieroService', () => {
  let prisma: any;
  let service: ResumenFinancieroService;

  const DESDE = new Date('2026-07-01T05:00:00.000Z');
  const HASTA = new Date('2026-07-31T04:59:59.999Z');

  beforeEach(() => {
    prisma = {
      venta: { findMany: jest.fn().mockResolvedValue([]) },
      pagoVenta: { aggregate: jest.fn().mockResolvedValue({ _sum: { monto: 0 } }) },
      compra: { findMany: jest.fn().mockResolvedValue([]) },
      pagoCompra: { aggregate: jest.fn().mockResolvedValue({ _sum: { monto: 0 } }) },
      pedidoMarketplace: { findMany: jest.fn().mockResolvedValue([]) },
      caja: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      movimientoCaja: {
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      empresaBanco: { findMany: jest.fn().mockResolvedValue([]) },
      cajaChica: { aggregate: jest.fn().mockResolvedValue({ _sum: { saldoActual: 0 } }) },
      prestamo: { findMany: jest.fn().mockResolvedValue([]) },
      pagoGastoRecurrente: { findMany: jest.fn().mockResolvedValue([]) },
      operacionAgente: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new ResumenFinancieroService(prisma);
  });

  describe('_resumenVentas', () => {
    it('cobrado = pagos del período (cash), pendiente = saldo canónico de las ventas del período', async () => {
      prisma.venta.findMany.mockResolvedValue([
        // Contado: total 100, cobrado 60 → saldo 40.
        { total: 100, totalConInteres: null, esCredito: false, pagos: [{ monto: 60 }], cuotas: [] },
        // Crédito con cuotas: el saldo sale de las CUOTAS (120), no de total-pagos.
        {
          total: 200,
          totalConInteres: 220,
          esCredito: true,
          pagos: [{ monto: 100 }],
          cuotas: [{ saldoPendiente: 120 }],
        },
      ]);
      prisma.pagoVenta.aggregate.mockResolvedValue({ _sum: { monto: 150 } });

      const r = await (service as any)._resumenVentas('emp-1', DESDE, HASTA);

      expect(r.totalVentas).toBe(300);
      expect(r.totalCobrado).toBe(150); // cash del período, no 160 (60+100)
      expect(r.pendienteCobro).toBe(160); // 40 + 120
      expect(r.ventasContado).toBe(1);
      expect(r.ventasCredito).toBe(1);

      // La query excluye ANULADA y BORRADOR y filtra pagos anulados.
      const where = prisma.venta.findMany.mock.calls[0][0].where;
      expect(where.estado).toEqual({ notIn: ['ANULADA', 'BORRADOR'] });
      const include = prisma.venta.findMany.mock.calls[0][0].include;
      expect(include.pagos).toEqual({ where: { anulado: false } });
      // El cobrado cash también excluye pagos anulados y ventas anuladas.
      const aggWhere = prisma.pagoVenta.aggregate.mock.calls[0][0].where;
      expect(aggWhere.anulado).toBe(false);
      expect(aggWhere.venta.estado).toEqual({ not: 'ANULADA' });
    });
  });

  describe('_resumenPedidosMarketplace', () => {
    it('totalPorFacturar: solo validados SIN venta interna y sin CONTRAENTREGA', async () => {
      prisma.pedidoMarketplace.findMany.mockResolvedValue([
        { estado: 'PAGO_VALIDADO', metodoPago: 'YAPE', total: 100 },
        { estado: 'EN_PREPARACION', metodoPago: 'CONTRAENTREGA', total: 50 }, // sin dinero aún
        { estado: 'ENVIADO', metodoPago: 'YAPE', total: 80 }, // ya tiene venta interna
        { estado: 'PENDIENTE_PAGO', metodoPago: 'YAPE', total: 30 },
      ]);

      const r = await (service as any)._resumenPedidosMarketplace('emp-1', DESDE, HASTA);

      expect(r.totalPorFacturar).toBe(100);
      expect(r.totalValidado).toBe(230); // informativo: 100+50+80
      expect(r.pedidosPendientes).toBe(1);
    });
  });

  describe('_resumenCuentasCobrar', () => {
    it('con cuotas: vencido POR CUOTA; sin cuotas: por fechaVencimientoPago', async () => {
      const ayer = new Date(Date.now() - 24 * 3600_000);
      const enUnMes = new Date(Date.now() + 30 * 24 * 3600_000);
      prisma.venta.findMany.mockResolvedValue([
        {
          total: 200,
          totalConInteres: 220,
          pagos: [{ monto: 30 }],
          cuotas: [
            { saldoPendiente: 50, fechaVencimiento: ayer },
            { saldoPendiente: 70, fechaVencimiento: enUnMes },
          ],
        },
        {
          total: 100,
          totalConInteres: null,
          fechaVencimientoPago: ayer,
          pagos: [],
          cuotas: [],
        },
      ]);

      const r = await (service as any)._resumenCuentasCobrar('emp-1');

      expect(r.totalVencido).toBe(150); // 50 (cuota vencida) + 100 (venta vencida)
      expect(r.totalPendiente).toBe(70); // cuota futura
      expect(r.total).toBe(220);
    });
  });

  describe('_resumenPrestamos', () => {
    it('totalPagadoPeriodo respeta el rango consultado', async () => {
      prisma.prestamo.findMany.mockResolvedValue([
        {
          saldoPendiente: 500,
          montoOriginal: 1000,
          totalPagado: 500,
          pagos: [
            { monto: 100, fechaPago: new Date('2026-07-10T12:00:00Z') }, // dentro
            { monto: 200, fechaPago: new Date('2026-06-10T12:00:00Z') }, // fuera
          ],
        },
      ]);

      const r = await (service as any)._resumenPrestamos('emp-1', DESDE, HASTA);
      expect(r.totalPagadoPeriodo).toBe(100);
    });
  });

  describe('_parseFecha', () => {
    it('date-only se interpreta como día calendario Perú completo', () => {
      const desde = (service as any)._parseFecha('2026-07-04', false);
      const hasta = (service as any)._parseFecha('2026-07-04', true);
      expect(desde.toISOString()).toBe('2026-07-04T05:00:00.000Z');
      expect(hasta.toISOString()).toBe('2026-07-05T04:59:59.999Z');
    });

    it('ISO completo pasa tal cual y basura devuelve null', () => {
      const iso = (service as any)._parseFecha('2026-07-04T10:00:00.000Z', false);
      expect(iso.toISOString()).toBe('2026-07-04T10:00:00.000Z');
      expect((service as any)._parseFecha('no-fecha', false)).toBeNull();
    });
  });

  describe('_resumenTesoreria', () => {
    it('bóveda = movs firmados de la central; cajas abiertas = apertura + movs sin par tesorería', async () => {
      prisma.caja.findMany
        .mockResolvedValueOnce([{ id: 'central-1' }]) // centrales
        .mockResolvedValueOnce([{ id: 'op-1', montoApertura: 100 }]); // abiertas
      prisma.movimientoCaja.groupBy
        .mockResolvedValueOnce([
          { tipo: 'INGRESO', _sum: { monto: 1000 } },
          { tipo: 'EGRESO', _sum: { monto: 300 } },
        ]) // central
        .mockResolvedValueOnce([{ tipo: 'INGRESO', _sum: { monto: 50 } }]); // operativas
      prisma.cajaChica.aggregate.mockResolvedValue({ _sum: { saldoActual: 200 } });

      const r = await (service as any)._resumenTesoreria('emp-1');

      expect(r.saldoBovedas).toBe(700);
      expect(r.efectivoCajasAbiertas).toBe(150);
      expect(r.saldoCajaChica).toBe(200);
    });
  });

  describe('getResumen (composición de totales)', () => {
    it('ingresos = cobros cash + pedidos por facturar + otros; liquidez suma las 4 fuentes', async () => {
      prisma.pagoVenta.aggregate.mockResolvedValue({ _sum: { monto: 150 } });
      prisma.pedidoMarketplace.findMany.mockResolvedValue([
        { estado: 'PAGO_VALIDADO', metodoPago: 'YAPE', total: 100 },
      ]);
      prisma.movimientoCaja.findMany.mockResolvedValue([
        { tipo: 'INGRESO', categoria: 'OTRO_INGRESO', monto: 20 },
        { tipo: 'EGRESO', categoria: 'PAGO_PLANILLA', monto: 500 },
      ]);
      prisma.pagoCompra.aggregate.mockResolvedValue({ _sum: { monto: 80 } });
      prisma.empresaBanco.findMany.mockResolvedValue([
        { id: 'b1', nombreBanco: 'BCP', moneda: 'PEN', saldoActual: 400, esPrincipal: true },
      ]);
      prisma.cajaChica.aggregate.mockResolvedValue({ _sum: { saldoActual: 200 } });
      // Tesorería: sin centrales ni cajas abiertas (findMany default []).

      const r = await service.getResumen('emp-1');

      expect(r.resumen.totalIngresos).toBe(270); // 150 + 100 + 20
      expect(r.resumen.totalEgresos).toBe(580); // 80 compras + 500 planilla
      expect(r.resumen.flujoNeto).toBe(-310);
      expect(r.resumen.liquidezTotal).toBe(600); // 0 bóveda + 0 cajas + 200 chica + 400 bancos
      expect(r.tesoreria.saldoBancos).toBe(400);
    });
  });
});
