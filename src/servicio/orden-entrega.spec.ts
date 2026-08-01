import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EstadoOrdenServicio } from '@prisma/client';
import { OrdenServicioService } from './orden-servicio.service';

/**
 * Tests de la ENTREGA FÍSICA del equipo.
 *
 * Cobrar y entregar son hechos distintos: el cliente paga en Venta Rápida (la
 * orden queda FINALIZADO) y puede llevarse el equipo otro día. `fechaEntrega`
 * es la señal: null = cobrada pero el equipo sigue en el taller.
 *
 * Invariantes:
 * - Solo se entrega una orden ya cobrada (FINALIZADO) y no entregada antes.
 * - La entrega NO cambia el estado; solo estampa fechaEntrega.
 * - En el historial se anota como ENTREGADO (la línea de tiempo se rotula por
 *   estadoNuevo), aunque el estado de la orden siga siendo FINALIZADO.
 * - El aviso de mantenimiento se crea acá, anclado a la entrega real.
 */

const ordenGuardada = (overrides: Partial<any> = {}) => ({
  id: 'orden-1',
  codigo: 'ORD-00001',
  estado: EstadoOrdenServicio.FINALIZADO,
  fechaEntrega: null,
  clienteId: 'cli-1',
  incluirAvisoMantenimiento: true,
  tipoServicio: 'REPARACION',
  tipoEquipo: 'LAPTOP',
  marcaEquipo: 'DELL',
  actualizadoEn: new Date('2026-07-31T10:00:00Z'),
  fechaAvisoPersonalizado: null,
  ...overrides,
});

const makeSelf = (orden: any = ordenGuardada(), updateOverrides: any = {}) => {
  const prisma = {
    ordenServicio: {
      findFirst: jest.fn().mockResolvedValue(orden),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          ordenGuardada({ ...orden, ...data, ...updateOverrides }),
        ),
      ),
    },
    historialOrdenServicio: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation((ops: any[]) => Promise.all(ops)),
  };
  const avisoMantenimientoService = {
    crearAvisoParaOrden: jest.fn().mockResolvedValue({}),
  };
  const self = { prisma, avisoMantenimientoService };
  const registrar = (OrdenServicioService.prototype as any)[
    'registrarEntrega'
  ].bind(self);
  return { registrar, prisma, avisoMantenimientoService };
};

describe('OrdenServicioService.registrarEntrega', () => {
  it('404 si la orden no existe o es de otra empresa', async () => {
    const { registrar } = makeSelf(null);
    await expect(
      registrar('empresa-1', 'orden-1', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 si la orden ya fue entregada', async () => {
    const { registrar, prisma } = makeSelf(
      ordenGuardada({ fechaEntrega: new Date('2026-07-30T12:00:00Z') }),
    );
    await expect(
      registrar('empresa-1', 'orden-1', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('400 si la orden todavía no está cobrada (no es FINALIZADO)', async () => {
    const { registrar, prisma } = makeSelf(
      ordenGuardada({ estado: EstadoOrdenServicio.LISTO_ENTREGA }),
    );
    await expect(
      registrar('empresa-1', 'orden-1', 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('estampa fechaEntrega y NO cambia el estado', async () => {
    const { registrar, prisma } = makeSelf();
    await registrar('empresa-1', 'orden-1', 'user-1');

    const dataUpdate = prisma.ordenServicio.update.mock.calls[0][0].data;
    expect(dataUpdate.fechaEntrega).toBeInstanceOf(Date);
    expect(dataUpdate.estado).toBeUndefined();
  });

  it('anota el evento como ENTREGADO en el historial', async () => {
    const { registrar, prisma } = makeSelf();
    await registrar('empresa-1', 'orden-1', 'user-1');

    expect(prisma.historialOrdenServicio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estadoAnterior: EstadoOrdenServicio.FINALIZADO,
          estadoNuevo: EstadoOrdenServicio.ENTREGADO,
          creadoPor: 'user-1',
          notas: expect.stringContaining('entregado'),
        }),
      }),
    );
  });

  it('adjunta la nota del usuario al historial', async () => {
    const { registrar, prisma } = makeSelf();
    await registrar('empresa-1', 'orden-1', 'user-1', '  retiró la esposa  ');

    const notas =
      prisma.historialOrdenServicio.create.mock.calls[0][0].data.notas;
    expect(notas).toContain('retiró la esposa');
  });

  it('crea el aviso de mantenimiento anclado a la fecha de entrega real', async () => {
    const { registrar, avisoMantenimientoService } = makeSelf();
    await registrar('empresa-1', 'orden-1', 'user-1');

    expect(avisoMantenimientoService.crearAvisoParaOrden).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'orden-1',
        empresaId: 'empresa-1',
        clienteId: 'cli-1',
        fechaEntrega: expect.any(Date),
      }),
    );
  });

  it('no crea aviso si la orden no lo incluye', async () => {
    const { registrar, avisoMantenimientoService } = makeSelf(
      ordenGuardada({ incluirAvisoMantenimiento: false }),
    );
    await registrar('empresa-1', 'orden-1', 'user-1');
    expect(avisoMantenimientoService.crearAvisoParaOrden).not.toHaveBeenCalled();
  });

  it('un aviso que falla no tumba la entrega', async () => {
    const { registrar, avisoMantenimientoService, prisma } = makeSelf();
    avisoMantenimientoService.crearAvisoParaOrden.mockRejectedValue(
      new Error('SMTP caído'),
    );
    await expect(
      registrar('empresa-1', 'orden-1', 'user-1'),
    ).resolves.toBeDefined();
    expect(prisma.ordenServicio.update).toHaveBeenCalled();
  });
});
