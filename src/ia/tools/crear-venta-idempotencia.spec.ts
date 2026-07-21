/**
 * IDEMPOTENCIA de crearVenta — la última grieta con plata: si el LLM llama
 * la tool dos veces (reintento tras un nudge del guard, relectura del
 * historial), NO deben crearse dos ventas ni dos reservas de stock. Una
 * venta PENDIENTE reciente del mismo celular con los MISMOS ítems se
 * devuelve tal cual.
 */
import { crearCrearVentaTool } from './crear-venta.tool';
import { ContextoTool } from './tool.types';

describe('crearVenta — idempotencia', () => {
  const ctx: ContextoTool = {
    empresaId: 'emp-1',
    sedeId: 'sede-1',
    celular: '51922039941',
    catalogoReciente: [
      { id: 'prod1', varianteId: null, nombre: 'LAPICERO GEL BOIL' },
    ],
  };

  let prisma: any;
  let ventaService: any;

  beforeEach(() => {
    prisma = {
      empresaUsuarioRol: {
        findFirst: jest.fn().mockResolvedValue({ usuarioId: 'staff-1' }),
      },
      producto: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'prod1',
          nombre: 'LAPICERO GEL BOIL',
          tipoAfectacionIgv: 'GRAVADO',
          stocksPorSede: [
            { precio: 1, stockActual: 10, stockReservado: 0 },
          ],
          variantes: [],
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      venta: { findFirst: jest.fn().mockResolvedValue(null) },
      persona: { findUnique: jest.fn().mockResolvedValue(null) },
      integracionWhatsapp: {
        findUnique: jest.fn().mockResolvedValue({ numeroPago: '901168935' }),
      },
      integracionYape: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    ventaService = {
      crearVentaYapeDiferida: jest
        .fn()
        .mockResolvedValue({ id: 'venta-nueva', total: 1 }),
      upsertEnvio: jest.fn(),
    };
  });

  const args = {
    items: [{ productoId: 'LAPICERO GEL BOIL', cantidad: 1 }],
    nombreCliente: 'GEYDY',
    documentoCliente: '44510151',
  };

  it('sin venta previa → crea normal', async () => {
    const tool = crearCrearVentaTool(prisma, ventaService);

    const r = await tool.ejecutar(args, ctx);

    expect(ventaService.crearVentaYapeDiferida).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, ventaId: 'venta-nueva', payAmount: 1 });
    expect((r as any).yaExistia).toBeUndefined();
  });

  it('venta PENDIENTE reciente con los MISMOS ítems → la devuelve, NO duplica', async () => {
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-previa',
      total: 1,
      detalles: [{ productoId: 'prod1', varianteId: null, cantidad: 1 }],
    });
    const tool = crearCrearVentaTool(prisma, ventaService);

    const r = await tool.ejecutar(args, ctx);

    expect(ventaService.crearVentaYapeDiferida).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      ok: true,
      ventaId: 'venta-previa',
      payAmount: 1,
      yaExistia: true,
    });
  });

  it('venta previa con ítems DISTINTOS (otra cantidad) → sí crea una nueva', async () => {
    prisma.venta.findFirst.mockResolvedValue({
      id: 'venta-previa',
      total: 2,
      detalles: [{ productoId: 'prod1', varianteId: null, cantidad: 2 }],
    });
    const tool = crearCrearVentaTool(prisma, ventaService);

    const r = await tool.ejecutar(args, ctx); // cantidad 1 ≠ 2

    expect(ventaService.crearVentaYapeDiferida).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: true, ventaId: 'venta-nueva' });
  });

  it('sin celular en el contexto → no consulta previas (crea directo)', async () => {
    const tool = crearCrearVentaTool(prisma, ventaService);

    const r = await tool.ejecutar(args, { ...ctx, celular: null });

    expect(prisma.venta.findFirst).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, ventaId: 'venta-nueva' });
  });
});
