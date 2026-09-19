import { Rol } from '@prisma/client';
import { soloVeCotizacionesPropias } from './cotizacion.service';

/**
 * Quién ve solo las cotizaciones que emitió (listado y Cola POS).
 *
 * El técnico entró cuando `cotizacion.crear` le permitió cotizar: sin el
 * filtro habría visto las cotizaciones de toda la empresa.
 */
describe('soloVeCotizacionesPropias', () => {
  it('🔴 el técnico ve solo las suyas', () => {
    expect(soloVeCotizacionesPropias(Rol.TECNICO)).toBe(true);
  });

  it('vendedor y cajero, como antes', () => {
    expect(soloVeCotizacionesPropias(Rol.VENDEDOR)).toBe(true);
    expect(soloVeCotizacionesPropias(Rol.CAJERO)).toBe(true);
  });

  it('los administrativos ven todas', () => {
    for (const rol of [
      Rol.SUPER_ADMIN,
      Rol.EMPRESA_ADMIN,
      Rol.SEDE_ADMIN,
      Rol.CONTADOR,
      Rol.LECTURA,
    ]) {
      expect(soloVeCotizacionesPropias(rol)).toBe(false);
    }
  });
});
