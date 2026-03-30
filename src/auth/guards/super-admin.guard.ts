import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Rol } from '@prisma/client';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    if (user.rolGlobal !== Rol.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Acceso restringido a Super Administradores del sistema',
      );
    }

    return true;
  }
}
