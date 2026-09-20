import {
  leerArbolDependiente,
  partirRuta,
  rutaValida,
  validarArbolDependiente,
  SEP_DEPENDIENTE,
} from './utils/opcion-dependiente.util';

/**
 * Campo de plantilla con selección en CASCADA (20-09).
 *
 * El árbol vive en la columna `opciones` (Json) y el valor guardado es la
 * ruta unida por " / ". Acá se fija el contrato que tienen que respetar los
 * dos clientes: app y web arman la misma ruta.
 */
const ARBOL = {
  niveles: ['Fabricante', 'Familia', 'Modelo'],
  arbol: [
    {
      valor: 'QUALCOMM',
      hijos: [
        {
          valor: 'SNAPDRAGON',
          hijos: [{ valor: '8 Gen 3' }, { valor: '888' }],
        },
      ],
    },
    {
      valor: 'INTEL',
      hijos: [
        { valor: 'CORE', hijos: [{ valor: 'i5-12400' }, { valor: 'i7-13700' }] },
      ],
    },
  ],
};

describe('campo OPCION_DEPENDIENTE', () => {
  describe('lectura del árbol', () => {
    it('lee niveles y árbol', () => {
      const a = leerArbolDependiente(ARBOL);
      expect(a?.niveles).toEqual(['Fabricante', 'Familia', 'Modelo']);
      expect(a?.arbol).toHaveLength(2);
    });

    it('🔴 un árbol ilegible devuelve null, NO tira', () => {
      // Un campo mal configurado no puede hacer fallar el guardado de la
      // orden entera: eso se valida al crear el campo.
      expect(leerArbolDependiente(null)).toBeNull();
      expect(leerArbolDependiente(['QUALCOMM'])).toBeNull();
      expect(leerArbolDependiente({ niveles: [], arbol: [] })).toBeNull();
      expect(
        leerArbolDependiente({ niveles: ['A'], arbol: [{ nombre: 'x' }] }),
      ).toBeNull();
    });
  });

  describe('la ruta', () => {
    const a = leerArbolDependiente(ARBOL)!;

    it('acepta una ruta completa', () => {
      expect(rutaValida(a, ['QUALCOMM', 'SNAPDRAGON', '8 Gen 3'])).toBe(true);
      expect(rutaValida(a, ['INTEL', 'CORE', 'i7-13700'])).toBe(true);
    });

    it('🔴 rechaza la ruta a medias: falta elegir', () => {
      expect(rutaValida(a, ['QUALCOMM'])).toBe(false);
      expect(rutaValida(a, ['QUALCOMM', 'SNAPDRAGON'])).toBe(false);
    });

    it('rechaza una rama que no existe', () => {
      // El modelo es de Intel, no de Qualcomm: es el caso que justifica la
      // cascada (con dos listas sueltas esto entraba).
      expect(rutaValida(a, ['QUALCOMM', 'CORE', 'i5-12400'])).toBe(false);
      expect(rutaValida(a, ['AMD', 'RYZEN', '5600'])).toBe(false);
      expect(rutaValida(a, [])).toBe(false);
    });

    it('parte la ruta tolerando espacios, y respeta los del valor', () => {
      expect(partirRuta('QUALCOMM / SNAPDRAGON / 8 Gen 3')).toEqual([
        'QUALCOMM',
        'SNAPDRAGON',
        '8 Gen 3',
      ]);
      expect(partirRuta('QUALCOMM/SNAPDRAGON/888')).toEqual([
        'QUALCOMM',
        'SNAPDRAGON',
        '888',
      ]);
    });

    it('el separador es ASCII (esto se imprime en térmica)', () => {
      expect(SEP_DEPENDIENTE).toBe(' / ');
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(SEP_DEPENDIENTE)).toBe(true);
    });
  });

  describe('validación al GUARDAR el campo', () => {
    it('un árbol bueno pasa', () => {
      expect(validarArbolDependiente(ARBOL)).toBeNull();
    });

    it('sin forma o sin opciones, se rechaza con motivo', () => {
      expect(validarArbolDependiente(null)).toMatch(/niveles/);
      expect(
        validarArbolDependiente({ niveles: ['Fabricante'], arbol: [] }),
      ).toMatch(/ninguna opción/);
    });

    it('🔴 rechaza opciones más abajo del último nivel', () => {
      // Serían inalcanzables: el selector solo pinta tantos combos como
      // niveles declarados.
      expect(
        validarArbolDependiente({
          niveles: ['Fabricante'],
          arbol: [{ valor: 'INTEL', hijos: [{ valor: 'CORE' }] }],
        }),
      ).toMatch(/más abajo/);
    });

    it('rechaza repetidos en el mismo nivel', () => {
      expect(
        validarArbolDependiente({
          niveles: ['Fabricante'],
          arbol: [{ valor: 'INTEL' }, { valor: 'intel' }],
        }),
      ).toMatch(/repetidas/);
    });
  });
});
