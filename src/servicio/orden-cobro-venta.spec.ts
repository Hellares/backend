import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EstadoOrdenServicio, EstadoComponente } from '@prisma/client';
import { OrdenServicioService } from './orden-servicio.service';

/**
 * Tests del cobro de órdenes de servicio vía Venta Rápida (POS).
 *
 * Los tres métodos reciben el TransactionClient como parámetro y no usan
 * `this.prisma`, así que se invocan sobre el prototype con un tx mockeado
 * (mismo patrón que venta-caja-vuelto.spec.ts).
 *
 * Invariantes:
 * - Solo se cobran órdenes REPARADO/LISTO_ENTREGA con saldo > 0.
 * - precioUnitario de la línea === saldo pendiente vigente (409 si divergen).
 * - Una orden solo se cobra una vez (409 ORDEN_YA_COBRADA).
 * - El cobro marca ENTREGADO + historial + componentes EN_USO.
 * - La anulación de la venta revierte a LISTO_ENTREGA y libera el candado.
 */

const validar: (
  tx: any,
  empresaId: string,
  detalles: any[],
) => Promise<any[]> = (OrdenServicioService.prototype as any)[
  'validarYBloquearCobroVenta'
].bind({});

const marcar: (tx: any, params: any) => Promise<any[]> = (
  OrdenServicioService.prototype as any
)['marcarOrdenesCobradasPorVenta'].bind({});

const revertir: (
  tx: any,
  empresaId: string,
  detalles: any[],
  usuarioId: string,
  ventaCodigo: string,
) => Promise<void> = (OrdenServicioService.prototype as any)[
  'revertirCobroPorVentaAnulada'
].bind({});

const EMPRESA = 'empresa-1';

const ordenBase = (overrides: Partial<any> = {}) => ({
  id: 'orden-1',
  codigo: 'ORD-00001',
  estado: EstadoOrdenServicio.LISTO_ENTREGA,
  estadoDiagnostico: 'COMPLETADO',
  costoTotal: 150,
  adelanto: 50,
  descuento: 0,
  servicio: { nombre: 'Reparación de laptop' },
  ...overrides,
});

const lineaBase = (overrides: Partial<any> = {}) => ({
  ordenServicioId: 'orden-1',
  cantidad: 1,
  // Precio de línea = COSTO NETO (costoTotal − descuento, SIN restar
  // adelanto): el comprobante sale por el total del servicio y el
  // adelanto entra como pago aplicado.
  precioUnitario: 150,
  descuento: 0,
  descripcion: 'SERVICIO ORD-00001 — LAPTOP DELL',
  ...overrides,
});

const makeTx = (overrides: Partial<any> = {}) => ({
  $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  ordenServicio: {
    findMany: jest.fn().mockResolvedValue([ordenBase()]),
    findFirst: jest.fn(),
    update: jest.fn().mockImplementation(({ where }) =>
      Promise.resolve(ordenBase({ id: where.id, estado: EstadoOrdenServicio.ENTREGADO })),
    ),
  },
  ventaDetalle: {
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  },
  historialOrdenServicio: {
    create: jest.fn().mockResolvedValue({}),
  },
  servicioComponente: {
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  ...overrides,
});

describe('OrdenServicioService.validarYBloquearCobroVenta', () => {
  it('retorna [] cuando no hay líneas de orden (venta solo productos)', async () => {
    const tx = makeTx();
    const result = await validar(tx, EMPRESA, [
      { productoId: 'p1', cantidad: 2, precioUnitario: 10, descripcion: 'Mouse' },
    ]);
    expect(result).toEqual([]);
    expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rechaza línea que mezcla orden con producto', async () => {
    await expect(
      validar(makeTx(), EMPRESA, [lineaBase({ productoId: 'p1' })]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza cantidad distinta de 1', async () => {
    await expect(
      validar(makeTx(), EMPRESA, [lineaBase({ cantidad: 2 })]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza descuento de línea (el descuento vive en la orden)', async () => {
    await expect(
      validar(makeTx(), EMPRESA, [lineaBase({ descuento: 5 })]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza la misma orden duplicada en la venta', async () => {
    await expect(
      validar(makeTx(), EMPRESA, [lineaBase(), lineaBase()]),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza orden inexistente o de otro tenant (NotFound)', async () => {
    const tx = makeTx({
      ordenServicio: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await expect(validar(tx, EMPRESA, [lineaBase()])).rejects.toThrow(
      NotFoundException,
    );
  });

  it.each([
    EstadoOrdenServicio.RECIBIDO,
    EstadoOrdenServicio.EN_REPARACION,
    EstadoOrdenServicio.ENTREGADO,
    EstadoOrdenServicio.CANCELADO,
  ])('rechaza orden en estado no cobrable %s', async (estado) => {
    const tx = makeTx({
      ordenServicio: {
        findMany: jest.fn().mockResolvedValue([ordenBase({ estado })]),
      },
    });
    await expect(validar(tx, EMPRESA, [lineaBase()])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rechaza orden sin costo total', async () => {
    const tx = makeTx({
      ordenServicio: {
        findMany: jest.fn().mockResolvedValue([ordenBase({ costoTotal: null })]),
      },
    });
    await expect(validar(tx, EMPRESA, [lineaBase()])).rejects.toThrow(
      BadRequestException,
    );
  });

  it('PERMITE orden 100% adelantada (saldo 0): la boleta sale por el total', async () => {
    const tx = makeTx({
      ordenServicio: {
        findMany: jest
          .fn()
          .mockResolvedValue([ordenBase({ costoTotal: 100, adelanto: 100 })]),
      },
      ventaDetalle: { findMany: jest.fn().mockResolvedValue([]) },
    });
    // precio de línea = costo neto (100), aunque hoy se cobre S/ 0
    const result = await validar(tx, EMPRESA, [
      lineaBase({ precioUnitario: 100 }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('rechaza saldo NEGATIVO (adelanto + descuento superan el costo)', async () => {
    const tx = makeTx({
      ordenServicio: {
        findMany: jest.fn().mockResolvedValue([
          // costo 100, descuento 30, adelanto 90 → saldo −20
          ordenBase({ costoTotal: 100, descuento: 30, adelanto: 90 }),
        ]),
      },
    });
    await expect(
      validar(tx, EMPRESA, [lineaBase({ precioUnitario: 70 })]),
    ).rejects.toThrow(BadRequestException);
  });

  it('409 SALDO_ORDEN_DESACTUALIZADO cuando el precio no coincide con el costo neto', async () => {
    const tx = makeTx(); // costo neto real = 150 (saldo 100 NO es el precio)
    try {
      await validar(tx, EMPRESA, [lineaBase({ precioUnitario: 100 })]);
      fail('debió lanzar ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = e.getResponse();
      expect(body.code).toBe('SALDO_ORDEN_DESACTUALIZADO');
      expect(body.divergencias).toHaveLength(1);
      expect(body.divergencias[0]).toMatchObject({
        precioCliente: 100,
        saldoServer: 150,
      });
    }
  });

  it('tolera diferencia de centavos <= 0.01 (floating point)', async () => {
    const tx = makeTx();
    const result = await validar(tx, EMPRESA, [
      lineaBase({ precioUnitario: 150.009 }),
    ]);
    expect(result).toHaveLength(1);
  });

  it('409 ORDEN_YA_COBRADA cuando otra venta ya la cobró', async () => {
    const tx = makeTx({
      ventaDetalle: {
        findMany: jest.fn().mockResolvedValue([
          { ordenServicioId: 'orden-1', venta: { codigo: 'VTA-00099' } },
        ]),
      },
    });
    try {
      await validar(tx, EMPRESA, [lineaBase()]);
      fail('debió lanzar ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe('ORDEN_YA_COBRADA');
      expect(e.getResponse().message).toContain('VTA-00099');
    }
  });

  it('happy path: bloquea con FOR UPDATE y retorna las órdenes', async () => {
    const tx = makeTx();
    const result = await validar(tx, EMPRESA, [lineaBase()]);
    expect(result).toHaveLength(1);
    expect(result[0].codigo).toBe('ORD-00001');
    // Lock pesimista con los ids + tenant
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      ['orden-1'],
      EMPRESA,
    );
  });
});

describe('OrdenServicioService.marcarOrdenesCobradasPorVenta', () => {
  it('marca ENTREGADO, vincula comprobante, crea historial y sync componentes', async () => {
    const tx = makeTx();
    const result = await marcar(tx, {
      ordenes: [ordenBase()],
      ventaCodigo: 'VTA-00123',
      comprobante: { id: 'comp-1', codigoGenerado: 'B001-00000045' },
      usuarioId: 'user-1',
    });

    expect(result).toHaveLength(1);
    expect(tx.ordenServicio.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'orden-1' },
        data: expect.objectContaining({
          estado: EstadoOrdenServicio.ENTREGADO,
          comprobanteId: 'comp-1',
          fechaEntrega: expect.any(Date),
        }),
      }),
    );
    expect(tx.historialOrdenServicio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estadoAnterior: EstadoOrdenServicio.LISTO_ENTREGA,
          estadoNuevo: EstadoOrdenServicio.ENTREGADO,
          notas: expect.stringContaining('VTA-00123'),
        }),
      }),
    );
    expect(tx.historialOrdenServicio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notas: expect.stringContaining('B001-00000045'),
        }),
      }),
    );
    expect(tx.servicioComponente.updateMany).toHaveBeenCalledWith({
      where: { ordenServicioId: 'orden-1' },
      data: { estadoComponente: EstadoComponente.EN_USO },
    });
  });

  it('venta TICKET (sin comprobante): comprobanteId null y nota sin código', async () => {
    const tx = makeTx();
    await marcar(tx, {
      ordenes: [ordenBase()],
      ventaCodigo: 'VTA-00124',
      comprobante: null,
      usuarioId: 'user-1',
    });

    expect(tx.ordenServicio.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ comprobanteId: null }),
      }),
    );
    const notas = tx.historialOrdenServicio.create.mock.calls[0][0].data.notas;
    expect(notas).toContain('VTA-00124');
    expect(notas).not.toContain('Comprobante');
  });
});

describe('OrdenServicioService.revertirCobroPorVentaAnulada', () => {
  it('revierte a LISTO_ENTREGA, desvincula comprobante y libera el candado', async () => {
    const tx = makeTx({
      ordenServicio: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'orden-1',
          estado: EstadoOrdenServicio.ENTREGADO,
          codigo: 'ORD-00001',
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    await revertir(
      tx,
      EMPRESA,
      [{ id: 'det-1', ordenServicioId: 'orden-1' }],
      'user-1',
      'VTA-00123',
    );

    expect(tx.ordenServicio.update).toHaveBeenCalledWith({
      where: { id: 'orden-1' },
      data: {
        estado: EstadoOrdenServicio.LISTO_ENTREGA,
        fechaEntrega: null,
        comprobanteId: null,
      },
    });
    expect(tx.historialOrdenServicio.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          estadoAnterior: EstadoOrdenServicio.ENTREGADO,
          estadoNuevo: EstadoOrdenServicio.LISTO_ENTREGA,
          notas: expect.stringContaining('VTA-00123'),
        }),
      }),
    );
    // Libera el @unique para permitir re-cobro
    expect(tx.ventaDetalle.update).toHaveBeenCalledWith({
      where: { id: 'det-1' },
      data: { ordenServicioId: null },
    });
    expect(tx.servicioComponente.updateMany).toHaveBeenCalledWith({
      where: { ordenServicioId: 'orden-1' },
      data: { estadoComponente: EstadoComponente.DISPONIBLE },
    });
  });

  it('orden de otro tenant / inexistente: skip silencioso (no rompe la anulación)', async () => {
    const tx = makeTx({
      ordenServicio: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    });

    await revertir(
      tx,
      EMPRESA,
      [{ id: 'det-1', ordenServicioId: 'orden-x' }],
      'user-1',
      'VTA-00123',
    );

    expect(tx.ordenServicio.update).not.toHaveBeenCalled();
    expect(tx.ventaDetalle.update).not.toHaveBeenCalled();
  });
});
