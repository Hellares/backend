import { Prisma } from '@prisma/client';
import { validarCantidadesDevolucion } from './cantidades-devolucion.util';

/**
 * Candado de las cantidades de una devolución: nunca más de lo que se vendió,
 * sumando lo que ya se devolvió.
 */
describe('Cantidades de una devolución', () => {
  const linea = (cantidad: number, varianteId: string | null = null) => ({
    productoId: 'peter',
    varianteId,
    cantidad,
  });

  it('🔴 la venta 927 de beta: vendió 1, ya se devolvió 1 → una segunda devolución se rechaza', () => {
    // Antes pasaba: salieron S/ 1.000 de caja por una venta de S/ 500.
    const vendidas = [{ ...linea(1), descripcion: 'PETER PORKER' }];

    expect(validarCantidadesDevolucion(vendidas, [linea(1)], [linea(1)])).toBe(
      '"PETER PORKER": se vendió 1 unidad y ya se devolvió 1. No queda nada por devolver de este producto.',
    );
  });

  it('en tandas: entra lo que queda, y lo que se pase se rechaza diciendo cuánto queda', () => {
    const vendidas = [linea(3)];

    expect(validarCantidadesDevolucion(vendidas, [linea(1)], [linea(2)])).toBeNull();
    expect(validarCantidadesDevolucion(vendidas, [linea(1)], [linea(3)])).toMatch(
      /Se pueden devolver 2 más, no 3/,
    );
  });

  it('suma las líneas repetidas, de la venta y de la devolución', () => {
    // El mismo producto en dos líneas de la venta: se vendieron 2.
    const vendidas = [linea(1), linea(1)];

    expect(validarCantidadesDevolucion(vendidas, [], [linea(1), linea(1)])).toBeNull();
    expect(validarCantidadesDevolucion(vendidas, [], [linea(2), linea(1)])).not.toBeNull();
  });

  it('cada variante se cuenta aparte', () => {
    const vendidas = [linea(1, 'rojo'), linea(1, 'azul')];

    // Ya volvió la roja: la azul todavía se puede devolver.
    expect(validarCantidadesDevolucion(vendidas, [linea(1, 'rojo')], [linea(1, 'azul')])).toBeNull();
    expect(validarCantidadesDevolucion(vendidas, [linea(1, 'rojo')], [linea(1, 'rojo')])).not.toBeNull();
  });

  it('entiende la cantidad como Decimal, que es como llega de Prisma', () => {
    const vendidas = [{ productoId: 'peter', varianteId: null, cantidad: new Prisma.Decimal('2.00') }];

    expect(validarCantidadesDevolucion(vendidas, [], [linea(2)])).toBeNull();
    expect(validarCantidadesDevolucion(vendidas, [], [linea(3)])).not.toBeNull();
  });

  it('una línea de servicio (sin producto) no se valida acá', () => {
    const servicio = { productoId: null, varianteId: null, cantidad: 1 };

    expect(validarCantidadesDevolucion([], [], [servicio])).toBeNull();
  });
});
