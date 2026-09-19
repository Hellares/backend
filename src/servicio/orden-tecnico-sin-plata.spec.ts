import { ForbiddenException } from '@nestjs/common';
import { Rol } from '@prisma/client';
import { OrdenServicioService } from './orden-servicio.service';
import { PermissionsService } from '../auth/services/permissions.service';

/**
 * Qué puede y qué no el técnico sobre una orden (19-09).
 *
 * 🔴 La plata de la orden entra por CUATRO puertas —crear, editar, cambiar de
 * estado y los abonos—, así que esconder la tarjeta de costos en el app no
 * restringe nada por sí solo. Los abonos los cierra el permiso
 * `canGestionarCostosOrden` en el controller; las otras tres, esta validación.
 */
describe('Orden de servicio — el técnico no toca la plata', () => {
  const validar = (dto: any, puedeCostos: boolean) =>
    OrdenServicioService.validarCostosPermitidos(dto, puedeCostos);

  it('🔴 sin permiso, mandar costo/adelanto/descuento es 403', () => {
    for (const campo of [
      'costoTotal',
      'adelanto',
      'descuento',
      'metodoPagoAdelanto',
    ]) {
      expect(() => validar({ [campo]: campo === 'metodoPagoAdelanto' ? 'YAPE' : 10 }, false))
        .toThrow(ForbiddenException);
    }
  });

  it('el estado y las notas pasan igual: es lo suyo', () => {
    expect(() =>
      validar(
        { nuevoEstado: 'EN_REPARACION', notas: 'cambié la pantalla', comunicarCliente: true },
        false,
      ),
    ).not.toThrow();
  });

  it('un 0 explícito también se rechaza: poner el costo en cero es tocarlo', () => {
    expect(() => validar({ costoTotal: 0 }, false)).toThrow(ForbiddenException);
    expect(() => validar({ descuento: 0 }, false)).toThrow(ForbiddenException);
  });

  it('con permiso (admin) pasa todo', () => {
    expect(() =>
      validar({ costoTotal: 120, adelanto: 50, descuento: 10, metodoPagoAdelanto: 'EFECTIVO' }, true),
    ).not.toThrow();
  });

  it('el mensaje dice que los repuestos sí los puede cargar', () => {
    expect(() => validar({ adelanto: 50 }, false)).toThrow(
      /repuesto/i,
    );
  });
});

/**
 * El técnico queda asignado a lo que recibe, y ve lo suyo más lo libre.
 */
describe('Orden de servicio — visibilidad y asignación del técnico', () => {
  it('🔴 el técnico ve las suyas y las que no tiene nadie', () => {
    expect(
      OrdenServicioService.filtroVisibilidadTecnico(Rol.TECNICO, 'tec-1'),
    ).toEqual({ OR: [{ tecnicoId: 'tec-1' }, { tecnicoId: null }] });
  });

  it('el admin y los demás roles no se filtran', () => {
    for (const rol of [Rol.EMPRESA_ADMIN, Rol.SEDE_ADMIN, Rol.CAJERO, undefined]) {
      expect(
        OrdenServicioService.filtroVisibilidadTecnico(rol, 'user-1'),
      ).toBeNull();
    }
  });

  it('sin usuario no filtra: mejor no inventar un dueño', () => {
    expect(
      OrdenServicioService.filtroVisibilidadTecnico(Rol.TECNICO, undefined),
    ).toBeNull();
  });

  it('🔴 el técnico queda asignado a la orden que crea', () => {
    expect(
      OrdenServicioService.tecnicoDeLaOrdenNueva(undefined, 'tec-1', false),
    ).toBe('tec-1');
  });

  it('🔴 y no puede dejársela a otro al crearla', () => {
    expect(
      OrdenServicioService.tecnicoDeLaOrdenNueva('tec-2', 'tec-1', false),
    ).toBe('tec-1');
  });

  it('el admin elige, y puede dejarla libre', () => {
    expect(
      OrdenServicioService.tecnicoDeLaOrdenNueva('tec-2', 'admin-1', true),
    ).toBe('tec-2');
    expect(
      OrdenServicioService.tecnicoDeLaOrdenNueva(undefined, 'admin-1', true),
    ).toBeUndefined();
  });
});

/**
 * Los dos permisos nuevos: repartir trabajo y tocar la plata son del admin.
 */
describe('Orden de servicio — permisos por rol', () => {
  const service = new PermissionsService();
  const p = (rol: Rol) => service.calculatePermissions([rol]);

  it('🔴 el técnico gestiona órdenes, pero no asigna ni cobra', () => {
    expect(p(Rol.TECNICO).canManageOrders).toBe(true);
    expect(p(Rol.TECNICO).canAsignarTecnico).toBe(false);
    expect(p(Rol.TECNICO).canGestionarCostosOrden).toBe(false);
  });

  it('el admin de empresa y el de sede sí', () => {
    for (const rol of [Rol.EMPRESA_ADMIN, Rol.SEDE_ADMIN]) {
      expect(p(rol).canAsignarTecnico).toBe(true);
      expect(p(rol).canGestionarCostosOrden).toBe(true);
    }
  });
});
