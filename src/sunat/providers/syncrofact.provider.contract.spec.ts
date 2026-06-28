import { SyncrofactProvider } from './syncrofact.provider';

/**
 * Test de CONTRATO: verifica si el provider extrae el código/descripción SUNAT
 * de la forma REAL en que la API de Syncrofact (Laravel) responde al consultar
 * un comprobante rechazado.
 *
 * Hallazgo (2026-06-28): el endpoint `GET /v1/{recurso}/{id}` (InvoiceController@show
 * / BoletaController@show) devuelve el bloque SUNAT bajo la llave `data.sunat`
 * (`{ codigo, descripcion, notas }`), pero `mapCreateResponse` leía `data.respuesta_sunat`.
 * Por la diferencia de llave, `errorCode` salía null y el mensaje caía al genérico.
 *
 * Fix: `extraerSunatTerminal` lee `data.sunat ?? data.respuesta_sunat` y acepta
 * `codigo|code` + `descripcion|description|message`. Estos tests son la guardia
 * de regresión: deben quedar VERDES con el provider corregido.
 */
describe('SyncrofactProvider — contrato de respuesta SUNAT en rechazo', () => {
  function nuevoProvider(showResponse: any) {
    const loggerStub: any = {
      setContext: () => {},
      log: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    const provider = new SyncrofactProvider(loggerStub);
    // Mockear la capa HTTP privada: consultarPorId hace callApiGet a /v1/boletas/:id
    jest.spyOn(provider as any, 'callApiGet').mockResolvedValue(showResponse);
    return provider;
  }

  const comprobante = {
    tipoComprobante: 'BOLETA',
    id: 'cmpLocal123',
    cdrResponse: { _syncrofactId: 123 }, // entra directo a consultarPorId (sin lookup)
  };
  const config = { proveedorRuta: 'https://syncrofact.test', proveedorToken: 'tok' };

  it('FORMA REAL de Laravel (data.sunat): extrae código y descripción exactos', async () => {
    const showReal = {
      success: true,
      data: {
        id: 123,
        estado_sunat: 'RECHAZADO',
        sunat: {
          codigo: '2335',
          descripcion: 'El documento ya fue informado dado de baja',
          notas: [],
        },
      },
    };

    const provider = nuevoProvider(showReal);
    const result = await provider.consultar(comprobante as any, config as any);

    expect(result.aceptado).toBe(false);
    expect(result.errorCode).toBe('2335');
    expect(result.error).toBe('El documento ya fue informado dado de baja');
  });

  it('VARIANTES de llave (data.sunat con code/message): también las resuelve', async () => {
    const showVariante = {
      success: true,
      data: {
        id: 123,
        estado_sunat: 'RECHAZADO',
        sunat: {
          code: '3206',
          message: 'El comprobante fue registrado previamente',
        },
      },
    };

    const provider = nuevoProvider(showVariante);
    const result = await provider.consultar(comprobante as any, config as any);

    expect(result.aceptado).toBe(false);
    expect(result.errorCode).toBe('3206');
    expect(result.error).toBe('El comprobante fue registrado previamente');
  });

  it('FALLBACK legacy (data.respuesta_sunat): sigue extrayendo código y mensaje', async () => {
    const showEsperado = {
      success: true,
      data: {
        id: 123,
        estado_sunat: 'RECHAZADO',
        respuesta_sunat: {
          codigo: '2335',
          descripcion: 'El documento ya fue informado dado de baja',
        },
      },
    };

    const provider = nuevoProvider(showEsperado);
    const result = await provider.consultar(comprobante as any, config as any);

    expect(result.aceptado).toBe(false);
    expect(result.errorCode).toBe('2335');
    expect(result.error).toBe('El documento ya fue informado dado de baja');
  });
});
