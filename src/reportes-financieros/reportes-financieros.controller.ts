import {
  Controller,
  Get,
  Query,
  UseGuards,
  Headers,
  Res,
  ParseIntPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { ReportesFinancierosExportService } from './reportes-financieros-export.service';
import { MotivoLiquidacion } from '@prisma/client';

@ApiTags('Reportes Financieros')
@Controller('reportes-financieros')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ReportesFinancierosController {
  private static readonly MAX_EXPORT_MONTHS = 3;

  constructor(
    private readonly exportService: ReportesFinancierosExportService,
  ) {}

  private validateMesAnio(mes: number, anio: number): void {
    if (mes < 1 || mes > 12) {
      throw new BadRequestException('El mes debe estar entre 1 y 12');
    }
    if (anio < 2020 || anio > 2100) {
      throw new BadRequestException('El año debe estar entre 2020 y 2100');
    }
  }

  @Get('registro-ventas')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({
    summary: 'Registro de Ventas e Ingresos (base formato 14.1 SUNAT)',
    description:
      'Comprobantes fiscales emitidos del mes (01/03/07/08) con bases, IGV y resumen para el PDT 621.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getRegistroVentas(
    @Headers('x-tenant-id') empresaId: string,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
    @Query('sedeId') sedeId?: string,
  ) {
    this.validateMesAnio(mes, anio);
    return this.exportService.getRegistroVentas(empresaId, mes, anio, sedeId);
  }

  @Get('export/registro-ventas')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Exportar Registro de Ventas (Excel)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportRegistroVentas(
    @Headers('x-tenant-id') empresaId: string,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
    @Res() res: Response,
    @Query('sedeId') sedeId?: string,
  ) {
    this.validateMesAnio(mes, anio);
    await this.exportService.exportRegistroVentas(empresaId, mes, anio, res, sedeId);
  }

  @Get('export/libro-contable')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Exportar libro contable mensual (Excel)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportLibroContable(
    @Headers('x-tenant-id') empresaId: string,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
    @Res() res: Response,
    @Query('sedeId') sedeId?: string,
  ) {
    this.validateMesAnio(mes, anio);
    await this.exportService.exportLibroContable(empresaId, mes, anio, res, sedeId);
  }

  @Get('export/cuentas-cobrar')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Exportar cuentas por cobrar (Excel)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportCuentasCobrar(
    @Headers('x-tenant-id') empresaId: string,
    @Res() res: Response,
  ) {
    await this.exportService.exportCuentasPorCobrar(empresaId, res);
  }

  @Get('export/cuentas-pagar')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Exportar cuentas por pagar (Excel)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportCuentasPagar(
    @Headers('x-tenant-id') empresaId: string,
    @Res() res: Response,
  ) {
    await this.exportService.exportCuentasPorPagar(empresaId, res);
  }

  // =====================================================
  // LIQUIDACIONES Y PÉRDIDAS COMERCIALES
  // =====================================================

  private parseFiltrosLiquidacion(
    fechaInicio: string,
    fechaFin: string,
    motivo?: string,
  ): { fechaInicio: Date; fechaFin: Date; motivo?: MotivoLiquidacion } {
    if (!fechaInicio || !fechaFin) {
      throw new BadRequestException('fechaInicio y fechaFin son requeridos (formato YYYY-MM-DD)');
    }
    // Fechas date-only = día calendario PERÚ completo. Antes `new Date(ymd)`
    // caía en medianoche UTC y el `setHours` corría en TZ del server (UTC):
    // las ventas de 19:00-23:59 Perú del último día quedaban FUERA del
    // reporte y las de la noche anterior al primer día entraban de más.
    const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
    const fi = DATE_ONLY.test(fechaInicio)
      ? new Date(`${fechaInicio}T00:00:00.000-05:00`)
      : new Date(fechaInicio);
    const ff = DATE_ONLY.test(fechaFin)
      ? new Date(`${fechaFin}T23:59:59.999-05:00`)
      : new Date(fechaFin);
    if (isNaN(fi.getTime()) || isNaN(ff.getTime())) {
      throw new BadRequestException('Fechas inválidas');
    }
    if (fi > ff) {
      throw new BadRequestException('fechaInicio debe ser anterior a fechaFin');
    }
    if (motivo && !Object.values(MotivoLiquidacion).includes(motivo as MotivoLiquidacion)) {
      throw new BadRequestException(`motivo inválido. Valores válidos: ${Object.values(MotivoLiquidacion).join(', ')}`);
    }
    return { fechaInicio: fi, fechaFin: ff, motivo: motivo as MotivoLiquidacion | undefined };
  }

  @Get('liquidaciones')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({
    summary: 'Reporte de liquidaciones y pérdidas comerciales',
    description: 'Agrega ventas con margen negativo (productos en liquidación o autorización bajo costo).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getReporteLiquidaciones(
    @Headers('x-tenant-id') empresaId: string,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Query('sedeId') sedeId?: string,
    @Query('motivo') motivo?: string,
  ) {
    const filtros = this.parseFiltrosLiquidacion(fechaInicio, fechaFin, motivo);
    return this.exportService.getReporteLiquidaciones(empresaId, { ...filtros, sedeId });
  }

  @Get('export/liquidaciones')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Exportar reporte de liquidaciones (Excel)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportLiquidaciones(
    @Headers('x-tenant-id') empresaId: string,
    @Query('fechaInicio') fechaInicio: string,
    @Query('fechaFin') fechaFin: string,
    @Res() res: Response,
    @Query('sedeId') sedeId?: string,
    @Query('motivo') motivo?: string,
  ) {
    const filtros = this.parseFiltrosLiquidacion(fechaInicio, fechaFin, motivo);
    // Validar rango ≤ 3 meses (igual que otros exports)
    const maxFin = new Date(filtros.fechaInicio);
    maxFin.setMonth(maxFin.getMonth() + ReportesFinancierosController.MAX_EXPORT_MONTHS);
    if (filtros.fechaFin > maxFin) {
      throw new BadRequestException(
        `El rango máximo de exportación es de ${ReportesFinancierosController.MAX_EXPORT_MONTHS} meses`,
      );
    }
    await this.exportService.exportLiquidaciones(empresaId, { ...filtros, sedeId }, res);
  }
}
