import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EstadoOrdenServicio } from '@prisma/client';
import { OrdenServicioService } from './orden-servicio.service';

/**
 * "Mis servicios" de la tienda web.
 *
 * Invariantes:
 * - El comprador solo ve y toca órdenes de SU EmpresaPersona en esa empresa:
 *   sin vínculo con la empresa, la lista viene vacía y el detalle es 404.
 * - Aprobar solo vale en ESPERANDO_APROBACION y pasa por la misma
 *   transición del app (a EN_REPARACION), con el usuario del comprador.
 */

const proto = OrdenServicioService.prototype as any;

const makeSelf = (opts: { empresaPersona?: any; orden?: any; ordenes?: any[] } = {}) => {
  const prisma = {
    empresaPersona: { findFirst: jest.fn().mockResolvedValue(opts.empresaPersona ?? null) },
    ordenServicio: {
      findFirst: jest.fn().mockResolvedValue(opts.orden ?? null),
      findMany: jest.fn().mockResolvedValue(opts.ordenes ?? []),
    },
    sede: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const self: any = {
    prisma,
    notificacionService: { enviarAUsuario: jest.fn().mockResolvedValue(undefined) },
    notificarAdminsEmpresa: jest.fn().mockResolvedValue(undefined),
    transitionEstado: jest.fn().mockResolvedValue({}),
  };
  self.clienteTienda = proto.clienteTienda.bind(self);
  self.detalleMiServicioTienda = jest.fn().mockResolvedValue({ id: 'orden-1' });
  return { self, prisma };
};

describe('Tienda web: mis servicios', () => {
  it('sin vínculo con la empresa, la lista viene vacía (no consulta órdenes)', async () => {
    const { self, prisma } = makeSelf();
    const res = await proto.listarMisServiciosTienda.call(self, 'empresa-1', 'persona-1');
    expect(res).toEqual({ data: [] });
    expect(prisma.ordenServicio.findMany).not.toHaveBeenCalled();
  });

  it('lista solo las órdenes de su EmpresaPersona y calcula el saldo', async () => {
    const { self, prisma } = makeSelf({
      empresaPersona: { id: 'ep-1' },
      ordenes: [{
        id: 'o1', codigo: 'OS-1', estado: EstadoOrdenServicio.EN_REPARACION,
        tipoEquipo: 'Laptop', marcaEquipo: 'Lenovo', modeloEquipo: null, servicio: { nombre: 'Mantenimiento' },
        fechaPrometida: null, fechaEntrega: null, creadoEn: new Date(), comprobanteId: null,
        costoTotal: 100, adelanto: 30, descuento: 0,
        componentes: [{ costoAccion: 20, costoRepuestos: 50 }],
      }],
    });
    const res = await proto.listarMisServiciosTienda.call(self, 'empresa-1', 'persona-1');
    expect(prisma.ordenServicio.findMany.mock.calls[0][0].where).toEqual({ empresaId: 'empresa-1', clienteId: 'ep-1' });
    expect(res.data[0]).toMatchObject({ equipo: 'Laptop Lenovo', total: 170, saldo: 140 });
  });

  it('el detalle de una orden ajena es 404', async () => {
    const { self } = makeSelf({ empresaPersona: { id: 'ep-1' }, orden: null });
    await expect(proto.detalleMiServicioTienda.call(self, 'empresa-1', 'persona-1', 'ajena'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('aprobar fuera de ESPERANDO_APROBACION es 400 y no transiciona', async () => {
    const { self } = makeSelf({
      empresaPersona: { id: 'ep-1' },
      orden: { id: 'orden-1', estado: EstadoOrdenServicio.EN_REPARACION, codigo: 'OS-1', tecnicoId: null },
    });
    await expect(proto.aprobarPresupuestoCliente.call(self, 'empresa-1', 'persona-1', 'user-1', 'orden-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(self.transitionEstado).not.toHaveBeenCalled();
  });

  it('aprobar pasa a EN_REPARACION con el usuario del comprador y avisa al técnico', async () => {
    const { self } = makeSelf({
      empresaPersona: { id: 'ep-1' },
      orden: { id: 'orden-1', estado: EstadoOrdenServicio.ESPERANDO_APROBACION, codigo: 'OS-1', tecnicoId: 'tec-1' },
    });
    await proto.aprobarPresupuestoCliente.call(self, 'empresa-1', 'persona-1', 'user-1', 'orden-1');
    expect(self.transitionEstado).toHaveBeenCalledWith(
      'empresa-1', 'orden-1',
      expect.objectContaining({ nuevoEstado: EstadoOrdenServicio.EN_REPARACION }),
      'user-1',
    );
    expect(self.notificacionService.enviarAUsuario).toHaveBeenCalledWith('tec-1', expect.any(String), expect.any(String), expect.any(Object));
  });
});
