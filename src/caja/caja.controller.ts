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
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CajaService } from './caja.service';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';

@ApiTags('Caja')
@Controller('caja')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CajaController {
  constructor(private readonly cajaService: CajaService) {}

  @Post('abrir')
  @RequiresPermission(Permission.MANAGE_CAJA)
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
  @RequiresPermission(Permission.MANAGE_CAJA)
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
}
