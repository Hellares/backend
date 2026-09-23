import { Rol } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const SEDE_ACCESO_DENEGADO_MSG =
  'No tenés acceso a esta sede. Pedí al administrador que te asigne a ella.';

export interface SedeAccessCtx {
  usuarioId: string;
  empresaId: string;
  /** `user.rolGlobal` del JWT. Si no viene, SUPER_ADMIN cae al fallback legacy. */
  rolGlobal?: string | null;
  /** Roles de empresa ya resueltos (TenantAuthGuard los cachea en `req._tenantRoles`). */
  rolesEmpresa?: Rol[] | null;
}

/**
 * Política de acceso por sede — enforcement PROGRESIVO (no rompe sede única):
 *  - SUPER_ADMIN global o EMPRESA_ADMIN de la empresa → cualquier sede suya.
 *  - Usuario CON asignaciones (`UsuarioSedeRol`) → solo esas.
 *  - Usuario SIN ninguna asignación (aún no migrado a multi-sede) → NO se
 *    restringe. En cuanto se le asigna una sede, el enforcement aplica solo.
 *
 * Vive acá y no dentro del guard porque hay operaciones donde la sede es
 * IMPLÍCITA (se deduce de la entidad que se está tocando, no del request) y
 * necesitan exactamente la misma política. Ver `OrdenSedeAccessGuard`.
 */
export async function puedeOperarEnSede(
  prisma: PrismaService,
  sedeId: string,
  ctx: SedeAccessCtx,
): Promise<boolean> {
  const { usuarioId, empresaId } = ctx;
  if (!usuarioId || !empresaId || !sedeId) return true;

  if (ctx.rolGlobal === Rol.SUPER_ADMIN) return true;

  const rolesEmpresa: Rol[] = Array.isArray(ctx.rolesEmpresa)
    ? ctx.rolesEmpresa
    : (
        await prisma.empresaUsuarioRol.findMany({
          where: { usuarioId, empresaId, isActive: true, deletedAt: null },
          select: { rol: true },
        })
      ).map((r) => r.rol);
  if (rolesEmpresa.includes(Rol.EMPRESA_ADMIN)) return true;

  const totalAsignaciones = await prisma.usuarioSedeRol.count({
    where: {
      usuarioId,
      isActive: true,
      deletedAt: null,
      sede: { empresaId, deletedAt: null },
    },
  });
  // Legacy: sin asignaciones → no se restringe.
  if (totalAsignaciones === 0) return true;

  const asignadaAEsta = await prisma.usuarioSedeRol.findFirst({
    where: {
      usuarioId,
      sedeId,
      isActive: true,
      deletedAt: null,
      sede: { empresaId, deletedAt: null },
    },
    select: { id: true },
  });
  return !!asignadaAEsta;
}

/**
 * Sedes sobre las que el usuario puede operar, para SCOPEAR LISTADOS — ahí no
 * hay una sede puntual que validar: si el request no manda `sedeId`, ningún
 * guard interviene y la consulta devolvería todas las sedes de la empresa.
 *
 * `null` = sin restricción. Misma política progresiva que `puedeOperarEnSede`:
 * SUPER_ADMIN, EMPRESA_ADMIN y usuarios aún sin asignaciones ven todo.
 */
export async function sedesPermitidas(
  prisma: PrismaService,
  ctx: SedeAccessCtx,
): Promise<string[] | null> {
  const { usuarioId, empresaId } = ctx;
  if (!usuarioId || !empresaId) return null;

  if (ctx.rolGlobal === Rol.SUPER_ADMIN) return null;

  const rolesEmpresa: Rol[] = Array.isArray(ctx.rolesEmpresa)
    ? ctx.rolesEmpresa
    : (
        await prisma.empresaUsuarioRol.findMany({
          where: { usuarioId, empresaId, isActive: true, deletedAt: null },
          select: { rol: true },
        })
      ).map((r) => r.rol);
  if (rolesEmpresa.includes(Rol.EMPRESA_ADMIN)) return null;

  const asignaciones = await prisma.usuarioSedeRol.findMany({
    where: {
      usuarioId,
      isActive: true,
      deletedAt: null,
      sede: { empresaId, deletedAt: null },
    },
    select: { sedeId: true },
  });
  // Legacy: sin asignaciones → no se restringe.
  if (asignaciones.length === 0) return null;

  return [...new Set(asignaciones.map((a) => a.sedeId))];
}
