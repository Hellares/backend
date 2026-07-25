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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
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

  @Get('dashboard-vendedor')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Dashboard personalizado del vendedor' })
  @ApiResponse({ status: 200, description: 'Dashboard del vendedor obtenido exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getDashboardVendedor(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Query('vendedorId') vendedorId?: string,
    @Query('sedeId') sedeId?: string,
  ) {
    // Si no se pasa vendedorId, usar el del usuario logueado
    const targetVendedorId = vendedorId || user.sub;
    return this.ventaAnalyticsService.getDashboardVendedor(empresaId, targetVendedorId, sedeId);
  }

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

  @Get('ventas-por-canal')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Distribucion de ventas por canal y por envio' })
  @ApiResponse({ status: 200, description: 'Distribucion por canal obtenida' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getVentasPorCanal(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getVentasPorCanal(empresaId, query);
  }

  @Get('ventas-por-categoria')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Ventas agrupadas por categoria de producto' })
  @ApiResponse({ status: 200, description: 'Ventas por categoria obtenidas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getVentasPorCategoria(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getVentasPorCategoria(empresaId, query);
  }

  @Get('ventas-por-marca')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Ventas agrupadas por marca de producto' })
  @ApiResponse({ status: 200, description: 'Ventas por marca obtenidas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getVentasPorMarca(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getVentasPorMarca(empresaId, query);
  }

  @Get('reposicion')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Reposicion sugerida: velocidad 30d vs stock actual (por variante)' })
  @ApiResponse({ status: 200, description: 'Reposicion sugerida obtenida' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getReposicionSugerida(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getReposicionSugerida(empresaId, query);
  }

  @Get('horas-pico')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Ventas por hora del dia y dia de semana (hora Peru)' })
  @ApiResponse({ status: 200, description: 'Horas pico obtenidas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getHorasPico(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getHorasPico(empresaId, query);
  }

  @Get('metodos-pago')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Distribucion de pagos cobrados por metodo' })
  @ApiResponse({ status: 200, description: 'Metodos de pago obtenidos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getMetodosPago(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getMetodosPago(empresaId, query);
  }

  @Get('entregas')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Distribucion por tipo de entrega + zonas top de envio/delivery' })
  @ApiResponse({ status: 200, description: 'Analytics de entregas obtenido' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getEntregasAnalytics(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getEntregasAnalytics(empresaId, query);
  }

  @Get('ventas-por-proveedor')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Ventas agrupadas por proveedor del producto (vinculo preferido)' })
  @ApiResponse({ status: 200, description: 'Ventas por proveedor obtenidas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getVentasPorProveedor(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VentaAnalyticsQueryDto,
  ) {
    return this.ventaAnalyticsService.getVentasPorProveedor(empresaId, query);
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
