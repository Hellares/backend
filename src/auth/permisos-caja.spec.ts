import { Rol } from '@prisma/client';
import { PermissionsService } from './services/permissions.service';
import { GranularPermissionId } from './services/granular-permissions.catalog';

/**
 * Abrir y cerrar caja se conceden POR SEPARADO, y el flag manda sobre el rol.
 *
 * 🔴 El uso real del negocio es "abre pero no cierra": el cierre lo hace el
 * admin. Era el unico caso en produccion y 5 de 8 en beta.
 *
 * Antes, `canCerrarCaja` incluia `isCajero`, asi que destildarle "puede cerrar
 * caja" a un cajero no le quitaba nada: el permiso seguia dando true por su
 * rol, la UI le escondia el boton y el endpoint CERRAR_CAJA le aceptaba la
 * peticion igual. La restriccion era cosmetica.
 */
describe('Permisos de caja: abrir y cerrar por separado', () => {
  const service = new PermissionsService();

  const permisos = (
    roles: Rol[],
    overrides?: { puedeAbrirCaja?: boolean; puedeCerrarCaja?: boolean; permisos?: string[] },
  ) => service.calculatePermissions(roles, overrides);

  it('🔴 un CAJERO sin el flag NO puede cerrar', () => {
    const p = permisos([Rol.CAJERO], { puedeAbrirCaja: true, puedeCerrarCaja: false });
    expect(p.canAbrirCaja).toBe(true);
    expect(p.canCerrarCaja).toBe(false);
  });

  it('un CAJERO con el flag si puede cerrar', () => {
    const p = permisos([Rol.CAJERO], { puedeAbrirCaja: true, puedeCerrarCaja: true });
    expect(p.canCerrarCaja).toBe(true);
  });

  it('un VENDEDOR con el granular puede abrir', () => {
    const p = permisos([Rol.VENDEDOR], {
      permisos: [GranularPermissionId.CAJA_ABRIR],
    });
    expect(p.canAbrirCaja).toBe(true);
    expect(p.canCerrarCaja).toBe(false);
  });

  it('el admin siempre puede, sin flags', () => {
    const p = permisos([Rol.EMPRESA_ADMIN]);
    expect(p.canAbrirCaja).toBe(true);
    expect(p.canCerrarCaja).toBe(true);
  });

  it('🔴 el cajero sin flags CONSERVA ver y operar su caja', () => {
    // Solo abrir/cerrar dependen del flag. Sacarle tambien estas lo dejaria
    // sin poder trabajar.
    const p = permisos([Rol.CAJERO], { puedeAbrirCaja: false, puedeCerrarCaja: false });
    expect(p.canViewCaja).toBe(true);
    expect(p.canManageCaja).toBe(true);
  });

  it('el granular caja.cerrar concede igual que el flag', () => {
    const p = permisos([Rol.VENDEDOR], {
      permisos: [GranularPermissionId.CAJA_CERRAR],
    });
    expect(p.canCerrarCaja).toBe(true);
  });
});
