import { UsuariosService } from './usuarios.service';

/**
 * Los permisos especiales fuera de catálogo se RECHAZAN.
 *
 * Antes solo se logueaba un warning y se guardaba igual: un `caja.abir` con
 * typo quedaba persistido para siempre, sin conceder nada y sin avisar. Quien
 * investigara después por qué el permiso "no funciona" iba a mirar el rol, el
 * guard y el cálculo — y el problema iba a ser una letra.
 *
 * Importa especialmente porque el catálogo está duplicado a mano entre backend
 * y app: si alguien agrega un permiso de un lado y se olvida del otro, esto
 * tiene que gritar.
 */
describe('UsuariosService — permisos especiales fuera de catálogo', () => {
  let service: UsuariosService;
  let prisma: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  beforeEach(() => {
    prisma = {
      // Si la validación deja pasar, `registrarUsuario` sigue y lo primero que
      // hace es buscar la persona. Cortamos ahí: se prueba el portero.
      persona: {
        findUnique: jest.fn().mockRejectedValue(new Error('LLEGO_A_LA_BD')),
      },
    };

    service = new UsuariosService(
      prisma,
      { checkUsuariosLimit: jest.fn() } as any,
      {} as any,
      logger as any,
      {} as any,
    );
  });

  const registrar = (permisos?: string[]) =>
    service.registrarUsuario('emp-1', {
      dni: '12345678',
      nombres: 'Ana',
      apellidos: 'Pérez',
      rol: 'VENDEDOR',
      permisos,
    } as any);

  it('🔴 un ID con typo se rechaza y no se toca la base', async () => {
    await expect(registrar(['caja.abir'])).rejects.toThrow(
      /no reconocido\(s\): caja\.abir/,
    );
    // Lo importante: falla ANTES de crear nada.
    expect(prisma.persona.findUnique).not.toHaveBeenCalled();
  });

  it('un ID válido pasa el portero', async () => {
    await expect(registrar(['caja.abrir'])).rejects.toThrow('LLEGO_A_LA_BD');
  });

  it('sin permisos no valida nada', async () => {
    await expect(registrar(undefined)).rejects.toThrow('LLEGO_A_LA_BD');
    await expect(registrar([])).rejects.toThrow('LLEGO_A_LA_BD');
  });

  it('con varios inválidos los nombra a todos, sin repetir', async () => {
    await expect(
      registrar(['caja.abir', 'venta.inventado', 'caja.abir']),
    ).rejects.toThrow(/caja\.abir, venta\.inventado/);
  });

  it('un válido junto a uno inválido igual rechaza: no se guarda a medias', async () => {
    await expect(
      registrar(['caja.abrir', 'permiso.fantasma']),
    ).rejects.toThrow(/permiso\.fantasma/);
    expect(prisma.persona.findUnique).not.toHaveBeenCalled();
  });

  it('el mensaje dice cuáles son los IDs válidos', async () => {
    await expect(registrar(['xx'])).rejects.toThrow(/caja\.abrir/);
  });

  it('el drift de catálogo queda en el log, no solo en la respuesta', async () => {
    await expect(registrar(['xx'])).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('fuera de catálogo'),
    );
  });
});
