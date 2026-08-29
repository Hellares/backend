import { VentaService } from './venta.service';

/**
 * Candado del sellado de identificadores (IMEI / N° de serie / placa).
 *
 * Lo que se fija acá es el contrato de `sellarIdentificadores`, que cuelga de
 * `aplicarPreciosBackendNivel` — el embudo por el que pasan los TRES flujos de
 * venta. Dos cosas que no pueden romperse:
 *
 *  1. La forma PLANA de siempre (`identificadores`, un código por unidad) sigue
 *     produciendo la misma descripción, byte por byte. Es lo que hace que un
 *     APK viejo cobre igual contra este backend.
 *  2. La nota se empareja con la UNIDAD, no con el código. Con un celular dual
 *     SIM (dos IMEI en una unidad) el emparejamiento por índice le pegaría la
 *     nota de la segunda unidad al segundo IMEI de la primera.
 *
 * La descripción no es cosmética: es el snapshot que se imprime en el ticket y
 * el que viaja a `DetalleComprobante` → SUNAT.
 */
describe('VentaService.sellarIdentificadores', () => {
  let service: VentaService;
  let prisma: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  beforeEach(() => {
    prisma = {
      producto: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'prod-1', nombre: 'CELULAR REDMI', etiquetaIdentificador: 'IMEI' },
        ]),
      },
      productoVariante: { findMany: jest.fn().mockResolvedValue([]) },
    };

    service = new VentaService(
      prisma, null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any,
      null as any, logger as any, null as any,
    );
  });

  /** Atajo al método privado: es interno a propósito, se prueba por su efecto. */
  const sellar = (detalle: any) =>
    (service as any).sellarIdentificadores([detalle]);

  const linea = (extra: any) => ({
    productoId: 'prod-1',
    descripcion: 'CELULAR REDMI',
    cantidad: 1,
    ...extra,
  });

  it('forma PLANA (APK viejo): un código por unidad, descripción igual que siempre', async () => {
    const [out] = await sellar(
      linea({
        cantidad: 2,
        identificadores: ['351234567890123', '351234567890124'],
        notasIdentificador: ['NEGRO 128GB', 'AZUL 256GB'],
      }),
    );

    expect(out.identificadores).toEqual(['351234567890123', '351234567890124']);
    expect(out.descripcion).toBe(
      'CELULAR REDMI - IMEI: 351234567890123 (NEGRO 128GB), ' +
        '351234567890124 (AZUL 256GB)',
    );
  });

  it('dual SIM: los dos IMEI de UNA unidad van juntos y se guardan sueltos', async () => {
    const [out] = await sellar(
      linea({
        cantidad: 1,
        identificadoresPorUnidad: [['351234567890123', '351234567890124']],
        notasIdentificador: ['NEGRO 128GB'],
      }),
    );

    // Aplanados en la columna: cada código sigue siendo buscable exacto por GIN.
    expect(out.identificadores).toEqual(['351234567890123', '351234567890124']);
    expect(out.descripcion).toBe(
      'CELULAR REDMI - IMEI: 351234567890123 / 351234567890124 (NEGRO 128GB)',
    );
  });

  it('la nota se empareja con la UNIDAD, no con el código', async () => {
    const [out] = await sellar(
      linea({
        cantidad: 2,
        identificadoresPorUnidad: [
          ['351234567890123', '351234567890124'],
          ['351234567890125'],
        ],
        notasIdentificador: ['NEGRO 128GB', 'BLANCO 256GB'],
      }),
    );

    // BLANCO es de la SEGUNDA unidad; emparejando por código habría caído en
    // el segundo IMEI de la primera.
    expect(out.descripcion).toBe(
      'CELULAR REDMI - IMEI: 351234567890123 / 351234567890124 (NEGRO 128GB), ' +
        '351234567890125 (BLANCO 256GB)',
    );
  });

  it('una unidad sin ningún código no pasa', async () => {
    await expect(
      sellar(
        linea({
          cantidad: 2,
          identificadoresPorUnidad: [['351234567890123'], []],
        }),
      ),
    ).rejects.toThrow(/unidad 2 le falta el IMEI/);
  });

  it('menos grupos que unidades no pasa', async () => {
    await expect(
      sellar(
        linea({
          cantidad: 3,
          identificadoresPorUnidad: [['351234567890123'], ['351234567890124']],
        }),
      ),
    ).rejects.toThrow(/llegaron 2/);
  });

  it('el mismo código repetido en la venta no pasa, aunque sea en la misma unidad', async () => {
    await expect(
      sellar(
        linea({
          cantidad: 1,
          identificadoresPorUnidad: [['351234567890123', '351234567890123']],
        }),
      ),
    ).rejects.toThrow(/repetido en la venta/);
  });

  it('más de 5 códigos en una unidad no pasa', async () => {
    await expect(
      sellar(
        linea({
          cantidad: 1,
          identificadoresPorUnidad: [['1', '2', '3', '4', '5', '6']],
        }),
      ),
    ).rejects.toThrow(/el máximo es 5/);
  });

  it('basura del cliente se descarta en vez de romper', async () => {
    const [out] = await sellar(
      linea({
        cantidad: 1,
        // Un no-string y un vacío entre medio: se limpian, queda el válido.
        identificadoresPorUnidad: [[null, '  351234567890123  ', '']],
      }),
    );

    expect(out.identificadores).toEqual(['351234567890123']);
  });

  it('producto que NO pide identificador: la descripción no se toca', async () => {
    prisma.producto.findMany.mockResolvedValue([]);

    const [out] = await sellar(
      linea({ cantidad: 1, identificadoresPorUnidad: [['351234567890123']] }),
    );

    expect(out.descripcion).toBe('CELULAR REDMI');
  });
});
