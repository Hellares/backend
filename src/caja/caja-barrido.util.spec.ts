import { destinoBarrido } from './caja-barrido.util';

/**
 * Tests del ruteo del barrido al cerrar caja (F2). Decide si el dinero de un
 * método va al BANCO (recaudación) o a la TESORERIA (bóveda).
 */
describe('destinoBarrido', () => {
  const bancoPEN = { id: 'b1', isActive: true, moneda: 'PEN' };

  it('EFECTIVO siempre va a TESORERIA, aunque tenga banco mapeado', () => {
    expect(destinoBarrido('EFECTIVO' as any, bancoPEN)).toBe('TESORERIA');
  });

  it('digital con cuenta de recaudación activa en PEN → BANCO', () => {
    expect(destinoBarrido('YAPE' as any, bancoPEN)).toBe('BANCO');
    expect(destinoBarrido('PLIN' as any, bancoPEN)).toBe('BANCO');
    expect(destinoBarrido('TRANSFERENCIA' as any, bancoPEN)).toBe('BANCO');
    expect(destinoBarrido('TARJETA' as any, bancoPEN)).toBe('BANCO');
  });

  it('digital SIN mapeo → TESORERIA (fallback, no se pierde el dinero)', () => {
    expect(destinoBarrido('YAPE' as any, null)).toBe('TESORERIA');
    expect(destinoBarrido('PLIN' as any, undefined)).toBe('TESORERIA');
  });

  it('digital con banco INACTIVO → TESORERIA', () => {
    expect(destinoBarrido('YAPE' as any, { id: 'b1', isActive: false, moneda: 'PEN' })).toBe(
      'TESORERIA',
    );
  });

  it('digital con banco en otra moneda (USD) → TESORERIA (caja es PEN)', () => {
    expect(destinoBarrido('YAPE' as any, { id: 'b1', isActive: true, moneda: 'USD' })).toBe(
      'TESORERIA',
    );
  });

  it('banco con moneda null se trata como PEN → BANCO', () => {
    expect(destinoBarrido('YAPE' as any, { id: 'b1', isActive: true, moneda: null })).toBe('BANCO');
  });
});
