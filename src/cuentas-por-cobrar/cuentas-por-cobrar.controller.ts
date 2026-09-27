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
import { ReportesAbonoService } from './reportes-abono.service';
import { EstadoReporteAbono, FuenteIngreso } from '@prisma/client';

@ApiTags('Cuentas por Cobrar')
@Controller('cuentas-por-cobrar')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CuentasPorCobrarController {
  constructor(
    private readonly service: CuentasPorCobrarService,
    private readonly reportes: ReportesAbonoService,
  ) {}

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

  @Get('estado-cuenta-cliente')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({
    summary: 'Estado de cuenta de un cliente (ventas a crédito + abonos + saldo)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async estadoCuentaCliente(
    @Headers('x-tenant-id') empresaId: string,
    @Query('clienteId') clienteId?: string,
    @Query('clienteEmpresaId') clienteEmpresaId?: string,
  ) {
    return this.service.getEstadoCuentaCliente(empresaId, {
      clienteId,
      clienteEmpresaId,
    });
  }

  // ── Pagos que reportan los clientes desde la tienda web ──
  // (antes de `:ventaId`: si no, "reportes-abono" se tomaría como una venta)

  @Get('reportes-abono')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Pagos reportados por clientes desde la tienda web' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listarReportes(
    @Headers('x-tenant-id') empresaId: string,
    @Query('estado') estado?: EstadoReporteAbono,
  ) {
    const valido = estado && ['PENDIENTE', 'APROBADO', 'RECHAZADO'].includes(estado) ? estado : 'PENDIENTE';
    return this.reportes.listar(empresaId, valido);
  }

  @Get('reportes-abono/pendientes')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Cuántos pagos reportados esperan revisión' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async contarReportes(@Headers('x-tenant-id') empresaId: string) {
    return this.reportes.contarPendientes(empresaId);
  }

  @Post('reportes-abono/:id/aprobar')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Aprobar un pago reportado: registra el abono' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async aprobarReporte(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: { fuente?: FuenteIngreso; bancoId?: string },
  ) {
    const fuente = body?.fuente && Object.values(FuenteIngreso).includes(body.fuente) ? body.fuente : undefined;
    return this.reportes.aprobar(empresaId, id, usuarioId, { fuente, bancoId: body?.bancoId || undefined });
  }

  @Post('reportes-abono/:id/rechazar')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Rechazar un pago reportado (el cliente ve el motivo)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async rechazarReporte(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: { motivo?: string },
  ) {
    return this.reportes.rechazar(empresaId, id, usuarioId, body?.motivo ?? '');
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
