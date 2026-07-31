import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Rol } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  puedeOperarEnSede,
  SEDE_ACCESO_DENEGADO_MSG,
} from '../../auth/sede-access.util';

/**
 * Acceso por sede para las rutas de orden de servicio que la llevan IMPLÍCITA:
 * la sede no viaja en el request (solo el `:id` de la orden), así que
 * `SedeAccessGuard` no puede validarla y el scoping se caía en cuanto alguien
 * tuviera el id — el filtro por sede del listado no protege el detalle.
 *
 * Misma política progresiva que `SedeAccessGuard` (ver `sede-access.util`).
 *
 * Debe declararse DESPUÉS de JwtAuthGuard/TenantAuthGuard. Solo va en las rutas
 * de STAFF: las de cliente (`mis-ordenes/:id`) ya scopean por personaId y no
 * tienen sede que validar.
 */
@Injectable()
export class OrdenSedeAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as any;
    const empresaId = req.headers['x-tenant-id'] as string | undefined;
    const ordenId: string | undefined = req.params?.id;

    if (!user || !empresaId || !ordenId) return true;

    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenId, empresaId },
      select: { sedeId: true },
    });
    // Inexistente o de otra empresa → que el servicio tire su 404. Orden legacy
    // sin sede → no hay nada que validar.
    if (!orden?.sedeId) return true;

    const permitido = await puedeOperarEnSede(this.prisma, orden.sedeId, {
      usuarioId: user.sub || user.id,
      empresaId,
      rolGlobal: user.rolGlobal,
      rolesEmpresa: Array.isArray(req._tenantRoles)
        ? (req._tenantRoles as Rol[])
        : null,
    });
    if (!permitido) throw new ForbiddenException(SEDE_ACCESO_DENEGADO_MSG);
    return true;
  }
}
