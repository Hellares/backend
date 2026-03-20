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
import { SolicitudCotizacionService } from './solicitud-cotizacion.service';
import { CrearSolicitudDto, RechazarSolicitudDto } from './dto/solicitud-cotizacion.dto';
import { EstadoSolicitudCotizacion } from '@prisma/client';

// ─── ENDPOINTS DEL CLIENTE (marketplace, JWT only) ───

@ApiTags('Marketplace - Solicitudes de Cotización')
@Controller('marketplace/solicitudes-cotizacion')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SolicitudCotizacionClienteController {
  constructor(private readonly service: SolicitudCotizacionService) {}

  @Post()
  @ApiOperation({ summary: 'Crear solicitud de cotización' })
  async crear(
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: CrearSolicitudDto,
  ) {
    return this.service.crear(usuarioId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar mis solicitudes de cotización' })
  async misSolicitudes(@CurrentUser('sub') usuarioId: string) {
    return this.service.misSolicitudes(usuarioId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una solicitud' })
  async detalle(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.service.miSolicitudDetalle(usuarioId, id);
  }

  @Post(':id/cancelar')
  @ApiOperation({ summary: 'Cancelar solicitud' })
  async cancelar(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.service.cancelar(usuarioId, id);
  }
}

// ─── ENDPOINTS DE LA EMPRESA (con tenant) ───

@ApiTags('Solicitudes de Cotización - Empresa')
@Controller('solicitudes-cotizacion')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SolicitudCotizacionEmpresaController {
  constructor(private readonly service: SolicitudCotizacionService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_COTIZACIONES)
  @ApiOperation({ summary: 'Listar solicitudes recibidas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('estado') estado?: EstadoSolicitudCotizacion,
    @Query('search') search?: string,
  ) {
    return this.service.listarRecibidas(empresaId, { estado, search });
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_COTIZACIONES)
  @ApiOperation({ summary: 'Detalle de solicitud recibida' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async detalle(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.detalleRecibida(empresaId, id);
  }

  @Post(':id/rechazar')
  @RequiresPermission(Permission.MANAGE_COTIZACIONES)
  @ApiOperation({ summary: 'Rechazar solicitud' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async rechazar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: RechazarSolicitudDto,
  ) {
    return this.service.rechazar(empresaId, id, dto);
  }

  @Post(':id/cotizar')
  @RequiresPermission(Permission.MANAGE_COTIZACIONES)
  @ApiOperation({ summary: 'Vincular cotización a la solicitud' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cotizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() body: { cotizacionId: string },
  ) {
    return this.service.cotizar(empresaId, id, body.cotizacionId);
  }
}
