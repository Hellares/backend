import { VentaService } from './venta.service';

/**
 * Tests del helper `construirPagosParaCaja` — la pieza que decide cuánto se
 * registra en caja por cada método de pago a partir de los pagos de la venta.
 *
 * Invariante central que garantiza que la caja SIEMPRE cuadre al cerrar:
 *   Σ(montos registrados en caja) === totalACobrar
 * y, por la regla de negocio "el vuelto sale del efectivo":
 *   efectivo neto === efectivo recibido − vuelto   (digitales a valor nominal)
 *
 * El helper es puro (no usa `this`), por eso lo invocamos sobre el prototype
 * sin instanciar el servicio (que tiene muchas dependencias inyectadas).
 */
describe('VentaService.construirPagosParaCaja', () => {
  // Bind a un `this` vacío: el método no referencia instancia.
  const construir: (
    pagos: Array<{ metodoPago: string; monto: number }>,
    totalACobrar: number,
    vuelto: number,
  ) => Array<{ metodoPago: string; monto: number }> = (
    VentaService.prototype as any
  )['construirPagosParaCaja'].bind({});

  const sum = (movs: Array<{ monto: number }>) =>
    Math.round(movs.reduce((s, m) => s + m.monto, 0) * 100) / 100;

  const efectivo = (movs: Array<{ metodoPago: string; monto: number }>) =>
    movs.filter((m) => m.metodoPago === 'EFECTIVO').reduce((s, m) => s + m.monto, 0);

  /**
   * Cada caso describe lo que llega del front (pagos con EFECTIVO en BRUTO =
   * lo recibido), el total a cobrar y el vuelto entregado. Esperamos el
   * desglose neto que debe quedar en caja.
   */
  const casos: Array<{
    nombre: string;
    pagos: Array<{ metodoPago: string; monto: number }>;
    total: number;
    vuelto: number;
    esperado: Array<{ metodoPago: string; monto: number }>;
  }> = [
    {
      nombre: 'Efectivo exacto, sin vuelto',
      pagos: [{ metodoPago: 'EFECTIVO', monto: 50 }],
      total: 50,
      vuelto: 0,
      esperado: [{ metodoPago: 'EFECTIVO', monto: 50 }],
    },
    {
      nombre: 'Efectivo con vuelto (recibió 100, total 50)',
      pagos: [{ metodoPago: 'EFECTIVO', monto: 100 }],
      total: 50,
      vuelto: 50,
      esperado: [{ metodoPago: 'EFECTIVO', monto: 50 }],
    },
    {
      nombre: 'Digital (Yape) exacto, nunca da vuelto',
      pagos: [{ metodoPago: 'YAPE', monto: 100 }],
      total: 100,
      vuelto: 0,
      esperado: [{ metodoPago: 'YAPE', monto: 100 }],
    },
    {
      nombre: 'MIXTO efectivo+Yape exacto (efectivo ya neto)',
      pagos: [
        { metodoPago: 'EFECTIVO', monto: 69.7 },
        { metodoPago: 'YAPE', monto: 141 },
      ],
      total: 210.7,
      vuelto: 0,
      esperado: [
        { metodoPago: 'EFECTIVO', monto: 69.7 },
        { metodoPago: 'YAPE', monto: 141 },
      ],
    },
    {
      // El bug original: VTA-SED-00000348. El vuelto debe salir del efectivo,
      // NO recortarse del Yape.
      nombre: 'MIXTO efectivo+Yape con vuelto (caso del bug)',
      pagos: [
        { metodoPago: 'EFECTIVO', monto: 100 },
        { metodoPago: 'YAPE', monto: 141 },
      ],
      total: 210.7,
      vuelto: 30.3,
      esperado: [
        { metodoPago: 'EFECTIVO', monto: 69.7 },
        { metodoPago: 'YAPE', monto: 141 },
      ],
    },
    {
      nombre: 'MIXTO con Yape PRIMERO y efectivo después (independiente del orden)',
      pagos: [
        { metodoPago: 'YAPE', monto: 141 },
        { metodoPago: 'EFECTIVO', monto: 100 },
      ],
      total: 210.7,
      vuelto: 30.3,
      esperado: [
        { metodoPago: 'YAPE', monto: 141 },
        { metodoPago: 'EFECTIVO', monto: 69.7 },
      ],
    },
    {
      nombre: 'MIXTO tarjeta+efectivo con vuelto',
      pagos: [
        { metodoPago: 'TARJETA', monto: 50 },
        { metodoPago: 'EFECTIVO', monto: 50 },
      ],
      total: 80,
      vuelto: 20,
      esperado: [
        { metodoPago: 'TARJETA', monto: 50 },
        { metodoPago: 'EFECTIVO', monto: 30 },
      ],
    },
    {
      nombre: 'Dos líneas de efectivo, vuelto consume de la primera',
      pagos: [
        { metodoPago: 'EFECTIVO', monto: 60 },
        { metodoPago: 'EFECTIVO', monto: 60 },
      ],
      total: 100,
      vuelto: 20,
      esperado: [
        { metodoPago: 'EFECTIVO', monto: 40 },
        { metodoPago: 'EFECTIVO', monto: 60 },
      ],
    },
    {
      nombre: 'Vuelto mayor que la primera línea de efectivo (se reparte)',
      // recibido 110 (10 + 100), total 90, vuelto 20
      pagos: [
        { metodoPago: 'EFECTIVO', monto: 10 },
        { metodoPago: 'EFECTIVO', monto: 100 },
      ],
      total: 90,
      vuelto: 20,
      // 10 − 10 = 0 (se filtra), resto vuelto 10 → 100 − 10 = 90
      esperado: [{ metodoPago: 'EFECTIVO', monto: 90 }],
    },
    {
      nombre: 'Montos con decimales (sin artefactos de punto flotante)',
      // recibido 63.33 (50 + 13.33), total 33.33, vuelto 30
      pagos: [
        { metodoPago: 'EFECTIVO', monto: 50 },
        { metodoPago: 'YAPE', monto: 13.33 },
      ],
      total: 33.33,
      vuelto: 30,
      esperado: [
        { metodoPago: 'EFECTIVO', monto: 20 },
        { metodoPago: 'YAPE', monto: 13.33 },
      ],
    },
    {
      nombre: 'Híbrido contado+crédito: la línea CREDITO se ignora en caja',
      pagos: [
        { metodoPago: 'EFECTIVO', monto: 60 },
        { metodoPago: 'CREDITO', monto: 40 },
      ],
      total: 60, // totalACobrar = solo lo del día
      vuelto: 0,
      esperado: [{ metodoPago: 'EFECTIVO', monto: 60 }],
    },
    {
      // Safety net: sin vuelto declarado pero los pagos exceden el total.
      // El excedente lo absorbe el EFECTIVO, nunca el digital.
      nombre: 'Safety: excedente sin vuelto declarado se recorta del efectivo',
      pagos: [
        { metodoPago: 'EFECTIVO', monto: 100 },
        { metodoPago: 'YAPE', monto: 50 },
      ],
      total: 120,
      vuelto: 0,
      esperado: [
        { metodoPago: 'EFECTIVO', monto: 70 },
        { metodoPago: 'YAPE', monto: 50 },
      ],
    },
  ];

  it.each(casos)('$nombre', ({ pagos, total, vuelto, esperado }) => {
    const resultado = construir(pagos, total, vuelto);

    // 1) Desglose por método correcto (orden incluido)
    expect(resultado).toEqual(esperado);

    // 2) Invariante de cuadre: lo registrado en caja == lo cobrado
    expect(sum(resultado)).toBeCloseTo(total, 2);

    // 3) El digital nunca queda por encima de su valor nominal recibido
    for (const mov of resultado) {
      if (mov.metodoPago !== 'EFECTIVO') {
        const recibidoDigital = pagos
          .filter((p) => p.metodoPago === mov.metodoPago)
          .reduce((s, p) => s + p.monto, 0);
        expect(mov.monto).toBeLessThanOrEqual(recibidoDigital + 1e-9);
      }
    }
  });

  it('el efectivo neto == efectivo recibido − vuelto (regla del vuelto)', () => {
    const pagos = [
      { metodoPago: 'EFECTIVO', monto: 100 },
      { metodoPago: 'YAPE', monto: 141 },
    ];
    const vuelto = 30.3;
    const recibidoEfectivo = 100;
    const resultado = construir(pagos, 210.7, vuelto);
    expect(efectivo(resultado)).toBeCloseTo(recibidoEfectivo - vuelto, 2);
  });

  it('nunca registra montos negativos ni en cero', () => {
    // recibido 110, total 90, vuelto 20: la línea de 10 se anula y se filtra
    const resultado = construir(
      [
        { metodoPago: 'EFECTIVO', monto: 10 },
        { metodoPago: 'EFECTIVO', monto: 100 },
      ],
      90,
      20,
    );
    for (const mov of resultado) expect(mov.monto).toBeGreaterThan(0);
  });
});
