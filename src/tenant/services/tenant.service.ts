import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantService {
  constructor(private prisma: PrismaService) {}

  async findBySubdomain(subdomain: string) {
    return this.prisma.empresa.findUnique({
      where: { subdominio: subdomain },
    });
  }

  async findById(id: string) {
    return this.prisma.empresa.findUnique({
      where: { id },
    });
  }

  async validateTenantAccess(userId: string, tenantId: string) {
    // Verificar que el usuario tenga acceso al tenant
    return this.prisma.usuario.findFirst({
      where: {
        id: userId,
        empresas: {
          some: {
            empresaId: tenantId,
          },
        },
      },
    });
  }
}