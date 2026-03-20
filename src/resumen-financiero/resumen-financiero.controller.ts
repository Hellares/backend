import { Controller, Get, Query, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { ResumenFinancieroService } from './resumen-financiero.service';

@ApiTags('Resumen Financiero')
@Controller('resumen-financiero')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ResumenFinancieroController {
  constructor(private readonly service: ResumenFinancieroService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Resumen financiero consolidado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getResumen(
    @Headers('x-tenant-id') empresaId: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.service.getResumen(empresaId, { fechaDesde, fechaHasta });
  }

  @Get('grafico-diario')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Datos diarios de ingresos vs egresos para gráfico' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getGraficoDiario(
    @Headers('x-tenant-id') empresaId: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.service.getGraficoDiario(empresaId, fechaDesde, fechaHasta);
  }
}
