import { NotFoundException } from '@nestjs/common';
import { MisComprasTiendaService } from './mis-compras-tienda.service';

/**
 * "Mis compras" de la tienda web.
 *
 * Invariantes:
 * - Acceso: su ficha (EmpresaPersona), los clientes empresa donde es contacto
 *   por DNI y las ventas al público con su DNI. Sin nada de eso: vacío / 404.
 * - Solo ventas cerradas (sin BORRADOR ni ANULADA).
 * - Saldo a crédito = suma de saldos de cuota (como CxC); la deuda solo suma
 *   compras a crédito.
 * - Un vencimiento se juzga por DÍA en Lima: la cuota que vence hoy no está vencida.
 */

const dia = (offset: number) => {
  // Mediodía de Lima (17:00 UTC) de hoy + offset días: lejos de los bordes del día.
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
  const d = new Date(`${hoy}T17:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};

const makeService = (opts: {
  empresaPersona?: any;
  dni?: string | null;
  empresasCliente?: { id: string }[];
  ventas?: any[];
  venta?: any;
} = {}) => {
  const prisma: any = {
    empresaPersona: { findFirst: jest.fn().mockResolvedValue(opts.empresaPersona ?? null) },
    persona: { findUnique: jest.fn().mockResolvedValue(opts.dni === undefined ? null : { dni: opts.dni }) },
    clienteEmpresa: { findMany: jest.fn().mockResolvedValue(opts.empresasCliente ?? []) },
    venta: {
      findMany: jest.fn().mockResolvedValue(opts.ventas ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.venta ?? null),
    },
    archivo: { findMany: jest.fn().mockResolvedValue([]) },
    pagoVenta: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { service: new MisComprasTiendaService(prisma), prisma };
};

const venta = (extra: any = {}) => ({
  id: 'v1', codigo: 'V-1', fechaVenta: new Date(), estado: 'PAGADA_COMPLETA', esCredito: false,
  total: 100, totalConInteres: null, fechaVencimientoPago: null, numeroCuotas: null,
  pagos: [], cuotas: [], detalles: [{ productoId: null }], clienteEmpresa: null,
  ...extra,
});

const cuota = (numero: number, monto: number, saldo: number, vence: Date) => ({
  numero, monto, montoPagado: monto - saldo, saldoPendiente: saldo, fechaVencimiento: vence,
  estado: saldo <= 0 ? 'PAGADA' : 'PENDIENTE', montoMora: 0,
});

describe('Tienda web: mis compras', () => {
  it('sin ficha, sin empresa y sin DNI válido: lista vacía sin consultar ventas', async () => {
    const { service, prisma } = makeService({ dni: null });
    const res = await service.listar('e1', 'p1');
    expect(res.data).toEqual([]);
    expect(res.resumen.deuda).toBe(0);
    expect(prisma.venta.findMany).not.toHaveBeenCalled();
  });

  it('filtra por su ficha, sus empresas cliente y su DNI, solo ventas cerradas', async () => {
    const { service, prisma } = makeService({
      empresaPersona: { id: 'ep1' }, dni: '12345678', empresasCliente: [{ id: 'ce1' }],
    });
    await service.listar('e1', 'p1');
    const where = prisma.venta.findMany.mock.calls[0][0].where;
    expect(where.empresaId).toBe('e1');
    expect(where.estado).toEqual({ in: ['CONFIRMADA', 'PAGADA_PARCIAL', 'PAGADA_COMPLETA'] });
    expect(where.AND[0].OR).toEqual([
      { clienteId: 'ep1' },
      { clienteEmpresaId: { in: ['ce1'] } },
      { clienteId: null, clienteEmpresaId: null, documentoCliente: '12345678' },
    ]);
  });

  it('la deuda suma solo los saldos de crédito (por cuotas) y la próxima es la más cercana', async () => {
    const { service } = makeService({
      empresaPersona: { id: 'ep1' },
      ventas: [
        venta({ id: 'a', codigo: 'V-A', esCredito: true, estado: 'PAGADA_PARCIAL', total: 1000, numeroCuotas: 4,
          cuotas: [cuota(1, 250, 0, dia(-10)), cuota(2, 250, 250, dia(8)), cuota(3, 250, 250, dia(38)), cuota(4, 250, 250, dia(68))] }),
        venta({ id: 'b', codigo: 'V-B', esCredito: true, estado: 'CONFIRMADA', total: 300, numeroCuotas: 1,
          cuotas: [cuota(1, 300, 300, dia(3))] }),
        venta({ id: 'c', codigo: 'V-C', total: 80 }),
      ],
    });
    const res = await service.listar('e1', 'p1');
    expect(res.resumen.deuda).toBe(1050);
    expect(res.resumen.comprasConDeuda).toBe(2);
    expect(res.resumen.totalComprado).toBe(1380);
    expect(res.resumen.proximoPago).toMatchObject({ codigo: 'V-B', numero: 1, saldo: 300 });
    const a = res.data.find((x) => x.id === 'a')!;
    expect(a).toMatchObject({ estado: 'CREDITO', total: 1000, pagado: 250, saldo: 750 });
    expect(res.data.find((x) => x.id === 'c')).toMatchObject({ estado: 'PAGADA', saldo: 0, pagado: 80 });
  });

  it('una cuota que vence HOY no está vencida; la de ayer sí', async () => {
    const { service } = makeService({
      empresaPersona: { id: 'ep1' },
      ventas: [
        venta({ id: 'hoy', esCredito: true, estado: 'CONFIRMADA', total: 100, cuotas: [cuota(1, 100, 100, dia(0))] }),
        venta({ id: 'ayer', esCredito: true, estado: 'CONFIRMADA', total: 100, cuotas: [cuota(1, 100, 100, dia(-1))] }),
      ],
    });
    const res = await service.listar('e1', 'p1');
    expect(res.data.find((x) => x.id === 'hoy')!.estado).toBe('CREDITO');
    expect(res.data.find((x) => x.id === 'ayer')!.estado).toBe('VENCIDA');
  });

  it('detalle de una venta ajena (o sin acceso) es 404', async () => {
    const { service } = makeService({ dni: null });
    await expect(service.detalle('e1', 'p1', 'v1')).rejects.toBeInstanceOf(NotFoundException);
    const { service: s2 } = makeService({ empresaPersona: { id: 'ep1' }, venta: null });
    await expect(s2.detalle('e1', 'p1', 'v1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el detalle no muestra un comprobante anulado', async () => {
    const { service } = makeService({
      empresaPersona: { id: 'ep1' },
      venta: venta({
        detalles: [{ productoId: null, descripcion: 'Mouse', cantidad: 2, precioUnitario: 45, descuento: 0, total: 90 }],
        sede: { nombre: 'Principal' },
        comprobante: { tipoComprobante: 'BOLETA', serie: 'B001', correlativo: '10', sunatPdfUrl: 'x', anulado: true },
      }),
    });
    const res = await service.detalle('e1', 'p1', 'v1');
    expect(res.comprobante).toBeNull();
    expect(res.items).toEqual([{ descripcion: 'Mouse', cantidad: 2, precioUnitario: 45, descuento: 0, subtotal: 90, imagen: null }]);
  });
});
