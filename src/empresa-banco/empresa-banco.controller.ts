import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { EmpresaBancoService } from './empresa-banco.service';
import {
  CrearEmpresaBancoDto,
  ActualizarEmpresaBancoDto,
  ActualizarSaldoDto,
} from './dto/crear-empresa-banco.dto';
import { AjusteBancoDto } from './dto/ajuste-banco.dto';

@ApiTags('Cuentas Bancarias Empresa')
@Controller('empresa-banco')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class EmpresaBancoController {
  constructor(private readonly service: EmpresaBancoService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Listar cuentas bancarias de la empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(@Headers('x-tenant-id') empresaId: string) {
    return this.service.listar(empresaId);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Crear cuenta bancaria' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() body: CrearEmpresaBancoDto,
  ) {
    return this.service.crear(empresaId, body);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Actualizar cuenta bancaria' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() body: ActualizarEmpresaBancoDto,
  ) {
    return this.service.actualizar(empresaId, id, body);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Eliminar cuenta bancaria' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async eliminar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.eliminar(empresaId, id);
  }

  @Post(':id/principal')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Marcar como cuenta principal' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async marcarPrincipal(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.marcarPrincipal(empresaId, id);
  }

  @Patch(':id/saldo')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Conciliar saldo: fija el saldo real del extracto y asienta el delta' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizarSaldo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: ActualizarSaldoDto,
  ) {
    return this.service.conciliar(empresaId, id, usuarioId, body.saldo);
  }

  @Post(':id/ajuste')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Ajuste manual del saldo (+/-) con motivo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async ajustar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: AjusteBancoDto,
  ) {
    return this.service.ajustar(empresaId, id, usuarioId, body);
  }

  @Get(':id/ajustes')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Historial de ajustes/conciliaciones de la cuenta' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getAjustes(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.getAjustes(empresaId, id);
  }

  @Get(':id/estado-cuenta')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Estado de cuenta real del banco (recaudación, pagos y ajustes del período)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getEstadoCuenta(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.service.getEstadoCuenta(empresaId, id, fechaDesde, fechaHasta);
  }

  @Get(':id/conciliacion')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Conciliación bancaria (legacy)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getConciliacion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.service.getConciliacion(empresaId, id, fechaDesde, fechaHasta);
  }
}
