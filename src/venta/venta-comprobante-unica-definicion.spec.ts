import * as fs from 'fs';
import * as path from 'path';

/**
 * El documento fiscal se arma en varios lugares de `venta.service.ts`, y cada
 * cambio regulatorio hay que aplicarlo en TODOS. El commit 94206a8 ("declarar
 * la línea en la unidad en la que se cobró") tuvo que insertar las mismas tres
 * llamadas 11 veces en este archivo — esa es la forma que tiene el problema.
 *
 * Este test NO exige que haya una sola copia hoy: exige que la lista de copias
 * conocidas no CREZCA. Cada entrada de la lista es deuda con nombre y apellido,
 * y la lista solo puede achicarse.
 *
 * Si estás acá porque el test se puso rojo agregando una emisión nueva: no
 * agregues tu método a la lista. Usá `_emitirComprobante`, que es la definición
 * única y ya cubre POS, Yape diferido y multi-RUC.
 */
describe('el comprobante tiene una definición única', () => {
  const fuente = fs.readFileSync(
    path.join(__dirname, 'venta.service.ts'),
    'utf8',
  );
  const lineas = fuente.split(/\r?\n/);

  /** Nombre del método que contiene la línea `n` (buscando hacia arriba). */
  const metodoDe = (n: number): string => {
    const decl = /^ {2}(?:private |public |protected )?(?:async )?([a-zA-Z_][\w]*)\s*\(/;
    for (let i = n; i >= 0; i--) {
      const m = lineas[i].match(decl);
      if (m && m[1] !== 'constructor') return m[1];
    }
    return '(nivel de clase)';
  };

  const sitiosDe = (aguja: string): string[] => {
    const encontrados: string[] = [];
    lineas.forEach((l, i) => {
      if (l.includes(aguja)) encontrados.push(metodoDe(i));
    });
    return encontrados.sort();
  };

  it('solo estos métodos crean un ComprobanteElectronico', () => {
    // _emitirComprobante ....... la definición única (POS + Yape diferido)
    // crearDesdeCotizacion ..... deuda: además arma su propio PagoComprobante
    //                            por el adelanto de la cotización, así que el
    //                            merge no es mecánico. Pase aparte.
    // generarComprobante ....... caso distinto: emite desde una venta que YA
    //                            existe, no durante su creación.
    const permitidos = [
      '_emitirComprobante',
      'crearDesdeCotizacion',
      'generarComprobante',
    ].sort();

    expect(sitiosDe('comprobanteElectronico.create')).toEqual(permitidos);
  });

  it('solo estos métodos bloquean la Sede para tomar el correlativo SUNAT', () => {
    // El correlativo tiene que ser sin huecos y en orden: se toma con
    // SELECT ... FOR UPDATE sobre la Sede. Cada copia de ese lock es otra
    // implementación del mismo requisito legal — y la de crearDesdeCotizacion
    // NO contempla multi-RUC (EmisorFacturacion), a diferencia de
    // resolverSerieCorrelativo.
    const permitidos = [
      'resolverSerieCorrelativo',
      'crearDesdeCotizacion',
      'generarComprobante',
    ].sort();

    expect(sitiosDe('FOR UPDATE OF s')).toEqual(permitidos);
  });

  it('crearYCobrar ya NO tiene su propia copia', () => {
    // Era una copia literal de _emitirComprobante (de hecho la función se
    // extrajo de acá y el original quedó vivo). Converger fue el paso 1.
    const sitios = sitiosDe('comprobanteElectronico.create');

    expect(sitios).not.toContain('crearYCobrar');
  });
});
