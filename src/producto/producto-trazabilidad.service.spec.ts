import { ProductoTrazabilidadService } from './producto-trazabilidad.service';

/**
 * Tests del agregador de Trazabilidad / Ficha 360 (fases 1 y 2). Es 100%
 * lectura; mockeamos prisma. La lógica no-trivial es el cálculo de totales
 * (stock+valorizado), la agregación de proveedores y de insumos consumidos.
 */

// Prisma mock base: todas las colecciones devuelven [] salvo lo que se pise.
const basePrisma = (over: Record<string, any> = {}) => ({
  producto: { findFirst: jest.fn() },
  productoStock: { findMany: jest.fn().mockResolvedValue([]) },
  compraDetalle: { findMany: jest.fn().mockResolvedValue([]) },
  lote: { findMany: jest.fn().mockResolvedValue([]) },
  ventaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
  movimientoStock: { findMany: jest.fn().mockResolvedValue([]) },
  transferenciaStockItem: { findMany: jest.fn().mockResolvedValue([]) },
  devolucionItem: { findMany: jest.fn().mockResolvedValue([]) },
  productoComponente: {
    count: jest.fn().mockResolvedValue(0),
    findMany: jest.fn().mockResolvedValue([]),
  },
  ...over,
});

const productoBase = (over: Record<string, any> = {}) => ({
  id: 'pf',
  nombre: 'Zapato',
  codigoEmpresa: 'P-001',
  esInsumo: false,
  tieneVariantes: false,
  factorCompra: null,
  unidadMedida: { simboloLocal: 'par' },
  unidadCompra: null,
  variantes: [],
  ...over,
});

describe('ProductoTrazabilidadService.trazabilidad', () => {
  it('producto inexistente → NotFoundException', async () => {
    const prisma = basePrisma();
    prisma.producto.findFirst.mockResolvedValue(null);
    const service = new ProductoTrazabilidadService(prisma as any);
    await expect(service.trazabilidad('e1', 'x')).rejects.toThrow(
      /no encontrado/i,
    );
  });

  it('fabricado: consolida secciones, calcula valorización e insumos consumidos', async () => {
    const prisma = basePrisma({
      producto: { findFirst: jest.fn().mockResolvedValue(productoBase()) },
      productoStock: {
        findMany: jest.fn().mockResolvedValue([
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
        ]),
      },
      movimientoStock: {
        findMany: jest
          .fn()
          // 1ª: _fabricaciones (PRODUCCION_ENTRADA)
          .mockResolvedValueOnce([
            {
              numeroDocumento: 'PROD-1',
              cantidad: 10,
              precioCostoUnitario: '8',
              costoManoObra: '6',
              creadoEn: new Date('2026-05-31'),
            },
          ])
          // 2ª: _kardexConsolidado (todos)
          .mockResolvedValueOnce([
            {
              tipo: 'PRODUCCION_ENTRADA',
              tipoDocumento: 'PRODUCCION',
              numeroDocumento: 'PROD-1',
              cantidad: 10,
              precioCostoUnitario: '8',
              creadoEn: new Date('2026-05-31'),
              productoStockId: 'st1',
            },
          ])
          // 3ª: _insumosConsumidos (PRODUCCION_SALIDA de PROD-1)
          .mockResolvedValueOnce([
            {
              cantidad: -100,
              precioCostoUnitario: '0.05',
              valorMovimiento: '5',
              productoStock: {
                producto: { nombre: 'Cuero' },
                variante: null,
              },
            },
          ]),
      },
      productoComponente: {
        count: jest.fn().mockResolvedValue(2), // tiene receta → esFabricado
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const service = new ProductoTrazabilidadService(prisma as any);

    const r = await service.trazabilidad('e1', 'pf');

    expect(r.producto.esFabricado).toBe(true);
    expect(r.producto.unidadMedidaSimbolo).toBe('par');
    expect(r.stock.stockTotal).toBe(14);
    expect(r.stock.valorizado).toBe(78); // 10×5 + 4×7
    expect(r.kardex).toHaveLength(1);
    expect(r.kardex[0].sedeNombre).toBe('Central'); // mapeado por productoStockId
    expect(r.fabricacion.lotesFabricados[0].numeroDocumento).toBe('PROD-1');
    // Insumos consumidos agregados por insumo
    expect(r.fabricacion.insumosConsumidos).toEqual([
      { insumo: 'Cuero', cantidad: 100, costo: 5 },
    ]);
    expect(r.fabricacion.usadoEnRecetas).toEqual([]);
  });

  it('insumo: lista en qué recetas se usa y NO calcula insumos consumidos', async () => {
    const prisma = basePrisma({
      producto: {
        findFirst: jest.fn().mockResolvedValue(
          productoBase({
            id: 'planta',
            nombre: 'Plantas',
            esInsumo: true,
            unidadMedida: null,
          }),
        ),
      },
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
    });
    const service = new ProductoTrazabilidadService(prisma as any);

    const r = await service.trazabilidad('e1', 'planta');

    expect(r.producto.esInsumo).toBe(true);
    expect(r.producto.esFabricado).toBe(false);
    expect(r.fabricacion.insumosConsumidos).toEqual([]);
    expect(r.fabricacion.usadoEnRecetas).toHaveLength(1);
    expect(r.fabricacion.usadoEnRecetas[0]).toMatchObject({
      productoFinalNombre: 'Zapato',
      varianteFinalNombre: 'T20',
      cantidadPorUnidad: 2,
    });
  });

  it('fase 2: transferencias, devoluciones y proveedores agregados', async () => {
    const prisma = basePrisma({
      producto: { findFirst: jest.fn().mockResolvedValue(productoBase()) },
      transferenciaStockItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            cantidadSolicitada: 5,
            cantidadEnviada: 5,
            cantidadRecibida: 5,
            estado: 'RECIBIDO',
            varianteId: null,
            transferencia: {
              id: 't1',
              codigo: 'TR-1',
              estado: 'COMPLETADA',
              fechaSolicitud: new Date('2026-05-20'),
              sedeOrigen: { nombre: 'Central' },
              sedeDestino: { nombre: 'Norte' },
            },
            variante: null,
          },
        ]),
      },
      devolucionItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            cantidad: 2,
            motivo: 'FALLADO',
            varianteId: null,
            devolucion: {
              id: 'd1',
              codigo: 'DEV-1',
              estado: 'PROCESADA',
              creadoEn: new Date('2026-05-25'),
              ventaId: 'v1',
              venta: { codigo: 'VTA-1' },
            },
            variante: null,
          },
        ]),
      },
      compraDetalle: {
        findMany: jest.fn().mockResolvedValue([
          // 2 compras del mismo proveedor → se agregan
          {
            cantidad: 10,
            precioUnitario: '5',
            total: '50',
            varianteId: null,
            compra: {
              id: 'c1',
              codigo: 'COM-1',
              proveedorId: 'prov1',
              nombreProveedor: 'Curtiembre SA',
              fechaRecepcion: new Date('2026-05-10'),
              estado: 'CONFIRMADA',
              moneda: 'PEN',
            },
            variante: null,
          },
          {
            cantidad: 30,
            precioUnitario: '6',
            total: '180',
            varianteId: null,
            compra: {
              id: 'c2',
              codigo: 'COM-2',
              proveedorId: 'prov1',
              nombreProveedor: 'Curtiembre SA',
              fechaRecepcion: new Date('2026-05-22'),
              estado: 'CONFIRMADA',
              moneda: 'PEN',
            },
            variante: null,
          },
        ]),
      },
    });
    const service = new ProductoTrazabilidadService(prisma as any);

    const r = await service.trazabilidad('e1', 'pf');

    // Transferencias
    expect(r.transferencias).toHaveLength(1);
    expect(r.transferencias[0]).toMatchObject({
      codigo: 'TR-1',
      origen: 'Central',
      destino: 'Norte',
    });
    // Devoluciones (con enlace a la venta)
    expect(r.devoluciones).toHaveLength(1);
    expect(r.devoluciones[0]).toMatchObject({
      codigo: 'DEV-1',
      ventaCodigo: 'VTA-1',
      cantidad: 2,
    });
    // Proveedores agregados: 1 proveedor, 2 compras, 40 unid, prom ponderado
    // (10×5 + 30×6) / 40 = 230/40 = 5.75
    expect(r.proveedores).toHaveLength(1);
    expect(r.proveedores[0]).toMatchObject({
      proveedor: 'Curtiembre SA',
      veces: 2,
      cantidadAcum: 40,
      precioPromedio: 5.75,
    });
    // Compras: las 2 filas
    expect(r.compras).toHaveLength(2);
  });
});

/**
 * Historial de compras del producto (el panel que se abre al comprar).
 *
 * 🔴 El costo tiene que venir SIEMPRE EN SOLES: es contra `ProductoStock.
 * precioCosto` que el panel lo compara, y ese no tiene moneda. Sin convertir,
 * una compra en dolares devolvia 14.59 al lado de una en soles de 54.15 y el
 * panel las trataba como comparables.
 */
describe('ProductoTrazabilidadService.historialCompras — moneda', () => {
  // La factura de Deltron: 11 webcams por US$160.48 al TC 3.712.
  const filaUsd = {
    cantidad: 11,
    precioUnitario: 13.6,
    total: 160.48,
    usaUnidadCompra: false,
    cantidadOriginal: null,
    unidadOriginalSimbolo: null,
    compra: {
      id: 'c-usd',
      codigo: 'COMPRA-00098',
      fechaRecepcion: new Date('2026-09-09'),
      proveedorId: 'deltron',
      nombreProveedor: 'DELTRON',
      moneda: 'USD',
      tipoCambio: 3.712,
    },
  };
  const filaPen = {
    ...filaUsd,
    total: 54.15 * 11,
    compra: {
      ...filaUsd.compra,
      id: 'c-pen',
      codigo: 'COMPRA-00090',
      fechaRecepcion: new Date('2026-09-01'),
      moneda: 'PEN',
      tipoCambio: null,
    },
  };

  const servicio = (filas: any[]) => {
    const prisma = basePrisma({
      producto: { findFirst: jest.fn().mockResolvedValue({ id: 'pf', variantes: [] }) },
      compraDetalle: { findMany: jest.fn().mockResolvedValue(filas) },
    });
    return new ProductoTrazabilidadService(prisma as any);
  };

  it('una compra en USD vuelve convertida a soles', async () => {
    const r = await servicio([filaUsd]).historialCompras('emp', 'pf');
    // 160.48 / 11 = 14.5891 dolares → x 3.712 = 54.1547 soles
    expect(r.compras[0].costoUnitario).toBeCloseTo(54.1547, 3);
    expect(r.compras[0].costoUnitarioOriginal).toBeCloseTo(14.5891, 3);
    expect(r.compras[0].moneda).toBe('USD');
    expect(r.compras[0].tipoCambio).toBe(3.712);
  });

  it('una compra en soles no se toca: los dos costos coinciden', async () => {
    const r = await servicio([filaPen]).historialCompras('emp', 'pf');
    expect(r.compras[0].costoUnitario).toBeCloseTo(54.15, 2);
    expect(r.compras[0].costoUnitarioOriginal).toBeCloseTo(54.15, 2);
    expect(r.compras[0].tipoCambio).toBeNull();
  });

  it('🔴 el promedio por proveedor NO mezcla monedas', async () => {
    // Las dos compras costaron practicamente lo mismo en soles (54.15), asi
    // que el promedio tiene que dar eso. Sin convertir daba (14.59+54.15)/2.
    const r = await servicio([filaUsd, filaPen]).historialCompras('emp', 'pf');
    expect(r.proveedores).toHaveLength(1);
    expect(r.proveedores[0].costoPromedio).toBeCloseTo(54.15, 1);
    expect(r.proveedores[0].veces).toBe(2);
  });

  it('el ultimo costo es el de la compra mas reciente, en soles', async () => {
    const r = await servicio([filaUsd, filaPen]).historialCompras('emp', 'pf');
    expect(r.ultimoCosto).toBeCloseTo(54.1547, 3);
  });

  it('el TC solo aplica si la moneda no es PEN', async () => {
    // Una compra en soles con un tipoCambio colgado (data vieja) no se escala.
    const rara = { ...filaPen, compra: { ...filaPen.compra, tipoCambio: 3.9 } };
    const r = await servicio([rara]).historialCompras('emp', 'pf');
    expect(r.compras[0].costoUnitario).toBeCloseTo(54.15, 2);
  });
});
