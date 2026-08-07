import { ProductoVarianteService } from './producto-variante.service';

/**
 * `unidadMedidaId` de una variante se PERSISTE.
 *
 * Estaba en el DTO desde siempre y no aparecía ni una vez en el service: ni el
 * create ni el update lo escribían, así que el campo se descartaba en
 * silencio — sin error, con 200 y la variante creada. Por eso no existía una
 * sola variante con unidad propia en toda la base.
 *
 * Importa porque una variante puede venderse en otra unidad que su producto
 * (un saco cerrado por unidad dentro de un producto cuya base es el gramo), y
 * porque el comprobante declara la línea con la unidad de la variante cuando
 * ésta difiere de la del producto.
 */
const mkLogger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const mkService = (existente: any = null) => {
  const tx = {
    productoVariante: {
      create: jest.fn().mockResolvedValue({ id: 'v-nueva' }),
      update: jest.fn().mockResolvedValue({}),
    },
    productoAtributoValor: { deleteMany: jest.fn().mockResolvedValue({}) },
    archivo: { updateMany: jest.fn().mockResolvedValue({}) },
    producto: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    producto: {
      // `tieneVariantes` es obligatorio: sin él el create corta antes.
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'p1', isActive: true, tieneVariantes: true }),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'p1', isActive: true, tieneVariantes: true }),
    },
    productoVariante: {
      findFirst: jest.fn().mockResolvedValue(existente),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const cache = { invalidateProductosLists: jest.fn().mockResolvedValue(undefined) };
  const realtime = { notifyProductoActualizado: jest.fn() };
  const codigos = {
    generarCodigoVariante: jest.fn().mockResolvedValue({ codigoEmpresa: 'VAR-001' }),
  };
  const service = new ProductoVarianteService(
    prisma as any,
    cache as any,
    codigos as any,
    realtime as any,
    mkLogger() as any,
  );
  // Corren en la misma transacción con sus propias consultas; no son lo que
  // este spec mide.
  (service as any).copiarNivelesDeOtraVariante = jest.fn().mockResolvedValue(undefined);
  (service as any).crearProductoStockEnSedes = jest.fn().mockResolvedValue(undefined);
  (service as any).recargarVariante = jest.fn().mockResolvedValue({
    id: 'v-nueva',
    productoId: 'p1',
    empresaId: 'e1',
    nombre: 'SACO 15KG',
    sku: 'SKU-SACO',
    codigoEmpresa: 'VAR-001',
    unidadMedidaId: 'um-unidad',
    atributosValores: [],
    isActive: true,
    orden: 0,
  });
  return { service, tx };
};

const BASE = { nombre: 'SACO 15KG', sku: 'SKU-SACO' };

describe('ProductoVarianteService — unidadMedidaId', () => {
  it('🔴 lo persiste al CREAR (antes se descartaba en silencio)', async () => {
    const { service, tx } = mkService();

    await service.create('p1', 'e1', { ...BASE, unidadMedidaId: 'um-unidad' } as any);

    expect(tx.productoVariante.create.mock.calls[0][0].data.unidadMedidaId).toBe('um-unidad');
  });

  it('sin unidad propia guarda null (hereda la del producto)', async () => {
    const { service, tx } = mkService();

    await service.create('p1', 'e1', { ...BASE } as any);

    expect(tx.productoVariante.create.mock.calls[0][0].data.unidadMedidaId).toBeNull();
  });

  it('🔴 lo persiste al ACTUALIZAR', async () => {
    const { service, tx } = mkService({
      id: 'v1', productoId: 'p1', empresaId: 'e1', sku: 'SKU-SACO', deletedAt: null,
    });

    await service.update('v1', 'e1', { unidadMedidaId: 'um-unidad' } as any);

    expect(tx.productoVariante.update.mock.calls[0][0].data.unidadMedidaId).toBe('um-unidad');
  });

  it('null lo BORRA en vez de omitirlo', async () => {
    // Con `!= null` el campo en null se omite y el backend lo lee como "no
    // tocar": la unidad propia no se podría quitar nunca. Va `!== undefined`.
    const { service, tx } = mkService({
      id: 'v1', productoId: 'p1', empresaId: 'e1', sku: 'SKU-SACO', deletedAt: null,
    });

    await service.update('v1', 'e1', { unidadMedidaId: null } as any);

    expect(tx.productoVariante.update.mock.calls[0][0].data).toHaveProperty(
      'unidadMedidaId',
      null,
    );
  });

  it('si no se manda, no se toca', async () => {
    const { service, tx } = mkService({
      id: 'v1', productoId: 'p1', empresaId: 'e1', sku: 'SKU-SACO', deletedAt: null,
    });

    await service.update('v1', 'e1', { nombre: 'Otro nombre' } as any);

    expect(tx.productoVariante.update.mock.calls[0][0].data).not.toHaveProperty(
      'unidadMedidaId',
    );
  });
});
