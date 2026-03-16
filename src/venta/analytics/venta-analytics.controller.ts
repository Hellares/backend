import { Controller, Get, Query, UseGuards, Headers } from '@nestjs/common';
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
import { VentaAnalyticsService } from './venta-analytics.service';
import { VentaAnalyticsQueryDto } from './dto/venta-analytics.dto';

@ApiTags('Venta Analytics')
@Controller('ventas/analytics')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class VentaAnalyticsController {
  constructor(
    private readonly ventaAnalyticsService: VentaAnalyticsService,
  ) {}

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Resumen general de ventas' })
  @ApiResponse({ status: 200, description: 'Resumen obtenido exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getResumen(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getResumenGeneral(empresaId, query);
  }

  @Get('ventas-periodo')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Ventas agrupadas por periodo' })
  @ApiResponse({ status: 200, description: 'Datos por periodo obtenidos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getVentasPorPeriodo(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getVentasPorPeriodo(empresaId, query);
  }

  @Get('top-productos')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Top productos mas vendidos' })
  @ApiResponse({ status: 200, description: 'Top productos obtenidos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getTopProductos(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getTopProductos(empresaId, query);
  }

  @Get('top-clientes')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Top clientes por monto de compras' })
  @ApiResponse({ status: 200, description: 'Top clientes obtenidos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getTopClientes(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getTopClientes(empresaId, query);
  }

  @Get('comparativo')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Comparativo de ventas entre periodos' })
  @ApiResponse({ status: 200, description: 'Comparativo obtenido' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getComparativo(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getComparativoVentas(empresaId, query);
  }

  @Get('alertas')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Alertas de ventas' })
  @ApiResponse({ status: 200, description: 'Alertas obtenidas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getAlertas(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getAlertasVentas(
      empresaId,
      query.sedeId,
    );
  }
}
