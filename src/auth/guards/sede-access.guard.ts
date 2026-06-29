import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Rol } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Restringe operaciones "sede-scoped" (que llevan `sedeId` en body/query/param) a
 * las sedes que el usuario tiene asignadas (UsuarioSedeRol).
 *
 * Política — enforcement PROGRESIVO (no rompe flujos legacy de sede única):
 *  - SUPER_ADMIN (global) o EMPRESA_ADMIN (de la empresa) → cualquier sede suya.
 *  - Usuario CON asignaciones de sede → la operación debe ser sobre una de ellas
 *    (si no, 403).
 *  - Usuario SIN ninguna asignación (aún no migrado a multi-sede) → NO se
 *    restringe. En cuanto se le asigna al menos una sede, el enforcement aplica
 *    automáticamente. Así no se rompe a usuarios existentes que operan sin
 *    UsuarioSedeRol.
 *
 * Debe declararse DESPUÉS de JwtAuthGuard/TenantAuthGuard (usa `request.user` y
 * el header `x-tenant-id`). Si no hay `sedeId` en la request, no valida nada.
 */
@Injectable()
export class SedeAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user as any;
    const empresaId = req.headers['x-tenant-id'] as string | undefined;
    const sedeId: string | undefined =
      req.body?.sedeId ?? req.query?.sedeId ?? req.params?.sedeId;

    // No es una operación sede-scoped validable → dejar pasar.
    if (!user || !empresaId || !sedeId) return true;

    const usuarioId = user.sub || user.id;

    // SUPER_ADMIN global → todas las sedes.
    if (user.rolGlobal === Rol.SUPER_ADMIN) return true;

    // EMPRESA_ADMIN de la empresa → todas las sedes. Reusar los roles cacheados
    // por TenantAuthGuard si están; si no, query directa.
    const rolesEmpresa: Rol[] = Array.isArray(req._tenantRoles)
      ? (req._tenantRoles as Rol[])
      : (
          await this.prisma.empresaUsuarioRol.findMany({
            where: { usuarioId, empresaId, isActive: true, deletedAt: null },
            select: { rol: true },
          })
        ).map((r) => r.rol);
    if (rolesEmpresa.includes(Rol.EMPRESA_ADMIN)) return true;

    // ¿El usuario tiene asignaciones de sede?
    const totalAsignaciones = await this.prisma.usuarioSedeRol.count({
      where: {
        usuarioId,
        isActive: true,
        deletedAt: null,
        sede: { empresaId, deletedAt: null },
      },
    });
    // Legacy: sin asignaciones → no se restringe.
    if (totalAsignaciones === 0) return true;

    // Tiene asignaciones → la sede de la operación debe estar entre ellas.
    const asignadaAEsta = await this.prisma.usuarioSedeRol.findFirst({
      where: {
        usuarioId,
        sedeId,
        isActive: true,
        deletedAt: null,
        sede: { empresaId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!asignadaAEsta) {
      throw new ForbiddenException(
        'No tenés acceso a esta sede. Pedí al administrador que te asigne a ella.',
      );
    }
    return true;
  }
}
