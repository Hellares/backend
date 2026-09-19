import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { EmpresaPermissionsDto } from '../../empresa/dto';

/**
 * Los permisos ya calculados del usuario en la empresa del request, que deja
 * `PermissionsGuard`.
 *
 * Para endpoints donde el permiso no decide si entrás, sino QUÉ podés mandar:
 * el técnico gestiona su orden, pero no el costo ni el adelanto.
 *
 * Solo tiene valor si la ruta pasa por `PermissionsGuard` con un
 * `@RequiresPermission`; si no, llega `undefined`.
 */
export const CurrentPermissions = createParamDecorator(
  (data: keyof EmpresaPermissionsDto | undefined, ctx: ExecutionContext) => {
    const permisos = ctx.switchToHttp().getRequest()._permissions as
      | EmpresaPermissionsDto
      | undefined;
    return data ? permisos?.[data] === true : permisos;
  },
);
