import {
  construirNombreVariante,
  nombreEsAutogenerado,
} from './utils/nombre-variante.util';

/**
 * El nombre de la variante se arma con los valores de los atributos MARCADOS.
 * Las reglas sutiles están acá: el orden, el respaldo cuando no hay ninguno
 * marcado, y sobre todo cómo se decide si un nombre lo pusimos nosotros o una
 * persona — de eso depende que recalcular no pise trabajo ajeno.
 */
const attr = (
  valor: string,
  orden: number,
  usarEnNombreVariante = true,
) => ({ valor, orden, usarEnNombreVariante });

describe('construirNombreVariante', () => {
  it('usa solo los marcados, ordenados por orden', () => {
    const nombre = construirNombreVariante([
      attr('860', 3),
      attr('QUALQON', 1, false),
      attr('AZUL', 0),
      attr('SNAPDRAGON 8XX', 2, false),
    ]);

    // El fabricante y la familia quedan fuera: ya están implícitos en el
    // procesador y estiraban el nombre a tres líneas en 58 mm.
    expect(nombre).toBe('AZUL / 860');
  });

  it('si NINGUNO está marcado, cae a todos', () => {
    const nombre = construirNombreVariante([
      attr('AZUL', 1, false),
      attr('860', 2, false),
    ]);

    // Preferible un nombre largo a una variante sin nombre.
    expect(nombre).toBe('AZUL / 860');
  });

  it('ignora los valores vacíos', () => {
    expect(construirNombreVariante([attr('AZUL', 0), attr('  ', 1)]))
      .toBe('AZUL');
  });

  it('sin atributos devuelve vacío, para que el llamador no pise el nombre', () => {
    expect(construirNombreVariante([])).toBe('');
  });
});

describe('nombreEsAutogenerado', () => {
  const valores = [attr('AZUL', 0), attr('QUALQON', 1, false), attr('860', 2)];

  it('reconoce el nombre que sale con los marcados', () => {
    expect(nombreEsAutogenerado('AZUL / 860', valores)).toBe(true);
  });

  /**
   * Las variantes creadas antes de que existiera el flag se nombraron con
   * TODOS los atributos. Sin este candidato, ninguna de las que ya están en la
   * base volvería a actualizarse nunca.
   */
  it('reconoce también el que sale usándolos todos', () => {
    expect(nombreEsAutogenerado('AZUL / QUALQON / 860', valores)).toBe(true);
  });

  it('respeta un nombre escrito a mano', () => {
    expect(nombreEsAutogenerado('Edición aniversario', valores)).toBe(false);
  });

  it('un nombre vacío se considera autogenerado: no hay nada que respetar', () => {
    expect(nombreEsAutogenerado('   ', valores)).toBe(true);
  });
});
