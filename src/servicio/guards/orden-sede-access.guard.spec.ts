import { ForbiddenException } from '@nestjs/common';
import { Rol } from '@prisma/client';
import { OrdenSedeAccessGuard } from './orden-sede-access.guard';

/**
 * La sede acá es IMPLÍCITA (sale de la orden, no del request). Misma política
 * progresiva que SedeAccessGuard.
 */
describe('OrdenSedeAccessGuard', () => {
  let prisma: any;
  let guard: OrdenSedeAccessGuard;

  const ctx = (req: any) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

  const baseReq = (over: any = {}) => ({
    user: { id: 'user-1' },
    headers: { 'x-tenant-id': 'emp-1' },
    params: { id: 'orden-1' },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      ordenServicio: {
        findFirst: jest.fn().mockResolvedValue({ sedeId: 'sede-1' }),
      },
      empresaUsuarioRol: { findMany: jest.fn().mockResolvedValue([]) },
      usuarioSedeRol: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    guard = new OrdenSedeAccessGuard(prisma);
  });

  it('sin :id en la request → deja pasar (no es una ruta de orden puntual)', async () => {
    await expect(
      guard.canActivate(ctx(baseReq({ params: {} }))),
    ).resolves.toBe(true);
    expect(prisma.ordenServicio.findFirst).not.toHaveBeenCalled();
  });

  it('orden inexistente o de otra empresa → deja pasar (el servicio tira 404)', async () => {
    prisma.ordenServicio.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(ctx(baseReq()))).resolves.toBe(true);
    expect(prisma.usuarioSedeRol.count).not.toHaveBeenCalled();
  });

  it('orden legacy sin sede → no hay nada que validar', async () => {
    prisma.ordenServicio.findFirst.mockResolvedValue({ sedeId: null });
    await expect(guard.canActivate(ctx(baseReq()))).resolves.toBe(true);
    expect(prisma.usuarioSedeRol.count).not.toHaveBeenCalled();
  });

  it('la orden se busca scopeada por empresa', async () => {
    await guard.canActivate(ctx(baseReq()));
    expect(prisma.ordenServicio.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'orden-1', empresaId: 'emp-1' },
      }),
    );
  });

  it('SUPER_ADMIN global → cualquier sede', async () => {
    const req = baseReq({ user: { id: 'u', rolGlobal: Rol.SUPER_ADMIN } });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(prisma.usuarioSedeRol.count).not.toHaveBeenCalled();
  });

  it('EMPRESA_ADMIN (vía _tenantRoles cacheados) → cualquier sede', async () => {
    const req = baseReq({ _tenantRoles: [Rol.EMPRESA_ADMIN] });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(prisma.usuarioSedeRol.count).not.toHaveBeenCalled();
  });

  it('usuario SIN asignaciones de sede (legacy) → no se restringe', async () => {
    prisma.usuarioSedeRol.count.mockResolvedValue(0);
    await expect(guard.canActivate(ctx(baseReq()))).resolves.toBe(true);
    expect(prisma.usuarioSedeRol.findFirst).not.toHaveBeenCalled();
  });

  it('usuario CON asignaciones pero NO a la sede de la orden → 403', async () => {
    prisma.usuarioSedeRol.count.mockResolvedValue(2);
    prisma.usuarioSedeRol.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(ctx(baseReq()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.usuarioSedeRol.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sedeId: 'sede-1' }),
      }),
    );
  });

  it('usuario CON asignación a la sede de la orden → deja pasar', async () => {
    prisma.usuarioSedeRol.count.mockResolvedValue(2);
    prisma.usuarioSedeRol.findFirst.mockResolvedValue({ id: 'usr-sede-1' });
    await expect(guard.canActivate(ctx(baseReq()))).resolves.toBe(true);
  });
});
