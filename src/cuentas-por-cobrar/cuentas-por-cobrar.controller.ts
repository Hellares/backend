import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
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
import { QueryCuentasCobrarDto } from './dto/query-cuentas-cobrar.dto';
import { UpdateConfiguracionMoraDto } from './dto/update-configuracion-mora.dto';

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
    @Query() query: QueryCuentasCobrarDto,
  ) {
    return this.service.listar(empresaId, query);
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Resumen de cuentas por cobrar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async resumen(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getResumen(empresaId);
  }

  @Get('configuracion-mora')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Obtener configuración de mora' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getConfiguracionMora(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getConfiguracionMora(empresaId);
  }

  @Patch('configuracion-mora')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Actualizar configuración de mora' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async updateConfiguracionMora(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: UpdateConfiguracionMoraDto,
  ) {
    return this.service.updateConfiguracionMora(empresaId, dto);
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
