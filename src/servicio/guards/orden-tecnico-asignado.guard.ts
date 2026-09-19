import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Rol } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * El técnico trabaja SUS órdenes y las que todavía no tiene nadie.
 *
 * Las libres quedan a la vista a propósito: son las que nadie está
 * atendiendo, y cualquiera del taller tiene que poder tomarlas. Las de otro
 * técnico no: para eso está el admin, que reparte.
 *
 * Va junto a `OrdenSedeAccessGuard` en las rutas de STAFF con `:id` — el
 * filtro del listado no alcanza, porque con el id se llega igual al detalle.
 * Las rutas de cliente (`mis-ordenes/:id`) ya scopean por personaId.
 */
@Injectable()
export class OrdenTecnicoAsignadoGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as any;
    const empresaId = req.headers['x-tenant-id'] as string | undefined;
    const ordenId: string | undefined = req.params?.id;

    if (!user || !empresaId || !ordenId) return true;

    const roles: Rol[] = Array.isArray(req._tenantRoles) ? req._tenantRoles : [];
    const esAdmin =
      user.rolGlobal === Rol.SUPER_ADMIN ||
      roles.some((r: Rol) =>
        ([Rol.SUPER_ADMIN, Rol.EMPRESA_ADMIN, Rol.SEDE_ADMIN] as Rol[]).includes(
          r,
        ),
      );
    if (esAdmin || !roles.includes(Rol.TECNICO)) return true;

    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenId, empresaId },
      select: { tecnicoId: true },
    });
    // Inexistente o de otra empresa → que el servicio tire su 404.
    if (!orden) return true;

    const usuarioId = user.sub || user.id;
    if (orden.tecnicoId === null || orden.tecnicoId === usuarioId) return true;

    throw new ForbiddenException(
      'Esta orden la está atendiendo otro técnico. Pídele al administrador que te la asigne.',
    );
  }
}
