import { Rol } from '@prisma/client';
import { PermissionsService } from './services/permissions.service';
import {
  GRANULAR_PERMISSIONS_CATALOG,
  GranularPermissionId,
} from './services/granular-permissions.catalog';

/**
 * Los permisos granulares AMPLÍAN lo que da el rol.
 *
 * El catálogo llegó a tener 11 permisos de los cuales 9 no los consultaba
 * nadie: eran casillas que el admin tildaba en la pantalla de usuarios y no
 * cambiaban nada. Los que sobrevivieron son los ADITIVOS —los que conceden algo
 * que el rol no da—, porque este mecanismo hace un OR sobre el rol y no puede
 * quitar.
 *
 * Lo que se fija acá es que cada permiso del catálogo mueva de verdad un
 * booleano, y que sin él el rol siga exactamente como estaba.
 */
describe('Permisos granulares aditivos', () => {
  const service = new PermissionsService();

  const permisos = (roles: Rol[], granulares: string[] = []) =>
    service.calculatePermissions(roles, { permisos: granulares });

  describe('devolucion.crear', () => {
    it('sin el permiso, el vendedor NO puede devolver', () => {
      expect(permisos([Rol.VENDEDOR]).canManageDevoluciones).toBe(false);
    });

    it('con el permiso, el mismo vendedor SÍ puede', () => {
      expect(
        permisos([Rol.VENDEDOR], [GranularPermissionId.DEVOLUCION_CREAR])
          .canManageDevoluciones,
      ).toBe(true);
    });

    it('el admin puede sin necesitar el permiso', () => {
      expect(permisos([Rol.EMPRESA_ADMIN]).canManageDevoluciones).toBe(true);
    });
  });

  describe('producto.editar-costo', () => {
    it('sin el permiso, el vendedor no edita costos', () => {
      expect(permisos([Rol.VENDEDOR]).canEditarCostoProducto).toBe(false);
    });

    it('con el permiso, sí', () => {
      expect(
        permisos([Rol.VENDEDOR], [GranularPermissionId.PRODUCTO_EDITAR_COSTO])
          .canEditarCostoProducto,
      ).toBe(true);
    });

    it('🔴 conceder el costo NO le da el resto del catálogo', () => {
      // Es la razón de existir de este permiso: `canManageProducts` cubre TODO
      // el producto. Si el granular lo arrastrara, sería lo mismo que hacerlo
      // administrador de productos.
      const p = permisos(
        [Rol.VENDEDOR],
        [GranularPermissionId.PRODUCTO_EDITAR_COSTO],
      );
      expect(p.canEditarCostoProducto).toBe(true);
      expect(p.canManageProducts).toBe(false);
    });
  });

  describe('venta.descuento-libre', () => {
    it('sin el permiso, el vendedor tiene que pedir autorización', () => {
      expect(permisos([Rol.VENDEDOR]).canDescuentoLibre).toBe(false);
    });

    it('con el permiso, descuenta solo', () => {
      expect(
        permisos([Rol.VENDEDOR], [GranularPermissionId.VENTA_DESCUENTO_LIBRE])
          .canDescuentoLibre,
      ).toBe(true);
    });
  });

  describe('venta.editar-precio', () => {
    it('sin el permiso no, con el permiso sí', () => {
      expect(permisos([Rol.CAJERO]).canEditarPrecioVenta).toBe(false);
      expect(
        permisos([Rol.CAJERO], [GranularPermissionId.VENTA_EDITAR_PRECIO])
          .canEditarPrecioVenta,
      ).toBe(true);
    });
  });

  describe('el catálogo no vuelve a llenarse de casillas muertas', () => {
    it('🔴 cada permiso del catálogo mueve algún booleano', () => {
      // Si alguien agrega un permiso al catálogo y se olvida de cablearlo en
      // calculatePermissions, este test lo agarra. Es exactamente el estado en
      // el que estaban 9 de los 11 permisos originales.
      //
      // `caja.abrir` / `caja.cerrar` se comparan contra un rol que NO sea
      // cajero: el cajero ya los tiene por su rol.
      const base = permisos([Rol.VENDEDOR]);
      for (const permiso of GRANULAR_PERMISSIONS_CATALOG) {
        const con = permisos([Rol.VENDEDOR], [permiso.id]);
        const cambio = Object.keys(con).some(
          (clave) => con[clave] !== base[clave],
        );
        expect(cambio).toBe(true);
      }
    });

    it('los permisos que solo pretendían RESTRINGIR ya no están', () => {
      // No se pueden expresar con un OR sobre el rol: ocultar un campo según
      // quién pregunta es filtrar la respuesta, no conceder un permiso.
      const ids = GRANULAR_PERMISSIONS_CATALOG.map((p) => p.id);
      expect(ids).not.toContain('producto.ver-costo');
      expect(ids).not.toContain('cliente.ver-credito');
      expect(ids).not.toContain('caja.movimiento-anular');
      // Redundante: la anulación ya valida el rol de quien autoriza.
      expect(ids).not.toContain('venta.anular');
      // Nunca se definió cuánto era "grande".
      expect(ids).not.toContain('cotizacion.aprobar-grande');
    });
  });
});
