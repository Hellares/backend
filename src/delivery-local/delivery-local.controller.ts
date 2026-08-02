import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeliveryLocalService } from './delivery-local.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import {
  AccionDeliveryDto,
  ActualizarDireccionDeliveryDto,
  CancelarDeliveryDto,
  CompartirUbicacionDto,
  EntregarDeliveryDto,
  ReportarPosicionDto,
  ResolverEnlaceUbicacionDto,
  SolicitarDeliveryDto,
} from './dto/delivery-local.dto';

/**
 * Delivery local (F1). Los permisos son por ROL a nivel de servicio
 * (patrón IaConfigService): staff solicita/cancela, repartidores toman y
 * avanzan estados. El tracking es PÚBLICO por token (el cliente no tiene
 * cuenta) — no expone datos que el cliente no haya dado.
 */
@ApiTags('Delivery local')
@Controller('delivery-local')
export class DeliveryLocalController {
  constructor(private readonly service: DeliveryLocalService) {}

  /** Publica el delivery de una venta pagada al 100% (staff). */
  @Post('solicitar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Solicitar delivery local para una venta pagada' })
  solicitar(@Body() dto: SolicitarDeliveryDto, @CurrentUser() user: any) {
    return this.service.solicitar(user.sub, dto);
  }

  /**
   * Comparte la ubicación de entrega por WhatsApp (instancia de la
   * empresa) a cualquier celular — pin nativo + texto, sin salir del app.
   */
  @Post(':id/compartir-ubicacion')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Compartir ubicación de entrega por WhatsApp' })
  compartirUbicacion(
    @Param('id') id: string,
    @Body() dto: CompartirUbicacionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.compartirUbicacion(user.sub, id, dto);
  }

  /** Delivery INTERNO: el empleado sale con el pedido (staff marca). */
  @Post(':id/interno/en-camino')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Interno: marcar en camino (staff, sin PIN)' })
  enCaminoInterno(
    @Param('id') id: string,
    @Body() dto: AccionDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.service.marcarEnCaminoInterno(dto.empresaId, id, user.sub);
  }

  /** Delivery INTERNO: el empleado entregó (staff marca, sin PIN). */
  @Post(':id/interno/entregado')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Interno: marcar entregado (staff, sin PIN)' })
  entregadoInterno(
    @Param('id') id: string,
    @Body() dto: AccionDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.service.marcarEntregadoInterno(dto.empresaId, id, user.sub);
  }

  /**
   * Edita la dirección de entrega (staff): dirección equivocada o el
   * cliente pidió otro punto. Si el delivery ya fue tomado/va en camino,
   * el repartidor recibe push con la dirección nueva.
   */
  @Patch(':id/direccion')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar dirección de entrega del delivery' })
  actualizarDireccion(
    @Param('id') id: string,
    @Body() dto: ActualizarDireccionDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.service.actualizarDireccion(user.sub, id, dto);
  }

  /**
   * Geocoder propio (Fase 1): busca en las direcciones confirmadas de la
   * empresa (trigram) + recientes del cliente por celular. Lo consulta el
   * picker de ubicación ANTES de caer a geocoders externos.
   */
  @Get('direcciones/buscar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Buscar direcciones frecuentes (geocoder propio)' })
  buscarDirecciones(
    @Query('empresaId') empresaId: string,
    @Query('q') q?: string,
    @Query('telefono') telefono?: string,
  ) {
    return this.service.buscarDirecciones(empresaId, q, telefono);
  }

  /**
   * Fase 2: geocodificación Google server-side (key restringida por IP,
   * nunca en el APK). El picker la dispara por BOTÓN cuando la base propia
   * no encuentra la dirección.
   */
  @Get('direcciones/geocode')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Geocodificar dirección con Google (fallback)' })
  geocodificar(@Query('q') q?: string) {
    return this.service.geocodificarGoogle(q);
  }

  /**
   * Convierte un enlace ACORTADO de Maps (`maps.app.goo.gl/...`) en
   * coordenadas siguiendo la redirección. Lo llama la app cuando el cliente
   * comparte su ubicación por WhatsApp y el enlace viene acortado.
   *
   * Va por POST y no por GET porque la URL entera como query param termina
   * escrita en los logs de acceso.
   */
  @Post('direcciones/resolver-enlace')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resolver enlace acortado de Google Maps' })
  resolverEnlace(@Body() dto: ResolverEnlaceUbicacionDto) {
    return this.service.resolverEnlaceUbicacion(dto.url);
  }

  /** Pool de deliveries disponibles para tomar (repartidor). */
  @Get('disponibles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deliveries disponibles para tomar' })
  disponibles(
    @Query('empresaId') empresaId: string,
    @Query('sedeId') sedeId: string | undefined,
    @CurrentUser() user: any,
  ) {
    return this.service.disponibles(empresaId, user.sub, sedeId || undefined);
  }

  /** Mis entregas (repartidor autenticado). */
  @Get('mis-entregas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Entregas del repartidor autenticado' })
  misEntregas(@Query('empresaId') empresaId: string, @CurrentUser() user: any) {
    return this.service.misEntregas(empresaId, user.sub);
  }

  /** Tomar un delivery (atómico — el primero gana). */
  @Post(':id/tomar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tomar un delivery disponible' })
  tomar(
    @Param('id') id: string,
    @Body() dto: AccionDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.service.tomar(dto.empresaId, id, user.sub);
  }

  @Post(':id/en-camino')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marcar delivery en camino' })
  enCamino(
    @Param('id') id: string,
    @Body() dto: AccionDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.service.marcarEnCamino(dto.empresaId, id, user.sub);
  }

  @Post(':id/entregado')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Marcar entregado (exige el PIN del cliente)' })
  entregado(
    @Param('id') id: string,
    @Body() dto: EntregarDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.service.marcarEntregado(dto.empresaId, id, user.sub, dto.pin);
  }

  // ── Pool EXTERNO (repartidores freelance de Syncronize) ──

  /** Pool cross-empresa del freelance: opt-in + sus zonas + topes. */
  @Get('externo/disponibles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Pool de deliveries para repartidor freelance' })
  poolExterno(@CurrentUser() user: any) {
    return this.service.poolExterno(user.sub);
  }

  /** Entregas del freelance (cruzan empresas). */
  @Get('externo/mis-entregas')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Entregas del repartidor freelance' })
  misEntregasExterno(@CurrentUser() user: any) {
    return this.service.misEntregasFreelance(user.sub);
  }

  /** Tomar como freelance (opt-in + zona + tope + límite de activas). */
  @Post(':id/tomar-externo')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tomar un delivery como repartidor freelance' })
  tomarExterno(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.tomarExterno(id, user.sub);
  }

  /** GPS: posición del repartidor en camino (best-effort, alta frecuencia). */
  @Post(':id/posicion')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reportar posición GPS del repartidor' })
  posicion(
    @Param('id') id: string,
    @Body() dto: ReportarPosicionDto,
    @CurrentUser() user: any,
  ) {
    return this.service.reportarPosicion(
      dto.empresaId,
      id,
      user.sub,
      dto.lat,
      dto.lon,
    );
  }

  /** Cancelar (staff). */
  @Post(':id/cancelar')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancelar un delivery' })
  cancelar(
    @Param('id') id: string,
    @Body() dto: CancelarDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.service.cancelar(user.sub, id, dto);
  }

  /** Seguimiento público por token — SIN auth (el cliente no tiene cuenta). */
  @Get('tracking/:token')
  @ApiOperation({ summary: 'Seguimiento público del delivery' })
  tracking(@Param('token') token: string) {
    return this.service.tracking(token);
  }
}
