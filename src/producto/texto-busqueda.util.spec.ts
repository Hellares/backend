import {
  MAX_TERMINOS_BUSQUEDA,
  condicionStockPorPalabras,
  condicionTextoBusqueda,
  normalizarBusqueda,
  pareceCodigo,
  tokenizarBusqueda,
} from './texto-busqueda.util';

/**
 * El caso que motivó todo: `"lavadora samsung"` devolvía CERO porque la
 * búsqueda usaba la frase entera como un substring, y "lavadora" está en el
 * nombre mientras que "samsung" está en la marca.
 */
describe('normalizarBusqueda', () => {
  it('baja a minúsculas y saca tildes', () => {
    expect(normalizarBusqueda('Lavadora Automática')).toBe(
      'lavadora automatica',
    );
    expect(normalizarBusqueda('CAÑO PVC')).toBe('cano pvc');
    expect(normalizarBusqueda('Güiro')).toBe('guiro');
  });

  it('colapsa espacios y recorta', () => {
    expect(normalizarBusqueda('  lavadora   samsung  ')).toBe(
      'lavadora samsung',
    );
  });

  // Debe coincidir con lower(unaccent(...)) de Postgres.
  it('normaliza los mismos casos que unaccent', () => {
    expect(normalizarBusqueda('Ñandú')).toBe('nandu');
    expect(normalizarBusqueda('Açaí')).toBe('acai');
  });
});

describe('tokenizarBusqueda', () => {
  it('parte la consulta en palabras normalizadas', () => {
    expect(tokenizarBusqueda('Lavadora SAMSUNG')).toEqual([
      'lavadora',
      'samsung',
    ]);
  });

  it('no repite palabras', () => {
    expect(tokenizarBusqueda('samsung samsung')).toEqual(['samsung']);
  });

  it('devuelve vacío si no hay nada que buscar', () => {
    expect(tokenizarBusqueda('   ')).toEqual([]);
    expect(tokenizarBusqueda('')).toEqual([]);
  });

  it('corta en el tope de términos', () => {
    const muchas = 'a b c d e f g h i j';
    expect(tokenizarBusqueda(muchas)).toHaveLength(MAX_TERMINOS_BUSQUEDA);
  });

  // Prisma NO escapa los comodines de LIKE en `contains`.
  it('neutraliza % y _ para que no actúen como comodines', () => {
    expect(tokenizarBusqueda('co_e')).toEqual(['co', 'e']);
    expect(tokenizarBusqueda('50%')).toEqual(['50']);
  });
});

describe('pareceCodigo', () => {
  it('reconoce un código de barras', () => {
    expect(pareceCodigo('7750182001234')).toBe(true);
    expect(pareceCodigo('SKU-001')).toBe(true);
  });

  it('una frase NO es un código', () => {
    expect(pareceCodigo('lavadora samsung')).toBe(false);
  });

  it('un texto larguísimo tampoco', () => {
    expect(pareceCodigo('x'.repeat(60))).toBe(false);
  });
});

describe('condicionTextoBusqueda', () => {
  it('exige que TODAS las palabras estén en la columna', () => {
    expect(condicionTextoBusqueda(['lavadora', 'samsung'])).toEqual([
      { textoBusqueda: { contains: 'lavadora' } },
      { textoBusqueda: { contains: 'samsung' } },
    ]);
  });

  // La columna ya está normalizada: un ILIKE solo agregaría trabajo.
  it('no usa mode insensitive', () => {
    const [cond] = condicionTextoBusqueda(['samsung']);
    expect(cond.textoBusqueda).not.toHaveProperty('mode');
  });

  it('sin términos no filtra nada', () => {
    expect(condicionTextoBusqueda([])).toEqual([]);
  });
});

describe('condicionStockPorPalabras', () => {
  it('cada palabra puede caer en el producto o en la variante', () => {
    const [cond] = condicionStockPorPalabras(['blanca']);
    expect(cond.OR).toEqual([
      { producto: { textoBusqueda: { contains: 'blanca' } } },
      { variante: { nombre: { contains: 'blanca', mode: 'insensitive' } } },
      { variante: { sku: { contains: 'blanca', mode: 'insensitive' } } },
      { variante: { codigoBarras: { contains: 'blanca', mode: 'insensitive' } } },
    ]);
  });

  it('varias palabras se combinan con AND (una condición por palabra)', () => {
    expect(condicionStockPorPalabras(['lavadora', 'samsung'])).toHaveLength(2);
  });
});
