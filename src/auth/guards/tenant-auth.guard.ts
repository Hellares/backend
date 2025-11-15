import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as { id: string; personaId: string; rolGlobal?: string };
    const empresa = request.currentEmpresa;

    if (!user) throw new UnauthorizedException('Usuario no autenticado');
    if (!empresa) throw new UnauthorizedException('Empresa no resuelta');

    // SUPER_ADMIN tiene acceso total
    if (user.rolGlobal === 'SUPER_ADMIN') {
      return true;
    }

    // Verificar acceso a la empresa
    const tieneAccesoEmpresa = await this.prisma.empresaUsuarioRol.findFirst({
      where: { usuarioId: user.id, empresaId: empresa.id, isActive: true, deletedAt: null },
    });

    if (tieneAccesoEmpresa) return true;

    // También puede ser cliente
    const esCliente = await this.prisma.empresaPersona.findFirst({
      where: { personaId: user.personaId, empresaId: empresa.id, isActive: true, deletedAt: null },
    });

    if (esCliente) return true;

    throw new UnauthorizedException('No tienes acceso a esta empresa');
  }
}