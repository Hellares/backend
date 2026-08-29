import {
  OPERACIONES_AUTORIZABLES,
  normalizarOperacion,
} from './services/operaciones-autorizables.catalog';

/**
 * Qué operaciones se pueden pedir autorizar.
 *
 * Antes `operacion` era un string libre que solo se escribía en el log: nada
 * garantizaba que fuera real, y los nombres se separaron solos (`DESCUENTO` y
 * `APLICAR_DESCUENTO` para lo mismo), así que la única traza de quién autorizó
 * qué no servía para auditar.
 *
 * 🔴 Lo más importante que se fija acá es el ALIAS. El APK que está hoy
 * instalado manda `DESCUENTO`: si se rechazara, quedarían sin poder autorizar
 * descuentos todos los celulares sin actualizar.
 */
describe('normalizarOperacion', () => {
  it('acepta las operaciones del catálogo tal cual', () => {
    for (const op of OPERACIONES_AUTORIZABLES) {
      expect(normalizarOperacion(op)).toBe(op);
    }
  });

  it('🔴 el alias viejo del APK en la calle sigue funcionando', () => {
    expect(normalizarOperacion('DESCUENTO')).toBe('APLICAR_DESCUENTO');
  });

  it('el alias se traduce al canónico, así el log queda uniforme', () => {
    // Dos celulares con versiones distintas tienen que producir la MISMA
    // entrada de auditoría.
    expect(normalizarOperacion('DESCUENTO')).toBe(
      normalizarOperacion('APLICAR_DESCUENTO'),
    );
  });

  it('una operación inventada se rechaza', () => {
    expect(normalizarOperacion('BORRAR_TODO')).toBeNull();
    expect(normalizarOperacion('anular_venta_x')).toBeNull();
  });

  it('vacío, espacios y undefined se rechazan', () => {
    expect(normalizarOperacion('')).toBeNull();
    expect(normalizarOperacion('   ')).toBeNull();
    expect(normalizarOperacion(undefined)).toBeNull();
  });

  it('tolera espacios y minúsculas: se rechaza lo que no existe, no un typo de formato', () => {
    expect(normalizarOperacion('  anular_venta  ')).toBe('ANULAR_VENTA');
    expect(normalizarOperacion('Aplicar_Descuento')).toBe('APLICAR_DESCUENTO');
  });

  it('el catálogo cubre todas las operaciones que hoy usa el app', () => {
    // Sacadas de `grep "operacion: '" lib` en syncronize-app. Si alguien
    // agrega una pantalla que pide autorización y se olvida del catálogo,
    // este test es el que lo agarra ANTES de que el 400 aparezca en el celular.
    const usadasPorElApp = [
      'ANULAR_VENTA',
      'ANULAR_MOVIMIENTO_CAJA',
      'APLICAR_DESCUENTO',
      'VENTA_BAJO_COSTO',
      'ACTIVAR_LIQUIDACION',
      'DESCUENTO', // alias legacy
    ];
    for (const op of usadasPorElApp) {
      expect(normalizarOperacion(op)).not.toBeNull();
    }
  });
});
