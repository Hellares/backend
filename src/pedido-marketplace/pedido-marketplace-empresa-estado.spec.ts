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
  let notificacion: any;
  let caja: any;
  let service: PedidoMarketplaceEmpresaService;

  const pedidoBase = {
    id: PEDIDO,
    empresaId: EMPRESA,
    codigo: 'PEDIDO-20260701-00001',
    compradorId: 'comprador-1',
    estado: 'EN_PREPARACION',
    nombreComprador: 'Juan Pérez',
    emailComprador: 'juan@mail.com',
    telefonoComprador: '999888777',
    direccionEnvio: 'Av. Siempre Viva 123',
    subtotal: 100,
    descuento: 0,
    total: 100,
    moneda: 'PEN',
    metodoPago: 'YAPE',
    transaccionExternaId: null,
    sedeRetiroId: null,
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
      venta: { create: jest.fn().mockResolvedValue({ id: 'venta-1' }) },
      sede: { findFirst: jest.fn().mockResolvedValue({ id: 'sede-fallback' }) },
      empresaUsuarioRol: {
        findFirst: jest.fn().mockResolvedValue({ usuarioId: 'admin-1' }),
        findMany: jest.fn().mockResolvedValue([{ usuarioId: 'admin-1' }]),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    notificacion = { enviarAUsuario: jest.fn(), enviarAUsuarios: jest.fn() };
    caja = {
      getOrCreateCajaCentral: jest.fn().mockResolvedValue({ id: 'caja-central' }),
      crearMovimientoAutomatico: jest.fn().mockResolvedValue({}),
    };
    const codigos = {
      generarCodigoVenta: jest.fn().mockResolvedValue({ codigoVenta: 'VTA-SED-100' }),
    };
    service = new PedidoMarketplaceEmpresaService(
      prisma,
      notificacion as any,
      caja as any,
      codigos as any,
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

    // Venta interna: canal ONLINE, pagada, en la sede del stock descontado,
    // precios snapshot del pedido y pago espejo del método del pedido.
    expect(prisma.venta.create).toHaveBeenCalledTimes(1);
    const venta = prisma.venta.create.mock.calls[0][0].data;
    expect(venta).toMatchObject({
      empresaId: EMPRESA,
      sedeId: 'sede-1',
      vendedorId: USUARIO,
      canalVenta: 'ONLINE',
      codigo: 'VTA-SED-100',
      nombreCliente: 'Juan Pérez',
      estado: 'PAGADA_COMPLETA',
      metodoPago: 'YAPE',
      subtotal: 100,
      total: 100,
    });
    expect(venta.detalles.create).toHaveLength(1);
    expect(venta.detalles.create[0]).toMatchObject({
      productoId: 'prod-1',
      cantidad: 2,
      precioCostoSnapshot: 5,
    });
    expect(venta.pagos.create).toMatchObject({ metodoPago: 'YAPE', monto: 100 });

    // Kardex SALIDA_VENTA valorizado, atribuido al pedido Y ligado a la venta.
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
      ventaId: 'venta-1',
    });

    // Estado actualizado con enviadoEn + código de seguimiento + venta ligada.
    const upd = prisma.pedidoMarketplace.update.mock.calls[0][0].data;
    expect(upd.estado).toBe('ENVIADO');
    expect(upd.codigoSeguimiento).toBe('TRK-1');
    expect(upd.enviadoEn).toBeInstanceOf(Date);
    expect(upd.ventaId).toBe('venta-1');
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

  it('ENVIADO sin fila de stock → no bloquea el envío; la venta se crea igual (sede fallback)', async () => {
    prisma.productoStock.findFirst.mockResolvedValue(null);
    prisma.pedidoMarketplace.findFirst
      .mockResolvedValueOnce({ ...pedidoBase })
      .mockResolvedValueOnce({
        ...pedidoBase,
        detalles: [{ productoId: 'prod-1', varianteId: null, cantidad: 2 }],
      });

    await service.cambiarEstado(EMPRESA, PEDIDO, USUARIO, { estado: 'ENVIADO' } as any);

    // Sin stock: ni descuento ni kardex, pero la venta SÍ se crea (la compra
    // ocurrió) atribuida a la primera sede activa.
    expect(prisma.productoStock.update).not.toHaveBeenCalled();
    expect(prisma.movimientoStock.create).not.toHaveBeenCalled();
    expect(prisma.venta.create).toHaveBeenCalledTimes(1);
    expect(prisma.venta.create.mock.calls[0][0].data.sedeId).toBe('sede-fallback');
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

  describe('confirmarPagoYapeAutomatico (webhook api-yape)', () => {
    it('PENDIENTE_PAGO → PAGO_VALIDADO + ingreso a Caja Central + notifica', async () => {
      prisma.pedidoMarketplace.findFirst.mockResolvedValue({
        ...pedidoBase,
        estado: 'PENDIENTE_PAGO',
      });

      const r = await service.confirmarPagoYapeAutomatico(EMPRESA, PEDIDO, {
        metodo: 'YAPE',
        referencia: 'OP-777',
      });

      expect(r).toMatchObject({ accion: 'pago-validado', pedidoId: PEDIDO });
      const upd = prisma.pedidoMarketplace.update.mock.calls[0][0].data;
      expect(upd.estado).toBe('PAGO_VALIDADO');
      expect(upd.pagoValidadoEn).toBeInstanceOf(Date);
      expect(upd.metodoPago).toBe('YAPE');
      expect(upd.transaccionExternaId).toBe('OP-777');

      // Ingreso SIEMPRE a la Caja Central, ligado al pedido.
      expect(caja.getOrCreateCajaCentral).toHaveBeenCalledWith(EMPRESA, 'sede-fallback', prisma);
      expect(caja.crearMovimientoAutomatico).toHaveBeenCalledWith(
        EMPRESA,
        'caja-central',
        expect.objectContaining({
          tipo: 'INGRESO',
          categoria: 'PEDIDO_MARKETPLACE',
          metodoPago: 'YAPE',
          monto: 100,
          pedidoMarketplaceId: PEDIDO,
          registradoPorId: 'admin-1',
        }),
        prisma,
      );

      // Notifica comprador y admins.
      expect(notificacion.enviarAUsuario).toHaveBeenCalled();
      expect(notificacion.enviarAUsuarios).toHaveBeenCalled();
    });

    it('idempotente: pedido ya validado → no toca nada', async () => {
      prisma.pedidoMarketplace.findFirst.mockResolvedValue({
        ...pedidoBase,
        estado: 'PAGO_VALIDADO',
      });

      const r = await service.confirmarPagoYapeAutomatico(EMPRESA, PEDIDO, { metodo: 'YAPE' });

      expect(r).toMatchObject({ accion: 'ya-validado' });
      expect(prisma.pedidoMarketplace.update).not.toHaveBeenCalled();
      expect(caja.crearMovimientoAutomatico).not.toHaveBeenCalled();
    });

    it('webhook tardío sobre pedido CANCELADO → ignorado', async () => {
      prisma.pedidoMarketplace.findFirst.mockResolvedValue({
        ...pedidoBase,
        estado: 'CANCELADO',
      });

      const r = await service.confirmarPagoYapeAutomatico(EMPRESA, PEDIDO, { metodo: 'PLIN' });

      expect(r).toMatchObject({ accion: 'pedido-cancelado' });
      expect(prisma.pedidoMarketplace.update).not.toHaveBeenCalled();
    });

    it('sin admin activo → valida el pago igual pero no registra en caja (warn)', async () => {
      prisma.pedidoMarketplace.findFirst.mockResolvedValue({
        ...pedidoBase,
        estado: 'PAGO_ENVIADO',
      });
      prisma.empresaUsuarioRol.findFirst.mockResolvedValue(null);

      const r = await service.confirmarPagoYapeAutomatico(EMPRESA, PEDIDO, { metodo: 'YAPE' });

      expect(r).toMatchObject({ accion: 'pago-validado' });
      expect(prisma.pedidoMarketplace.update).toHaveBeenCalled();
      expect(caja.crearMovimientoAutomatico).not.toHaveBeenCalled();
    });
  });
});
