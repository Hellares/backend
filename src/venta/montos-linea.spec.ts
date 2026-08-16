import { calcularMontosLinea } from '../common/utils/montos-linea.util';

/**
 * La identidad `subtotal + igv + icbper === total` en una línea de venta.
 *
 * Salió de un bug real (VTA-SED-00000806, 16-08): una línea a granel dejó la
 * venta impaga por 0.01 y mandó al comprobante un `gravada + igv` que no daba
 * el total declarado.
 */
describe('calcularMontosLinea', () => {
  /** Lo que hace que todo lo demás cierre. */
  const cuadra = (m: { subtotal: number; igv: number; icbper: number; total: number }) =>
    expect(Number((m.subtotal + m.igv + m.icbper).toFixed(2))).toBe(m.total);

  describe('el caso que rompió: 1237 g × 0.015 = 18.555', () => {
    const linea = {
      cantidad: 1237,
      precioUnitario: 0.015,
      precioIncluyeIgv: true,
    };

    it('el total es el monto exacto que paga el cliente', () => {
      // 18.555 redondea a 18.56: el total es lo que NO se puede mover.
      expect(calcularMontosLinea(linea).total).toBe(18.56);
    });

    it('las partes SUMAN el total (antes daban 18.55)', () => {
      const m = calcularMontosLinea(linea);
      cuadra(m);
      // El IGV absorbe el centavo: 18.56 - 15.72 = 2.84, y no el 2.83 que
      // salía de redondear el IGV por su cuenta.
      expect(m.subtotal).toBe(15.72);
      expect(m.igv).toBe(2.84);
    });
  });

  describe('la venta 806 completa', () => {
    // Las tres líneas tal cual quedaron guardadas.
    const lineas = [
      { cantidad: 1237, precioUnitario: 0.015, precioIncluyeIgv: true },
      { cantidad: 1, precioUnitario: 160, precioIncluyeIgv: true },
      { cantidad: 1237, precioUnitario: 0.011, precioIncluyeIgv: true },
    ];

    it('subtotal + impuestos de la VENTA da su total', () => {
      const montos = lineas.map(calcularMontosLinea);
      const subtotal = montos.reduce((s, m) => s + m.subtotal, 0);
      const igv = montos.reduce((s, m) => s + m.igv, 0);
      const total = montos.reduce((s, m) => s + m.total, 0);

      expect(Number(total.toFixed(2))).toBe(192.17);
      // 🔴 Esto es lo que fallaba: daba 192.16 contra un total de 192.17, la
      // venta quedaba con 0.01 pendiente y no llegaba nunca a PAGADA.
      expect(Number((subtotal + igv).toFixed(2))).toBe(192.17);
    });
  });

  describe('no rompe lo que ya andaba', () => {
    it('precio redondo con IGV incluido', () => {
      const m = calcularMontosLinea({
        cantidad: 1,
        precioUnitario: 160,
        precioIncluyeIgv: true,
      });
      expect(m).toMatchObject({ subtotal: 135.59, igv: 24.41, total: 160 });
      cuadra(m);
    });

    it('precio SIN IGV: el total lo suma', () => {
      const m = calcularMontosLinea({
        cantidad: 2,
        precioUnitario: 50,
        precioIncluyeIgv: false,
      });
      expect(m).toMatchObject({ subtotal: 100, igv: 18, total: 118 });
      cuadra(m);
    });

    it('con descuento en la línea', () => {
      const m = calcularMontosLinea({
        cantidad: 3,
        precioUnitario: 10,
        descuento: 5,
        precioIncluyeIgv: true,
      });
      expect(m.total).toBe(25);
      cuadra(m);
    });

    it('el ICBPER se suma al total sin pasar por el IGV', () => {
      const m = calcularMontosLinea({
        cantidad: 2,
        precioUnitario: 5,
        precioIncluyeIgv: true,
        icbper: 0.6,
      });
      expect(m.icbper).toBe(0.6);
      expect(m.total).toBe(10.6);
      cuadra(m);
    });

    it('exonerado (0%): todo es base, sin IGV', () => {
      const m = calcularMontosLinea({
        cantidad: 3,
        precioUnitario: 7.5,
        porcentajeIGV: 0,
        precioIncluyeIgv: true,
      });
      expect(m).toMatchObject({ subtotal: 22.5, igv: 0, total: 22.5 });
      cuadra(m);
    });

    it('cantidad cero no inventa montos', () => {
      const m = calcularMontosLinea({ cantidad: 0, precioUnitario: 12.5 });
      expect(m).toMatchObject({ subtotal: 0, igv: 0, total: 0 });
    });
  });

  /**
   * 🔑 La prueba que de verdad protege: cualquier gramaje contra cualquier
   * precio por kilo tiene que cuadrar. Pesar produce estos números todo el
   * tiempo, y no se pueden enumerar a mano.
   */
  it('cuadra para CUALQUIER peso y precio (barrido)', () => {
    for (let gramos = 1; gramos <= 3000; gramos += 7) {
      for (const precioKilo of [7, 8.5, 11, 15, 19.9, 23.33]) {
        const m = calcularMontosLinea({
          cantidad: gramos,
          precioUnitario: precioKilo / 1000,
          precioIncluyeIgv: true,
        });
        const suma = Number((m.subtotal + m.igv + m.icbper).toFixed(2));
        expect(suma).toBe(m.total);
      }
    }
  });
});
