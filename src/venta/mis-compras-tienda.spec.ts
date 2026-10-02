import { NotFoundException, ValidationPipe } from '@nestjs/common';
import { ReportarAbonoDto } from './dto/reportar-abono.dto';
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
  empresasCliente?: { id: string; razonSocial?: string; nombreComercial?: string | null }[];
  ventas?: any[];
  venta?: any;
  clienteEmpresa?: any;
  pendientes?: any[];
  cuenta?: any;
  depositos?: any[];
  depositosEnRevision?: any[];
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
    depositoCliente: { findMany: jest.fn().mockResolvedValue(opts.depositos ?? []) },
    reporteAbono: {
      // Depósitos (pagos sin líneas) que esperan aprobación.
      findMany: jest.fn().mockResolvedValue(opts.depositosEnRevision ?? []),
      count: jest.fn().mockResolvedValue((opts.depositosEnRevision ?? []).length),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: data.id, monto: data.monto, metodoPago: data.metodoPago, estado: 'PENDIENTE', creadoEn: new Date() })),
    },
    // Líneas de pagos en revisión: [{ ventaId, monto }].
    reporteAbonoVenta: { findMany: jest.fn().mockResolvedValue(opts.pendientes ?? []) },
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

describe('Tienda web: reportar un pago (a una o varias compras)', () => {
  const file: any = { mimetype: 'image/jpeg', size: 1000, buffer: Buffer.from('x') };
  const files = [file];
  const credito = (id: string, total: number, extra: any = {}) => venta({
    id, codigo: `V-${id}`, esCredito: true, estado: 'CONFIRMADA', total, nombreCliente: 'Ana',
    cuotas: [cuota(1, total, total, dia(5))], ...extra,
  });
  const yape = (lineas: { ventaId: string; monto: number }[]) => ({ lineas, metodoPago: 'YAPE' as const });

  it('una compra al contado no acepta abonos', async () => {
    const { service } = makeService({ empresaPersona: { id: 'ep1' }, ventas: [venta({ id: 'v1' })] });
    await expect(service.reportarAbono('e1', 'p1', 'u1', yape([{ ventaId: 'v1', monto: 10 }]), files))
      .rejects.toThrow('crédito');
  });

  it('una compra ajena (fuera del acceso) es 404', async () => {
    const { service } = makeService({ empresaPersona: { id: 'ep1' }, ventas: [credito('v1', 100)] });
    await expect(service.reportarAbono('e1', 'p1', 'u1', yape([{ ventaId: 'v1', monto: 10 }, { ventaId: 'v-ajena', monto: 10 }]), files))
      .rejects.toThrow('no encontrada');
  });

  it('no deja pagarle a una compra más que su saldo menos lo que está en revisión', async () => {
    const { service, storage } = makeService({
      empresaPersona: { id: 'ep1' }, ventas: [credito('v1', 1000)], pendientes: [{ ventaId: 'v1', monto: 900 }],
    });
    await expect(service.reportarAbono('e1', 'p1', 'u1', yape([{ ventaId: 'v1', monto: 150 }]), files))
      .rejects.toThrow('S/ 100.00');
    expect(storage.uploadArchivo).not.toHaveBeenCalled();
  });

  it('no mezcla compras personales con las de una empresa', async () => {
    const { service } = makeService({
      empresaPersona: { id: 'ep1' },
      ventas: [credito('v1', 100), credito('v2', 100, { clienteEmpresaId: 'ce1' })],
    });
    await expect(service.reportarAbono('e1', 'p1', 'u1', yape([{ ventaId: 'v1', monto: 50 }, { ventaId: 'v2', monto: 50 }]), files))
      .rejects.toThrow('No mezcles');
  });

  it('la misma compra dos veces: 400', async () => {
    const { service } = makeService({ empresaPersona: { id: 'ep1' }, ventas: [credito('v1', 100)] });
    await expect(service.reportarAbono('e1', 'p1', 'u1', yape([{ ventaId: 'v1', monto: 10 }, { ventaId: 'v1', monto: 10 }]), files))
      .rejects.toThrow('dos veces');
  });

  it('una transferencia exige una cuenta activa de la tienda', async () => {
    const { service } = makeService({ empresaPersona: { id: 'ep1' }, ventas: [credito('v1', 1000)], cuenta: null });
    await expect(service.reportarAbono('e1', 'p1', 'u1',
      { lineas: [{ ventaId: 'v1', monto: 100 }], metodoPago: 'TRANSFERENCIA', empresaBancoId: 'b-ajena' }, files))
      .rejects.toThrow('cuenta');
  });

  it('una transferencia grande que salda 3 compras: un pago con 3 líneas y el total', async () => {
    const { service, prisma, storage, notificaciones } = makeService({
      empresaPersona: { id: 'ep1' },
      ventas: [credito('a', 4000), credito('b', 3000), credito('c', 3000)],
      cuenta: { id: 'b1' },
    });
    const res = await service.reportarAbono('e1', 'p1', 'u1', {
      lineas: [{ ventaId: 'a', monto: 4000 }, { ventaId: 'b', monto: 3000 }, { ventaId: 'c', monto: 3000 }],
      metodoPago: 'TRANSFERENCIA', empresaBancoId: 'b1', numeroOperacion: ' 987 ',
    }, files);
    const creado = prisma.reporteAbono.create.mock.calls[0][0].data;
    expect(creado).toMatchObject({ monto: 10000, metodoPago: 'TRANSFERENCIA', empresaBancoId: 'b1', numeroOperacion: '987' });
    expect(creado.lineas.create).toEqual([
      { ventaId: 'a', monto: 4000 }, { ventaId: 'b', monto: 3000 }, { ventaId: 'c', monto: 3000 },
    ]);
    // La captura, ligada al REPORTE (no a una venta).
    expect(storage.uploadArchivo.mock.calls[0][0].entidadId).toBe(creado.id);
    expect(res).toMatchObject({ estado: 'PENDIENTE', monto: 10000, compras: 3 });
    expect(notificaciones.enviarAUsuarios.mock.calls[0][2]).toContain('a 3 ventas');
  });

  it('un pago en 4 Yape: sube las 4 capturas y las guarda todas (la primera también sola)', async () => {
    const { service, prisma, storage } = makeService({ empresaPersona: { id: 'ep1' }, ventas: [credito('v1', 2000)] });
    storage.uploadArchivo
      .mockResolvedValueOnce({ url: 'u1.jpg' }).mockResolvedValueOnce({ url: 'u2.jpg' })
      .mockResolvedValueOnce({ url: 'u3.jpg' }).mockResolvedValueOnce({ url: 'u4.jpg' });
    await service.reportarAbono('e1', 'p1', 'u1', yape([{ ventaId: 'v1', monto: 2000 }]), [file, file, file, file]);
    expect(storage.uploadArchivo).toHaveBeenCalledTimes(4);
    const creado = prisma.reporteAbono.create.mock.calls[0][0].data;
    expect(creado).toMatchObject({ comprobanteUrl: 'u1.jpg', comprobantesUrls: ['u1.jpg', 'u2.jpg', 'u3.jpg', 'u4.jpg'] });
  });

  it('más de 4 capturas o ninguna: 400 sin subir nada', async () => {
    const { service, storage } = makeService({ empresaPersona: { id: 'ep1' }, ventas: [credito('v1', 1000)] });
    await expect(service.reportarAbono('e1', 'p1', 'u1', yape([{ ventaId: 'v1', monto: 100 }]), [file, file, file, file, file]))
      .rejects.toThrow('hasta 4');
    await expect(service.reportarAbono('e1', 'p1', 'u1', yape([{ ventaId: 'v1', monto: 100 }]), []))
      .rejects.toThrow('captura');
    expect(storage.uploadArchivo).not.toHaveBeenCalled();
  });
});

describe('Tienda web: depósitos sin indicar compras y saldo a favor', () => {
  const files = [{ originalname: 'c.jpg' }] as any;

  it('el saldo a favor es lo depositado menos lo aplicado, por titular', async () => {
    const { service } = makeService({
      empresaPersona: { id: 'ep1' }, dni: '12345678', empresasCliente: [{ id: 'ce1', razonSocial: 'ACME SAC', nombreComercial: null }],
      depositos: [
        { clienteEmpresaId: null, monto: 4000, montoAplicado: 3980 },
        { clienteEmpresaId: 'ce1', monto: 500, montoAplicado: 0 },
      ],
      depositosEnRevision: [{ clienteEmpresaId: null, monto: 300 }],
    });
    const res = await service.listar('e1', 'p1');
    const personal = res.saldos.find((x: any) => x.clienteEmpresaId === null)!;
    const acme = res.saldos.find((x: any) => x.clienteEmpresaId === 'ce1')!;
    expect(personal).toMatchObject({ saldoAFavor: 20, enRevision: 300 });
    expect(acme).toMatchObject({ saldoAFavor: 500, nombre: 'ACME SAC' });
    expect(res.resumen.saldoAFavor).toBe(520);
  });

  it('un depósito sin compras queda PENDIENTE con su titular y sin líneas', async () => {
    const { service, prisma, notificaciones } = makeService({ empresaPersona: { id: 'ep1' }, dni: '12345678' });
    const res = await service.reportarAbono('e1', 'p1', 'u1', { metodoPago: 'YAPE', monto: 4000 } as any, files);
    const creado = prisma.reporteAbono.create.mock.calls[0][0].data;
    expect(creado).toMatchObject({ monto: 4000, clienteId: 'ep1', clienteEmpresaId: null });
    expect(creado.lineas).toBeUndefined();
    expect(res).toMatchObject({ esDeposito: true, compras: 0 });
    expect(notificaciones.enviarAUsuarios).toHaveBeenCalled();
  });

  it('depositar por una empresa donde NO es contacto es 404', async () => {
    const { service } = makeService({ empresaPersona: { id: 'ep1' }, dni: '12345678' });
    await expect(
      service.reportarAbono('e1', 'p1', 'u1', { metodoPago: 'YAPE', monto: 100, clienteEmpresaId: 'ajena' } as any, files),
    ).rejects.toThrow('Empresa no encontrada');
  });

  it('sin ficha de cliente no puede dejar un depósito personal', async () => {
    const { service } = makeService({ dni: '12345678' });
    await expect(service.reportarAbono('e1', 'p1', 'u1', { metodoPago: 'YAPE', monto: 100 } as any, files))
      .rejects.toThrow('cuenta de cliente');
  });

  it('sin monto no hay depósito', async () => {
    const { service } = makeService({ empresaPersona: { id: 'ep1' } });
    await expect(service.reportarAbono('e1', 'p1', 'u1', { metodoPago: 'YAPE' } as any, files))
      .rejects.toThrow('cuánto depositaste');
  });
});

describe('ReportarAbonoDto por multipart', () => {
  // El mismo pipe que main.ts: `lineas` llega como TEXTO JSON dentro del multipart.
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const meta = { type: 'body' as const, metatype: ReportarAbonoDto };

  it('convierte las líneas de texto JSON a objetos con monto numérico', async () => {
    const dto = await pipe.transform(
      { lineas: '[{"ventaId":"v1","monto":"4000"},{"ventaId":"v2","monto":"3000.5"}]', metodoPago: 'TRANSFERENCIA', empresaBancoId: 'b1' },
      meta,
    );
    expect(dto.lineas).toEqual([
      expect.objectContaining({ ventaId: 'v1', monto: 4000 }),
      expect.objectContaining({ ventaId: 'v2', monto: 3000.5 }),
    ]);
  });

  it('sin líneas es un depósito: pasa con su monto', async () => {
    const dto = await pipe.transform({ metodoPago: 'YAPE', monto: '4000', clienteEmpresaId: 'ce1' }, meta);
    expect(dto.lineas).toBeUndefined();
    expect(dto.monto).toBe(4000);
    expect(dto.clienteEmpresaId).toBe('ce1');
  });

  it('rechaza JSON roto o un monto en cero', async () => {
    await expect(pipe.transform({ metodoPago: 'YAPE', monto: '0' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ lineas: '{roto', metodoPago: 'YAPE' }, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ lineas: '[{"ventaId":"v1","monto":"0"}]', metodoPago: 'YAPE' }, meta)).rejects.toBeDefined();
  });
});
