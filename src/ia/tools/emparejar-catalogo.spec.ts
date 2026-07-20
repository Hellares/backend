import { emparejarCatalogo } from './stock.util';

const ctx = (items: any[]) => ({ empresaId: 'e', catalogoReciente: items }) as any;

const ALMOHADAS = [
  { id: 'p', varianteId: 'v11', nombre: 'ALMOHADA AZUL SIN RELLENO 1 METRO' },
  { id: 'p', varianteId: 'v14', nombre: 'ALMOHADA ROJA CON RELLENO 2 METROS' },
  { id: 'p', varianteId: 'v16', nombre: 'ALMOHADA ROJA SIN RELLENO 2 METROS' },
];

describe('emparejarCatalogo', () => {
  it('id abreviado ambiguo ("ALMOHADA_ROJA_RELLENO_2M") → opciones, no adivina', () => {
    const r = emparejarCatalogo(ctx(ALMOHADAS), 'ALMOHADA_ROJA_RELLENO_2M');
    expect(r.match).toBeUndefined();
    expect(r.opciones?.map((o) => o.varianteId).sort()).toEqual(['v14', 'v16']);
  });

  it('nombre exacto con "CON" desambigua a la variante correcta', () => {
    const r = emparejarCatalogo(ctx(ALMOHADAS), 'ALMOHADA ROJA CON RELLENO 2 METROS');
    expect(r.match?.varianteId).toBe('v14');
  });

  it('código inventado "LAP001" → único producto por letras', () => {
    const r = emparejarCatalogo(
      ctx([{ id: 'L', varianteId: null, nombre: 'LAPICERO GEL BOIL' }]),
      'LAP001',
    );
    expect(r.match?.id).toBe('L');
  });

  it('nombre a secas ("LAPICERO") resuelve por tokens', () => {
    const r = emparejarCatalogo(
      ctx([{ id: 'L', varianteId: null, nombre: 'LAPICERO GEL BOIL' }]),
      'LAPICERO',
    );
    expect(r.match?.id).toBe('L');
  });

  it('id real (cuid) matchea directo', () => {
    const r = emparejarCatalogo(
      ctx([{ id: 'cmxyz', varianteId: null, nombre: 'ESPEJO' }]),
      'cmxyz',
    );
    expect(r.match?.id).toBe('cmxyz');
  });

  it('sin match → vacío (no inventa)', () => {
    const r = emparejarCatalogo(ctx(ALMOHADAS), 'TELEVISOR SAMSUNG');
    expect(r.match).toBeUndefined();
    expect(r.opciones).toBeUndefined();
  });
});
