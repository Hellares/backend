import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReportesAbonoService } from './reportes-abono.service';

/**
 * Pagos reportados por el cliente desde la tienda web (a una o varias ventas).
 *
 * Invariantes:
 * - Aprobar registra UN abono por línea por el MISMO camino del panel
 *   (registrarAbono), con la misma referencia; un digital sin N° de
 *   operación va con "00000" (bancarización).
 * - Todo o nada: si una línea falla, se anulan los abonos ya registrados y el
 *   pago vuelve a PENDIENTE.
 * - Dos aprobaciones a la vez: solo una registra plata (se "toma" el pago).
 * - Entrar a BANCO exige cuenta: la reportada por el cliente o la elegida.
 * - Rechazar exige motivo (lo ve el cliente) y no toca plata.
 */

const linea = (id: string, ventaId: string, monto: number) => ({ id, ventaId, monto, pagoVentaId: null });
const reporte = (extra: any = {}) => ({
  id: 'r1', empresaId: 'e1', monto: 250, metodoPago: 'YAPE',
  numeroOperacion: null, empresaBancoId: null, estado: 'PENDIENTE',
  lineas: [linea('l1', 'v1', 250)], ...extra,
});

const make = (opts: { reporte?: any; tomado?: number; registrar?: jest.Mock } = {}) => {
  const prisma: any = {
    reporteAbono: {
      findFirst: jest.fn().mockResolvedValue(opts.reporte === undefined ? reporte() : opts.reporte),
      updateMany: jest.fn().mockResolvedValue({ count: opts.tomado ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
    reporteAbonoVenta: { update: jest.fn().mockResolvedValue({}) },
  };
  let n = 0;
  const cxc: any = {
    registrarAbono: opts.registrar ?? jest.fn().mockImplementation(() => Promise.resolve({ pagoId: `pago-${++n}`, saldoPendiente: 0 })),
    anularAbono: jest.fn().mockResolvedValue({}),
  };
  const depositos: any = { registrar: jest.fn().mockResolvedValue({ depositoId: 'dep-1', disponible: 0 }) };
  return { service: new ReportesAbonoService(prisma, cxc, depositos), prisma, cxc, depositos };
};

describe('Pagos reportados por el cliente (CxC)', () => {
  it('aprobar un pago de una venta registra su abono y lo enlaza a la línea', async () => {
    const { service, prisma, cxc } = make();
    const res = await service.aprobar('e1', 'r1', 'u-admin', { fuente: 'BANCO', bancoId: 'b1' });
    expect(cxc.registrarAbono).toHaveBeenCalledWith(
      'e1', 'v1',
      { monto: 250, metodoPago: 'YAPE', referencia: '00000', fuente: 'BANCO', bancoId: 'b1' },
      'u-admin',
    );
    expect(prisma.reporteAbonoVenta.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { pagoVentaId: 'pago-1' } });
    expect(res).toMatchObject({ ok: true, abonos: 1 });
  });

  it('una transferencia que salda 3 ventas: un abono por venta, misma referencia y cuenta', async () => {
    const { service, cxc, prisma } = make({
      reporte: reporte({
        monto: 10000, metodoPago: 'TRANSFERENCIA', empresaBancoId: 'b-cliente', numeroOperacion: '987',
        lineas: [linea('l1', 'a', 4000), linea('l2', 'b', 3000), linea('l3', 'c', 3000)],
      }),
    });
    const res = await service.aprobar('e1', 'r1', 'u', {});
    expect(cxc.registrarAbono.mock.calls.map((c: any[]) => [c[1], c[2].monto, c[2].referencia, c[2].bancoId])).toEqual([
      ['a', 4000, '987', 'b-cliente'], ['b', 3000, '987', 'b-cliente'], ['c', 3000, '987', 'b-cliente'],
    ]);
    expect(prisma.reporteAbonoVenta.update).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ abonos: 3, pagos: ['pago-1', 'pago-2', 'pago-3'] });
  });

  it('si la 3.ª venta falla, se anulan los 2 abonos ya registrados y el pago vuelve a PENDIENTE', async () => {
    const registrar = jest.fn()
      .mockResolvedValueOnce({ pagoId: 'pago-1' })
      .mockResolvedValueOnce({ pagoId: 'pago-2' })
      .mockRejectedValueOnce(new BadRequestException('El abono supera el saldo'));
    const { service, cxc, prisma } = make({
      registrar,
      reporte: reporte({ lineas: [linea('l1', 'a', 100), linea('l2', 'b', 100), linea('l3', 'c', 100)] }),
    });
    await expect(service.aprobar('e1', 'r1', 'u', { fuente: 'TESORERIA' })).rejects.toThrow('supera el saldo');
    expect(cxc.anularAbono.mock.calls.map((c: any[]) => c[1])).toEqual(['pago-2', 'pago-1']);
    expect(prisma.reporteAbonoVenta.update).toHaveBeenCalledWith({ where: { id: 'l1' }, data: { pagoVentaId: null } });
    expect(prisma.reporteAbono.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { estado: 'PENDIENTE', revisadoPorId: null, revisadoEn: null },
    });
  });

  it('Yape a BANCO sin cuenta: 400 y no toma el pago', async () => {
    const { service, prisma, cxc } = make();
    await expect(service.aprobar('e1', 'r1', 'u', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reporteAbono.updateMany).not.toHaveBeenCalled();
    expect(cxc.registrarAbono).not.toHaveBeenCalled();
  });

  it('si otro admin ya lo tomó, no registra nada', async () => {
    const { service, cxc } = make({ tomado: 0 });
    await expect(service.aprobar('e1', 'r1', 'u', { fuente: 'TESORERIA' })).rejects.toBeInstanceOf(ConflictException);
    expect(cxc.registrarAbono).not.toHaveBeenCalled();
  });

  it('un pago ya revisado no se aprueba', async () => {
    const { service } = make({ reporte: reporte({ estado: 'APROBADO' }) });
    await expect(service.aprobar('e1', 'r1', 'u', { fuente: 'TESORERIA' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechazar exige motivo y no toca plata', async () => {
    const { service, prisma, cxc } = make();
    await expect(service.rechazar('e1', 'r1', 'u', '  ')).rejects.toBeInstanceOf(BadRequestException);
    await service.rechazar('e1', 'r1', 'u', 'No llegó la transferencia');
    expect(prisma.reporteAbono.updateMany.mock.calls[0][0].data).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'No llegó la transferencia' });
    expect(cxc.registrarAbono).not.toHaveBeenCalled();
  });
  it('un pago SIN compras es un deposito: entra una vez y no registra abonos', async () => {
    const { service, cxc, depositos } = make({
      reporte: reporte({ monto: 4000, metodoPago: 'TRANSFERENCIA', numeroOperacion: 'OP-1', lineas: [], clienteId: 'ep1', clienteEmpresaId: null }),
    });
    const res = await service.aprobar('e1', 'r1', 'u-admin', { fuente: 'BANCO', bancoId: 'b1' });
    expect(depositos.registrar).toHaveBeenCalledWith(
      'e1', 'u-admin',
      expect.objectContaining({ clienteId: 'ep1', monto: 4000, metodoPago: 'TRANSFERENCIA', referencia: 'OP-1', fuente: 'BANCO', bancoId: 'b1' }),
      { origen: 'TIENDA', reporteAbonoId: 'r1' },
    );
    expect(cxc.registrarAbono).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: true, abonos: 0, depositoId: 'dep-1' });
  });

  it('si el deposito no se puede registrar, el pago vuelve a PENDIENTE', async () => {
    const { service, prisma, depositos } = make({
      reporte: reporte({ lineas: [], clienteId: 'ep1' }),
    });
    depositos.registrar.mockRejectedValue(new Error('sin caja abierta'));
    await expect(service.aprobar('e1', 'r1', 'u-admin', { fuente: 'BANCO', bancoId: 'b1' })).rejects.toThrow('sin caja abierta');
    expect(prisma.reporteAbono.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { estado: 'PENDIENTE', revisadoPorId: null, revisadoEn: null },
    });
  });
});
