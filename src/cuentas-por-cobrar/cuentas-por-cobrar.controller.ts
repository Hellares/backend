import {
  Controller,
  Get,
  Param,
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
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';

@ApiTags('Cuentas por Cobrar')
@Controller('cuentas-por-cobrar')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CuentasPorCobrarController {
  constructor(private readonly service: CuentasPorCobrarService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Listar cuentas por cobrar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('estado') estado?: 'PENDIENTE' | 'VENCIDA' | 'PAGADA',
    @Query('clienteId') clienteId?: string,
    @Query('sedeId') sedeId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listar(empresaId, { estado, clienteId, sedeId, search });
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Resumen de cuentas por cobrar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async resumen(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getResumen(empresaId);
  }

  @Get(':ventaId')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Detalle de una cuenta por cobrar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async detalle(
    @Headers('x-tenant-id') empresaId: string,
    @Param('ventaId') ventaId: string,
  ) {
    return this.service.getDetalle(empresaId, ventaId);
  }
}
