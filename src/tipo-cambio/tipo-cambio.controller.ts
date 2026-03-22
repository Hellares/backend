import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { TipoCambioService } from './tipo-cambio.service';

@ApiTags('Tipo de Cambio')
@Controller('tipo-cambio')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TipoCambioController {
  constructor(private readonly service: TipoCambioService) {}

  @Get('hoy')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Tipo de cambio del dia (API o manual)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getHoy(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getHoy(empresaId);
  }

  @Get('historial')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Historial de tipos de cambio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getHistorial(
    @Headers('x-tenant-id') empresaId: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getHistorial(empresaId, {
      fechaDesde,
      fechaHasta,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Post('manual')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Registrar tipo de cambio manual' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarManual(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: { compra: number; venta: number; fecha?: string },
  ) {
    return this.service.registrarManual(empresaId, dto);
  }

  @Get('configuracion')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Configuracion de monedas de la empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getConfiguracion(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getConfiguracion(empresaId);
  }
}
