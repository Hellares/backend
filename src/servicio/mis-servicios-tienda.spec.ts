import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EstadoOrdenServicio } from '@prisma/client';
import { OrdenServicioService } from './orden-servicio.service';

/**
 * "Mis servicios" de la tienda web.
 *
 * Invariantes:
 * - El comprador ve sus órdenes personales (EmpresaPersona de su persona) y
 *   TODAS las de los clientes empresa donde es contacto con su DNI.
 * - Sin ninguno de los dos vínculos, la lista viene vacía y el detalle es 404.
 * - Aprobar solo vale en ESPERANDO_APROBACION y pasa por la misma
 *   transición del app (a EN_REPARACION), con el usuario del comprador.
 */

const proto = OrdenServicioService.prototype as any;

const makeSelf = (opts: {
  empresaPersona?: any;
  dni?: string | null;
  empresasCliente?: { id: string }[];
  orden?: any;
  ordenes?: any[];
} = {}) => {
  const prisma = {
    empresaPersona: { findFirst: jest.fn().mockResolvedValue(opts.empresaPersona ?? null) },
    persona: { findUnique: jest.fn().mockResolvedValue(opts.dni === undefined ? null : { dni: opts.dni }) },
    clienteEmpresa: { findMany: jest.fn().mockResolvedValue(opts.empresasCliente ?? []) },
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
  self.accesoTienda = proto.accesoTienda.bind(self);
  self.ordenTienda = proto.ordenTienda.bind(self);
  self.detalleMiServicioTienda = jest.fn().mockResolvedValue({ id: 'orden-1' });
  return { self, prisma };
};

const ordenLista = (extra: any = {}) => ({
  id: 'o1', codigo: 'OS-1', estado: EstadoOrdenServicio.EN_REPARACION,
  tipoEquipo: 'Laptop', marcaEquipo: 'Lenovo', modeloEquipo: null, servicio: { nombre: 'Mantenimiento' },
  fechaPrometida: null, fechaEntrega: null, creadoEn: new Date(), comprobanteId: null,
  costoTotal: 100, adelanto: 30, descuento: 0,
  componentes: [{ costoAccion: 20, costoRepuestos: 50 }],
  clienteEmpresa: null, contactoClienteEmpresa: null,
  ...extra,
});

describe('Tienda web: mis servicios', () => {
  it('sin vínculo personal ni de empresa, la lista viene vacía (no consulta órdenes)', async () => {
    const { self, prisma } = makeSelf({ dni: '12345678' });
    const res = await proto.listarMisServiciosTienda.call(self, 'empresa-1', 'persona-1');
    expect(res).toEqual({ data: [] });
    expect(prisma.ordenServicio.findMany).not.toHaveBeenCalled();
  });

  it('solo personal: filtra por su EmpresaPersona y calcula el saldo', async () => {
    const { self, prisma } = makeSelf({ empresaPersona: { id: 'ep-1' }, dni: '12345678', ordenes: [ordenLista()] });
    const res = await proto.listarMisServiciosTienda.call(self, 'empresa-1', 'persona-1');
    expect(prisma.ordenServicio.findMany.mock.calls[0][0].where).toEqual({
      empresaId: 'empresa-1',
      AND: [{ OR: [{ clienteId: 'ep-1' }] }],
    });
    expect(res.data[0]).toMatchObject({ equipo: 'Laptop Lenovo', total: 170, saldo: 140, empresaCliente: null });
  });

  it('contacto de clientes empresa: ve TODAS las órdenes de esas empresas, además de las suyas', async () => {
    const { self, prisma } = makeSelf({
      empresaPersona: { id: 'ep-1' },
      dni: '12345678',
      empresasCliente: [{ id: 'ce-1' }, { id: 'ce-2' }],
      ordenes: [ordenLista({ clienteEmpresa: { razonSocial: 'COLEGIO SAN MARTIN SAC', nombreComercial: null }, contactoClienteEmpresa: { nombre: 'Ana' } })],
    });
    const res = await proto.listarMisServiciosTienda.call(self, 'empresa-1', 'persona-1');
    expect(prisma.clienteEmpresa.findMany.mock.calls[0][0].where).toMatchObject({
      empresaId: 'empresa-1', contactos: { some: { dni: '12345678' } },
    });
    expect(prisma.ordenServicio.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      OR: [{ clienteId: 'ep-1' }, { clienteEmpresaId: { in: ['ce-1', 'ce-2'] } }],
    });
    expect(res.data[0]).toMatchObject({ empresaCliente: 'COLEGIO SAN MARTIN SAC', contacto: 'Ana' });
  });

  it('sin DNI en la persona no busca clientes empresa', async () => {
    const { self, prisma } = makeSelf({ empresaPersona: { id: 'ep-1' }, dni: null, ordenes: [] });
    await proto.listarMisServiciosTienda.call(self, 'empresa-1', 'persona-1');
    expect(prisma.clienteEmpresa.findMany).not.toHaveBeenCalled();
  });

  it('el detalle de una orden sin acceso es 404', async () => {
    const { self } = makeSelf({ empresaPersona: { id: 'ep-1' }, dni: '12345678', orden: null });
    await expect(proto.detalleMiServicioTienda.call(self, 'empresa-1', 'persona-1', 'ajena'))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('aprobar fuera de ESPERANDO_APROBACION es 400 y no transiciona', async () => {
    const { self } = makeSelf({
      empresaPersona: { id: 'ep-1' },
      dni: '12345678',
      orden: { id: 'orden-1', estado: EstadoOrdenServicio.EN_REPARACION, codigo: 'OS-1', tecnicoId: null },
    });
    await expect(proto.aprobarPresupuestoCliente.call(self, 'empresa-1', 'persona-1', 'user-1', 'orden-1'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(self.transitionEstado).not.toHaveBeenCalled();
  });

  it('un contacto aprueba la orden de su empresa: EN_REPARACION con su usuario y aviso al técnico', async () => {
    const { self } = makeSelf({
      dni: '12345678',
      empresasCliente: [{ id: 'ce-1' }],
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
