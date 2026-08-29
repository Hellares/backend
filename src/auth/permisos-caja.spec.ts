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

  const permisos = (roles: Rol[], granulares: string[] = []) =>
    service.calculatePermissions(roles, { permisos: granulares });

  const ABRIR = GranularPermissionId.CAJA_ABRIR;
  const CERRAR = GranularPermissionId.CAJA_CERRAR;

  it('🔴 un CAJERO sin el permiso NO puede cerrar', () => {
    const p = permisos([Rol.CAJERO], [ABRIR]);
    expect(p.canAbrirCaja).toBe(true);
    expect(p.canCerrarCaja).toBe(false);
  });

  it('un CAJERO con el permiso si puede cerrar', () => {
    const p = permisos([Rol.CAJERO], [ABRIR, CERRAR]);
    expect(p.canCerrarCaja).toBe(true);
  });

  it('un VENDEDOR con el granular puede abrir', () => {
    const p = permisos([Rol.VENDEDOR], [ABRIR]);
    expect(p.canAbrirCaja).toBe(true);
    expect(p.canCerrarCaja).toBe(false);
  });

  it('el admin siempre puede, sin permisos especiales', () => {
    const p = permisos([Rol.EMPRESA_ADMIN]);
    expect(p.canAbrirCaja).toBe(true);
    expect(p.canCerrarCaja).toBe(true);
  });

  it('🔴 el cajero sin permisos de caja CONSERVA ver y operar su caja', () => {
    // Solo abrir/cerrar dependen del permiso. Sacarle tambien estas lo
    // dejaria sin poder trabajar.
    const p = permisos([Rol.CAJERO]);
    expect(p.canViewCaja).toBe(true);
    expect(p.canManageCaja).toBe(true);
  });

  it('🔴 las columnas legacy ya NO se leen', () => {
    // `puedeAbrirCaja`/`puedeCerrarCaja` salieron de PermissionsOverrides el
    // 29-08. Siguen existiendo en la tabla -- el app las escribe derivadas del
    // catalogo, para que un rollback de imagen las encuentre -- pero este
    // servicio no las mira. Si alguien las reintroduce, que sea a conciencia.
    const overrides = { permisos: [] as string[] };
    expect(Object.keys(overrides)).toEqual(['permisos']);
    expect(permisos([Rol.CAJERO]).canCerrarCaja).toBe(false);
  });
});
