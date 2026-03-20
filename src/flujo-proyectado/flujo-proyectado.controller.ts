import { Controller, Get, Query, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { FlujoProyectadoService } from './flujo-proyectado.service';

@ApiTags('Flujo Proyectado')
@Controller('flujo-proyectado')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class FlujoProyectadoController {
  constructor(private readonly service: FlujoProyectadoService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Proyeccion de flujo de caja para los proximos meses' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'meses', type: Number, required: false, example: 3 })
  async getProyeccion(
    @Headers('x-tenant-id') empresaId: string,
    @Query('meses') meses?: string,
  ) {
    const mesesNum = meses ? parseInt(meses, 10) : 3;
    return this.service.getProyeccion(empresaId, mesesNum);
  }
}
