import { Rol } from '@prisma/client';
import { PermissionsService } from './services/permissions.service';
import { GRANULAR_PERMISSIONS_CATALOG } from './services/granular-permissions.catalog';

/**
 * `permisosPorRol` alimenta la ficha de usuario del app, que arma los
 * permisos efectivos como "rol OR cada permiso especial" para mostrar solo
 * los accesos que ese usuario va a ver.
 *
 * Lo que se fija acá es que esa composición dé EXACTAMENTE lo mismo que
 * `calculatePermissions`. Si alguien agrega una regla que combine dos
 * granulares con AND, este test falla antes de que la ficha empiece a mentir.
 */
describe('PermissionsService.permisosPorRol', () => {
  const service = new PermissionsService();
  const { roles, granulares } = service.permisosPorRol();
  const ids = GRANULAR_PERMISSIONS_CATALOG.map((p) => p.id);

  /** Lo que hace el app: rol OR cada granular. */
  const componer = (rol: Rol, permisos: string[]) => {
    const r: Record<string, unknown> = { ...roles[rol] };
    for (const id of permisos) {
      for (const clave of granulares[id]) r[clave] = true;
    }
    return r;
  };

  const rolesStaff = Object.values(Rol).filter((r) => r !== Rol.CLIENTE);

  it('trae cada rol de staff, y no al CLIENTE', () => {
    expect(Object.keys(roles).sort()).toEqual([...rolesStaff].sort());
    expect(roles[Rol.CLIENTE]).toBeUndefined();
  });

  it('el TECNICO trae lo mismo que calculatePermissions', () => {
    expect(roles[Rol.TECNICO]).toEqual(
      service.calculatePermissions([Rol.TECNICO]),
    );
    expect(roles[Rol.TECNICO].canManageOrders).toBe(true);
    expect(roles[Rol.TECNICO].canManageVentas).toBe(false);
  });

  it('cada permiso especial del catálogo enciende algo', () => {
    expect(Object.keys(granulares).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(granulares[id].length).toBeGreaterThan(0);
    }
  });

  it('🔴 rol OR un permiso especial == calculatePermissions, para todo rol', () => {
    for (const rol of rolesStaff) {
      for (const id of ids) {
        expect(componer(rol, [id])).toEqual(
          service.calculatePermissions([rol], { permisos: [id] }),
        );
      }
    }
  });

  it('🔴 y también de a pares y con todos juntos', () => {
    for (const rol of rolesStaff) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(componer(rol, [ids[i], ids[j]])).toEqual(
            service.calculatePermissions([rol], { permisos: [ids[i], ids[j]] }),
          );
        }
      }
      expect(componer(rol, ids)).toEqual(
        service.calculatePermissions([rol], { permisos: ids }),
      );
    }
  });
});
