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

  it('desglosa por variante y agrupa lo vendido sin variante como "Sin variante"', async () => {
    const conVariantes = [
      {
        productoId: 'p1',
        varianteId: 'v1',
        cantidad: dec(2),
        total: dec(60),
        precioUnitario: dec(30),
        producto: { nombre: 'Polo', codigoEmpresa: 'C1', empresaCategoriaId: null, empresaCategoria: null },
        variante: { nombre: 'Talla M' },
      },
      {
        productoId: 'p1',
        varianteId: 'v2',
        cantidad: dec(1),
        total: dec(100),
        precioUnitario: dec(100),
        producto: { nombre: 'Polo', codigoEmpresa: 'C1', empresaCategoriaId: null, empresaCategoria: null },
        variante: { nombre: 'Talla L' },
      },
      {
        productoId: 'p1',
        varianteId: null,
        cantidad: dec(5),
        total: dec(50),
        precioUnitario: dec(10),
        producto: { nombre: 'Polo', codigoEmpresa: 'C1', empresaCategoriaId: null, empresaCategoria: null },
        variante: null,
      },
    ];
    const service = mkService({
      ventaDetalle: { findMany: jest.fn().mockResolvedValue(conVariantes) },
    });

    const result = await service.getTopProductos('emp1', {} as any);

    expect(result).toHaveLength(1);
    expect(result[0].cantidadVendida).toBe(8);
    expect(result[0].ingresoTotal).toBe(210);
    // Ordenado por ingreso desc dentro del producto
    expect(result[0].variantes).toEqual([
      { varianteId: 'v2', nombre: 'Talla L', cantidadVendida: 1, ingresoTotal: 100 },
      { varianteId: 'v1', nombre: 'Talla M', cantidadVendida: 2, ingresoTotal: 60 },
      { varianteId: null, nombre: 'Sin variante', cantidadVendida: 5, ingresoTotal: 50 },
    ]);
  });

  it('producto sin variantes devuelve variantes vacio (sin bucket redundante)', async () => {
    const result = await mkTopService().getTopProductos('emp1', {} as any);

    for (const p of result) {
      expect(p.variantes).toEqual([]);
    }
  });

  it('calcula margen total y % por producto desde margenSnapshot × cantidad', async () => {
    const conMargen = [
      {
        productoId: 'p1',
        cantidad: dec(2),
        total: dec(100),
        precioUnitario: dec(50),
        margenSnapshot: dec(20), // 20 × 2 = 40
        producto: { nombre: 'Prod', codigoEmpresa: 'C1', empresaCategoriaId: null, empresaCategoria: null },
      },
      {
        productoId: 'p1',
        cantidad: dec(1),
        total: dec(50),
        precioUnitario: dec(50),
        margenSnapshot: dec(10), // 10 × 1 = 10
        producto: { nombre: 'Prod', codigoEmpresa: 'C1', empresaCategoriaId: null, empresaCategoria: null },
      },
    ];
    const service = mkService({
      ventaDetalle: { findMany: jest.fn().mockResolvedValue(conMargen) },
    });

    const result = await service.getTopProductos('emp1', {} as any);

    expect(result[0].margenTotal).toBe(50);
    expect(result[0].margenPorcentaje).toBe(33.33); // 50 / 150
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

describe('VentaAnalyticsService.getVentasPorMarca', () => {
  it('agrupa por marca (local > personalizado > maestra) y agrupa sin marca aparte', async () => {
    const detalles = [
      {
        productoId: 'p1',
        cantidad: dec(2),
        total: dec(100),
        producto: {
          empresaMarcaId: 'm1',
          empresaMarca: {
            nombreLocal: null,
            nombrePersonalizado: null,
            marcaMaestra: { nombre: 'Nike' },
          },
        },
      },
      {
        productoId: 'p2',
        cantidad: dec(1),
        total: dec(200),
        producto: {
          empresaMarcaId: 'm1',
          empresaMarca: {
            nombreLocal: null,
            nombrePersonalizado: null,
            marcaMaestra: { nombre: 'Nike' },
          },
        },
      },
      {
        productoId: 'p3',
        cantidad: dec(4),
        total: dec(40),
        producto: { empresaMarcaId: null, empresaMarca: null },
      },
    ];
    const service = mkService({
      ventaDetalle: { findMany: jest.fn().mockResolvedValue(detalles) },
    });

    const result = await service.getVentasPorMarca('emp1', {} as any);

    expect(result).toEqual([
      {
        marcaId: 'm1',
        marca: 'Nike',
        cantidadVendida: 3,
        ingresoTotal: 300,
        productosDistintos: 2,
      },
      {
        marcaId: null,
        marca: 'Sin marca',
        cantidadVendida: 4,
        ingresoTotal: 40,
        productosDistintos: 1,
      },
    ]);
  });
});

describe('VentaAnalyticsService.getTopClientes — dedupe', () => {
  it('fusiona al mismo cliente con/sin clienteId y con el nombre escrito distinto', async () => {
    const ventas = [
      { clienteId: 'c1', nombreCliente: 'Juan Perez', total: dec(100) },
      // Sin clienteId pero mismo nombre (otra capitalización/espacios)
      { clienteId: null, nombreCliente: 'JUAN PEREZ', total: dec(50) },
      { clienteId: null, nombreCliente: '  juan   perez ', total: dec(25) },
      // Otro cliente real
      { clienteId: 'c2', nombreCliente: 'Maria Lopez', total: dec(80) },
      // Solo nombre, sin cliente registrado
      { clienteId: null, nombreCliente: 'Pedro Diaz', total: dec(10) },
    ];
    const service = mkService({
      venta: { findMany: jest.fn().mockResolvedValue(ventas) },
    });

    const result = await service.getTopClientes('emp1', {} as any);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      clienteId: 'c1',
      totalCompras: 3,
      montoTotal: 175,
    });
    expect(result[1]).toMatchObject({ clienteId: 'c2', montoTotal: 80 });
    expect(result[2]).toMatchObject({
      clienteId: null,
      nombre: 'Pedro Diaz',
      montoTotal: 10,
    });
  });
});

describe('VentaAnalyticsService.getResumenGeneral — anuladas y devoluciones', () => {
  it('reporta anuladas (aparte, sin sumar al monto) y devoluciones procesadas', async () => {
    const aggregate = jest
      .fn()
      // 1ª llamada: agregado normal (excluye anuladas por el where)
      .mockResolvedValueOnce({
        _count: { id: 10 },
        _sum: { total: dec(1000) },
        _avg: { total: dec(100) },
      })
      // 2ª llamada: agregado de ANULADAS
      .mockResolvedValueOnce({
        _count: { id: 2 },
        _sum: { total: dec(150) },
      });
    const service = mkService({
      venta: { aggregate, count: jest.fn().mockResolvedValue(3) },
      devolucion: { count: jest.fn().mockResolvedValue(4) },
      devolucionItem: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { cantidad: 7 } }),
      },
      ventaDetalle: {
        // margen unitario 10 × 2 und. + 5 × 4 und. = 40 de utilidad
        findMany: jest.fn().mockResolvedValue([
          { margenSnapshot: dec(10), cantidad: dec(2) },
          { margenSnapshot: dec(5), cantidad: dec(4) },
        ]),
      },
    });

    const result = await service.getResumenGeneral('emp1', {} as any);

    expect(result.montoTotal).toBe(1000); // sin las anuladas
    expect(result.ventasAnuladas).toBe(2);
    expect(result.montoAnulado).toBe(150);
    expect(result.devoluciones).toBe(4);
    expect(result.itemsDevueltos).toBe(7);
    expect(result.utilidadBruta).toBe(40);
    expect(result.margenPorcentaje).toBe(4); // 40 / 1000
    // El agregado de anuladas filtra estado ANULADA con los mismos filtros
    expect(aggregate.mock.calls[1][0].where.estado).toBe('ANULADA');
  });

  it('devoluciones: solo PROCESADAS de cliente (ventaId not null)', async () => {
    const devolucionCount = jest.fn().mockResolvedValue(0);
    const service = mkService({
      venta: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { id: 0 },
          _sum: { total: null },
          _avg: { total: null },
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      devolucion: { count: devolucionCount },
      devolucionItem: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { cantidad: null } }),
      },
      ventaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await service.getResumenGeneral('emp1', {} as any);

    const whereDev = devolucionCount.mock.calls[0][0].where;
    expect(whereDev.estado).toBe('PROCESADA');
    expect(whereDev.ventaId).toEqual({ not: null });
  });
});

describe('VentaAnalyticsService.getReposicionSugerida', () => {
  it('cruza velocidad 30d con stock (rama variante y rama producto) y clasifica', async () => {
    const detalles = [
      // Variante v1: 60 und. en 30d = 2/día; stock 6 → 3 días (CRITICO)
      {
        productoId: 'p1',
        varianteId: 'v1',
        cantidad: dec(60),
        producto: { nombre: 'Polo' },
        variante: { nombre: 'Talla M' },
      },
      // Producto base p2: 15 und. = 0.5/día; stock 30 → 60 días (OK)
      {
        productoId: 'p2',
        varianteId: null,
        cantidad: dec(15),
        producto: { nombre: 'Gorra' },
        variante: null,
      },
      // p3 sin fila de stock → excluido
      {
        productoId: 'p3',
        varianteId: null,
        cantidad: dec(10),
        producto: { nombre: 'Servicio' },
        variante: null,
      },
    ];
    const stockFindMany = jest
      .fn()
      // 1ª llamada: rama producto base
      .mockResolvedValueOnce([{ productoId: 'p2', stockActual: 30 }])
      // 2ª llamada: rama variante (2 sedes → se suman)
      .mockResolvedValueOnce([
        { varianteId: 'v1', stockActual: 4 },
        { varianteId: 'v1', stockActual: 2 },
      ]);
    const service = mkService({
      ventaDetalle: { findMany: jest.fn().mockResolvedValue(detalles) },
      productoStock: { findMany: stockFindMany },
    });

    const result = await service.getReposicionSugerida('emp1', {} as any);

    expect(result).toHaveLength(2);
    // Ordenado por menos cobertura primero
    expect(result[0]).toMatchObject({
      varianteId: 'v1',
      nombre: 'Polo — Talla M',
      ventaDiaria: 2,
      stockActual: 6,
      diasCobertura: 3,
      nivel: 'CRITICO',
      sugeridoComprar: 24, // 2/día × 15 días − 6
    });
    expect(result[1]).toMatchObject({
      productoId: 'p2',
      nombre: 'Gorra',
      diasCobertura: 60,
      nivel: 'OK',
      sugeridoComprar: 0,
    });
    // Rama producto NUNCA filtra por varianteId y viceversa
    expect(stockFindMany.mock.calls[0][0].where.productoId).toEqual({ in: ['p2', 'p3'] });
    expect(stockFindMany.mock.calls[0][0].where.varianteId).toBeUndefined();
    expect(stockFindMany.mock.calls[1][0].where.varianteId).toEqual({ in: ['v1'] });
    expect(stockFindMany.mock.calls[1][0].where.productoId).toBeUndefined();
  });
});

describe('VentaAnalyticsService.getHorasPico', () => {
  it('bucketiza por hora y día de semana en hora Perú (UTC-5)', async () => {
    const ventas = [
      // 2026-07-20 = lunes. 15:30 UTC = 10:30 Perú (lunes)
      { fechaVenta: new Date('2026-07-20T15:30:00Z'), total: dec(100) },
      // 03:00 UTC del lunes = 22:00 Perú del DOMINGO 19 (dia 7)
      { fechaVenta: new Date('2026-07-20T03:00:00Z'), total: dec(50) },
      // Otra a las 10:xx Perú del lunes — acumula en la misma hora
      { fechaVenta: new Date('2026-07-20T15:45:00Z'), total: dec(25) },
    ];
    const service = mkService({
      venta: { findMany: jest.fn().mockResolvedValue(ventas) },
    });

    const result = await service.getHorasPico('emp1', {} as any);

    expect(result.porHora).toHaveLength(24);
    expect(result.porHora[10]).toEqual({ hora: 10, cantidad: 2, monto: 125 });
    expect(result.porHora[22]).toEqual({ hora: 22, cantidad: 1, monto: 50 });
    expect(result.porDiaSemana).toHaveLength(7);
    expect(result.porDiaSemana[0]).toEqual({ dia: 1, cantidad: 2, monto: 125 }); // lunes
    expect(result.porDiaSemana[6]).toEqual({ dia: 7, cantidad: 1, monto: 50 }); // domingo
  });
});

describe('VentaAnalyticsService.getMetodosPago', () => {
  it('agrupa pagos por método ordenado por monto', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { metodoPago: 'EFECTIVO', _count: { id: 5 }, _sum: { monto: dec(80) } },
      { metodoPago: 'YAPE', _count: { id: 3 }, _sum: { monto: dec(200) } },
    ]);
    const service = mkService({ pagoVenta: { groupBy } });

    const result = await service.getMetodosPago('emp1', {} as any);

    expect(result).toEqual([
      { metodo: 'YAPE', cantidad: 3, monto: 200 },
      { metodo: 'EFECTIVO', cantidad: 5, monto: 80 },
    ]);
    // Los pagos se filtran por la venta (excluye anuladas/borrador)
    const wherePago = groupBy.mock.calls[0][0].where;
    expect(wherePago.venta.is.estado).toEqual({
      notIn: ['BORRADOR', 'ANULADA'],
    });
  });
});

describe('VentaAnalyticsService.getEntregasAnalytics', () => {
  it('clasifica por tipo (delivery manda, luego envío, canal decide el resto) y agrupa zonas', async () => {
    const ventas = [
      // delivery activo aunque tenga conEnvio → DELIVERY
      { total: dec(50), conEnvio: true, canalVenta: 'POS', deliveryLocal: { estado: 'EN_CAMINO' } },
      // delivery cancelado + conEnvio → ENVIO
      { total: dec(100), conEnvio: true, canalVenta: 'POS', deliveryLocal: { estado: 'CANCELADO' } },
      // canal remoto sin envío ni delivery → RECOJO
      { total: dec(30), conEnvio: false, canalVenta: 'WHATSAPP_IA', deliveryLocal: null },
      // presencial sin nada → FISICA
      { total: dec(20), conEnvio: false, canalVenta: 'POS', deliveryLocal: null },
      { total: dec(40), conEnvio: false, canalVenta: 'COTIZACION', deliveryLocal: null },
    ];
    const envios = [
      {
        destinoDepartamento: 'La Libertad',
        destinoProvincia: 'Trujillo',
        venta: { total: dec(100) },
      },
      {
        destinoDepartamento: 'La Libertad',
        destinoProvincia: 'Trujillo',
        venta: { total: dec(60) },
      },
      {
        destinoDepartamento: 'Lima',
        destinoProvincia: null,
        venta: { total: dec(80) },
      },
    ];
    const deliveries = [
      { distrito: 'MOCHE', venta: { total: dec(50) } },
      { distrito: 'MOCHE', venta: { total: dec(25) } },
      { distrito: null, venta: { total: dec(10) } },
    ];
    const service = mkService({
      venta: { findMany: jest.fn().mockResolvedValue(ventas) },
      ventaEnvio: { findMany: jest.fn().mockResolvedValue(envios) },
      deliveryLocal: { findMany: jest.fn().mockResolvedValue(deliveries) },
    });

    const result = await service.getEntregasAnalytics('emp1', {} as any);

    // Orden fijo ENVIO→DELIVERY→RECOJO→FISICA
    expect(result.porTipoEntrega).toEqual([
      { tipo: 'ENVIO', cantidad: 1, monto: 100 },
      { tipo: 'DELIVERY', cantidad: 1, monto: 50 },
      { tipo: 'RECOJO', cantidad: 1, monto: 30 },
      { tipo: 'FISICA', cantidad: 2, monto: 60 },
    ]);
    expect(result.zonasEnvio).toEqual([
      { zona: 'La Libertad / Trujillo', cantidad: 2, monto: 160 },
      { zona: 'Lima', cantidad: 1, monto: 80 },
    ]);
    expect(result.zonasDelivery).toEqual([
      { zona: 'MOCHE', cantidad: 2, monto: 75 },
      { zona: 'Sin distrito', cantidad: 1, monto: 10 },
    ]);
  });
});

describe('VentaAnalyticsService.getVentasPorProveedor', () => {
  it('atribuye al proveedor del vínculo (preferido primero) y agrupa sin proveedor aparte', async () => {
    const detalles = [
      { productoId: 'p1', cantidad: dec(2), total: dec(100) },
      { productoId: 'p2', cantidad: dec(1), total: dec(50) },
      { productoId: 'p3', cantidad: dec(3), total: dec(30) },
    ];
    // p1 con dos vínculos: el preferido llega primero por el orderBy.
    const vinculos = [
      {
        productoId: 'p1',
        proveedorId: 'prov1',
        proveedor: { nombre: 'Distribuidora Andina SAC', nombreComercial: 'Andina' },
      },
      {
        productoId: 'p1',
        proveedorId: 'prov2',
        proveedor: { nombre: 'Otro SAC', nombreComercial: null },
      },
      {
        productoId: 'p2',
        proveedorId: 'prov2',
        proveedor: { nombre: 'Otro SAC', nombreComercial: null },
      },
    ];
    const findManyVinculos = jest.fn().mockResolvedValue(vinculos);
    const service = mkService({
      ventaDetalle: { findMany: jest.fn().mockResolvedValue(detalles) },
      proveedorProducto: { findMany: findManyVinculos },
    });

    const result = await service.getVentasPorProveedor('emp1', {} as any);

    expect(result).toEqual([
      {
        proveedorId: 'prov1',
        proveedor: 'Andina',
        cantidadVendida: 2,
        ingresoTotal: 100,
        productosDistintos: 1,
      },
      {
        proveedorId: 'prov2',
        proveedor: 'Otro SAC',
        cantidadVendida: 1,
        ingresoTotal: 50,
        productosDistintos: 1,
      },
      {
        proveedorId: null,
        proveedor: 'Sin proveedor',
        cantidadVendida: 3,
        ingresoTotal: 30,
        productosDistintos: 1,
      },
    ]);
    // El lookup de vínculos ordena preferido primero y filtra activos
    expect(findManyVinculos.mock.calls[0][0].orderBy).toEqual([
      { esPreferido: 'desc' },
      { creadoEn: 'asc' },
    ]);
    expect(findManyVinculos.mock.calls[0][0].where.isActive).toBe(true);
  });

  it('sin detalles no consulta vínculos y devuelve vacío', async () => {
    const findManyVinculos = jest.fn();
    const service = mkService({
      ventaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
      proveedorProducto: { findMany: findManyVinculos },
    });

    const result = await service.getVentasPorProveedor('emp1', {} as any);

    expect(result).toEqual([]);
    expect(findManyVinculos).not.toHaveBeenCalled();
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
