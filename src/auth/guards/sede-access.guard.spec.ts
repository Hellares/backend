import { ForbiddenException } from '@nestjs/common';
import { Rol } from '@prisma/client';
import { SedeAccessGuard } from './sede-access.guard';

/**
 * Tests del enforcement progresivo de acceso por sede.
 */
describe('SedeAccessGuard', () => {
  let prisma: any;
  let guard: SedeAccessGuard;

  const ctx = (req: any) =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

  const baseReq = (over: any = {}) => ({
    user: { id: 'user-1' },
    headers: { 'x-tenant-id': 'emp-1' },
    body: { sedeId: 'sede-1' },
    ...over,
  });

  beforeEach(() => {
    prisma = {
      empresaUsuarioRol: { findMany: jest.fn().mockResolvedValue([]) },
      usuarioSedeRol: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    guard = new SedeAccessGuard(prisma);
  });

  it('sin sedeId en la request → deja pasar (no es sede-scoped)', async () => {
    await expect(
      guard.canActivate(ctx(baseReq({ body: {}, query: {}, params: {} }))),
    ).resolves.toBe(true);
  });

  it('SUPER_ADMIN global → todas las sedes', async () => {
    const req = baseReq({ user: { id: 'u', rolGlobal: Rol.SUPER_ADMIN } });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(prisma.usuarioSedeRol.count).not.toHaveBeenCalled();
  });

  it('EMPRESA_ADMIN (vía _tenantRoles cacheados) → todas las sedes', async () => {
    const req = baseReq({ _tenantRoles: [Rol.EMPRESA_ADMIN] });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(prisma.usuarioSedeRol.count).not.toHaveBeenCalled();
  });

  it('usuario SIN asignaciones de sede (legacy) → no se restringe', async () => {
    prisma.usuarioSedeRol.count.mockResolvedValue(0);
    await expect(guard.canActivate(ctx(baseReq()))).resolves.toBe(true);
    expect(prisma.usuarioSedeRol.findFirst).not.toHaveBeenCalled();
  });

  it('usuario CON asignaciones pero NO a esta sede → 403', async () => {
    prisma.usuarioSedeRol.count.mockResolvedValue(2);
    prisma.usuarioSedeRol.findFirst.mockResolvedValue(null);
    await expect(guard.canActivate(ctx(baseReq()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('usuario CON asignación a esta sede → deja pasar', async () => {
    prisma.usuarioSedeRol.count.mockResolvedValue(2);
    prisma.usuarioSedeRol.findFirst.mockResolvedValue({ id: 'usr-sede-1' });
    await expect(guard.canActivate(ctx(baseReq()))).resolves.toBe(true);
  });

  it('transferencia: valida la sede ORIGEN (body.sedeOrigenId) cuando no hay sedeId', async () => {
    prisma.usuarioSedeRol.count.mockResolvedValue(1);
    prisma.usuarioSedeRol.findFirst.mockResolvedValue(null);
    const req = baseReq({ body: { sedeOrigenId: 'sede-origen' } });
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.usuarioSedeRol.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sedeId: 'sede-origen' }),
      }),
    );
  });

  it('toma sedeId de query si no está en body', async () => {
    prisma.usuarioSedeRol.count.mockResolvedValue(1);
    prisma.usuarioSedeRol.findFirst.mockResolvedValue(null);
    const req = baseReq({ body: {}, query: { sedeId: 'sede-9' } });
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.usuarioSedeRol.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sedeId: 'sede-9' }) }),
    );
  });
});
