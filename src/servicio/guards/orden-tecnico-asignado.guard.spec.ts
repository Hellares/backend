import { ForbiddenException } from '@nestjs/common';
import { Rol } from '@prisma/client';
import { OrdenTecnicoAsignadoGuard } from './orden-tecnico-asignado.guard';

/**
 * El técnico trabaja sus órdenes y las libres. Filtrar el listado no alcanza:
 * con el id se llega igual al detalle, a los mensajes y al cambio de estado.
 */
describe('OrdenTecnicoAsignadoGuard', () => {
  let prisma: any;
  let guard: OrdenTecnicoAsignadoGuard;

  const ctx = (req: any) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

  const req = (over: any = {}) => ({
    user: { sub: 'tec-1' },
    headers: { 'x-tenant-id': 'emp-1' },
    params: { id: 'orden-1' },
    _tenantRoles: [Rol.TECNICO],
    ...over,
  });

  const conTecnico = (tecnicoId: string | null) => {
    prisma.ordenServicio.findFirst.mockResolvedValue({ tecnicoId });
  };

  beforeEach(() => {
    prisma = {
      ordenServicio: { findFirst: jest.fn().mockResolvedValue({ tecnicoId: null }) },
    };
    guard = new OrdenTecnicoAsignadoGuard(prisma);
  });

  it('la suya, pasa', async () => {
    conTecnico('tec-1');
    await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
  });

  it('🔴 una libre pasa: nadie la está atendiendo y hay que poder tomarla', async () => {
    conTecnico(null);
    await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
  });

  it('🔴 la de otro técnico, no', async () => {
    conTecnico('tec-2');
    await expect(guard.canActivate(ctx(req()))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('el admin ve todas, también las de otro', async () => {
    conTecnico('tec-2');
    await expect(
      guard.canActivate(ctx(req({ _tenantRoles: [Rol.EMPRESA_ADMIN] }))),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        ctx(req({ _tenantRoles: [], user: { sub: 'x', rolGlobal: Rol.SUPER_ADMIN } })),
      ),
    ).resolves.toBe(true);
  });

  it('un técnico que ADEMÁS es admin de sede reparte, así que ve todas', async () => {
    conTecnico('tec-2');
    await expect(
      guard.canActivate(ctx(req({ _tenantRoles: [Rol.TECNICO, Rol.SEDE_ADMIN] }))),
    ).resolves.toBe(true);
  });

  it('sin :id o sin tenant no se mete', async () => {
    await expect(guard.canActivate(ctx(req({ params: {} })))).resolves.toBe(true);
    await expect(guard.canActivate(ctx(req({ headers: {} })))).resolves.toBe(true);
    expect(prisma.ordenServicio.findFirst).not.toHaveBeenCalled();
  });

  it('orden inexistente o de otra empresa: deja que el servicio tire el 404', async () => {
    prisma.ordenServicio.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(ctx(req()))).resolves.toBe(true);
  });
});
