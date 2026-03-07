import {
  Controller,
  Get,
  Query,
  UseGuards,
  Headers,
  Param,
  Res,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { CompraAnalyticsService } from './compra-analytics.service';
import { CompraAnalyticsExportService } from './compra-analytics-export.service';
import { CompraAnalyticsQueryDto } from './dto/compra-analytics.dto';

@ApiTags('Compra Analytics')
@Controller('empresas/:empresaId/compra/analytics')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CompraAnalyticsController {
  private static readonly MAX_EXPORT_MONTHS = 3;

  constructor(
    private readonly analyticsService: CompraAnalyticsService,
    private readonly exportService: CompraAnalyticsExportService,
  ) {}

  private validateExportDateRange(fechaInicio: string, fechaFin: string): void {
    if (!fechaInicio || !fechaFin) {
      throw new BadRequestException('fechaInicio y fechaFin son requeridos para exportar');
    }
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    if (isNaN(inicio.getTime()) || isNaN(fin.getTime())) {
      throw new BadRequestException('Las fechas proporcionadas no son válidas');
    }
    if (fin < inicio) {
      throw new BadRequestException('fechaFin no puede ser anterior a fechaInicio');
    }
    const maxFin = new Date(inicio);
    maxFin.setMonth(maxFin.getMonth() + CompraAnalyticsController.MAX_EXPORT_MONTHS);
    if (fin > maxFin) {
      throw new BadRequestException(
        `El rango máximo de exportación es de ${CompraAnalyticsController.MAX_EXPORT_MONTHS} meses`,
      );
    }
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Resumen general de compras (KPIs)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getResumen(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: CompraAnalyticsQueryDto,
  ) {
    return this.analyticsService.getResumenGeneral(empresaId, query);
  }

  @Get('gastos-periodo')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Gastos agrupados por periodo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getGastosPorPeriodo(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: CompraAnalyticsQueryDto,
  ) {
    return this.analyticsService.getGastosPorPeriodo(empresaId, query);
  }

  @Get('top-productos')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Top productos por costo de compra' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getTopProductos(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: CompraAnalyticsQueryDto,
  ) {
    return this.analyticsService.getTopProductos(empresaId, query);
  }

  @Get('top-proveedores')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Top proveedores por monto total' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getTopProveedores(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: CompraAnalyticsQueryDto,
  ) {
    return this.analyticsService.getTopProveedores(empresaId, query);
  }

  @Get('historial-precios/:productoId')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Historial de precios de un producto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getHistorialPrecios(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Query() query: CompraAnalyticsQueryDto,
  ) {
    return this.analyticsService.getHistorialPrecios(empresaId, productoId, query.sedeId);
  }

  @Get('comparativo-costos')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Comparativo de costos periodo actual vs anterior' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getComparativoCostos(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: CompraAnalyticsQueryDto,
  ) {
    return this.analyticsService.getComparativoCostos(empresaId, query);
  }

  @Get('alertas')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Alertas de compras (OC pendientes, vencimientos, etc.)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getAlertas(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: CompraAnalyticsQueryDto,
  ) {
    return this.analyticsService.getAlertasCompras(empresaId, query.sedeId);
  }

  @Get('export/productos')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Exportar detalle de compras por producto (Excel)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportPorProducto(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: CompraAnalyticsQueryDto,
    @Res() res: Response,
  ) {
    this.validateExportDateRange(query.fechaInicio, query.fechaFin);
    await this.exportService.exportDetalladoPorProducto(
      empresaId,
      query.fechaInicio,
      query.fechaFin,
      query.sedeId,
      res,
    );
  }

  @Get('export/proveedores')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Exportar detalle de compras por proveedor (Excel)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportPorProveedor(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: CompraAnalyticsQueryDto,
    @Res() res: Response,
  ) {
    this.validateExportDateRange(query.fechaInicio, query.fechaFin);
    await this.exportService.exportDetalladoPorProveedor(
      empresaId,
      query.fechaInicio,
      query.fechaFin,
      query.sedeId,
      res,
    );
  }
}
