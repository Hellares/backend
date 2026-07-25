import { VentaAnalyticsService } from './venta-analytics.service';

/**
 * Tests de los filtros y agregaciones de estadísticas de ventas:
 * filtros nuevos (canal, conEnvio, categoría) vía buildVentaWhere,
 * ranking de productos (más/menos vendidos, criterio, límite) y
 * distribuciones por canal y por categoría.
 */

const dec = (n: number) => ({ toNumber: () => n });

const mkLogger = () =>
  ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as any;

const mkService = (prisma: any) =>
  new VentaAnalyticsService(prisma, mkLogger());

describe('VentaAnalyticsService — filtros de buildVentaWhere', () => {
  it('aplica canalVenta y conEnvio=true al where de la venta', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = mkService({ ventaDetalle: { findMany } });

    await service.getTopProductos('emp1', {
      canalVenta: 'ONLINE',
      conEnvio: 'true',
    } as any);

    const where = findMany.mock.calls[0][0].where.venta;
    expect(where.empresaId).toBe('emp1');
    expect(where.canalVenta).toBe('ONLINE');
    expect(where.conEnvio).toBe(true);
    expect(where.estado).toEqual({ notIn: ['BORRADOR', 'ANULADA'] });
  });

  it("conEnvio='false' filtra ventas físicas (conEnvio=false)", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = mkService({ ventaDetalle: { findMany } });

    await service.getTopProductos('emp1', { conEnvio: 'false' } as any);

    expect(findMany.mock.calls[0][0].where.venta.conEnvio).toBe(false);
  });

  it('sin conEnvio ni canal no agrega esos filtros', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = mkService({ ventaDetalle: { findMany } });

    await service.getTopProductos('emp1', {} as any);

    const where = findMany.mock.calls[0][0].where.venta;
    expect(where.conEnvio).toBeUndefined();
    expect(where.canalVenta).toBeUndefined();
  });

  it('categoriaId filtra por producto.empresaCategoriaId en el detalle', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = mkService({ ventaDetalle: { findMany } });

    await service.getTopProductos('emp1', { categoriaId: 'cat9' } as any);

    expect(findMany.mock.calls[0][0].where.producto).toEqual({
      empresaCategoriaId: 'cat9',
    });
  });
});

describe('VentaAnalyticsService.getTopProductos — ranking', () => {
  const detalles = [
    // p1: 2 unidades, S/ 100
    {
      productoId: 'p1',
      cantidad: dec(2),
      total: dec(100),
      precioUnitario: dec(50),
      producto: {
        nombre: 'Producto Uno',
        codigoEmpresa: 'C1',
        empresaCategoriaId: 'cat1',
        empresaCategoria: {
          nombreLocal: null,
          nombrePersonalizado: null,
          categoriaMaestra: { nombre: 'Bebidas' },
        },
      },
    },
    // p2: 10 unidades, S/ 30
    {
      productoId: 'p2',
      cantidad: dec(10),
      total: dec(30),
      precioUnitario: dec(3),
      producto: {
        nombre: 'Producto Dos',
        codigoEmpresa: 'C2',
        empresaCategoriaId: null,
        empresaCategoria: null,
      },
    },
    // p3: 1 unidad, S/ 500
    {
      productoId: 'p3',
      cantidad: dec(1),
      total: dec(500),
      precioUnitario: dec(500),
      producto: {
        nombre: 'Producto Tres',
        codigoEmpresa: 'C3',
        empresaCategoriaId: 'cat2',
        empresaCategoria: {
          nombreLocal: 'Tech',
          nombrePersonalizado: null,
          categoriaMaestra: { nombre: 'Electrónica' },
        },
      },
    },
  ];

  const mkTopService = () =>
    mkService({
      ventaDetalle: { findMany: jest.fn().mockResolvedValue(detalles) },
    });

  it('default: más vendidos por ingreso (DESC)', async () => {
    const result = await mkTopService().getTopProductos('emp1', {} as any);

    expect(result.map((p) => p.productoId)).toEqual(['p3', 'p1', 'p2']);
    expect(result[0].ingresoTotal).toBe(500);
  });

  it('orden=ASC devuelve los menos vendidos primero', async () => {
    const result = await mkTopService().getTopProductos('emp1', {
      orden: 'ASC',
    } as any);

    expect(result.map((p) => p.productoId)).toEqual(['p2', 'p1', 'p3']);
  });

  it('ordenarPor=CANTIDAD ordena por unidades, no por ingreso', async () => {
    const result = await mkTopService().getTopProductos('emp1', {
      ordenarPor: 'CANTIDAD',
    } as any);

    expect(result.map((p) => p.productoId)).toEqual(['p2', 'p1', 'p3']);
  });

  it('limit recorta el ranking y se clampa a [1,100]', async () => {
    const top1 = await mkTopService().getTopProductos('emp1', {
      limit: '1',
    } as any);
    expect(top1).toHaveLength(1);

    const clamped = await mkTopService().getTopProductos('emp1', {
      limit: '0',
    } as any);
    expect(clamped).toHaveLength(1);

    const invalido = await mkTopService().getTopProductos('emp1', {
      limit: 'abc',
    } as any);
    expect(invalido).toHaveLength(3); // fallback 10 > 3 filas
  });

  it('resuelve el nombre de categoría (local > personalizado > maestra) y "Sin categoria"', async () => {
    const result = await mkTopService().getTopProductos('emp1', {} as any);

    const porId = Object.fromEntries(result.map((p) => [p.productoId, p]));
    expect(porId['p1'].categoria).toBe('Bebidas');
    expect(porId['p3'].categoria).toBe('Tech');
    expect(porId['p2'].categoria).toBe('Sin categoria');
  });

  it('acumula cantidades e ingresos de detalles repetidos del mismo producto', async () => {
    const service = mkService({
      ventaDetalle: {
        findMany: jest.fn().mockResolvedValue([detalles[0], detalles[0]]),
      },
    });

    const result = await service.getTopProductos('emp1', {} as any);

    expect(result).toHaveLength(1);
    expect(result[0].cantidadVendida).toBe(4);
    expect(result[0].ingresoTotal).toBe(200);
  });
});

describe('VentaAnalyticsService.getVentasPorCanal', () => {
  it('agrupa por canal (ordenado por monto) y por envío', async () => {
    const groupBy = jest
      .fn()
      .mockResolvedValueOnce([
        { canalVenta: 'POS', _count: { id: 5 }, _sum: { total: dec(100) } },
        { canalVenta: 'ONLINE', _count: { id: 2 }, _sum: { total: dec(300) } },
      ])
      .mockResolvedValueOnce([
        { conEnvio: false, _count: { id: 6 }, _sum: { total: dec(250) } },
        { conEnvio: true, _count: { id: 1 }, _sum: { total: dec(150) } },
      ]);
    const service = mkService({ venta: { groupBy } });

    const result = await service.getVentasPorCanal('emp1', {} as any);

    expect(result.porCanal).toEqual([
      { canal: 'ONLINE', cantidad: 2, monto: 300 },
      { canal: 'POS', cantidad: 5, monto: 100 },
    ]);
    expect(result.porEnvio).toEqual([
      { conEnvio: false, cantidad: 6, monto: 250 },
      { conEnvio: true, cantidad: 1, monto: 150 },
    ]);
  });
});

describe('VentaAnalyticsService.getVentasPorCategoria', () => {
  it('agrupa por categoría con productos distintos y agrupa sin categoría aparte', async () => {
    const detalles = [
      {
        productoId: 'p1',
        cantidad: dec(2),
        total: dec(100),
        producto: {
          empresaCategoriaId: 'cat1',
          empresaCategoria: {
            nombreLocal: null,
            nombrePersonalizado: 'Snacks',
            categoriaMaestra: null,
          },
        },
      },
      {
        productoId: 'p2',
        cantidad: dec(3),
        total: dec(50),
        producto: {
          empresaCategoriaId: 'cat1',
          empresaCategoria: {
            nombreLocal: null,
            nombrePersonalizado: 'Snacks',
            categoriaMaestra: null,
          },
        },
      },
      {
        productoId: 'p3',
        cantidad: dec(1),
        total: dec(80),
        producto: { empresaCategoriaId: null, empresaCategoria: null },
      },
    ];
    const service = mkService({
      ventaDetalle: { findMany: jest.fn().mockResolvedValue(detalles) },
    });

    const result = await service.getVentasPorCategoria('emp1', {} as any);

    expect(result).toEqual([
      {
        categoriaId: 'cat1',
        categoria: 'Snacks',
        cantidadVendida: 5,
        ingresoTotal: 150,
        productosDistintos: 2,
      },
      {
        categoriaId: null,
        categoria: 'Sin categoria',
        cantidadVendida: 1,
        ingresoTotal: 80,
        productosDistintos: 1,
      },
    ]);
  });
});
