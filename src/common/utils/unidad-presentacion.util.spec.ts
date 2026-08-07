import {
  cantidadDeclarada,
  clavePresentacion,
  codigoSunatUnidad,
  montosDeclarados,
  presentacionDeProducto,
  presentacionDeVariante,
  sinPresentacion,
  UNIDAD_SUNAT_DEFAULT,
  type PresentacionLinea,
} from './unidad-presentacion.util';

/** RICOCAN: se guarda en gramos, se cobra en kilos. */
const KILO: PresentacionLinea = { factor: 1000, simbolo: 'kg', codigoSunat: 'KGM' };

/** Unidad de empresa con su maestra, tal como sale del select de Prisma. */
const unidad = (codigo: string, simbolo?: string) => ({
  simboloLocal: simbolo ?? null,
  simboloPersonalizado: null,
  unidadMaestra: { codigo, simbolo: simbolo ?? codigo },
});

/** RICOCAN tal como está configurado en prod: base gramo, presentación kilo. */
const GRANEL_EN_KILOS = {
  unidadMedidaId: 'um-gramo',
  factorPresentacion: 1000,
  unidadPresentacion: unidad('KGM', 'kg'),
  unidadMedida: unidad('GRM', 'g'),
};

describe('codigoSunatUnidad', () => {
  it('usa el código de la unidad maestra', () => {
    expect(codigoSunatUnidad({ unidadMaestra: { codigo: 'KGM' } })).toBe('KGM');
  });

  it('normaliza a mayúsculas y sin espacios', () => {
    expect(codigoSunatUnidad({ unidadMaestra: { codigo: ' kgm ' } })).toBe('KGM');
  });

  it('cae a NIU sin unidad', () => {
    expect(codigoSunatUnidad(null)).toBe(UNIDAD_SUNAT_DEFAULT);
    expect(codigoSunatUnidad(undefined)).toBe(UNIDAD_SUNAT_DEFAULT);
  });

  it('cae a NIU cuando la unidad es PERSONALIZADA', () => {
    // Sin unidadMaestra el código lo escribió el usuario ("100 g", "CJ12") y
    // no existe en el catálogo 03: mandarlo hace que SUNAT rechace.
    expect(codigoSunatUnidad({ unidadMaestra: null })).toBe('NIU');
    expect(codigoSunatUnidad({} as any)).toBe('NIU');
  });
});

describe('cantidadDeclarada', () => {
  it('divide por el factor: 1500 g son 1.5 kg', () => {
    expect(cantidadDeclarada(1500, KILO)).toBe(1.5);
  });

  it('un saco entero: 22 000 g son 22 kg', () => {
    expect(cantidadDeclarada(22000, KILO)).toBe(22);
  });

  it('conserva el gramo: 1237 g son 1.237 kg', () => {
    expect(cantidadDeclarada(1237, KILO)).toBe(1.237);
  });

  it('sin presentación no toca la cantidad', () => {
    expect(cantidadDeclarada(3, sinPresentacion())).toBe(3);
  });

  it('un factor de 1 no divide (presentación inerte)', () => {
    expect(cantidadDeclarada(3, { factor: 1, simbolo: 'und', codigoSunat: 'NIU' })).toBe(3);
  });
});

describe('montosDeclarados', () => {
  it('1.5 kg a S/8.00 el kilo, no 1500 g a S/0.01', () => {
    // Lo guardado: 1500 g, precio por gramo 0.008 → total 12.00.
    const r = montosDeclarados({ cantidad: 1500, subtotal: 10.17, total: 12 }, KILO);

    expect(r.cantidad).toBe(1.5);
    expect(r.precioUnitario).toBeCloseTo(8, 6);
    expect(r.valorUnitario).toBeCloseTo(6.78, 6);
  });

  it('cantidad × precioUnitario reconstruye el total que pagó el cliente', () => {
    // El caso que motivó los 3 decimales: 1237 g a S/8/kg = S/9.90 cobrados.
    // Derivando el unitario de la cantidad ya redondeada, la línea cuadra.
    const linea = { cantidad: 1237, subtotal: 8.39, total: 9.9 };
    const r = montosDeclarados(linea, KILO);

    expect(r.cantidad * r.precioUnitario).toBeCloseTo(linea.total, 6);
    expect(r.cantidad * r.valorUnitario).toBeCloseTo(linea.subtotal, 6);
  });

  it('NO es multiplicar el precio por el factor', () => {
    // precioPorGramo × 1000 daría 9.896/1.237 = 8.0000 pero al revés:
    // con cantidad redondeada a 1.24 (2 decimales) el total saldría 9.92.
    // Este test fija que la cantidad conserva el gramo.
    const r = montosDeclarados({ cantidad: 1237, subtotal: 8.39, total: 9.9 }, KILO);
    expect(r.cantidad).not.toBe(1.24);
    expect(r.cantidad).toBe(1.237);
  });

  it('sin presentación deja la línea exactamente como estaba', () => {
    const r = montosDeclarados({ cantidad: 2, subtotal: 20, total: 23.6 }, sinPresentacion());

    expect(r.cantidad).toBe(2);
    expect(r.valorUnitario).toBe(10);
    expect(r.precioUnitario).toBe(11.8);
  });

  it('cantidad 0 no divide por cero', () => {
    const r = montosDeclarados({ cantidad: 0, subtotal: 5, total: 5.9 }, KILO);

    expect(r.cantidad).toBe(0);
    expect(Number.isFinite(r.valorUnitario)).toBe(true);
    expect(r.precioUnitario).toBe(5.9);
  });

  it('media unidad de presentación: 500 g son 0.5 kg', () => {
    const r = montosDeclarados({ cantidad: 500, subtotal: 3.39, total: 4 }, KILO);

    expect(r.cantidad).toBe(0.5);
    expect(r.precioUnitario).toBeCloseTo(8, 6);
  });
});

describe('clavePresentacion', () => {
  it('dos variantes del MISMO producto no colisionan', () => {
    // El bug que motivó la clave compuesta: indexando por productoId, el saco
    // y el granel del mismo alimento caían en la misma entrada.
    expect(clavePresentacion('p1', 'v-saco')).not.toBe(
      clavePresentacion('p1', 'v-granel'),
    );
  });

  it('el producto base y una variante suya son claves distintas', () => {
    expect(clavePresentacion('p1', null)).not.toBe(clavePresentacion('p1', 'v1'));
  });

  it('es estable con null y con undefined', () => {
    expect(clavePresentacion('p1', null)).toBe(clavePresentacion('p1', undefined));
    expect(clavePresentacion(null, 'v1')).toBe(clavePresentacion(undefined, 'v1'));
  });
});

describe('presentacionDeProducto', () => {
  it('con presentación configurada declara en la unidad de presentación', () => {
    const p = presentacionDeProducto(GRANEL_EN_KILOS);

    expect(p.factor).toBe(1000);
    expect(p.simbolo).toBe('kg');
    expect(p.codigoSunat).toBe('KGM');
  });

  it('sin presentación declara con la unidad de VENTA, no NIU', () => {
    const p = presentacionDeProducto({
      unidadMedidaId: 'um-gramo',
      unidadMedida: unidad('GRM', 'g'),
    });

    expect(p.factor).toBe(1);
    expect(p.codigoSunat).toBe('GRM');
  });

  it('un factor <= 1 deja la presentación inerte', () => {
    // Dato viejo o cargado por SQL: agrupar de a 1 no agrupa nada.
    const p = presentacionDeProducto({ ...GRANEL_EN_KILOS, factorPresentacion: 1 });

    expect(p.factor).toBe(1);
    expect(p.codigoSunat).toBe('GRM');
  });

  it('sin producto cae a NIU', () => {
    expect(presentacionDeProducto(null).codigoSunat).toBe(UNIDAD_SUNAT_DEFAULT);
  });
});

describe('presentacionDeVariante', () => {
  it('una variante sin unidad propia hereda la presentación del producto', () => {
    // Colores y tallas: misma unidad de venta que el producto.
    const p = presentacionDeVariante({
      unidadMedidaId: null,
      producto: GRANEL_EN_KILOS,
    });

    expect(p.factor).toBe(1000);
    expect(p.codigoSunat).toBe('KGM');
  });

  it('una variante con la MISMA unidad que el producto también la hereda', () => {
    const p = presentacionDeVariante({
      unidadMedidaId: 'um-gramo',
      unidadMedida: unidad('GRM', 'g'),
      producto: GRANEL_EN_KILOS,
    });

    expect(p.factor).toBe(1000);
    expect(p.codigoSunat).toBe('KGM');
  });

  it('🔴 una variante en OTRA unidad NO hereda la presentación del producto', () => {
    // El caso saco cerrado vs granel: el saco se vende por unidad, dentro de
    // un producto cuya base es el gramo y su presentación el kilo. Heredando,
    // la boleta declaraba "1 KGM" por un saco de 15 kg — SUNAT la acepta y
    // dice una mentira.
    const p = presentacionDeVariante({
      unidadMedidaId: 'um-unidad',
      unidadMedida: unidad('NIU', 'und'),
      producto: GRANEL_EN_KILOS,
    });

    expect(p.factor).toBe(1);
    expect(p.codigoSunat).toBe('NIU');
  });

  it('la variante en otra unidad se declara con la SUYA, no con NIU por defecto', () => {
    const p = presentacionDeVariante({
      unidadMedidaId: 'um-metro',
      unidadMedida: unidad('MTR', 'm'),
      producto: GRANEL_EN_KILOS,
    });

    expect(p.codigoSunat).toBe('MTR');
  });

  it('sin producto ni unidad cae a NIU', () => {
    expect(presentacionDeVariante({}).codigoSunat).toBe(UNIDAD_SUNAT_DEFAULT);
  });

  // ─── Presentación PROPIA de la variante (saco cerrado vs granel) ───

  it('la presentación PROPIA de la variante gana sobre la del producto', () => {
    // GRANEL de un saco abierto: el producto padre podría no tener
    // presentación, o tener otra; manda la de la variante.
    const p = presentacionDeVariante({
      unidadMedidaId: 'um-gramo',
      unidadMedida: unidad('GRM', 'g'),
      factorPresentacion: 1000,
      unidadPresentacion: unidad('KGM', 'kg'),
      producto: { unidadMedidaId: 'um-unidad', unidadMedida: unidad('NIU', 'und') },
    });

    expect(p.factor).toBe(1000);
    expect(p.simbolo).toBe('kg');
    expect(p.codigoSunat).toBe('KGM');
  });

  it('🔴 el SACO cerrado no se contagia de la presentación del GRANEL', () => {
    // Las dos variantes del mismo producto, resueltas por separado. Este es
    // el caso que la clave compuesta hizo posible expresar.
    const saco = presentacionDeVariante({
      unidadMedidaId: 'um-unidad',
      unidadMedida: unidad('NIU', 'und'),
      producto: GRANEL_EN_KILOS,
    });
    const granel = presentacionDeVariante({
      unidadMedidaId: 'um-gramo',
      unidadMedida: unidad('GRM', 'g'),
      factorPresentacion: 1000,
      unidadPresentacion: unidad('KGM', 'kg'),
      producto: GRANEL_EN_KILOS,
    });

    expect(saco.codigoSunat).toBe('NIU');
    expect(saco.factor).toBe(1);
    expect(granel.codigoSunat).toBe('KGM');
    expect(granel.factor).toBe(1000);
  });

  it('una presentación propia con factor <= 1 no se aplica y se hereda', () => {
    const p = presentacionDeVariante({
      factorPresentacion: 1,
      unidadPresentacion: unidad('KGM', 'kg'),
      producto: GRANEL_EN_KILOS,
    });

    // Cae a la herencia, o sea la presentación del producto.
    expect(p.factor).toBe(1000);
    expect(p.codigoSunat).toBe('KGM');
  });
});
