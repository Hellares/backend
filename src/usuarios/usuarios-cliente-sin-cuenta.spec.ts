import { UsuariosService } from './usuarios.service';

// El CASO 3 hashea el DNI con costo 12: con la suite en paralelo pasaba el
// timeout de jest. Acá no se prueba el hash.
jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hash') }));

/**
 * Dar de alta como trabajador a alguien que YA es cliente de la empresa pero
 * sin cuenta de usuario (se registro solo con su DNI).
 *
 * Caso 19-09 (prod, CARRANZA MERCEDES): un empleado de prueba quedo como
 * cliente; al crearlo como TECNICO, el CASO 3 hacia `empresaPersona.create` y
 * reventaba con el unique (personaId, empresaId). El CASO 1 no lo cubria
 * porque solo promueve a quien tiene EmpresaUsuarioRol CLIENTE.
 */
describe('UsuariosService — cliente sin cuenta dado de alta como trabajador', () => {
  let service: UsuariosService;
  let prisma: any;
  let tx: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  beforeEach(() => {
    tx = {
      sede: { findMany: jest.fn().mockResolvedValue([{ id: 'sede-1' }]) },
      persona: { update: jest.fn() },
      usuario: { create: jest.fn().mockResolvedValue({ id: 'usr-1' }) },
      authProvider: { create: jest.fn() },
      empresaPersona: {
        upsert: jest.fn(),
        create: jest.fn().mockRejectedValue(
          new Error('Unique constraint failed on (personaId, empresaId)'),
        ),
      },
      empresaUsuarioRol: { create: jest.fn() },
      usuarioSedeRol: { createMany: jest.fn() },
    };
    prisma = {
      persona: { findUnique: jest.fn() },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    service = new UsuariosService(
      prisma,
      { checkUsuariosLimit: jest.fn() } as any,
      { invalidateTenantAccess: jest.fn() } as any,
      logger as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'obtenerUsuarioCompleto')
      .mockResolvedValue({ id: 'usr-1' });
  });

  const registrarTecnico = () =>
    service.registrarUsuario(
      'emp-1',
      {
        dni: '40445892',
        nombres: 'Sonia',
        apellidos: 'Marreros',
        rol: 'TECNICO',
        sedeIds: ['sede-1'],
      } as any,
      'admin-1',
    );

  it('🔴 CASO 3: la persona queda como EMPLEADO sin volver a crear EmpresaPersona', async () => {
    prisma.persona.findUnique.mockResolvedValue({ id: 'per-1', usuario: null });

    await expect(registrarTecnico()).resolves.toMatchObject({
      usuario: { id: 'usr-1' },
    });

    expect(tx.empresaPersona.create).not.toHaveBeenCalled();
    expect(tx.empresaPersona.upsert).toHaveBeenCalledWith({
      where: { personaId_empresaId: { personaId: 'per-1', empresaId: 'emp-1' } },
      create: {
        personaId: 'per-1', empresaId: 'emp-1', rol: 'EMPLEADO', isActive: true,
      },
      update: { rol: 'EMPLEADO', isActive: true, deletedAt: null },
    });
    expect(tx.empresaUsuarioRol.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        empresaId: 'emp-1', usuarioId: 'usr-1', rol: 'TECNICO',
      }),
    });
  });

  it('🔴 CASO 2: usuario de otra empresa que aqui es solo cliente, tambien pasa', async () => {
    prisma.persona.findUnique.mockResolvedValue({
      id: 'per-1',
      usuario: { id: 'usr-9', empresas: [] },
    });

    await expect(registrarTecnico()).resolves.toBeDefined();

    expect(tx.empresaPersona.create).not.toHaveBeenCalled();
    expect(tx.empresaPersona.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { personaId_empresaId: { personaId: 'per-1', empresaId: 'emp-1' } },
      }),
    );
    expect(tx.empresaUsuarioRol.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ usuarioId: 'usr-9', rol: 'TECNICO' }),
    });
  });
});
