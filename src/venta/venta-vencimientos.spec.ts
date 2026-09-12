import { VentaService } from './venta.service';
import { inicioDeHoyCalendario } from '../common/utils/date-utils';

/**
 * Candado del guard de VENCIMIENTOS.
 *
 * 🔴 El corte no es "perecedero sí/no": es la distinción de DIGESA/INDECOPI
 * entre una fecha de CADUCIDAD ("no consumir después de") y una de consumo
 * preferente ("mejor antes de"). Lo que se fija acá es que esas dos NO se
 * traten igual:
 *
 *  - CADUCIDAD frena SECO y no ofrece autorización. Vender leche vencida no es
 *    una decisión comercial que un gerente pueda tomar, y una puerta abierta
 *    "por si acaso" se usa un viernes a la noche.
 *  - CONSUMO_PREFERENTE se vende con autorización gerencial.
 *
 * Y que mire los lotes que FEFO va a consumir DE VERDAD, no "si el producto
 * tiene algún lote vencido por ahí".
 */
describe('VentaService · guard de vencimientos', () => {
  let service: VentaService;
  let prisma: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  // Por DÍA de calendario en Perú, como el guard: "ayer" es la medianoche UTC
  // del día anterior, no "hace 24 horas" (eso fallaba entre las 19:00 y las
  // 24:00 de Lima, cuando restar un día no cambia de fecha en UTC).
  const AYER = inicioDeHoyCalendario(-1);
  const HOY = inicioDeHoyCalendario(0);
  const MANANA = inicioDeHoyCalendario(1);

  const lote = (codigo: string, qty: number, vence: Date | null) => ({
    id: `l-${codigo}`,
    codigo,
    cantidadActual: qty,
    precioCosto: 10 as any,
    fechaVencimiento: vence,
  });

  /**
   * @param tipo política del producto (null = no controla vencimiento)
   * @param lotes los que tiene el stock, en orden de antigüedad
   */
  const build = (tipo: string | null, lotes: any[], esAdmin = true) => {
    prisma = {
      producto: {
        findMany: jest.fn().mockResolvedValue(
          tipo
            ? [{ id: 'prod-1', nombre: 'LECHE', tipoVencimiento: tipo, variantes: [] }]
            : [],
        ),
      },
      productoStock: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ps-1', productoId: 'prod-1', varianteId: null, lotes },
        ]),
      },
      empresaUsuarioRol: {
        findFirst: jest.fn().mockResolvedValue(esAdmin ? { id: 'r1' } : null),
      },
      usuarioSedeRol: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    service = new VentaService(
      prisma, null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any,
      null as any, logger as any, null as any,
      null as any, null as any,
    );
  };

  const validar = (cantidad = 1, autorizadoPorId: string | null = null) =>
    (service as any).validarVencimientos(
      // En producción es la transacción de la venta: el guard lee el mismo
      // snapshot que el cobro.
      prisma,
      [{ descripcion: 'LECHE 1L', productoId: 'prod-1', varianteId: null, cantidad }],
      'sede-1',
      autorizadoPorId,
      'emp-1',
    );

  it('un producto que NO controla vencimiento ni se consulta', async () => {
    build(null, [lote('L1', 10, AYER)]);

    await expect(validar()).resolves.toBeUndefined();
    // Se corta antes de mirar stock: el caso de casi todo el catálogo no paga
    // ni una query de más.
    expect(prisma.productoStock.findMany).not.toHaveBeenCalled();
  });

  it('🔴 CADUCIDAD vencido: frena SECO y dice qué hacer', async () => {
    build('CADUCIDAD', [lote('L1', 10, AYER)]);

    await expect(validar()).rejects.toMatchObject({
      response: {
        code: 'VENTA_PRODUCTO_VENCIDO',
        // El mensaje nombra el lote y la salida real: merma o corregir la
        // fecha. Nunca "pedí autorización", porque no la hay.
        message: expect.stringContaining('L1'),
      },
    });
  });

  it('🔴 CADUCIDAD no se puede autorizar NI SIENDO ADMIN', async () => {
    build('CADUCIDAD', [lote('L1', 10, AYER)]);

    // Con autorizador en mano igual rebota: no hay puerta.
    await expect(validar(1, 'admin-1')).rejects.toMatchObject({
      response: { code: 'VENTA_PRODUCTO_VENCIDO' },
    });
  });

  it('CONSUMO_PREFERENTE vencido SIN autorización: pide autorización', async () => {
    build('CONSUMO_PREFERENTE', [lote('L1', 10, AYER)]);

    await expect(validar()).rejects.toMatchObject({
      response: { code: 'VENTA_VENCIDO_NO_AUTORIZADA' },
    });
  });

  it('CONSUMO_PREFERENTE vencido CON autorización gerencial: pasa', async () => {
    build('CONSUMO_PREFERENTE', [lote('L1', 10, AYER)], true);

    await expect(validar(1, 'admin-1')).resolves.toBeUndefined();
  });

  it('CONSUMO_PREFERENTE: un autorizador SIN rol gerencial no alcanza', async () => {
    build('CONSUMO_PREFERENTE', [lote('L1', 10, AYER)], false);

    await expect(validar(1, 'cajero-1')).rejects.toThrow(/no tiene rol para hacerlo/);
  });

  it('🔑 el que vence HOY todavía se vende: el envase vale el día entero', async () => {
    // "VENCE 01/10" es válido el 01/10. Comparar contra el instante actual lo
    // bloqueaba desde las 19:00 del 30/09 (medianoche UTC = 19:00 Lima).
    build('CADUCIDAD', [lote('L1', 10, HOY)]);

    await expect(validar()).resolves.toBeUndefined();
  });

  it('lote vigente: no molesta a nadie', async () => {
    build('CADUCIDAD', [lote('L1', 10, MANANA)]);

    await expect(validar(5)).resolves.toBeUndefined();
  });

  it('🔑 mira los lotes que FEFO VA A CONSUMIR, no "si hay alguno vencido"', async () => {
    // El vencido tiene 3 unidades y sale PRIMERO por FEFO. Vender 2 lo toca.
    build('CADUCIDAD', [lote('VENCIDO', 3, AYER), lote('SANO', 10, MANANA)]);
    await expect(validar(2)).rejects.toMatchObject({
      response: { code: 'VENTA_PRODUCTO_VENCIDO' },
    });
  });

  it('🔑 sin lotes vencidos en el tramo consumido, no frena', async () => {
    // El vencido ya se agotó (0 unidades): FEFO no lo toca y la venta pasa.
    build('CADUCIDAD', [lote('VENCIDO', 0, AYER), lote('SANO', 10, MANANA)]);

    await expect(validar(4)).resolves.toBeUndefined();
  });

  it('una línea sin producto (servicio) no se mira', async () => {
    build('CADUCIDAD', [lote('L1', 10, AYER)]);

    await expect(
      (service as any).validarVencimientos(
        prisma,
        [{ descripcion: 'SERVICIO', cantidad: 1 }],
        'sede-1',
        null,
        'emp-1',
      ),
    ).resolves.toBeUndefined();
    expect(prisma.producto.findMany).not.toHaveBeenCalled();
  });
});
