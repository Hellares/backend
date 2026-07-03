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

  @Get('items-previos/:empresaId')
  @ApiOperation({ summary: 'Obtener items de la última solicitud para pre-llenar' })
  async getItemsPrevios(
    @CurrentUser('sub') usuarioId: string,
    @Param('empresaId') empresaId: string,
  ) {
    return this.service.getItemsPrevios(usuarioId, empresaId);
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

  // ─── Cotización formal (respuesta de la empresa) vista por el cliente ───

  @Get(':id/cotizacion')
  @ApiOperation({ summary: 'Ver la cotización formal de mi solicitud' })
  async miCotizacion(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.service.miCotizacion(usuarioId, { solicitudId: id });
  }

  @Post(':id/cotizacion/aceptar')
  @ApiOperation({ summary: 'Aceptar la cotización (sin adelanto)' })
  async aceptarCotizacion(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.service.aceptarCotizacion(usuarioId, { solicitudId: id });
  }

  @Post(':id/cotizacion/rechazar')
  @ApiOperation({ summary: 'Rechazar la cotización' })
  async rechazarCotizacion(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.service.rechazarCotizacion(usuarioId, { solicitudId: id });
  }

  @Post(':id/cotizacion/cobro-yape')
  @ApiOperation({
    summary:
      'Pagar la cotización (total o parcial) con Yape/Plin automático (api-yape). ' +
      'Sin `monto` usa el adelanto requerido (o el saldo completo). El webhook ' +
      'acumula el pago, reserva stock y aprueba solo.',
  })
  async cobroYapeAdelanto(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
    @Body('monto') monto?: number,
  ) {
    return this.service.cobroYapeAdelanto(usuarioId, { solicitudId: id }, monto);
  }
}

// ─── COTIZACIONES DEL CLIENTE (marketplace, JWT only) ───
// Todas las cotizaciones dirigidas al usuario: las de sus solicitudes +
// las que una empresa le creó DIRECTAMENTE (match por su Persona/DNI).

@ApiTags('Marketplace - Mis Cotizaciones')
@Controller('marketplace/cotizaciones')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MarketplaceCotizacionController {
  constructor(private readonly service: SolicitudCotizacionService) {}

  @Get()
  @ApiOperation({ summary: 'Listar mis cotizaciones (de solicitudes + directas)' })
  async misCotizaciones(@CurrentUser('sub') usuarioId: string) {
    return this.service.misCotizaciones(usuarioId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una cotización dirigida a mí' })
  async detalle(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.service.miCotizacion(usuarioId, { cotizacionId: id });
  }

  @Post(':id/aceptar')
  @ApiOperation({ summary: 'Aceptar la cotización (sin adelanto)' })
  async aceptar(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.service.aceptarCotizacion(usuarioId, { cotizacionId: id });
  }

  @Post(':id/rechazar')
  @ApiOperation({ summary: 'Rechazar la cotización' })
  async rechazar(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.service.rechazarCotizacion(usuarioId, { cotizacionId: id });
  }

  @Post(':id/cobro-yape')
  @ApiOperation({ summary: 'Pagar la cotización (total o parcial) con Yape/Plin' })
  async cobroYape(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
    @Body('monto') monto?: number,
  ) {
    return this.service.cobroYapeAdelanto(usuarioId, { cotizacionId: id }, monto);
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
