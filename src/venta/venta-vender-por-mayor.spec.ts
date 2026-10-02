import { BadRequestException } from '@nestjs/common';
import { VentaService } from './venta.service';

/**
 * Candado de "vender por mayor" en el embudo de precios de la venta.
 *
 * A diferencia de vender a costo, acá el precio SÍ sale de los niveles (con el
 * escalón forzado) y SÍ pasa por el guard de divergencia. Lo que se fija:
 *
 *  1. La línea marcada le pide al cálculo `forzarMayor`; las demás no.
 *  2. Exige el mismo granular que el costo (`venta.editar-precio`).
 *  3. A costo y por mayor en la misma línea, o sobre un servicio: rechazado.
 *  4. El precio del cliente tiene que coincidir con el del servidor (409).
 *  5. Un nivel elegido que ya no existe NO cae al precio del cliente.
 */
describe('VentaService · vender por mayor', () => {
  let service: VentaService;
  let precioNivel: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  const calc = (precioUnitario: number, nivelAplicado: string) => ({
    precioUnitario,
    precioBase: 75,
    precioPublico: 75,
    precioCosto: 60,
    nivelAplicado,
    motivoLiquidacion: null,
    descuentoAplicado: 0,
    vipAplicado: false,
    vipPoliticaId: null,
  });

  const buildService = (puedeEditarPrecio = true) => {
    const prisma = {
      producto: { findMany: jest.fn().mockResolvedValue([]) },
      productoVariante: { findMany: jest.fn().mockResolvedValue([]) },
      empresaUsuarioRol: { findMany: jest.fn().mockResolvedValue([{ rol: 'EMPRESA_ADMIN' }]) },
      usuarioSedeRol: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const permissions = {
      calculatePermissions: jest.fn().mockReturnValue({
        canEditarPrecioVenta: puedeEditarPrecio,
      }),
    };
    precioNivel = {
      calcularCantidadesGrupoMayoreo: jest.fn().mockResolvedValue(new Map()),
      // El servidor: forzado paga 72 (o 70 con el nivel n-6), sin forzar 75.
      calcularPrecioSegunCantidad: jest.fn().mockImplementation(
        async (_p: any, _v: any, _s: any, _c: any, opts: any) => {
          if (!opts?.forzarMayor) return calc(75, 'Precio base');
          if (opts.forzarMayor.nivelId === 'n-borrado') {
            throw new BadRequestException({ code: 'NIVEL_MAYOR_NO_DISPONIBLE', message: 'x' });
          }
          return opts.forzarMayor.nivelId === 'n-6'
            ? calc(70, 'Mayorista (manual)')
            : calc(72, 'Por Mayor (manual)');
        },
      ),
    };
    service = new VentaService(
      prisma as any, null as any, null as any, null as any, null as any,
      null as any, null as any, precioNivel as any, null as any,
      null as any, logger as any, null as any,
      { costosDeItems: jest.fn().mockResolvedValue(new Map()) } as any,
      permissions as any,
    );
  };

  const aplicar = (detalles: any[]) =>
    (service as any).aplicarPreciosBackendNivel(detalles, 'sede-1', null, {
      empresaId: 'emp-1',
      usuarioId: 'user-1',
    });

  const linea = (extra: any = {}) => ({
    varianteId: 'v-alianza',
    descripcion: 'EDREDON ALIANZA',
    cantidad: 1,
    precioUnitario: 72,
    precioPorMayor: true,
    ...extra,
  });

  beforeEach(() => jest.clearAllMocks());

  it('1 unidad marcada por mayor cobra el precio por mayor y lo deja escrito', async () => {
    buildService();
    const [out] = await aplicar([linea()]);
    expect(out.precioUnitario).toBe(72);
    expect(out.nivelAplicadoSnapshot).toBe('Por Mayor (manual)');
  });

  it('mixto: solo la línea marcada se fuerza', async () => {
    buildService();
    const [mayor, normal] = await aplicar([
      linea(),
      linea({ varianteId: 'v-snoopy', precioPorMayor: undefined, precioUnitario: 75 }),
    ]);
    expect(mayor.precioUnitario).toBe(72);
    expect(normal.precioUnitario).toBe(75);
    const llamadas = precioNivel.calcularPrecioSegunCantidad.mock.calls;
    expect(llamadas[0][4].forzarMayor).toEqual({ nivelId: null });
    expect(llamadas[1][4].forzarMayor).toBeUndefined();
  });

  it('el nivel elegido viaja al cálculo', async () => {
    buildService();
    const [out] = await aplicar([linea({ precioNivelId: 'n-6', precioUnitario: 70 })]);
    expect(out.precioUnitario).toBe(70);
  });

  it('🔴 el precio del cliente se valida: uno inventado rebota con 409', async () => {
    buildService();
    await expect(aplicar([linea({ precioUnitario: 50 })])).rejects.toMatchObject({
      response: { code: 'PRECIO_DESACTUALIZADO' },
    });
  });

  it('🔴 un nivel que ya no existe NO cae al precio del cliente', async () => {
    buildService();
    await expect(
      aplicar([linea({ precioNivelId: 'n-borrado', precioUnitario: 1 })]),
    ).rejects.toMatchObject({ response: { code: 'NIVEL_MAYOR_NO_DISPONIBLE' } });
  });

  it('sin el permiso de cambiar precio, rechazado', async () => {
    buildService(false);
    await expect(aplicar([linea()])).rejects.toMatchObject({
      response: { code: 'SIN_PERMISO_VENDER_POR_MAYOR' },
    });
  });

  it('a costo y por mayor en la misma línea, rechazado', async () => {
    buildService();
    await expect(
      aplicar([linea({ precioModo: 'COSTO_LOTE' })]),
    ).rejects.toThrow(/a costo y por mayor a la vez/);
  });

  it('un servicio no tiene precio por mayor', async () => {
    buildService();
    await expect(
      aplicar([linea({ varianteId: undefined, servicioId: 'srv-1' })]),
    ).rejects.toThrow(/no tiene precio por mayor/);
  });
});
