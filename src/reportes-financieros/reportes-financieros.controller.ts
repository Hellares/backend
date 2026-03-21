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

  @Get('export/libro-contable')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Exportar libro contable mensual (Excel)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportLibroContable(
    @Headers('x-tenant-id') empresaId: string,
    @Query('mes', ParseIntPipe) mes: number,
    @Query('anio', ParseIntPipe) anio: number,
    @Res() res: Response,
  ) {
    this.validateMesAnio(mes, anio);
    await this.exportService.exportLibroContable(empresaId, mes, anio, res);
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
}
