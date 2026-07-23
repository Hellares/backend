import { IaAgenteService } from './ia.service';

/**
 * Guard 2.5 "venta fantasma" (incidente Rayza 07-21): Haiku cerró una compra
 * fingiendo el flujo completo — "Listo 👍 El sistema validará tu pago" — sin
 * llamar crearVenta, y la clienta yapeó S/1 real contra una venta que jamás
 * existió. El regex es la mitad determinística del guard: caza AFIRMACIONES
 * de pago-en-validación / pedido-registrado (ilegítimas sin ctx.ventaIa) sin
 * frenar el flujo normal de venta (preguntas, montos, instrucciones de pago).
 */
describe('AFIRMA_VENTA_O_PAGO (guard venta fantasma)', () => {
  const re = IaAgenteService.AFIRMA_VENTA_O_PAGO;

  it.each([
    // Las frases REALES del incidente:
    'Listo 👍 El sistema validará tu pago',
    'Tu pago está validándose... perfecto, ya estamos validando tu yape',
    // Variantes plausibles del mismo cierre fantasma:
    'Tu pago está siendo validado por el sistema',
    'El pago se validará en unos minutos',
    'Tu yape está en proceso de validación',
    'Tu pago ya está confirmado ✅',
    'Tu pedido ya quedó registrado',
    'Tu compra fue procesada con éxito',
    'La orden ha sido generada',
    'Registré tu pedido, ahora yapea el monto',
    'Creamos tu orden sin problemas',
    'Recibimos tu pago, gracias',
    'Pago recibido ✅',
  ])('caza la afirmación fantasma: «%s»', (frase) => {
    expect(re.test(frase)).toBe(true);
  });

  it.each([
    // Flujo LEGÍTIMO de venta — jamás debe frenarse:
    '¿Deseas que registre tu pedido?',
    'El monto a pagar es S/ 40.07 al número 901168935',
    'Para confirmar tu compra necesito tu DNI',
    '¿Confirmas tu pedido? Responde sí para continuar',
    'Cuando hagas el yape, el sistema lo validará automáticamente',
    'Tenemos el LAPICERO GEL BOIL a S/ 1.00, ¿cuántos llevas?',
    '¿A qué nombre registro la compra?',
  ])('NO frena el flujo legítimo: «%s»', (frase) => {
    expect(re.test(frase)).toBe(false);
  });
});
