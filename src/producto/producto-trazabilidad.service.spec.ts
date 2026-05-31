import { ProductoTrazabilidadService } from './producto-trazabilidad.service';

/**
 * Tests del agregador de Trazabilidad / Ficha 360. Es 100% lectura; mockeamos
 * prisma. La única lógica no-trivial es el cálculo de totales (stock + valorizado)
 * y el armado de secciones; el resto es mapeo.
 */

describe('ProductoTrazabilidadService.trazabilidad', () => {
  it('producto inexistente → NotFoundException', async () => {
    const prisma = {
      producto: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new ProductoTrazabilidadService(prisma as any);
    await expect(
      service.trazabilidad('e1', 'noexiste'),
    ).rejects.toThrow(/no encontrado/i);
  });

  it('happy path (producto fabricado): consolida secciones y calcula valorización', async () => {
    const prisma = {
      producto: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'pf',
          nombre: 'Zapato',
          codigoEmpresa: 'P-001',
          esInsumo: false,
          tieneVariantes: false,
          factorCompra: null,
          unidadMedida: { simboloLocal: 'par' },
          unidadCompra: null,
          variantes: [],
        }),
      },
      productoStock: {
        findMany: jest
          .fn()
          // 1ª llamada: stock por sede
          .mockResolvedValueOnce([
            {
              id: 'st1',
              stockActual: 10,
              precioCosto: '5',
              varianteId: null,
              sede: { id: 's1', nombre: 'Central' },
              variante: null,
            },
            {
              id: 'st2',
              stockActual: 4,
              precioCosto: '7',
              varianteId: null,
              sede: { id: 's2', nombre: 'Norte' },
              variante: null,
            },
          ])
          // 2ª llamada: stock ids para fabricaciones
          .mockResolvedValueOnce([{ id: 'st1' }, { id: 'st2' }]),
      },
      compraDetalle: { findMany: jest.fn().mockResolvedValue([]) },
      lote: { findMany: jest.fn().mockResolvedValue([]) },
      ventaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
      movimientoStock: {
        findMany: jest.fn().mockResolvedValue([
          {
            numeroDocumento: 'PROD-1',
            cantidad: 10,
            precioCostoUnitario: '8',
            costoManoObra: '6',
            creadoEn: new Date('2026-05-31'),
          },
        ]),
      },
      productoComponente: { count: jest.fn().mockResolvedValue(2) },
    };
    const service = new ProductoTrazabilidadService(prisma as any);

    const r = await service.trazabilidad('e1', 'pf');

    // Cabecera
    expect(r.producto.esFabricado).toBe(true); // count > 0
    expect(r.producto.unidadMedidaSimbolo).toBe('par');
    // Totales: 10 + 4 = 14; valorizado = 10×5 + 4×7 = 78
    expect(r.stock.stockTotal).toBe(14);
    expect(r.stock.valorizado).toBe(78);
    expect(r.stock.porSede).toHaveLength(2);
    // Fabricación: 1 lote producido
    expect(r.fabricacion.lotesFabricados).toHaveLength(1);
    expect(r.fabricacion.lotesFabricados[0].numeroDocumento).toBe('PROD-1');
    expect(r.fabricacion.lotesFabricados[0].precioCostoUnitario).toBe(8);
    // No es insumo → no se busca dónde se usa
    expect(r.fabricacion.usadoEnRecetas).toEqual([]);
    expect(prisma.productoComponente.count).toHaveBeenCalled();
  });

  it('insumo: busca en qué recetas se usa (usadoEnRecetas)', async () => {
    const prisma = {
      producto: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'planta',
          nombre: 'Plantas',
          codigoEmpresa: 'I-009',
          esInsumo: true,
          tieneVariantes: false,
          factorCompra: null,
          unidadMedida: null,
          unidadCompra: null,
          variantes: [],
        }),
      },
      productoStock: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([]) // stock por sede
          .mockResolvedValueOnce([]), // fabricaciones (sin stock)
      },
      compraDetalle: { findMany: jest.fn().mockResolvedValue([]) },
      lote: { findMany: jest.fn().mockResolvedValue([]) },
      ventaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
      movimientoStock: { findMany: jest.fn().mockResolvedValue([]) },
      productoComponente: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([
          {
            cantidad: 2,
            producto: { id: 'zapato', nombre: 'Zapato' },
            variante: { nombre: 'T20' },
            componenteVariante: null,
          },
        ]),
      },
    };
    const service = new ProductoTrazabilidadService(prisma as any);

    const r = await service.trazabilidad('e1', 'planta');

    expect(r.producto.esInsumo).toBe(true);
    expect(r.producto.esFabricado).toBe(false);
    expect(r.fabricacion.usadoEnRecetas).toHaveLength(1);
    expect(r.fabricacion.usadoEnRecetas[0]).toMatchObject({
      productoFinalNombre: 'Zapato',
      varianteFinalNombre: 'T20',
      cantidadPorUnidad: 2,
    });
  });
});
