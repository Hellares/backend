/**
 * Match de nombres Yape/Plin. El caso que motivó el spec: la PRIMERA compra
 * de un cliente real por el agente IA (07-20) no se auto-validó porque Yape
 * mandó el apellido TRUNCADO con asterisco ("Geydy Sil*") y el matcher solo
 * aceptaba palabra exacta o inicial de 1 letra → venta-sin-match, el cliente
 * pagó S/3 y su venta murió por TTL.
 */
import { nombreCoincideYape, nombresCoinciden } from './nombre-match.util';

describe('nombreCoincideYape', () => {
  describe('formato TRUNCADO con asterisco (el bug de la venta 721)', () => {
    it('matchea el apellido truncado contra el nombre oficial', () => {
      expect(nombreCoincideYape('Geydy Sil*', 'GEYDY SILVANA RAMOS VEGA')).toBe(
        true,
      );
    });

    it('salta segundos nombres antes del apellido truncado', () => {
      expect(
        nombreCoincideYape('Geydy Sil*', 'GEYDY MARIA SILVA VASQUEZ'),
      ).toBe(true);
    });

    it('el nombre truncado también vale ("Gey* Silva")', () => {
      expect(nombreCoincideYape('Gey* Silva', 'GEYDY SILVA VASQUEZ')).toBe(true);
    });

    it('NO matchea si el prefijo no calza con ninguna palabra', () => {
      expect(nombreCoincideYape('Geydy Sil*', 'GEYDY TORRES DIAZ')).toBe(false);
    });

    it('NO matchea a otra persona con otro nombre de pila', () => {
      expect(nombreCoincideYape('Geydy Sil*', 'MARIA SILVANA RAMOS')).toBe(
        false,
      );
    });

    it('un asterisco suelto no valida nada', () => {
      expect(nombreCoincideYape('*', 'GEYDY SILVANA RAMOS')).toBe(false);
      expect(nombreCoincideYape('G*', 'GEYDY SILVANA RAMOS')).toBe(false);
    });
  });

  describe('formatos que ya funcionaban (no romper)', () => {
    it('inicial con punto', () => {
      expect(
        nombreCoincideYape('Sebastiana C.', 'SEBASTIANA CACERES VALENZUELA'),
      ).toBe(true);
    });

    it('la inicial NO salta palabras (evita calzar el apellido materno)', () => {
      expect(nombreCoincideYape('Juan V.', 'JUAN RAMOS VEGA')).toBe(false);
    });

    it('nombre completo exacto', () => {
      expect(
        nombreCoincideYape('James Johel Torres Ledezma', 'JAMES JOHEL TORRES LEDEZMA'),
      ).toBe(true);
    });

    it('tildes y mayúsculas son indiferentes', () => {
      expect(nombreCoincideYape('José M.', 'JOSE MARTINEZ ROJAS')).toBe(true);
    });

    it('solo iniciales no identifican a nadie', () => {
      expect(nombreCoincideYape('J. C.', 'JUAN CARLOS RAMOS')).toBe(false);
    });

    it('un tercero NO matchea', () => {
      expect(nombreCoincideYape('Pago de prueba', 'GEYDY SILVANA RAMOS')).toBe(
        false,
      );
    });
  });
});

describe('nombresCoinciden (bidireccional)', () => {
  it('el sender trae MÁS palabras que el registro', () => {
    expect(
      nombresCoinciden('James Johel Torres Ledezma', 'JAMES TORRES LEDEZMA'),
    ).toBe(true);
  });

  it('el sender truncado contra el registro', () => {
    expect(nombresCoinciden('Geydy Sil*', 'GEYDY SILVANA RAMOS VEGA')).toBe(
      true,
    );
  });

  it('un solo nombre de pila registrado no basta en el sentido inverso', () => {
    expect(nombresCoinciden('Geydy Silvana Ramos', 'GEYDY')).toBe(false);
  });

  describe('formato APELLIDOS-PRIMERO (caso real Rayza 07-19)', () => {
    it('nombre completo volteado matchea por conjunto de palabras', () => {
      expect(
        nombresCoinciden(
          'SALAS FLORES RAYZA NADIEJDA',
          'RAYZA NADIEJDA SALAS FLORES',
        ),
      ).toBe(true);
    });

    it('volteado con una palabra menos (sin segundo nombre) también', () => {
      expect(
        nombresCoinciden('SALAS FLORES RAYZA', 'RAYZA NADIEJDA SALAS FLORES'),
      ).toBe(true);
    });

    it('volteado + apellido truncado con asterisco', () => {
      expect(
        nombresCoinciden('Salas Flo* Rayza', 'RAYZA NADIEJDA SALAS FLORES'),
      ).toBe(true);
    });

    it('con solo 2 palabras el desorden NO vale (muy ambiguo)', () => {
      expect(nombresCoinciden('CARLOS JUAN', 'JUAN CARLOS RAMOS')).toBe(false);
    });

    it('coincidencia parcial de palabras NO vale', () => {
      expect(
        nombresCoinciden('SALAS FLORES PEDRO JOSE', 'RAYZA NADIEJDA SALAS FLORES'),
      ).toBe(false);
    });

    it('las iniciales sueltas no cuentan para el conjunto', () => {
      expect(
        nombresCoinciden('SALAS F. R. N.', 'RAYZA NADIEJDA SALAS FLORES'),
      ).toBe(false);
    });
  });
});
