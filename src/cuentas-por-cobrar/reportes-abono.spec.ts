import { BadRequestException, ConflictException } from '@nestjs/common';
import { ReportesAbonoService } from './reportes-abono.service';

/**
 * Pagos reportados por el cliente desde la tienda web.
 *
 * Invariantes:
 * - Aprobar registra el abono por el MISMO camino del panel (registrarAbono)
 *   y lo enlaza; un digital sin N° de operación va con "00000" (bancarización).
 * - Dos aprobaciones a la vez: solo una registra plata (se "toma" el reporte).
 * - Si registrarAbono falla, el reporte vuelve a PENDIENTE.
 * - Entrar a BANCO exige cuenta: la reportada por el cliente o la elegida.
 * - Rechazar exige motivo (lo ve el cliente) y no toca plata.
 */

const reporte = (extra: any = {}) => ({
  id: 'r1', empresaId: 'e1', ventaId: 'v1', monto: 250, metodoPago: 'YAPE',
  numeroOperacion: null, empresaBancoId: null, estado: 'PENDIENTE', ...extra,
});

const make = (opts: { reporte?: any; tomado?: number; registrar?: jest.Mock } = {}) => {
  const prisma: any = {
    reporteAbono: {
      findFirst: jest.fn().mockResolvedValue(opts.reporte === undefined ? reporte() : opts.reporte),
      updateMany: jest.fn().mockResolvedValue({ count: opts.tomado ?? 1 }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  const cxc: any = {
    registrarAbono: opts.registrar ?? jest.fn().mockResolvedValue({ pagoId: 'pago-1', saldoPendiente: 750 }),
  };
  return { service: new ReportesAbonoService(prisma, cxc), prisma, cxc };
};

describe('Pagos reportados por el cliente (CxC)', () => {
  it('aprobar registra el abono por registrarAbono y lo enlaza al reporte', async () => {
    const { service, prisma, cxc } = make();
    const res = await service.aprobar('e1', 'r1', 'u-admin', { fuente: 'BANCO', bancoId: 'b1' });
    expect(cxc.registrarAbono).toHaveBeenCalledWith(
      'e1', 'v1',
      { monto: 250, metodoPago: 'YAPE', referencia: '00000', fuente: 'BANCO', bancoId: 'b1' },
      'u-admin',
    );
    expect(prisma.reporteAbono.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { pagoVentaId: 'pago-1' } });
    expect(res).toMatchObject({ ok: true, pagoId: 'pago-1' });
  });

  it('una transferencia sin cuenta elegida entra a la cuenta que reportó el cliente', async () => {
    const { service, cxc } = make({ reporte: reporte({ metodoPago: 'TRANSFERENCIA', empresaBancoId: 'b-cliente', numeroOperacion: '123' }) });
    await service.aprobar('e1', 'r1', 'u', {});
    expect(cxc.registrarAbono.mock.calls[0][2]).toMatchObject({ fuente: 'BANCO', bancoId: 'b-cliente', referencia: '123' });
  });

  it('Yape a BANCO sin cuenta: 400 y no toma el reporte', async () => {
    const { service, prisma, cxc } = make();
    await expect(service.aprobar('e1', 'r1', 'u', {})).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reporteAbono.updateMany).not.toHaveBeenCalled();
    expect(cxc.registrarAbono).not.toHaveBeenCalled();
  });

  it('si otro admin ya lo tomó, no registra un segundo abono', async () => {
    const { service, cxc } = make({ tomado: 0 });
    await expect(service.aprobar('e1', 'r1', 'u', { fuente: 'TESORERIA' })).rejects.toBeInstanceOf(ConflictException);
    expect(cxc.registrarAbono).not.toHaveBeenCalled();
  });

  it('si registrarAbono falla, el reporte vuelve a PENDIENTE', async () => {
    const { service, prisma } = make({ registrar: jest.fn().mockRejectedValue(new BadRequestException('saldo')) });
    await expect(service.aprobar('e1', 'r1', 'u', { fuente: 'TESORERIA' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.reporteAbono.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { estado: 'PENDIENTE', revisadoPorId: null, revisadoEn: null },
    });
  });

  it('un reporte ya revisado no se aprueba', async () => {
    const { service } = make({ reporte: reporte({ estado: 'APROBADO' }) });
    await expect(service.aprobar('e1', 'r1', 'u', { fuente: 'TESORERIA' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechazar exige motivo y no toca plata', async () => {
    const { service, prisma, cxc } = make();
    await expect(service.rechazar('e1', 'r1', 'u', '  ')).rejects.toBeInstanceOf(BadRequestException);
    await service.rechazar('e1', 'r1', 'u', 'No llegó el Yape');
    expect(prisma.reporteAbono.updateMany.mock.calls[0][0].data).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'No llegó el Yape' });
    expect(cxc.registrarAbono).not.toHaveBeenCalled();
  });
});
