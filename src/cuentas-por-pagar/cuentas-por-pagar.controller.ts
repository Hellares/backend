import {
  Controller,
  Get,
  Post,
  Body,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CuentasPorPagarService } from './cuentas-por-pagar.service';
import { MetodoPagoVenta } from '@prisma/client';

@ApiTags('Cuentas por Pagar')
@Controller('cuentas-por-pagar')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CuentasPorPagarController {
  constructor(private readonly service: CuentasPorPagarService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Listar cuentas por pagar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('estado') estado?: 'PENDIENTE' | 'VENCIDA' | 'PAGADA',
    @Query('proveedorId') proveedorId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listar(empresaId, { estado, proveedorId, search });
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Resumen de cuentas por pagar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async resumen(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getResumen(empresaId);
  }

  @Post(':compraId/pago')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Registrar pago a proveedor' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarPago(
    @Headers('x-tenant-id') empresaId: string,
    @Param('compraId') compraId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: {
      metodoPago: MetodoPagoVenta;
      monto: number;
      referencia?: string;
      bancoDestino?: string;
      cuentaDestino?: string;
    },
  ) {
    return this.service.registrarPago(empresaId, compraId, usuarioId, body);
  }
}
