import {
  Controller,
  Get,
  Post,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';
import { QueryCuentasCobrarDto } from './dto/query-cuentas-cobrar.dto';
import { UpdateConfiguracionMoraDto } from './dto/update-configuracion-mora.dto';
import { RegistrarAbonoDto } from './dto/registrar-abono.dto';

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

  @Get('por-cliente')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Deuda por cobrar agrupada por cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async porCliente(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getPorCliente(empresaId);
  }

  @Post(':ventaId/abono')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Registrar un abono a una venta a crédito' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarAbono(
    @Headers('x-tenant-id') empresaId: string,
    @Param('ventaId') ventaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: RegistrarAbonoDto,
  ) {
    return this.service.registrarAbono(empresaId, ventaId, body, usuarioId);
  }

  @Post('pagos/:pagoId/anular')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary: 'Anular un abono (revierte el ingreso y recomputa las cuotas)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async anularAbono(
    @Headers('x-tenant-id') empresaId: string,
    @Param('pagoId') pagoId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: { motivo?: string },
  ) {
    return this.service.anularAbono(empresaId, pagoId, usuarioId, body?.motivo);
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
