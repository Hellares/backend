import { NotFoundException } from '@nestjs/common';
import { ProveedorService } from './proveedor.service';

/**
 * Tests del estado de cuenta del tercero (proveedor que también es cliente):
 * cruza CxP (le debo) con CxC (me debe) y calcula el neto por moneda.
 */
describe('ProveedorService.estadoCuenta', () => {
  const EMP = 'emp-1';
  const PROV = 'prov-1';
  let prisma: any;
  let cxp: any;
  let cxc: any;
  let service: ProveedorService;

  const logger = { info: jest.fn(), setContext: jest.fn(), log: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    prisma = {
      proveedor: { findFirst: jest.fn() },
      compraDetalle: { findMany: jest.fn().mockResolvedValue([]) },
      ventaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
    };
    cxp = { listar: jest.fn().mockResolvedValue([]) };
    cxc = { listar: jest.fn().mockResolvedValue([]) };
    service = new ProveedorService(prisma, logger as any, {} as any, {} as any, cxp, cxc);
  });

  it('proveedor inexistente → NotFound', async () => {
    prisma.proveedor.findFirst.mockResolvedValue(null);
    await expect(service.estadoCuenta(EMP, PROV)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cruza CxP y CxC y calcula el neto por moneda', async () => {
    prisma.proveedor.findFirst.mockResolvedValue({
      id: PROV, nombre: 'ARCA', numeroDocumento: '20101024645',
      clienteEmpresa: { id: 'ce-1', codigo: 'CE-002' },
    });
    cxp.listar.mockResolvedValue([
      { compraId: 'c1', codigo: 'COMPRA-1', moneda: 'PEN', saldoPendiente: 100, totalCompra: 100, totalPagado: 0, fechaCompra: '2026-06-01', estado: 'PENDIENTE' },
      { compraId: 'c2', codigo: 'COMPRA-2', moneda: 'USD', saldoPendiente: 50, totalCompra: 50, totalPagado: 0, fechaCompra: '2026-06-03', estado: 'PENDIENTE' },
    ]);
    cxc.listar.mockResolvedValue([
      { ventaId: 'v1', codigo: 'VTA-1', moneda: 'PEN', saldoPendiente: 30, totalVenta: 30, totalPagado: 0, fechaVenta: '2026-06-02', estado: 'PENDIENTE' },
    ]);
    prisma.compraDetalle.findMany.mockResolvedValue([
      { compraId: 'c1', descripcion: 'Gaseosa', cantidad: 2, total: 100 },
    ]);

    const r = await service.estadoCuenta(EMP, PROV);
    expect(cxc.listar).toHaveBeenCalledWith(EMP, { clienteEmpresaId: 'ce-1' });
    expect(r.leDeboPorMoneda).toEqual({ PEN: 100, USD: 50 });
    expect(r.meDebePorMoneda).toEqual({ PEN: 30 });
    expect(r.netoPorMoneda).toEqual({ PEN: 70, USD: 50 });
    expect(r.movimientos).toHaveLength(3);
    // Ordenado por fecha desc: COMPRA-2 (06-03) primero
    expect(r.movimientos[0].codigo).toBe('COMPRA-2');
    expect(r.esTercero).toBe(true);
    // El movimiento de COMPRA-1 trae sus ítems + id para navegar
    const c1 = r.movimientos.find((m: any) => m.codigo === 'COMPRA-1') as any;
    expect(c1.id).toBe('c1');
    expect(c1.items).toEqual([{ descripcion: 'Gaseosa', cantidad: 2, total: 100 }]);
  });

  it('proveedor sin cliente vinculado → solo CxP, no consulta CxC', async () => {
    prisma.proveedor.findFirst.mockResolvedValue({
      id: PROV, nombre: 'ARCA', numeroDocumento: '20101024645', clienteEmpresa: null,
    });
    cxp.listar.mockResolvedValue([
      { codigo: 'COMPRA-1', moneda: 'PEN', saldoPendiente: 100, totalCompra: 100, totalPagado: 0, fechaCompra: '2026-06-01', estado: 'PENDIENTE' },
    ]);
    const r = await service.estadoCuenta(EMP, PROV);
    expect(cxc.listar).not.toHaveBeenCalled();
    expect(r.meDebePorMoneda).toEqual({});
    expect(r.netoPorMoneda).toEqual({ PEN: 100 });
    expect(r.esTercero).toBe(false);
  });
});
