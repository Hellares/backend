import { NotFoundException } from '@nestjs/common';
import { EmpresaBancoService } from './empresa-banco.service';

/**
 * Tests de getEstadoCuenta (conciliación real por banco): unifica recaudación
 * (ingresos), pagos a proveedor/gasto (egresos) y ajustes del banco. Sin DB.
 */
describe('EmpresaBancoService.getEstadoCuenta', () => {
  const EMPRESA = 'emp-1';
  const BANCO = 'bcp';
  let prisma: any;
  let service: EmpresaBancoService;

  beforeEach(() => {
    prisma = {
      empresaBanco: {
        findFirst: jest.fn().mockResolvedValue({
          id: BANCO, nombreBanco: 'BCP', numeroCuenta: '191', moneda: 'PEN', saldoActual: 1000,
        }),
      },
      movimientoCaja: { findMany: jest.fn().mockResolvedValue([]) },
      pagoCompra: { findMany: jest.fn().mockResolvedValue([]) },
      pagoGastoRecurrente: { findMany: jest.fn().mockResolvedValue([]) },
      ajusteBanco: { findMany: jest.fn().mockResolvedValue([]) },
      // Egresos RRHH (adelantos/planilla) e ingresos CxC (abonos) del estado de cuenta.
      adelantoPago: { findMany: jest.fn().mockResolvedValue([]) },
      boletaPago: { findMany: jest.fn().mockResolvedValue([]) },
      pagoVenta: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new EmpresaBancoService(prisma);
  });

  it('unifica recaudación (ingreso), pagos (egresos) y ajustes, con resumen', async () => {
    prisma.movimientoCaja.findMany.mockResolvedValue([
      { metodoPago: 'YAPE', monto: 200, fechaMovimiento: new Date('2026-06-10') },
    ]);
    prisma.pagoCompra.findMany.mockResolvedValue([
      { monto: 50, fechaPago: new Date('2026-06-12'), compra: { codigo: 'COM-1', nombreProveedor: 'Prov SAC' } },
    ]);
    prisma.pagoGastoRecurrente.findMany.mockResolvedValue([
      { montoReal: 30, fechaPago: new Date('2026-06-11'), gastoRecurrente: { nombre: 'Luz' } },
    ]);
    prisma.ajusteBanco.findMany.mockResolvedValue([
      { tipo: 'INGRESO', monto: 10, motivo: 'Interés', origen: 'AJUSTE_MANUAL', creadoEn: new Date('2026-06-13') },
    ]);
    prisma.$queryRaw.mockResolvedValue([
      { metodoPago: 'YAPE', total: 53536.6 },
      { metodoPago: 'TARJETA', total: 2380 },
    ]);

    const res = await service.getEstadoCuenta(EMPRESA, BANCO);
    expect(res.recaudadoPorMetodo).toEqual({ YAPE: 53536.6, TARJETA: 2380 });

    expect(res.cuenta).toMatchObject({ id: BANCO, saldoActual: 1000 });
    // 4 movimientos, ordenados por fecha desc → ajuste(13), pago compra(12), gasto(11), recaud(10)
    expect(res.movimientos.map((m: any) => m.origen)).toEqual([
      'AJUSTE_MANUAL', 'PAGO_PROVEEDOR', 'PAGO_GASTO', 'RECAUDACION',
    ]);
    const recaud = res.movimientos.find((m: any) => m.origen === 'RECAUDACION');
    expect(recaud).toMatchObject({ tipo: 'INGRESO', concepto: 'Recaudación YAPE', monto: 200 });
    const pago = res.movimientos.find((m: any) => m.origen === 'PAGO_PROVEEDOR');
    expect(pago).toMatchObject({ tipo: 'EGRESO', detalle: 'Prov SAC (COM-1)', monto: 50 });

    // Ingresos = 200 (recaud) + 10 (ajuste INGRESO) = 210; egresos = 50 + 30 = 80
    expect(res.resumen).toMatchObject({ totalIngresos: 210, totalEgresos: 80, neto: 130, cantidad: 4 });
  });

  it('cuenta inexistente → NotFound', async () => {
    prisma.empresaBanco.findFirst.mockResolvedValue(null);
    await expect(service.getEstadoCuenta(EMPRESA, 'x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin movimientos → resumen en 0', async () => {
    const res = await service.getEstadoCuenta(EMPRESA, BANCO);
    expect(res.movimientos).toEqual([]);
    expect(res.resumen).toMatchObject({ totalIngresos: 0, totalEgresos: 0, neto: 0, cantidad: 0 });
  });
});
