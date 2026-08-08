import { ProductoVarianteService } from './producto-variante.service';

/**
 * Configuración de presentación y apertura en la VARIANTE.
 *
 * Dos cosas se cubren acá:
 *
 * 1. Que `unidadMedidaId` se PERSISTA. Estaba en el DTO desde siempre pero ni
 *    el create ni el update lo escribían, así que se descartaba en silencio —
 *    por eso no existía una sola variante con unidad propia. El saco cerrado
 *    la necesita: se vende por unidad dentro de un producto en gramos.
 *
 * 2. Que las dos parejas vayan completas o vacías. Media configuración es peor
 *    que ninguna: deja un "abrir" que no sabe cuánto rinde.
 */
const mkLogger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  success: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const VAR_EXISTENTE = {
  id: 'v-saco',
  productoId: 'p1',
  empresaId: 'e1',
  sku: 'SKU-SACO',
  deletedAt: null,
  unidadMedidaId: null,
  unidadPresentacionId: null,
  factorPresentacion: null,
  varianteAperturaId: null,
  rendimientoApertura: null,
};

const mkService = (
  opts: {
    destinoExiste?: boolean;
    existente?: any;
    /** El destino elegido es a su vez un bulto (saco → saco). */
    destinoEsBulto?: boolean;
    /** Otra variante ya se abre en la que estamos editando. */
    laAbreOtra?: any;
  } = {},
) => {
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
      // `tieneVariantes` es obligatorio: sin él el create corta antes con
      // "El producto no tiene variantes habilitadas".
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'p1', isActive: true, tieneVariantes: true }),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'p1', isActive: true, tieneVariantes: true }),
    },
    productoVariante: {
      // Despacha por la FORMA del `where`, no por el orden de llamada: contar
      // llamadas hacía que cualquier validación nueva —como el guard de
      // cadena— rompiera specs que ni la miran.
      findFirst: jest.fn().mockImplementation((args: any) => {
        const where = args?.where ?? {};
        // "¿alguna otra variante se abre en ésta?"
        if (where.varianteAperturaId) {
          return Promise.resolve(opts.laAbreOtra ?? null);
        }
        // Destino de la apertura: se busca por id DENTRO del producto.
        if (where.id && where.productoId) {
          return Promise.resolve(
            opts.destinoExiste === false
              ? null
              : {
                  id: 'v-granel',
                  nombre: 'GRANEL',
                  varianteAperturaId: opts.destinoEsBulto ? 'v-otro-granel' : null,
                },
          );
        }
        // Chequeo de SKU duplicado / variante existente.
        return Promise.resolve(opts.existente ?? null);
      }),
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
  // Estos dos corren dentro de la misma transacción y tienen sus propias
  // consultas; no son lo que este spec mide, así que se stubbean para que el
  // test hable solo del `data` que llega al create.
  (service as any).copiarNivelesDeOtraVariante = jest.fn().mockResolvedValue(undefined);
  (service as any).crearProductoStockEnSedes = jest.fn().mockResolvedValue(undefined);
  // El reload final consulta por su cuenta; devolvemos algo mapeable.
  (service as any).recargarVariante = jest.fn().mockResolvedValue({
    id: 'v-nueva',
    productoId: 'p1',
    empresaId: 'e1',
    nombre: 'SACO 15KG',
    sku: 'SKU-SACO',
    codigoEmpresa: 'VAR-001',
    unidadMedidaId: 'um-unidad',
    unidadPresentacionId: null,
    factorPresentacion: null,
    varianteAperturaId: 'v-granel',
    rendimientoApertura: '15000',
    atributosValores: [],
    isActive: true,
    orden: 0,
  });
  return { service, prisma, tx };
};

const BASE = { nombre: 'SACO 15KG', sku: 'SKU-SACO' };

describe('crear variante con configuración de apertura', () => {
  // `unidadMedidaId` tiene su propio spec (producto-variante-unidad-medida):
  // era un bug aparte, anterior a este proyecto, y se arregló por separado.

  it('persiste el vínculo de apertura y su rendimiento', async () => {
    const { service, tx } = mkService();

    await service.create('p1', 'e1', {
      ...BASE,
      unidadMedidaId: 'um-unidad',
      varianteAperturaId: 'v-granel',
      rendimientoApertura: 15000,
    } as any);

    const data = tx.productoVariante.create.mock.calls[0][0].data;
    expect(data.varianteAperturaId).toBe('v-granel');
    expect(data.rendimientoApertura).toBe(15000);
  });

  it('persiste la presentación propia de la variante', async () => {
    const { service, tx } = mkService();

    await service.create('p1', 'e1', {
      ...BASE,
      unidadPresentacionId: 'um-kg',
      factorPresentacion: 1000,
    } as any);

    const data = tx.productoVariante.create.mock.calls[0][0].data;
    expect(data.unidadPresentacionId).toBe('um-kg');
    expect(data.factorPresentacion).toBe(1000);
  });

  it('rechaza destino de apertura sin rendimiento', async () => {
    const { service } = mkService();

    await expect(
      service.create('p1', 'e1', { ...BASE, varianteAperturaId: 'v-granel' } as any),
    ).rejects.toThrow(/rendimiento es obligatorio/i);
  });

  it('rechaza rendimiento sin destino', async () => {
    const { service } = mkService();

    await expect(
      service.create('p1', 'e1', { ...BASE, rendimientoApertura: 15000 } as any),
    ).rejects.toThrow(/sin variante destino/i);
  });

  it('rechaza unidad de presentación sin factor', async () => {
    const { service } = mkService();

    await expect(
      service.create('p1', 'e1', { ...BASE, unidadPresentacionId: 'um-kg' } as any),
    ).rejects.toThrow(/factor es obligatorio/i);
  });

  it('rechaza factor de presentación <= 1', async () => {
    const { service } = mkService();

    await expect(
      service.create('p1', 'e1', {
        ...BASE, unidadPresentacionId: 'um-kg', factorPresentacion: 1,
      } as any),
    ).rejects.toThrow(/mayor a 1/i);
  });

  it('rechaza un destino que no es del mismo producto', async () => {
    const { service } = mkService({ destinoExiste: false });

    await expect(
      service.create('p1', 'e1', {
        ...BASE, varianteAperturaId: 'v-de-otro-producto', rendimientoApertura: 15000,
      } as any),
    ).rejects.toThrow(/mismo producto/i);
  });

  it('🔴 rechaza un destino que a su vez es un bulto (saco → saco)', async () => {
    // Cargando ALIMENTO PARA RATON en beta, un saco quedó apuntando al saco de
    // la otra etapa: en la lista de hermanas los nombres solo se diferencian al
    // final. Abrirlo habría sumado 15 000 SACOS al inventario y dejado el costo
    // del destino en centavos por el promedio ponderado.
    const { service } = mkService({ destinoEsBulto: true });

    await expect(
      service.create('p1', 'e1', {
        ...BASE, varianteAperturaId: 'v-otro-saco', rendimientoApertura: 15000,
      } as any),
    ).rejects.toThrow(/variante suelta/i);
  });
});

describe('actualizar variante', () => {
  it('🔴 null BORRA el vínculo, no se omite', async () => {
    // El bug que hoy tiene la unidad de compra: armar el update con
    // `if (x != null)` hace que el campo en null se omita y el backend lo lea
    // como "no tocar", así que la configuración no se puede apagar nunca.
    const { service, tx } = mkService({
      existente: { ...VAR_EXISTENTE, varianteAperturaId: 'v-granel', rendimientoApertura: '15000' },
    });

    await service.update('v-saco', 'e1', {
      varianteAperturaId: null,
      rendimientoApertura: null,
    } as any);

    const data = tx.productoVariante.update.mock.calls[0][0].data;
    expect(data).toHaveProperty('varianteAperturaId', null);
    expect(data).toHaveProperty('rendimientoApertura', null);
  });

  it('un campo ausente NO se toca', async () => {
    const { service, tx } = mkService({
      existente: { ...VAR_EXISTENTE, varianteAperturaId: 'v-granel', rendimientoApertura: '15000' },
    });

    await service.update('v-saco', 'e1', { nombre: 'SACO 15KG v2' } as any);

    const data = tx.productoVariante.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('varianteAperturaId');
    expect(data).not.toHaveProperty('rendimientoApertura');
  });

  it('valida contra el estado resultante, no solo contra el dto', async () => {
    // Solo se manda el rendimiento; el destino ya está guardado, así que es
    // una edición válida y no debe rechazarse.
    const { service } = mkService({
      existente: { ...VAR_EXISTENTE, varianteAperturaId: 'v-granel', rendimientoApertura: '15000' },
    });

    await expect(
      service.update('v-saco', 'e1', { rendimientoApertura: 22000 } as any),
    ).resolves.toBeDefined();
  });

  it('una variante no puede abrirse en sí misma', async () => {
    const { service } = mkService({ existente: VAR_EXISTENTE });

    await expect(
      service.update('v-saco', 'e1', {
        varianteAperturaId: 'v-saco', rendimientoApertura: 100,
      } as any),
    ).rejects.toThrow(/en sí misma/i);
  });

  it('🔴 la que ya es destino de otra no puede volverse bulto', async () => {
    // La misma regla que el guard de arriba, del otro lado. Sin esto el orden
    // de carga decide: si al elegir el destino ése todavía no era bulto, la
    // cadena se arma igual cuando se lo configure después.
    const { service } = mkService({
      existente: VAR_EXISTENTE,
      laAbreOtra: { nombre: 'SACO 15KG' },
    });

    await expect(
      service.update('v-saco', 'e1', {
        varianteAperturaId: 'v-granel', rendimientoApertura: 15000,
      } as any),
    ).rejects.toThrow(/se abre en esta variante/i);
  });
});
