import { UsuariosService } from './usuarios.service';
import {
  ELEMENTOS_OCULTABLES,
  VALID_ELEMENTO_OCULTABLE_IDS,
} from '../auth/services/elementos-ocultables.catalog';

/**
 * Los elementos a ocultar fuera de catalogo se RECHAZAN.
 *
 * `accesosRapidosOcultos` guarda dos familias en una sola lista: los 21
 * botones del dashboard y los items del menu lateral (prefijo `menu.`). Antes
 * no se validaba nada, asi que un id inventado se guardaba en silencio y el
 * elemento seguia apareciendo sin ninguna pista de por que.
 *
 * A diferencia de los permisos granulares, esto no autoriza: oculta. Un id
 * malo no abre ninguna puerta, pero deja al admin creyendo que configuro algo
 * que no configuro.
 */
describe('UsuariosService — elementos ocultables fuera de catalogo', () => {
  let service: UsuariosService;
  let prisma: any;

  const logger = {
    setContext: jest.fn(), info: jest.fn(), warn: jest.fn(),
    log: jest.fn(), error: jest.fn(), success: jest.fn(),
  };

  beforeEach(() => {
    prisma = {
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
      {} as any,
    );
  });

  const registrar = (ocultos?: string[]) =>
    service.registrarUsuario('emp-1', {
      dni: '12345678',
      nombres: 'Ana',
      apellidos: 'Perez',
      rol: 'CAJERO',
      accesosRapidosOcultos: ocultos,
    } as any);

  it('🔴 un id inventado se rechaza y no se toca la base', async () => {
    await expect(registrar(['no-existe'])).rejects.toThrow(
      /no reconocido\(s\): no-existe/,
    );
    expect(prisma.persona.findUnique).not.toHaveBeenCalled();
  });

  it('un id del DASHBOARD pasa', async () => {
    await expect(registrar(['cotizaciones'])).rejects.toThrow('LLEGO_A_LA_BD');
  });

  it('un id del MENU pasa', async () => {
    await expect(registrar(['menu.inventario.kardex'])).rejects.toThrow(
      'LLEGO_A_LA_BD',
    );
  });

  it('sin nada que ocultar no valida', async () => {
    await expect(registrar(undefined)).rejects.toThrow('LLEGO_A_LA_BD');
    await expect(registrar([])).rejects.toThrow('LLEGO_A_LA_BD');
  });

  it('uno valido junto a uno invalido rechaza todo: no se guarda a medias', async () => {
    await expect(registrar(['caja', 'inventado'])).rejects.toThrow(/inventado/);
    expect(prisma.persona.findUnique).not.toHaveBeenCalled();
  });

  it('el catalogo no tiene ids repetidos', () => {
    expect(ELEMENTOS_OCULTABLES.length).toBe(VALID_ELEMENTO_OCULTABLE_IDS.size);
  });

  it('🔴 los ids del menu van prefijados, para no chocar con los del dashboard', () => {
    // Un choque haria que ocultar un boton del dashboard escondiera un item de
    // menu que no tiene nada que ver.
    const menu = ELEMENTOS_OCULTABLES.filter((id) => id.startsWith('menu.'));
    const dashboard = ELEMENTOS_OCULTABLES.filter(
      (id) => !id.startsWith('menu.'),
    );
    expect(menu.length).toBe(36);
    expect(dashboard.length).toBe(21);
    for (const id of dashboard) {
      expect(menu).not.toContain(id);
    }
  });
});
