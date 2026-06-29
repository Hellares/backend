import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { SedeAccessGuard } from '../auth/guards/sede-access.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CajaService } from './caja.service';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import { AnularMovimientoDto } from './dto/anular-movimiento.dto';
import { CrearArqueoDto } from './dto/crear-arqueo.dto';
import { AjusteTesoreriaDto } from './dto/ajuste-tesoreria.dto';

@ApiTags('Caja')
@Controller('caja')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Post('abrir')
  @UseGuards(SedeAccessGuard)
  @RequiresPermission(Permission.ABRIR_CAJA)
  @ApiOperation({ summary: 'Abrir una nueva caja' })
  @ApiResponse({ status: 201, description: 'Caja abierta exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async abrirCaja(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: AbrirCajaDto,
  ) {
    return this.cajaService.abrirCaja(empresaId, usuarioId, dto);
  }

  @Get('activa')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Obtener caja activa del usuario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getCajaActiva(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.cajaService.getCajaActiva(empresaId, usuarioId);
  }

  @Post(':id/movimiento')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Registrar movimiento manual en la caja' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearMovimiento(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: CrearMovimientoDto,
  ) {
    return this.cajaService.crearMovimiento(empresaId, cajaId, usuarioId, dto);
  }

  @Post(':cajaId/movimiento/:movimientoId/anular')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Anular un movimiento manual de caja' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async anularMovimiento(
    @Headers('x-tenant-id') empresaId: string,
    @Param('cajaId') cajaId: string,
    @Param('movimientoId') movimientoId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: AnularMovimientoDto,
  ) {
    return this.cajaService.anularMovimiento(empresaId, cajaId, movimientoId, usuarioId, dto);
  }

  @Get(':id/movimientos')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Listar movimientos de una caja' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getMovimientos(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaId: string,
  ) {
    return this.cajaService.getMovimientos(empresaId, cajaId);
  }

  @Post(':id/cerrar')
  @RequiresPermission(Permission.CERRAR_CAJA)
  @ApiOperation({ summary: 'Cerrar caja con conteo físico' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cerrarCaja(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: CerrarCajaDto,
  ) {
    return this.cajaService.cerrarCaja(empresaId, cajaId, usuarioId, dto);
  }

  @Get('historial')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Historial de cajas cerradas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getHistorial(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.cajaService.getHistorial(empresaId, sedeId, fechaDesde, fechaHasta);
  }

  @Get('monitor')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Monitor de cajas abiertas en tiempo real' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getMonitor(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.cajaService.getMonitor(empresaId, sedeId);
  }

  @Get(':id/resumen')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Resumen de una caja (totales por método de pago)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getResumen(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaId: string,
  ) {
    return this.cajaService.getResumen(empresaId, cajaId);
  }

  @Get(':id/auditoria')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({
    summary:
      'Auditoría completa de una caja (apertura → cierre): caja + cierre + arqueos + TODOS los movimientos (incluye anulados y contrapartidas).',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getAuditoria(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaId: string,
  ) {
    return this.cajaService.getAuditoria(empresaId, cajaId);
  }

  @Post(':id/arqueo')
  @RequiresPermission(Permission.CERRAR_CAJA)
  @ApiOperation({
    summary: 'Realizar arqueo de caja (conteo intermedio sin cerrar)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearArqueo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: CrearArqueoDto,
  ) {
    return this.cajaService.crearArqueo(empresaId, cajaId, usuarioId, dto);
  }

  @Get(':id/arqueos')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Listar arqueos de una caja' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getArqueos(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaId: string,
  ) {
    return this.cajaService.getArqueos(empresaId, cajaId);
  }

  @Get('configuracion')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Obtener configuración de caja de la empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getConfiguracion(@Headers('x-tenant-id') empresaId: string) {
    return this.cajaService.getConfiguracion(empresaId);
  }

  @Patch('configuracion')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Actualizar configuración de caja' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async updateConfiguracion(
    @Headers('x-tenant-id') empresaId: string,
    @Body() body: { requiereCajaParaVender: boolean },
  ) {
    return this.cajaService.updateConfiguracion(empresaId, body.requiereCajaParaVender);
  }

  // ───── Caja Central (Tesoreria) por sede ─────
  // IMPORTANTE: los endpoints 'tesoreria/:sedeId*' deben declararse ANTES
  // del comodín ':id' para que NestJS no los capture como id.

  @Get('tesoreria-consolidado')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({
    summary:
      'Vista consolidada de tesorería: bóveda(s) de efectivo por sede + cuentas bancarias con saldo y método que recaudan.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getTesoreriaConsolidado(@Headers('x-tenant-id') empresaId: string) {
    return this.cajaService.getTesoreriaConsolidado(empresaId);
  }

  @Post('tesoreria/migrar-digital-historico')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({
    summary:
      'Mueve el digital histórico de tesorería a los bancos según el mapeo de recaudación. Idempotente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async migrarDigitalHistorico(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.cajaService.migrarDigitalHistorico(empresaId, usuarioId);
  }

  @Get('tesoreria/:sedeId')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({
    summary:
      'Resumen de la Caja Central (Tesorería) de una sede: saldo efectivo, saldo digital, totales y último movimiento. Auto-crea la central si no existe.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getTesoreriaResumen(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
  ) {
    return this.cajaService.getTesoreriaResumen(empresaId, sedeId);
  }

  @Get('tesoreria/:sedeId/movimientos')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({
    summary:
      'Movimientos de la Caja Central de una sede con filtros opcionales (tipo, método, categoría, fechas, búsqueda) y paginación.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getTesoreriaMovimientos(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Query('tipo') tipo?: string,
    @Query('metodoPago') metodoPago?: string,
    @Query('categoria') categoria?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.cajaService.getTesoreriaMovimientos(empresaId, sedeId, {
      tipo,
      metodoPago,
      categoria,
      fechaDesde,
      fechaHasta,
      q,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
    });
  }

  @Post('tesoreria/:sedeId/ajuste')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({
    summary:
      'Ajuste manual en la Caja Central (depósito o retiro). Categoria AJUSTE_TESORERIA. Solo admin/gerente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearAjusteTesoreria(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: AjusteTesoreriaDto,
  ) {
    return this.cajaService.crearAjusteTesoreria(
      empresaId,
      sedeId,
      usuarioId,
      dto,
    );
  }

  /**
   * Devuelve la caja con saldos calculados — mismo shape que /caja/activa
   * pero por id en vez de "mi caja activa". Lo usa el admin desde el monitor
   * para abrir el dashboard de la caja de otro cajero y operarla
   * (arqueo, cerrar) reusando la CajaPage del cajero.
   *
   * IMPORTANTE: este endpoint va AL FINAL del controller porque NestJS
   * matchea rutas en orden de declaración. Si :id estuviera antes de
   * 'monitor', 'historial' o 'configuracion', el comodín capturaría
   * esas rutas literales y devolvería 404 (la cadena no existe como id).
   */
  @Get(':id')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Obtener una caja por id (vista admin)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getCajaPorId(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaId: string,
  ) {
    return this.cajaService.getCajaPorId(empresaId, cajaId);
  }
}
