import {
  Controller,
  Get,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { DashboardRrhhService } from './dashboard-rrhh.service';

@ApiTags('RRHH - Dashboard')
@Controller('rrhh-dashboard')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class DashboardRrhhController {
  constructor(private readonly dashboardRrhhService: DashboardRrhhService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_EMPLEADOS)
  @ApiOperation({ summary: 'Obtener dashboard general de RRHH' })
  @ApiResponse({ status: 200, description: 'Dashboard de RRHH obtenido exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getDashboard(@Headers('x-tenant-id') empresaId: string) {
    return this.dashboardRrhhService.getDashboard(empresaId);
  }
}
