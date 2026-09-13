import { VentaService } from './venta.service';
import { CostoVentaService } from '../producto/costo-venta.service';

/**
 * Candado de "vender a costo".
 *
 * Lo que se fija acá es el cortocircuito de `aplicarPreciosBackendNivel`: la
 * línea que llega con `precioModo` NO pasa por los niveles de precio ni por el
 * guard de divergencia — el precio lo pone el servidor desde el costo de la
 * compra.
 *
 * Cuatro cosas que no pueden romperse:
 *
 *  1. El precio sale del COSTO y el que mandó el cliente se ignora, sin 409.
 *     Si esto se rompiera comparando contra `precioUnitario`, el modo entero
 *     sería inusable: toda venta a costo rebotaría con PRECIO_DESACTUALIZADO.
 *  2. `precioCostoSnapshot` sigue siendo el costo PROMEDIO del inventario, no
 *     el que se cobró. Es el número con el que el kardex valora la salida, y
 *     pisarlo desalinearía el margen reportado del COGS.
 *  3. Sin costo NO se cae al precio de lista: revienta con un error explícito.
 *     Cobrarle lista a un cliente al que se le prometió costo es el peor final.
 *  4. El costo NUNCA queda por encima del precio público vigente. Con el
 *     producto en liquidación por debajo del costo, prender el interruptor le
 *     SUBÍA el precio al cliente (ventas 912/913 de beta).
 */
describe('VentaService · vender a costo', () => {
  let service: VentaService;
  let prisma: any;
  let costoVenta: any;
  let permissions: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  /**
   * Un ítem con los tres costos. El lote sale más barato que el promedio a
   * propósito: es el caso que hace dar margen NEGATIVO y el que tiene que
   * quedar exento del guard de venta bajo costo.
   */
  const COSTOS = {
    productoId: 'prod-1',
    varianteId: null,
    costoPromedio: 141.8,
    costoLote: 132.5,
    costoLoteSinFlete: 130.0,
    origen: null,
  };

  /**
   * Lo que el cliente pagaría SIN el interruptor. Por defecto muy por encima
   * del costo —el caso normal— así que el techo no toca nada; los tests que
   * lo necesitan bajan `precioUnitario` a mano.
   */
  const PRECIO_PUBLICO = {
    precioUnitario: 189,
    precioBase: 189,
    precioPublico: 189,
    precioCosto: 141.8,
    nivelAplicado: 'Precio base',
    motivoLiquidacion: null,
    descuentoAplicado: 0,
    vipAplicado: false,
    vipPoliticaId: null,
  };

  const buildService = (
    costos: Map<string, any>,
    puedeEditarPrecio = true,
    precioPublico: any = PRECIO_PUBLICO,
  ) => {
    prisma = {
      producto: { findMany: jest.fn().mockResolvedValue([]) },
      productoVariante: { findMany: jest.fn().mockResolvedValue([]) },
      empresaUsuarioRol: { findMany: jest.fn().mockResolvedValue([{ rol: 'EMPRESA_ADMIN' }]) },
      usuarioSedeRol: { findMany: jest.fn().mockResolvedValue([]) },
    };
    costoVenta = { costosDeItems: jest.fn().mockResolvedValue(costos) };
    permissions = {
      calculatePermissions: jest.fn().mockReturnValue({
        canEditarPrecioVenta: puedeEditarPrecio,
      }),
    };
    // El mapa de mayoreo combinado se calcula UNA vez para todo el carrito,
    // antes del loop y también cuando ninguna línea usa niveles.
    const precioNivel = {
      calcularCantidadesGrupoMayoreo: jest.fn().mockResolvedValue(new Map()),
      // 🔑 La línea a costo TAMBIÉN lo consulta ahora: es el techo contra el
      // que se compara. Lo que sigue sin hacer es entrar al guard de
      // divergencia, que es lo que la rebotaría con 409.
      calcularPrecioSegunCantidad: precioPublico?.__rechaza
        ? jest.fn().mockRejectedValue(new Error('sin precio en la sede'))
        : jest.fn().mockResolvedValue(precioPublico),
    };
    service = new VentaService(
      prisma, null as any, null as any, null as any, null as any,
      null as any, null as any, precioNivel as any, null as any,
      null as any, logger as any, null as any,
      costoVenta as any, permissions as any,
    );
  };

  // La clave es por LÍNEA (producto + lote elegido); sin lote, la parte del
  // lote va vacía.
  const conCosto = () =>
    new Map([[CostoVentaService.claveDeLinea('prod-1', null, null), COSTOS]]);

  /** Atajo al embudo privado por el que pasan los tres flujos de venta. */
  const aplicar = (detalles: any[]) =>
    (service as any).aplicarPreciosBackendNivel(detalles, 'sede-1', null, {
      empresaId: 'emp-1',
      usuarioId: 'user-1',
    });

  const linea = (extra: any = {}) => ({
    productoId: 'prod-1',
    descripcion: 'SSD KINGSTON NV2 500GB',
    cantidad: 10,
    // 🔑 Un precio de LISTA a propósito, muy lejos del costo: es lo que el
    // carrito tenía antes de prender el interruptor. Tiene que ser ignorado
    // sin abortar la venta.
    precioUnitario: 189,
    precioModo: 'COSTO_LOTE',
    ...extra,
  });

  beforeEach(() => jest.clearAllMocks());

  it('el precio sale del COSTO DEL LOTE y el del cliente se ignora, sin 409', async () => {
    buildService(conCosto());

    const [out] = await aplicar([linea()]);

    expect(out.precioUnitario).toBe(132.5);
    expect(out.nivelAplicadoSnapshot).toBe('Costo lote');
    expect(out.ventaACosto).toBe(true);
  });

  it('cada modo cobra SU número', async () => {
    buildService(conCosto());

    const [sinFlete] = await aplicar([linea({ precioModo: 'COSTO_LOTE_SIN_FLETE' })]);
    expect(sinFlete.precioUnitario).toBe(130);
    expect(sinFlete.nivelAplicadoSnapshot).toBe('Costo lote s/flete');

    const [promedio] = await aplicar([linea({ precioModo: 'COSTO_PROMEDIO' })]);
    expect(promedio.precioUnitario).toBe(141.8);
    expect(promedio.nivelAplicadoSnapshot).toBe('Costo promedio');
  });

  it('🔑 el snapshot de costo es el PROMEDIO del inventario, no el que se cobró', async () => {
    buildService(conCosto());

    const [out] = await aplicar([linea()]);

    // Cobra 132.50 (el lote) pero valora contra 141.80 (el promedio): así el
    // margen reportado y el COGS del kardex siguen hablando del mismo número.
    expect(out.precioCostoSnapshot).toBe(141.8);
  });

  describe('techo del precio público', () => {
    /**
     * El caso real: ventas 912 y 913 de beta sobre el mismo producto, con 17
     * segundos de diferencia. Lista 500, costo 300, liquidación vigente 250.
     * La 912 (normal) cobró 250 y la 913 (a costo) cobró 300.
     */
    const EN_LIQUIDACION = {
      ...PRECIO_PUBLICO,
      precioUnitario: 250,
      precioBase: 500,
      precioPublico: 250,
      precioCosto: 300,
      nivelAplicado: 'Liquidación',
      motivoLiquidacion: 'FUERA_DE_CAMPANA',
    };

    const costoDe = (monto: number) =>
      new Map([[
        CostoVentaService.claveDeLinea('prod-1', null, null),
        { ...COSTOS, costoPromedio: monto, costoLote: monto, costoLoteSinFlete: monto },
      ]]);

    it('🔴 en liquidación por debajo del costo, cobra la LIQUIDACIÓN y no el costo', async () => {
      buildService(costoDe(300), true, EN_LIQUIDACION);

      const [out] = await aplicar([linea({ cantidad: 1, precioUnitario: 250 })]);

      // Cobraba 300: S/ 50 MÁS que sin tocar el interruptor.
      expect(out.precioUnitario).toBe(250);
      // Se sella lo que REALMENTE se aplicó, con su motivo —que la línea a
      // costo borraba, dejando la venta fuera del reporte de liquidaciones.
      expect(out.nivelAplicadoSnapshot).toBe('Liquidación');
      expect(out.motivoLiquidacionSnapshot).toBe('FUERA_DE_CAMPANA');
      // Y deja de ser "a costo": el precio ya no lo puso el costo, así que no
      // se lleva la exención del guard de venta bajo costo.
      expect(out.ventaACosto).toBe(false);
    });

    it('el costo por debajo del público NO se toca', async () => {
      buildService(conCosto()); // público 189 contra un lote de 132.50

      const [out] = await aplicar([linea()]);

      expect(out.precioUnitario).toBe(132.5);
      expect(out.nivelAplicadoSnapshot).toBe('Costo lote');
      expect(out.ventaACosto).toBe(true);
    });

    it('empatar no es cobrar de más: la línea sigue siendo a costo', async () => {
      buildService(conCosto(), true, { ...PRECIO_PUBLICO, precioUnitario: 132.5 });

      const [out] = await aplicar([linea()]);

      expect(out.precioUnitario).toBe(132.5);
      expect(out.nivelAplicadoSnapshot).toBe('Costo lote');
      expect(out.ventaACosto).toBe(true);
    });

    it('sin precio en la sede no hay techo contra el cual comparar: manda el costo', async () => {
      // Frenar acá una venta que hoy pasa sería peor que dejarla seguir.
      buildService(conCosto(), true, { __rechaza: true });

      const [out] = await aplicar([linea()]);

      expect(out.precioUnitario).toBe(132.5);
      expect(out.ventaACosto).toBe(true);
    });
  });

  it('🔴 una línea a costo con margen negativo NO pide autorización gerencial', async () => {
    buildService(conCosto());

    // Lo que sale de `calcularDetalle`: cobrando 132.50 contra un costo de
    // inventario de 141.80, el margen es −9.30.
    const detalle = {
      descripcion: 'SSD KINGSTON NV2 500GB',
      productoId: 'prod-1',
      varianteId: null,
      cantidad: 10,
      precioUnitario: 132.5,
      descuento: 0,
      precioCostoSnapshot: 141.8,
      margenSnapshot: -9.3,
      motivoLiquidacionSnapshot: null,
      ventaACosto: true,
    };

    await expect(
      (service as any).validarVentaBajoCosto('emp-1', [detalle], null),
    ).resolves.toBeNull();

    // Y sin la marca, la MISMA línea sí frena el cobro: la exención es lo que
    // hace la diferencia, no que el guard se haya aflojado para todos.
    await expect(
      (service as any).validarVentaBajoCosto(
        'emp-1', [{ ...detalle, ventaACosto: false }], null,
      ),
    ).rejects.toMatchObject({
      response: { code: 'VENTA_BAJO_COSTO_NO_AUTORIZADA' },
    });
  });

  it('🔴 sin costo NO cae al precio de lista: revienta explícito', async () => {
    buildService(new Map([[
      CostoVentaService.clave('prod-1', null),
      { ...COSTOS, costoLote: null, costoLoteSinFlete: null },
    ]]));

    await expect(aplicar([linea()])).rejects.toMatchObject({
      response: { code: 'SIN_COSTO_PARA_VENDER_A_COSTO' },
    });
  });

  it('🔴 un costo en CERO es "no cargado", no "gratis"', async () => {
    buildService(new Map([[
      CostoVentaService.clave('prod-1', null),
      { ...COSTOS, costoLote: 0 },
    ]]));

    await expect(aplicar([linea()])).rejects.toMatchObject({
      response: { code: 'SIN_COSTO_PARA_VENDER_A_COSTO' },
    });
  });

  it('🔴 el lote elegido ya no está: 409 LOTE_NO_DISPONIBLE, nunca se recotiza en silencio', async () => {
    // El servidor recotizó y el plan lo encabeza OTRO lote: el elegido se
    // agotó (o se dio de baja) entre cotizar y cobrar. Caer a FEFO y cobrar
    // un número que el cajero no vio es justo lo que este modo no puede hacer.
    buildService(
      new Map([[
        CostoVentaService.claveDeLinea('prod-1', null, 'lote-ceti'),
        { ...COSTOS, loteId: 'lote-ceti', sinCubrir: 0, tramos: [{ loteId: 'lote-deltron', cantidad: 10 }] },
      ]]),
    );

    await expect(aplicar([linea({ loteId: 'lote-ceti' })])).rejects.toMatchObject({
      response: { code: 'LOTE_NO_DISPONIBLE', loteId: 'lote-ceti' },
    });
  });

  it('el lote elegido encabeza el plan: pasa y cobra el costo de ESA línea', async () => {
    buildService(
      new Map([[
        CostoVentaService.claveDeLinea('prod-1', null, 'lote-ceti'),
        { ...COSTOS, loteId: 'lote-ceti', costoLote: 56.17, sinCubrir: 0, tramos: [{ loteId: 'lote-ceti', cantidad: 10 }] },
      ]]),
    );

    const [r] = await aplicar([linea({ loteId: 'lote-ceti' })]);
    expect(r.precioUnitario).toBe(56.17);
  });

  it('no admite descuento en la misma línea', async () => {
    buildService(conCosto());

    await expect(aplicar([linea({ descuento: 1 })])).rejects.toThrow(
      /ya se está vendiendo a costo/,
    );
  });

  it('no admite combos ni componentes de combo ni órdenes de servicio', async () => {
    buildService(conCosto());

    await expect(aplicar([linea({ origenComboId: 'combo-1' })])).rejects.toThrow(/combo/);
    await expect(
      aplicar([linea({ productoId: undefined, ordenServicioId: 'os-1' })]),
    ).rejects.toThrow(/servicio/);
  });

  it('exige el granular venta.editar-precio', async () => {
    buildService(conCosto(), false);

    await expect(aplicar([linea()])).rejects.toMatchObject({
      response: { code: 'SIN_PERMISO_VENDER_A_COSTO' },
    });
  });

  it('sin usuario en mano (edición de borrador) el modo no está disponible', async () => {
    buildService(conCosto());

    await expect(
      (service as any).aplicarPreciosBackendNivel([linea()], 'sede-1'),
    ).rejects.toThrow(/solo está disponible al cobrar/);
  });

  it('una venta SIN líneas a costo no consulta costos ni permisos', async () => {
    buildService(conCosto());

    // Sin `precioModo` no se toca nada del camino nuevo: el flujo normal de
    // venta no paga ni una query de más.
    await aplicar([{ descripcion: 'SERVICIO', cantidad: 1, precioUnitario: 50 }]);

    expect(costoVenta.costosDeItems).not.toHaveBeenCalled();
    expect(permissions.calculatePermissions).not.toHaveBeenCalled();
  });
});
