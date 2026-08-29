import { VentaService } from './venta.service';

/**
 * Quién puede autorizar la anulación de una venta — validado en el SERVIDOR.
 *
 * `autorizadoPorId` llega en el body. El front lo obtiene de
 * `/auth/autorizar-operacion` (que valida DNI + contraseña), pero eso es una
 * defensa de UI: sin este chequeo, un cliente modificado podía mandar el id de
 * cualquiera y dejar la venta anulada "autorizada" por un cajero.
 *
 * Las dos vías que tienen que seguir funcionando:
 *  - Un ADMIN que anula directo manda su PROPIO id (no se le piden
 *    credenciales) → pasa, porque tiene el rol.
 *  - Un cajero pide autorización a un gerente → llega el id del gerente → pasa.
 */
describe('VentaService.anular — validación del autorizador', () => {
  let service: VentaService;
  let prisma: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  /**
   * @param empresaRol fila devuelta por EmpresaUsuarioRol (null = no es admin)
   * @param sedeRol    fila devuelta por UsuarioSedeRol (null = sin rol gerencial)
   */
  const build = (empresaRol: unknown, sedeRol: unknown) => {
    prisma = {
      empresaUsuarioRol: { findFirst: jest.fn().mockResolvedValue(empresaRol) },
      usuarioSedeRol: { findFirst: jest.fn().mockResolvedValue(sedeRol) },
      // Si la validación deja pasar, `anular` sigue y abre la transacción.
      // La cortamos ahí: lo que se prueba es el portero, no el reverso.
      $transaction: jest.fn().mockRejectedValue(new Error('LLEGO_A_LA_TX')),
    };

    service = new VentaService(
      prisma, null as any, null as any, null as any, null as any,
      null as any, null as any, null as any, null as any,
      null as any, logger as any, null as any,
    );
  };

  const anular = (dto?: { autorizadoPorId: string; motivo: string }, opts?: any) =>
    service.anular('vta-1', 'emp-1', 'cajero-1', dto, opts);

  const dto = { autorizadoPorId: 'user-1', motivo: 'Error de tipeo' };

  it('🔴 un autorizador sin rol NO puede anular, y no se toca nada', async () => {
    build(null, null);

    await expect(anular(dto)).rejects.toThrow(/no tiene rol para hacerlo/);
    // Lo importante: se corta ANTES de abrir la transacción, así que no se
    // revierte stock ni caja de una anulación que no estaba autorizada.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('el ADMIN que anula directo se autoriza a sí mismo y pasa', async () => {
    build({ id: 'rol-1' }, null);

    // Pasa el portero y muere en la transacción, que es hasta donde llega
    // este test.
    await expect(anular(dto)).rejects.toThrow('LLEGO_A_LA_TX');
    expect(prisma.empresaUsuarioRol.findFirst).toHaveBeenCalled();
  });

  it('un GERENTE_SEDE (sin rol de empresa) también puede autorizar', async () => {
    build(null, { id: 'sederol-1' });

    await expect(anular(dto)).rejects.toThrow('LLEGO_A_LA_TX');
  });

  it('busca el rol de empresa por el AUTORIZADOR, no por quien opera', async () => {
    build({ id: 'rol-1' }, null);

    await expect(anular(dto)).rejects.toThrow('LLEGO_A_LA_TX');
    expect(prisma.empresaUsuarioRol.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          usuarioId: 'user-1', // el autorizador, no 'cajero-1'
          empresaId: 'emp-1',
          rol: { in: ['SUPER_ADMIN', 'EMPRESA_ADMIN'] },
        }),
      }),
    );
  });

  it('el cron de Yape anula sin autorizador y no se le pide ninguno', async () => {
    build(null, null);

    // Sin dto (anulación por TTL): no hay humano que autorice, así que la
    // validación no aplica y el flujo sigue.
    await expect(
      anular(undefined, { soloSiPendienteSinPagos: true }),
    ).rejects.toThrow('LLEGO_A_LA_TX');
    expect(prisma.empresaUsuarioRol.findFirst).not.toHaveBeenCalled();
  });
});
