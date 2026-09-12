import {
  aFechaCalendario,
  diaCalendario,
  estaVencido,
  hoyCalendarioPeru,
  inicioDeHoyCalendario,
} from './date-utils';

/**
 * Un vencimiento es un DÍA, no un instante.
 *
 * 🔴 El bug que esto fija: la fecha se guarda como medianoche UTC del día del
 * envase, y compararla contra `new Date()` la daba por vencida desde las 19:00
 * del día ANTERIOR en Lima. Un envase que dice "VENCE 01/10" vale el 01/10
 * entero.
 */
describe('fechas de calendario (vencimientos)', () => {
  const VENCE = aFechaCalendario('2026-10-01');

  it('🔴 el envase vale el día entero en Perú', () => {
    // 30/09 19:30 en Lima = 01/10 00:30 UTC. Ya pasó la medianoche UTC, pero
    // en Perú todavía es 30/09: no está vencido.
    expect(estaVencido(VENCE, new Date('2026-10-01T00:30:00Z'))).toBe(false);
    // 01/10 23:59 en Lima: sigue siendo el día del envase.
    expect(estaVencido(VENCE, new Date('2026-10-02T04:59:00Z'))).toBe(false);
    // 02/10 00:00 en Lima: recién ahora.
    expect(estaVencido(VENCE, new Date('2026-10-02T05:00:00Z'))).toBe(true);
  });

  it('sin fecha no vence', () => {
    expect(estaVencido(null)).toBe(false);
    expect(estaVencido(undefined)).toBe(false);
  });

  it('normaliza lo que manda cada cliente al MISMO día', () => {
    // La web: yyyy-MM-dd.
    expect(diaCalendario(aFechaCalendario('2026-10-01'))).toBe('2026-10-01');
    // El app: la medianoche local sin zona.
    expect(diaCalendario(aFechaCalendario('2026-10-01T00:00:00.000'))).toBe('2026-10-01');
    // La medianoche de Lima expresada en UTC.
    expect(diaCalendario(aFechaCalendario('2026-10-01T05:00:00.000Z'))).toBe('2026-10-01');
    // Un Date ya guardado.
    expect(diaCalendario(aFechaCalendario(new Date('2026-10-01T00:00:00Z')))).toBe('2026-10-01');
    // Y se guarda siempre igual: medianoche UTC de ese día.
    expect(aFechaCalendario('2026-10-01').toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('hoy en Perú cambia a las 05:00 UTC', () => {
    expect(hoyCalendarioPeru(new Date('2026-10-02T04:59:59Z'))).toBe('2026-10-01');
    expect(hoyCalendarioPeru(new Date('2026-10-02T05:00:00Z'))).toBe('2026-10-02');
  });

  it('el umbral de las queries es la medianoche UTC del día de hoy en Perú', () => {
    expect(inicioDeHoyCalendario(0, new Date('2026-10-02T04:59:59Z')).toISOString())
      .toBe('2026-10-01T00:00:00.000Z');
    // "Vence dentro de 30 días": 02/10 + 30 = 01/11.
    expect(inicioDeHoyCalendario(30, new Date('2026-10-02T05:00:00Z')).toISOString())
      .toBe('2026-11-01T00:00:00.000Z');
  });
});
