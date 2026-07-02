import { BadRequestException } from '@nestjs/common';
import { PedidoMarketplaceEmpresaService } from './pedido-marketplace-empresa.service';

/**
 * Tests de cambiarEstado: la transición a ENVIADO debe hacer la salida REAL de
 * inventario (descontar stockActual + liberar stockReservadoVenta + kardex
 * SALIDA_VENTA); CANCELADO solo libera la reserva. Sin DB.
 */
describe('PedidoMarketplaceEmpresaService.cambiarEstado', () => {
  const EMPRESA = 'emp-1';
  const PEDIDO = 'ped-1';
  const USUARIO = 'user-1';

  let prisma: any;
  let service: PedidoMarketplaceEmpresaService;

  const pedidoBase = {
    id: PEDIDO,
    empresaId: EMPRESA,
    codigo: 'PEDIDO-20260701-00001',
    compradorId: 'comprador-1',
    estado: 'EN_PREPARACION',
  };

  const stockRow = {
    id: 'stock-1',
    sedeId: 'sede-1',
    empresaId: EMPRESA,
    stockActual: 10,
    stockReservadoVenta: 3,
    precioCosto: 5,
  };

  beforeEach(() => {
    prisma = {
      pedidoMarketplace: {
        findFirst: jest.fn().mockResolvedValue({ ...pedidoBase }),
        update: jest.fn().mockResolvedValue({}),
      },
      productoStock: {
        findFirst: jest.fn().mockResolvedValue({ ...stockRow }),
        findUnique: jest.fn().mockResolvedValue({ precioCosto: 5 }),
        update: jest.fn().mockResolvedValue({}),
      },
      movimientoStock: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    const notificacion = { enviarAUsuario: jest.fn(), enviarAUsuarios: jest.fn() };
    service = new PedidoMarketplaceEmpresaService(
      prisma,
      notificacion as any,
      {} as any,
    );
  });

  it('ENVIADO → descuenta stockActual, libera reserva y escribe kardex SALIDA_VENTA', async () => {
    // 1ª llamada: pedido para validar transición; 2ª: pedido con detalles.
    prisma.pedidoMarketplace.findFirst
      .mockResolvedValueOnce({ ...pedidoBase })
      .mockResolvedValueOnce({
        ...pedidoBase,
        detalles: [
          { productoId: 'prod-1', varianteId: null, cantidad: 2 },
        ],
      });

    await service.cambiarEstado(EMPRESA, PEDIDO, USUARIO, {
      estado: 'ENVIADO',
      codigoSeguimiento: 'TRK-1',
    } as any);

    // Descuento real + liberación de reserva en la misma fila de stock.
    expect(prisma.productoStock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: {
        stockActual: { decrement: 2 },
        stockReservadoVenta: { decrement: 2 },
      },
    });

    // Kardex SALIDA_VENTA valorizado, atribuido al pedido.
    expect(prisma.movimientoStock.create).toHaveBeenCalledTimes(1);
    const mov = prisma.movimientoStock.create.mock.calls[0][0].data;
    expect(mov).toMatchObject({
      productoStockId: 'stock-1',
      sedeId: 'sede-1',
      tipo: 'SALIDA_VENTA',
      cantidad: -2,
      cantidadAnterior: 10,
      cantidadNueva: 8,
      usuarioId: USUARIO,
      tipoDocumento: 'PEDIDO_MARKETPLACE',
      numeroDocumento: pedidoBase.codigo,
    });

    // Estado actualizado con enviadoEn + código de seguimiento.
    const upd = prisma.pedidoMarketplace.update.mock.calls[0][0].data;
    expect(upd.estado).toBe('ENVIADO');
    expect(upd.codigoSeguimiento).toBe('TRK-1');
    expect(upd.enviadoEn).toBeInstanceOf(Date);
  });

  it('ENVIADO → la liberación de reserva se acota a lo reservado (no negativa)', async () => {
    prisma.productoStock.findFirst.mockResolvedValue({
      ...stockRow,
      stockReservadoVenta: 1, // menos que la cantidad del detalle
    });
    prisma.pedidoMarketplace.findFirst
      .mockResolvedValueOnce({ ...pedidoBase })
      .mockResolvedValueOnce({
        ...pedidoBase,
        detalles: [{ productoId: 'prod-1', varianteId: null, cantidad: 2 }],
      });

    await service.cambiarEstado(EMPRESA, PEDIDO, USUARIO, { estado: 'ENVIADO' } as any);

    expect(prisma.productoStock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: {
        stockActual: { decrement: 2 },
        stockReservadoVenta: { decrement: 1 },
      },
    });
  });

  it('ENVIADO sin fila de stock → no bloquea el envío (solo cambia estado)', async () => {
    prisma.productoStock.findFirst.mockResolvedValue(null);
    prisma.pedidoMarketplace.findFirst
      .mockResolvedValueOnce({ ...pedidoBase })
      .mockResolvedValueOnce({
        ...pedidoBase,
        detalles: [{ productoId: 'prod-1', varianteId: null, cantidad: 2 }],
      });

    await service.cambiarEstado(EMPRESA, PEDIDO, USUARIO, { estado: 'ENVIADO' } as any);

    expect(prisma.productoStock.update).not.toHaveBeenCalled();
    expect(prisma.movimientoStock.create).not.toHaveBeenCalled();
    expect(prisma.pedidoMarketplace.update).toHaveBeenCalled();
  });

  it('CANCELADO → libera reserva pero NO toca stockActual ni escribe kardex', async () => {
    prisma.pedidoMarketplace.findFirst
      .mockResolvedValueOnce({ ...pedidoBase, estado: 'PAGO_VALIDADO' })
      .mockResolvedValueOnce({
        ...pedidoBase,
        estado: 'PAGO_VALIDADO',
        detalles: [{ productoId: 'prod-1', varianteId: null, cantidad: 2 }],
      });

    await service.cambiarEstado(EMPRESA, PEDIDO, USUARIO, { estado: 'CANCELADO' } as any);

    expect(prisma.productoStock.update).toHaveBeenCalledWith({
      where: { id: 'stock-1' },
      data: { stockReservadoVenta: { decrement: 2 } },
    });
    expect(prisma.movimientoStock.create).not.toHaveBeenCalled();
  });

  it('transición inválida (ENVIADO → EN_PREPARACION) → BadRequest', async () => {
    prisma.pedidoMarketplace.findFirst.mockResolvedValue({
      ...pedidoBase,
      estado: 'ENVIADO',
    });

    await expect(
      service.cambiarEstado(EMPRESA, PEDIDO, USUARIO, { estado: 'EN_PREPARACION' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.pedidoMarketplace.update).not.toHaveBeenCalled();
  });
});
