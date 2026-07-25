import { Controller, Get, Query, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { ResumenFinancieroService } from './resumen-financiero.service';
import { QueryResumenFinancieroDto } from './dto/query-resumen.dto';

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
    @Query() query: QueryResumenFinancieroDto,
  ) {
    return this.service.getResumen(empresaId, query);
  }

  @Get('grafico-diario')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Datos diarios de ingresos vs egresos para gráfico' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getGraficoDiario(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryResumenFinancieroDto,
  ) {
    return this.service.getGraficoDiario(empresaId, query.fechaDesde, query.fechaHasta, query.sedeId);
  }

  @Get('dashboard')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({
    summary:
      'Resumen + grafico diario en una sola respuesta (dashboard empresa)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getDashboard(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryResumenFinancieroDto,
  ) {
    // El dashboard del app pedia resumen y grafico por separado — dos
    // round-trips moviles que ademas van DESPUES del contexto de empresa.
    // Aca el fan-out corre server-side. Endpoints sueltos quedan por
    // compatibilidad (los usa tambien la pagina de Resumen Financiero).
    const [resumen, graficoDiario] = await Promise.all([
      this.service.getResumen(empresaId, query),
      this.service.getGraficoDiario(
        empresaId,
        query.fechaDesde,
        query.fechaHasta,
        query.sedeId,
      ),
    ]);
    return { resumen, graficoDiario };
  }
}
