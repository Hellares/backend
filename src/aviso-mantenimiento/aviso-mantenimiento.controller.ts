import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequiresPermission,
  Permission,
} from '../auth/decorators/requires-permission.decorator';
import { AvisoMantenimientoService } from './aviso-mantenimiento.service';
import { AvisoMantenimientoTaskService } from './aviso-mantenimiento-task.service';
import { QueryAvisoMantenimientoDto } from './dto/query-aviso-mantenimiento.dto';
import { UpdateEstadoAvisoDto } from './dto/update-estado-aviso.dto';
import { UpdateConfiguracionAvisoDto } from './dto/update-configuracion-aviso.dto';

@ApiTags('Avisos de Mantenimiento')
@Controller('avisos-mantenimiento')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AvisoMantenimientoController {
  constructor(
    private readonly avisoMantenimientoService: AvisoMantenimientoService,
    private readonly avisoMantenimientoTaskService: AvisoMantenimientoTaskService,
  ) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar avisos de mantenimiento' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryAvisoMantenimientoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.avisoMantenimientoService.findAll(empresaId, query);
  }

  @Get('resumen')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Resumen de avisos de mantenimiento' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getResumen(@Headers('x-tenant-id') empresaId: string) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.avisoMantenimientoService.getResumen(empresaId);
  }

  @Get('configuracion')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener configuración de avisos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getConfiguracion(@Headers('x-tenant-id') empresaId: string) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.avisoMantenimientoService.getConfiguracion(empresaId);
  }

  @Put('configuracion')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Actualizar configuración de avisos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  updateConfiguracion(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: UpdateConfiguracionAvisoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.avisoMantenimientoService.updateConfiguracion(empresaId, dto);
  }

  @Post('generar')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Generar avisos manualmente para órdenes completadas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async generarAvisos(@Headers('x-tenant-id') empresaId: string) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.avisoMantenimientoTaskService.generarAvisosParaEmpresaManual(empresaId);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener un aviso de mantenimiento' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.avisoMantenimientoService.findOne(empresaId, id);
  }

  @Patch(':id/estado')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Cambiar estado de un aviso' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  updateEstado(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEstadoAvisoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.avisoMantenimientoService.updateEstado(empresaId, id, dto);
  }
}
