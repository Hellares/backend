import { ProductoVarianteService } from './producto-variante.service';

/**
 * Rotación de variantes: cuánto salió de cada una en los últimos N días.
 *
 * Es el dato que separa "tengo 175 kg de pollo" de "tengo pollo para 8 meses".
 * Lo que este spec cuida es el CONTRATO de la consulta, que es donde un
 * descuido se vuelve un número creíble pero falso:
 *
 *  - excluir BORRADOR y ANULADA (si no, una venta anulada cuenta como salida)
 *  - filtrar por `fechaVenta`, igual que la analítica de ventas
 *  - acotar a las variantes DEL producto y a la sede pedida
 *  - devolver la cantidad en unidad de venta, sin convertir
 */
const mkLogger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const mkService = (opts: { variantes?: any[]; grupos?: any[] } = {}) => {
  const prisma = {
    productoVariante: {
      findMany: jest.fn().mockResolvedValue(
        opts.variantes ?? [{ id: 'v-granel' }, { id: 'v-saco' }],
      ),
    },
    ventaDetalle: {
      groupBy: jest.fn().mockResolvedValue(opts.grupos ?? []),
    },
  };
  const service = new ProductoVarianteService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    mkLogger() as any,
  );
  return { service, prisma };
};

describe('rotacionVariantes', () => {
  it('suma cantidad y plata, y devuelve la última venta', async () => {
    const { service } = mkService({
      grupos: [
        {
          varianteId: 'v-granel',
          _sum: { cantidad: '12000', total: '132.00' },
          _count: { _all: 4 },
          _max: { creadoEn: new Date('2026-08-08T10:16:48Z') },
        },
      ],
    });

    const r = await service.rotacionVariantes('p1', 'e1', 's1', 90);

    expect(r.dias).toBe(90);
    expect(r.items).toEqual([
      {
        varianteId: 'v-granel',
        // En unidad de VENTA (gramos): convertir a kilos es tarea del cliente,
        // que es el que conoce la presentación de cada variante.
        cantidad: 12000,
        total: 132,
        ventas: 4,
        ultimaVenta: '2026-08-08T10:16:48.000Z',
      },
    ]);
  });

  it('🔴 no cuenta ventas anuladas ni borradores', async () => {
    const { service, prisma } = mkService();

    await service.rotacionVariantes('p1', 'e1', 's1', 30);

    const where = prisma.ventaDetalle.groupBy.mock.calls[0][0].where;
    expect(where.venta.estado.notIn).toEqual(['BORRADOR', 'ANULADA']);
  });

  it('filtra por sede y por fechaVenta dentro del rango', async () => {
    const { service, prisma } = mkService();

    await service.rotacionVariantes('p1', 'e1', 'sede-principal', 30);

    const where = prisma.ventaDetalle.groupBy.mock.calls[0][0].where;
    expect(where.venta.sedeId).toBe('sede-principal');
    expect(where.venta.empresaId).toBe('e1');
    // `fechaVenta`, no `creadoEn`: mismo criterio que la analítica de ventas.
    expect(where.venta.fechaVenta.gte).toBeInstanceOf(Date);
    const dias =
      (Date.now() - where.venta.fechaVenta.gte.getTime()) / 86400000;
    expect(dias).toBeGreaterThan(29.9);
    expect(dias).toBeLessThan(30.1);
  });

  it('solo mira las variantes del producto', async () => {
    const { service, prisma } = mkService({
      variantes: [{ id: 'v1' }, { id: 'v2' }],
    });

    await service.rotacionVariantes('p1', 'e1', 's1', 90);

    const where = prisma.ventaDetalle.groupBy.mock.calls[0][0].where;
    expect(where.varianteId.in).toEqual(['v1', 'v2']);
  });

  it('un producto sin variantes no consulta ventas', async () => {
    const { service, prisma } = mkService({ variantes: [] });

    const r = await service.rotacionVariantes('p1', 'e1', 's1', 90);

    expect(r.items).toEqual([]);
    expect(prisma.ventaDetalle.groupBy).not.toHaveBeenCalled();
  });
});
