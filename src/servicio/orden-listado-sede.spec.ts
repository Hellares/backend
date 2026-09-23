import { Rol } from '@prisma/client';
import { OrdenServicioService } from './orden-servicio.service';

/**
 * Scope por SEDE del listado de órdenes.
 *
 * El listado es la única ruta sede-scoped donde la sede puede NO venir en el
 * request: `SedeAccessGuard` valida el `sedeId` que se pide, pero contra un
 * listado pelado no tiene nada que validar y la consulta devolvería todas las
 * sedes de la empresa. Por eso el scope se aplica también en el `where`.
 *
 * Política progresiva (la misma de `SedeAccessGuard` / `OrdenSedeAccessGuard`):
 * admins y usuarios sin asignaciones ven todo; el que tiene sedes asignadas ve
 * esas, más las órdenes legacy sin sede.
 */
const makeSelf = (over: any = {}) => {
  const prisma = {
    ordenServicio: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    mensajeServicio: { groupBy: jest.fn().mockResolvedValue([]) },
    empresaUsuarioRol: { findMany: jest.fn().mockResolvedValue([]) },
    usuarioSedeRol: { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  };
  const findAll = (OrdenServicioService.prototype as any)['findAll'].bind({
    prisma,
  });
  const whereUsado = () => prisma.ordenServicio.findMany.mock.calls[0][0].where;
  return { findAll, prisma, whereUsado };
};

const conSedes = (...sedeIds: string[]) => ({
  usuarioSedeRol: {
    findMany: jest.fn().mockResolvedValue(sedeIds.map((sedeId) => ({ sedeId }))),
  },
});

const staff = { rol: Rol.CAJERO, usuarioId: 'user-1' };

describe('Listado de órdenes — scope por sede', () => {
  it('🔴 sin sedeId en la query, el usuario asignado a sedes solo ve esas (+ las sin sede)', async () => {
    const { findAll, whereUsado } = makeSelf(conSedes('sede-1', 'sede-2'));

    await findAll('emp-1', {}, false, staff);

    expect(whereUsado().AND).toContainEqual({
      OR: [{ sedeId: { in: ['sede-1', 'sede-2'] } }, { sedeId: null }],
    });
  });

  it('🔴 pedir otra sede no se scopea acá: eso lo rechaza SedeAccessGuard con 403', async () => {
    const { findAll, whereUsado, prisma } = makeSelf(conSedes('sede-1'));

    await findAll('emp-1', { sedeId: 'sede-9' }, false, staff);

    expect(whereUsado().sedeId).toBe('sede-9');
    expect(prisma.usuarioSedeRol.findMany).not.toHaveBeenCalled();
  });

  it('usuario sin asignaciones (legacy, sede única) → no se restringe', async () => {
    const { findAll, whereUsado } = makeSelf();

    await findAll('emp-1', {}, false, staff);

    expect(whereUsado().AND ?? []).toEqual([]);
    expect(whereUsado().sedeId).toBeUndefined();
  });

  it('EMPRESA_ADMIN ve todas las sedes de su empresa', async () => {
    const { findAll, whereUsado, prisma } = makeSelf({
      empresaUsuarioRol: {
        findMany: jest.fn().mockResolvedValue([{ rol: Rol.EMPRESA_ADMIN }]),
      },
      ...conSedes('sede-1'),
    });

    await findAll('emp-1', {}, false, {
      rol: Rol.EMPRESA_ADMIN,
      usuarioId: 'admin-1',
    });

    expect(whereUsado().AND ?? []).toEqual([]);
    expect(prisma.usuarioSedeRol.findMany).not.toHaveBeenCalled();
  });

  it('SUPER_ADMIN global tampoco se restringe', async () => {
    const { findAll, whereUsado, prisma } = makeSelf(conSedes('sede-1'));

    await findAll('emp-1', {}, false, {
      ...staff,
      rolGlobal: Rol.SUPER_ADMIN,
    });

    expect(whereUsado().AND ?? []).toEqual([]);
    expect(prisma.empresaUsuarioRol.findMany).not.toHaveBeenCalled();
  });

  it('modo cliente (mis-ordenes) no lleva sede: el cliente ve las suyas de cualquier sede', async () => {
    const { findAll, whereUsado, prisma } = makeSelf(conSedes('sede-1'));

    await findAll('emp-1', { clienteId: 'cli-1' }, true);

    expect(whereUsado().clienteId).toBe('cli-1');
    expect(whereUsado().AND ?? []).toEqual([]);
    expect(prisma.usuarioSedeRol.findMany).not.toHaveBeenCalled();
  });

  it('el scope de sede convive con el del técnico (van los dos en AND)', async () => {
    const { findAll, whereUsado } = makeSelf(conSedes('sede-1'));

    await findAll('emp-1', {}, false, {
      rol: Rol.TECNICO,
      usuarioId: 'tec-1',
    });

    expect(whereUsado().AND).toEqual([
      { OR: [{ tecnicoId: 'tec-1' }, { tecnicoId: null }] },
      { OR: [{ sedeId: { in: ['sede-1'] } }, { sedeId: null }] },
    ]);
  });

  it('el count usa el MISMO where que la búsqueda (si no, el total delata las otras sedes)', async () => {
    const { findAll, prisma } = makeSelf(conSedes('sede-1'));

    await findAll('emp-1', {}, false, staff);

    expect(prisma.ordenServicio.count.mock.calls[0][0].where).toBe(
      prisma.ordenServicio.findMany.mock.calls[0][0].where,
    );
  });
});
