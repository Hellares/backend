import {
  Body,
  Controller,
  Get,
  Param,
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
  CancelarDeliveryDto,
  ReportarPosicionDto,
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
  @ApiOperation({ summary: 'Marcar delivery entregado' })
  entregado(
    @Param('id') id: string,
    @Body() dto: AccionDeliveryDto,
    @CurrentUser() user: any,
  ) {
    return this.service.marcarEntregado(dto.empresaId, id, user.sub);
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
