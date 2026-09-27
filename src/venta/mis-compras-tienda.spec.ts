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
  clienteEmpresa?: any;
  pendientes?: any[];
  cuenta?: any;
} = {}) => {
  const prisma: any = {
    empresaPersona: { findFirst: jest.fn().mockResolvedValue(opts.empresaPersona ?? null) },
    persona: {
      findUnique: jest.fn().mockResolvedValue(
        opts.dni === undefined ? null : { dni: opts.dni, nombres: 'Ana', apellidos: 'Díaz' },
      ),
    },
    clienteEmpresa: {
      findMany: jest.fn().mockResolvedValue(opts.empresasCliente ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.clienteEmpresa ?? null),
    },
    empresa: { findUnique: jest.fn().mockResolvedValue({ nombre: 'TIENDA SAC', ruc: '20123456789' }) },
    venta: {
      findMany: jest.fn().mockResolvedValue(opts.ventas ?? []),
      findFirst: jest.fn().mockResolvedValue(opts.venta ?? null),
    },
    archivo: { findMany: jest.fn().mockResolvedValue([]) },
    pagoVenta: { findMany: jest.fn().mockResolvedValue([]) },
    reporteAbono: {
      findMany: jest.fn().mockResolvedValue(opts.pendientes ?? []),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: data.id, monto: data.monto, metodoPago: data.metodoPago, estado: 'PENDIENTE', creadoEn: new Date() })),
    },
    empresaBanco: { findFirst: jest.fn().mockResolvedValue(opts.cuenta ?? null) },
    empresaUsuarioRol: { findMany: jest.fn().mockResolvedValue([{ usuarioId: 'admin-1' }]) },
  };
  const storage: any = { uploadArchivo: jest.fn().mockResolvedValue({ url: 'https://cdn/captura.jpg' }) };
  const notificaciones: any = { enviarAUsuarios: jest.fn().mockResolvedValue(undefined) };
  return { service: new MisComprasTiendaService(prisma, storage, notificaciones), prisma, storage, notificaciones };
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

  it('estado de cuenta personal: solo crédito y SIN las compras de empresas', async () => {
    const { service, prisma } = makeService({
      empresaPersona: { id: 'ep1' }, dni: '12345678', empresasCliente: [{ id: 'ce1' }],
      ventas: [venta({ id: 'a', codigo: 'V-A', esCredito: true, estado: 'CONFIRMADA', total: 300,
        cuotas: [cuota(1, 300, 300, dia(5))],
        detalles: [{ productoId: null, descripcion: 'Laptop', cantidad: 1, precioUnitario: 300, total: 300 }] })],
    });
    const res = await service.estadoCuenta('e1', 'p1', null);
    const where = prisma.venta.findMany.mock.calls[0][0].where;
    expect(where.esCredito).toBe(true);
    expect(where.clienteEmpresaId).toBeNull();
    expect(res.estadoCuenta.cliente).toMatchObject({ tipo: 'PERSONA', nombre: 'Ana Díaz', documento: '12345678' });
    expect(res.estadoCuenta.resumen).toMatchObject({ saldoPendiente: 300, cantidadVentas: 1, ventasConSaldo: 1 });
    expect(res.detalles.a).toEqual([{ descripcion: 'Laptop', cantidad: 1, precioUnitario: 300, total: 300 }]);
    expect(res.empresa).toEqual({ nombre: 'TIENDA SAC', ruc: '20123456789' });
  });

  it('estado de cuenta de una empresa donde NO es contacto: 404 (el acceso deja la lista vacía)', async () => {
    const { service } = makeService({
      empresaPersona: { id: 'ep1' }, dni: '12345678',
      clienteEmpresa: { razonSocial: 'OTRA SAC', numeroDocumento: '20999999999' },
      ventas: [],
    });
    await expect(service.estadoCuenta('e1', 'p1', 'ce-ajena')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Tienda web: reportar un abono', () => {
  const file: any = { mimetype: 'image/jpeg', size: 1000, buffer: Buffer.from('x') };
  const files = [file];
  const credito = () => venta({
    id: 'v1', codigo: 'V-1', esCredito: true, estado: 'CONFIRMADA', total: 1000, nombreCliente: 'Ana',
    cuotas: [cuota(1, 500, 500, dia(5)), cuota(2, 500, 500, dia(35))],
  });

  it('una compra al contado no acepta abonos', async () => {
    const { service } = makeService({ empresaPersona: { id: 'ep1' }, venta: venta() });
    await expect(service.reportarAbono('e1', 'p1', 'u1', 'v1', { monto: 10, metodoPago: 'YAPE' }, files))
      .rejects.toThrow('no es a crédito');
  });

  it('no deja reportar más que el saldo menos lo que ya está en revisión', async () => {
    const { service, storage } = makeService({ empresaPersona: { id: 'ep1' }, venta: credito(), pendientes: [{ monto: 900 }] });
    await expect(service.reportarAbono('e1', 'p1', 'u1', 'v1', { monto: 150, metodoPago: 'YAPE' }, files))
      .rejects.toThrow('S/ 100.00');
    expect(storage.uploadArchivo).not.toHaveBeenCalled();
  });

  it('una transferencia exige una cuenta activa de la tienda', async () => {
    const { service } = makeService({ empresaPersona: { id: 'ep1' }, venta: credito(), cuenta: null });
    await expect(service.reportarAbono('e1', 'p1', 'u1', 'v1', { monto: 100, metodoPago: 'TRANSFERENCIA', empresaBancoId: 'b-ajena' }, files))
      .rejects.toThrow('cuenta');
  });

  it('reporta: sube la captura ligada al reporte, queda PENDIENTE y avisa a la tienda', async () => {
    const { service, prisma, storage, notificaciones } = makeService({ empresaPersona: { id: 'ep1' }, venta: credito() });
    const res = await service.reportarAbono('e1', 'p1', 'u1', 'v1', { monto: 500, metodoPago: 'YAPE', numeroOperacion: ' 123 ' }, files);
    const subida = storage.uploadArchivo.mock.calls[0][0];
    const creado = prisma.reporteAbono.create.mock.calls[0][0].data;
    expect(subida.entidadId).toBe(creado.id);
    expect(subida.entidadId).not.toBe('v1');
    expect(creado).toMatchObject({ ventaId: 'v1', monto: 500, metodoPago: 'YAPE', numeroOperacion: '123', comprobanteUrl: 'https://cdn/captura.jpg' });
    expect(res).toMatchObject({ estado: 'PENDIENTE', monto: 500 });
    expect(notificaciones.enviarAUsuarios).toHaveBeenCalled();
  });

  it('un pago en 3 Yape: sube las 3 capturas y las guarda todas (la primera también sola)', async () => {
    const { service, prisma, storage } = makeService({ empresaPersona: { id: 'ep1' }, venta: credito() });
    storage.uploadArchivo
      .mockResolvedValueOnce({ url: 'u1.jpg' }).mockResolvedValueOnce({ url: 'u2.jpg' }).mockResolvedValueOnce({ url: 'u3.jpg' });
    await service.reportarAbono('e1', 'p1', 'u1', 'v1', { monto: 900, metodoPago: 'YAPE' }, [file, file, file]);
    expect(storage.uploadArchivo).toHaveBeenCalledTimes(3);
    const creado = prisma.reporteAbono.create.mock.calls[0][0].data;
    expect(creado).toMatchObject({ monto: 900, comprobanteUrl: 'u1.jpg', comprobantesUrls: ['u1.jpg', 'u2.jpg', 'u3.jpg'] });
  });

  it('más de 3 capturas o ninguna: 400 sin subir nada', async () => {
    const { service, storage } = makeService({ empresaPersona: { id: 'ep1' }, venta: credito() });
    await expect(service.reportarAbono('e1', 'p1', 'u1', 'v1', { monto: 100, metodoPago: 'YAPE' }, [file, file, file, file]))
      .rejects.toThrow('hasta 3');
    await expect(service.reportarAbono('e1', 'p1', 'u1', 'v1', { monto: 100, metodoPago: 'YAPE' }, []))
      .rejects.toThrow('captura');
    expect(storage.uploadArchivo).not.toHaveBeenCalled();
  });
});
