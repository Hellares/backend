import { CostoVentaService } from './costo-venta.service';

/**
 * Elegir de qué lote sale una línea.
 *
 * 🔑 El caso real: se le compró a DELTRON y a CETI para dos clientes
 * distintos. FEFO parte de que una unidad es intercambiable con otra, y
 * cuando la mercadería se compró POR ENCARGO eso deja de ser cierto — esa
 * caja tiene dueño y su costo es otro. Sin el lote elegido, al cliente de la
 * compra cara se le cobra el costo de la barata.
 *
 * Lo que se fija acá:
 *
 *  1. `lotesDisponibles` trae TODOS los presentes, no solo los que este pedido
 *     consume: el selector existe justamente para ofrecer los que FEFO no
 *     habría elegido.
 *  2. El orden es el de FEFO, así que el primero es el que sale por defecto —
 *     de eso depende que la UI pueda decir "hoy saldría este".
 *  3. El lote elegido MANDA sobre FEFO y el costo cotizado es el suyo. Este es
 *     el mismo planificador que después consume el stock: si se despegaran, la
 *     vista previa mostraría un precio y la venta cobraría otro.
 */
describe('CostoVentaService · elegir el lote', () => {
  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  const compra = (codigo: string, serie: string, numero: string) => ({
    id: `c-${codigo}`,
    codigo,
    moneda: 'PEN',
    tipoCambio: null,
    tipoDocumentoProveedor: 'FACTURA',
    serieDocumentoProveedor: serie,
    numeroDocumentoProveedor: numero,
  });

  /** Sin vencimiento, caro: el que FEFO manda AL FINAL. Es el de DELTRON. */
  const LOTE_A = {
    id: 'lote-a',
    productoStockId: 'ps-1',
    codigo: 'L-A',
    precioCosto: 30,
    cantidadActual: 1,
    fechaIngreso: new Date('2026-01-01'),
    fechaVencimiento: null,
    nombreProveedor: 'DELTRON',
    compra: compra('COM-001', 'F001', '111'),
    // total 25 + flete 5 = los 30 del lote: el neto sin flete es 25.
    detallesCompra: [
      { cantidad: 1, total: 25, gastoProrrateado: 5, cantidadBonificada: 0 },
    ],
  };

  /** Vence más tarde que C. */
  const LOTE_B = {
    ...LOTE_A,
    id: 'lote-b',
    codigo: 'L-B',
    precioCosto: 20,
    cantidadActual: 5,
    fechaIngreso: new Date('2026-02-01'),
    fechaVencimiento: new Date('2026-10-01'),
    nombreProveedor: 'CETI',
    compra: compra('COM-002', 'F002', '222'),
    detallesCompra: [
      { cantidad: 5, total: 100, gastoProrrateado: 0, cantidadBonificada: 0 },
    ],
  };

  /** El que vence PRIMERO: el que FEFO toma sin que nadie elija nada. */
  const LOTE_C = {
    ...LOTE_A,
    id: 'lote-c',
    codigo: 'L-C',
    precioCosto: 10,
    cantidadActual: 2,
    fechaIngreso: new Date('2026-03-01'),
    fechaVencimiento: new Date('2026-09-20'),
    nombreProveedor: 'CETI',
    compra: compra('COM-003', 'F002', '333'),
    detallesCompra: [
      { cantidad: 2, total: 20, gastoProrrateado: 0, cantidadBonificada: 0 },
    ],
  };

  const build = (lotes: any[]) => {
    const prisma = {
      productoStock: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ps-1', productoId: 'prod-1', varianteId: null, precioCosto: 22 },
        ]),
      },
      // La query real ordena por fechaIngreso asc: el desempate de los "sin
      // vencimiento" sale de ahí, no del comparador.
      lote: { findMany: jest.fn().mockResolvedValue(lotes) },
    };
    return new CostoVentaService(prisma as any, logger as any);
  };

  const pedir = async (
    lotes: any[],
    cantidad: number,
    loteId?: string,
  ) => {
    const service = build(lotes);
    const mapa = await service.costosDeItems(
      [{ productoId: 'prod-1', cantidad, loteId }],
      'sede-1',
      'emp-1',
    );
    return mapa.get('p:prod-1')!;
  };

  it('ofrece TODOS los lotes presentes, en el orden en que FEFO los tomaría', async () => {
    const r = await pedir([LOTE_A, LOTE_B, LOTE_C], 1);

    // Vence antes → sale antes; el sin vencimiento va al final.
    expect(r.lotesDisponibles.map((l) => l.codigo)).toEqual(['L-C', 'L-B', 'L-A']);
    // Aunque el pedido consuma UNO solo: el selector ofrece los tres.
    expect(r.tramos).toHaveLength(1);
    expect(r.tramos[0].loteId).toBe('lote-c');
  });

  it('cada lote dice lo que QUEDA y de qué factura salió', async () => {
    const r = await pedir([LOTE_A, LOTE_B, LOTE_C], 1);
    const a = r.lotesDisponibles.find((l) => l.codigo === 'L-A')!;

    expect(a.cantidadActual).toBe(1);
    expect(a.costoUnitario).toBe(30);
    // El neto de la factura, sin el flete prorrateado.
    expect(a.costoUnitarioSinFlete).toBe(25);
    expect(a.proveedorNombre).toBe('DELTRON');
    expect(a.documentoProveedor).toBe('F001-111');
    expect(a.compraCodigo).toBe('COM-001');
  });

  it('🔑 el lote elegido MANDA sobre FEFO y el costo cotizado es el suyo', async () => {
    const auto = await pedir([LOTE_A, LOTE_B, LOTE_C], 1);
    const elegido = await pedir([LOTE_A, LOTE_B, LOTE_C], 1, 'lote-a');

    // Sin elegir sale el que vence primero, a 10.
    expect(auto.costoLote).toBe(10);
    // Eligiendo el de DELTRON se cobra SU costo, no el del más viejo.
    expect(elegido.costoLote).toBe(30);
    expect(elegido.tramos[0].loteId).toBe('lote-a');
  });

  it('si el elegido no alcanza, el resto sigue por FEFO y se ve en los tramos', async () => {
    // Se piden 3 y el lote de DELTRON tiene 1.
    const r = await pedir([LOTE_A, LOTE_B, LOTE_C], 3, 'lote-a');

    expect(r.tramos.map((t) => [t.loteId, t.cantidad])).toEqual([
      ['lote-a', 1],
      ['lote-c', 2],
    ]);
    // Promedio PONDERADO: (30×1 + 10×2) / 3. × 3 devuelve lo que costaron.
    expect(r.costoLote).toBeCloseTo(50 / 3, 6);
    expect(r.sinCubrir).toBe(0);
  });

  it('sin lotes no hay nada que elegir, y no se inventa un costo de lote', async () => {
    const r = await pedir([], 1);

    expect(r.lotesDisponibles).toEqual([]);
    expect(r.costoLote).toBeNull();
    // El promedio del inventario sigue estando: es otro modo, y es válido.
    expect(r.costoPromedio).toBe(22);
  });
});
