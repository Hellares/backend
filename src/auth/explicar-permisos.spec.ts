import { Rol } from '@prisma/client';
import { PermissionsService } from './services/permissions.service';
import { GranularPermissionId } from './services/granular-permissions.catalog';

/**
 * "Que puede hacer este usuario, y por que".
 *
 * Los permisos no se guardan: se calculan desde los roles. Sin esto, para
 * responder por que un cajero veia el libro contable habia que mirar el rol,
 * mirar los permisos especiales y aplicar mentalmente una funcion de 200
 * lineas.
 *
 * 🔴 El origen se deduce POR DIFERENCIA, sin tocar calculatePermissions: lo
 * que dan los roles solos vs lo que da con los granulares. Meterle mano a esa
 * funcion para que registrara su procedencia habria duplicado cada regla, con
 * el riesgo de que la explicacion y el calculo se separen y la pantalla mienta.
 */
describe('PermissionsService.explicarPermisos', () => {
  const service = new PermissionsService();

  const buscar = (
    roles: Rol[],
    clave: string,
    overrides?: { permisos?: string[] },
  ) => service.explicarPermisos(roles, overrides).find((p) => p.clave === clave)!;

  it('un permiso que da el rol se atribuye a ESE rol', () => {
    const p = buscar([Rol.CAJERO], 'canViewCaja');
    expect(p.valor).toBe(true);
    expect(p.origen).toBe('rol');
    expect(p.detalle).toBe(Rol.CAJERO);
  });

  it('con varios roles nombra al que efectivamente lo otorga', () => {
    // TECNICO no da canViewCaja; CAJERO si.
    const p = buscar([Rol.TECNICO, Rol.CAJERO], 'canViewCaja');
    expect(p.detalle).toBe(Rol.CAJERO);
  });

  it('🔴 un permiso que NO da el rol se atribuye al permiso especial', () => {
    const p = buscar([Rol.VENDEDOR], 'canDescuentoLibre', {
      permisos: [GranularPermissionId.VENTA_DESCUENTO_LIBRE],
    });
    expect(p.valor).toBe(true);
    expect(p.origen).toBe('especial');
    expect(p.detalle).toBe('venta.descuento-libre');
  });

  it('con varios especiales encendidos, nombra el que corresponde', () => {
    const p = buscar([Rol.VENDEDOR], 'canManageDevoluciones', {
      permisos: [
        GranularPermissionId.VENTA_DESCUENTO_LIBRE,
        GranularPermissionId.DEVOLUCION_CREAR,
      ],
    });
    expect(p.origen).toBe('especial');
    expect(p.detalle).toBe('devolucion.crear');
  });

  it('la capacidad de caja se atribuye al permiso especial', () => {
    // Ya no hay origen 'flag': las columnas legacy salieron del calculo y el
    // catalogo es la unica fuente.
    const p = buscar([Rol.VENDEDOR], 'canAbrirCaja', {
      permisos: [GranularPermissionId.CAJA_ABRIR],
    });
    expect(p.valor).toBe(true);
    expect(p.origen).toBe('especial');
    expect(p.detalle).toBe('caja.abrir');
  });

  it('lo que no tiene se reporta sin origen', () => {
    const p = buscar([Rol.VENDEDOR], 'canManageProducts');
    expect(p.valor).toBe(false);
    expect(p.origen).toBeNull();
  });

  it('el rol gana sobre el especial: si ya lo daba el rol, no se atribuye al granular', () => {
    // Un admin tiene canManageDevoluciones por rol. Aunque tenga tambien el
    // granular, el origen honesto es el rol: quitarle el permiso especial no
    // le sacaria la capacidad.
    const p = buscar([Rol.EMPRESA_ADMIN], 'canManageDevoluciones', {
      permisos: [GranularPermissionId.DEVOLUCION_CREAR],
    });
    expect(p.origen).toBe('rol');
  });

  it('explica TODOS los permisos, no un subconjunto', () => {
    const todos = service.explicarPermisos([Rol.CAJERO]);
    const claves = service.getAllAvailablePermissions();
    for (const clave of claves) {
      expect(todos.some((p) => p.clave === clave)).toBe(true);
    }
  });
});
