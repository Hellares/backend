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
import { DepositosClienteService } from './depositos-cliente.service';
import { AplicarDepositoDto, RegistrarDepositoDto } from './dto/deposito-cliente.dto';
import { EstadoReporteAbono, FuenteIngreso } from '@prisma/client';

@ApiTags('Cuentas por Cobrar')
@Controller('cuentas-por-cobrar')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CuentasPorCobrarController {
  constructor(
    private readonly service: CuentasPorCobrarService,
    private readonly reportes: ReportesAbonoService,
    private readonly depositos: DepositosClienteService,
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
    const estado = await this.service.getEstadoCuentaCliente(empresaId, {
      clienteId,
      clienteEmpresaId,
    });
    // Lo que el cliente entregó y todavía no se aplicó a ninguna venta.
    const saldoAFavor = await this.depositos.saldoAFavor(empresaId, { clienteId, clienteEmpresaId });
    return { ...estado, resumen: { ...estado.resumen, saldoAFavor } };
  }

  // ── Depósitos del cliente sin repartir + saldo a favor ──
  // (antes de `:ventaId`: si no, "depositos" se tomaría como una venta)

  @Get('depositos')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Depósitos de un cliente y su saldo a favor' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listarDepositos(
    @Headers('x-tenant-id') empresaId: string,
    @Query('clienteId') clienteId?: string,
    @Query('clienteEmpresaId') clienteEmpresaId?: string,
  ) {
    return this.depositos.listar(empresaId, { clienteId, clienteEmpresaId });
  }

  @Get('depositos/sugerencia')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Cómo repartir un monto entre las ventas con deuda del cliente (cuotas completas, la que vence primero)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async sugerirReparto(
    @Headers('x-tenant-id') empresaId: string,
    @Query('monto') monto: string,
    @Query('clienteId') clienteId?: string,
    @Query('clienteEmpresaId') clienteEmpresaId?: string,
  ) {
    return this.depositos.sugerirReparto(empresaId, { clienteId, clienteEmpresaId }, Number(monto));
  }

  @Post('depositos')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Registrar un depósito del cliente (y repartirlo, si vienen líneas)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarDeposito(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: RegistrarDepositoDto,
  ) {
    return this.depositos.registrar(empresaId, usuarioId, body);
  }

  @Post('depositos/aplicar')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Repartir el saldo a favor del cliente entre sus ventas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async aplicarSaldo(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: AplicarDepositoDto,
  ) {
    return this.depositos.aplicarSaldo(
      empresaId,
      { clienteId: body.clienteId, clienteEmpresaId: body.clienteEmpresaId },
      usuarioId,
      body.lineas,
    );
  }

  @Post('depositos/:id/anular')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Anular un depósito sin repartir (revierte el ingreso)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async anularDeposito(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: { motivo?: string },
  ) {
    return this.depositos.anular(empresaId, id, usuarioId, body?.motivo);
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
    @Body() body: { fuente?: FuenteIngreso; bancoId?: string; sedeId?: string },
  ) {
    const fuente = body?.fuente && Object.values(FuenteIngreso).includes(body.fuente) ? body.fuente : undefined;
    return this.reportes.aprobar(empresaId, id, usuarioId, {
      fuente,
      bancoId: body?.bancoId || undefined,
      sedeId: body?.sedeId || undefined,
    });
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
