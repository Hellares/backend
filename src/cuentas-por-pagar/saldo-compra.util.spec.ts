import {
  diferenciaDeCambio,
  montoQueCancela,
  saldoCompra,
  totalPagadoCompra,
  totalPagadoSoles,
} from './saldo-compra.util';

/**
 * La deuda con el proveedor cuando la factura viene en otra moneda.
 *
 * El caso real: la empresa no maneja dolares pero su proveedor factura en
 * dolares. La compra vale US$242.49 al TC 3.712 del dia (S/900.12 de costo,
 * congelado). Cuando la paga, el dolar esta 3.755 y salen S/910.55 de la caja.
 * La deuda se cancela entera; los S/10.43 de mas son diferencia de cambio.
 */
describe('saldo de una compra — misma moneda (el camino de siempre)', () => {
  it('sin montoAplicado, lo que cancela es el monto', () => {
    expect(montoQueCancela({ monto: 900 })).toBe(900);
    expect(saldoCompra(1000, [{ monto: 900 }])).toBe(100);
  });

  it('los pagos anulados no cuentan', () => {
    const saldo = saldoCompra(1000, [
      { monto: 400 },
      { monto: 600, anulado: true },
    ]);
    expect(saldo).toBe(600);
  });

  it('sin pagos el saldo es el total', () => {
    expect(saldoCompra(242.49, [])).toBe(242.49);
    expect(totalPagadoCompra([])).toBe(0);
  });
});

describe('saldo de una compra — en dolares pagada en soles', () => {
  // S/910.55 salen de la caja y cancelan US$242.49 al TC 3.755.
  const pago = { monto: 910.55, montoAplicado: 242.49, tipoCambio: 3.755 };

  it('🔴 el saldo se mide con lo que CANCELA, no con los soles que salen', () => {
    expect(montoQueCancela(pago)).toBe(242.49);
    expect(saldoCompra(242.49, [pago])).toBe(0);
  });

  it('restar los soles dejaria la deuda pagada de mas', () => {
    // Lo que hacia el codigo viejo: 242.49 - 910.55 = -668.06.
    const conElBug = 242.49 - Number(pago.monto);
    expect(conElBug).toBeLessThan(0);
    expect(saldoCompra(242.49, [pago])).toBe(0); // lo correcto
  });

  it('un pago parcial deja el saldo en dolares', () => {
    const parcial = { monto: 375.5, montoAplicado: 100, tipoCambio: 3.755 };
    expect(saldoCompra(242.49, [parcial])).toBe(142.49);
  });

  it('la caja ve los soles, la deuda ve los dolares', () => {
    expect(totalPagadoSoles([pago])).toBe(910.55);
    expect(totalPagadoCompra([pago])).toBe(242.49);
  });
});

describe('diferencia de cambio', () => {
  const pago = { monto: 910.55, montoAplicado: 242.49, tipoCambio: 3.755 };

  it('pagar con el dolar mas caro es una PERDIDA', () => {
    // Costo congelado S/900.12 (TC 3.712); salieron S/910.55 (TC 3.755).
    expect(diferenciaDeCambio(242.49, 900.12, [pago])).toBe(10.43);
  });

  it('pagar con el dolar mas barato es una GANANCIA', () => {
    const barato = { monto: 880, montoAplicado: 242.49, tipoCambio: 3.629 };
    expect(diferenciaDeCambio(242.49, 900.12, [barato])).toBe(-20.12);
  });

  it('mientras falte plata NO hay diferencia de cambio, hay saldo', () => {
    const parcial = { monto: 375.5, montoAplicado: 100, tipoCambio: 3.755 };
    expect(saldoCompra(242.49, [parcial])).toBe(142.49);
    expect(diferenciaDeCambio(242.49, 900.12, [parcial])).toBe(0);
  });

  it('una compra en soles nunca tiene diferencia de cambio', () => {
    expect(diferenciaDeCambio(900, 900, [{ monto: 900 }])).toBe(0);
  });
});
