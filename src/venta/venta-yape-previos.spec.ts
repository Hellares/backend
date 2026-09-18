import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { VentaService } from './venta.service';

/**
 * Caso 1 (09-18): el cliente yapeó ANTES de que existiera la venta (09-16:
 * AQUINO pagó 21 min antes) → el cobro automático no lo empareja nunca. La
 * hoja de cobro ofrece esos Yapes (`pagosYapePrevios`) y, al aprobar con uno
 * elegido, `resolverYapeElegido` lo verifica contra el buzón y devuelve su
 * referencia real. Igual que el spec de cobroYape: se invocan sobre un
 * `this` falso, sin instanciar el servicio.
 */
const proto = VentaService.prototype as any;

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

const yape = (over: any = {}) => ({
  id: 'pay-1',
  senderName: 'AQUINO ARENAS JHONATAN',
  amount: 83,
  provider: 'yape',
  receivedAt: hace(21),
  operationCode: null,
  ...over,
});

const armarThis = ({
  venta = { total: 83, nombreCliente: 'CLIENTES VARIOS', pagos: [] } as any,
  buzon = [] as any[],
  participaciones = [] as any[],
  cobros = [] as any[],
} = {}) => {
  const ctx: any = {
    prisma: {
      venta: { findFirst: jest.fn().mockResolvedValue(venta) },
      sorteoParticipante: { findMany: jest.fn().mockResolvedValue(participaciones) },
      pagoVenta: { findMany: jest.fn().mockResolvedValue(cobros) },
    },
    integracionYape: { listarPagosRecientes: jest.fn().mockResolvedValue(buzon) },
  };
  ctx.yapesConsumidos = proto.yapesConsumidos.bind(ctx);
  return ctx;
};

describe('VentaService.pagosYapePrevios (el cliente pagó antes de la venta)', () => {
  const previos = (ctx: any, monto?: number) =>
    proto.pagosYapePrevios.call(ctx, 'emp-1', 'v1', monto);

  it('ofrece los Yapes SIN usar del monto del cobro, de la última hora', async () => {
    const ctx = armarThis({
      buzon: [
        yape({ id: 'pay-1' }),
        yape({ id: 'pay-2', amount: 80 }), // otro monto
        yape({ id: 'pay-3' }), // ya usado por otra venta (por id)
        yape({ id: 'pay-4', operationCode: 'OP-4' }), // usado (por operationCode)
      ],
      cobros: [
        { referencia: 'pay-3', venta: { codigo: 'VTA-9' } },
        { referencia: 'OP-4', venta: { codigo: 'VTA-10' } },
      ],
    });

    const r = await previos(ctx, 83);

    expect(ctx.integracionYape.listarPagosRecientes).toHaveBeenCalledWith('emp-1', {
      horas: 1,
    });
    expect(r.pagos.map((p: any) => p.id)).toEqual(['pay-1']);
    expect(r.pagos[0]).toMatchObject({
      senderName: 'AQUINO ARENAS JHONATAN',
      amount: 83,
      calzaNombre: false, // venta a CLIENTES VARIOS
    });
  });

  it('primero los que calzan por nombre (caso real JHONATAN/JHONATHAN), después los más recientes', async () => {
    const ctx = armarThis({
      venta: { total: 83, nombreCliente: 'JHONATHAN AQUINO ARENAS', pagos: [] },
      buzon: [
        yape({ id: 'otro-reciente', senderName: 'Rosa Qui*', receivedAt: hace(2) }),
        yape({ id: 'aquino', receivedAt: hace(21) }),
        yape({ id: 'otro-viejo', senderName: 'Oscar Gut*', receivedAt: hace(40) }),
      ],
    });

    const r = await previos(ctx, 83);

    expect(r.pagos.map((p: any) => p.id)).toEqual(['aquino', 'otro-reciente', 'otro-viejo']);
    expect(r.pagos[0].calzaNombre).toBe(true);
  });

  it('sin monto → usa el PENDIENTE (total − pagos no anulados)', async () => {
    const ctx = armarThis({
      venta: { total: 100, nombreCliente: 'CLIENTES VARIOS', pagos: [{ monto: 17 }] },
      buzon: [yape({ id: 'p83', amount: 83 }), yape({ id: 'p100', amount: 100 })],
    });

    const r = await previos(ctx);

    expect(r.pagos.map((p: any) => p.id)).toEqual(['p83']);
    expect(ctx.prisma.venta.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          pagos: { where: { anulado: false }, select: { monto: true } },
        }),
      }),
    );
  });

  it('sin integración / buzón vacío → lista vacía y ni consulta los usados', async () => {
    const ctx = armarThis({ buzon: [] });

    const r = await previos(ctx, 83);

    expect(r).toEqual({ pagos: [] });
    expect(ctx.prisma.pagoVenta.findMany).not.toHaveBeenCalled();
  });

  it('venta inexistente → 404', async () => {
    const ctx = armarThis({ venta: null });
    await expect(previos(ctx, 83)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('un Yape usado por una venta ANULADA o un cobro anulado vuelve a estar disponible (814 → 815)', async () => {
    const ctx = armarThis({ buzon: [yape()] });

    await previos(ctx, 83);

    expect(ctx.prisma.pagoVenta.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          anulado: false,
          venta: { empresaId: 'emp-1', estado: { not: 'ANULADA' } },
        }),
      }),
    );
  });
});

describe('VentaService.resolverYapeElegido (aprobar con un Yape del buzón)', () => {
  const resolver = (ctx: any, dto: any) =>
    proto.resolverYapeElegido.call(ctx, 'emp-1', {
      metodoPago: 'YAPE',
      monto: 83,
      yapePagoId: 'pay-1',
      ...dto,
    });

  it('verificado → devuelve la referencia REAL (operationCode, o el id)', async () => {
    const conCodigo = armarThis({ buzon: [yape({ operationCode: 'OP-83' })] });
    await expect(resolver(conCodigo, {})).resolves.toBe('OP-83');

    const sinCodigo = armarThis({ buzon: [yape()] });
    await expect(resolver(sinCodigo, {})).resolves.toBe('pay-1');
  });

  it('ya no está en el buzón (o el lector no responde) → rechaza', async () => {
    const ctx = armarThis({ buzon: [] });
    await expect(resolver(ctx, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el Yape es de otro monto → rechaza', async () => {
    const ctx = armarThis({ buzon: [yape({ amount: 80 })] });
    await expect(resolver(ctx, {})).rejects.toThrow('Ese Yape es de S/ 80.00');
  });

  it('otra cajera ya lo aplicó a otra venta → 409 con el código de esa venta', async () => {
    const ctx = armarThis({
      buzon: [yape()],
      cobros: [{ referencia: 'pay-1', venta: { codigo: 'VTA-SED-00000815' } }],
    });
    const err = await resolver(ctx, {}).catch((e: any) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('VTA-SED-00000815');
  });

  it('ya validó una participación de sorteo → 409', async () => {
    const ctx = armarThis({
      buzon: [yape()],
      participaciones: [{ yapePaymentId: 'pay-1' }],
    });
    await expect(resolver(ctx, {})).rejects.toThrow('participación de sorteo');
  });

  it('un cobro que no es Yape/Plin no puede usar el buzón', async () => {
    const ctx = armarThis({ buzon: [yape()] });
    await expect(resolver(ctx, { metodoPago: 'EFECTIVO' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
