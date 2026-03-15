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
  HttpCode,
  HttpStatus,
  BadRequestException,
  Delete,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificacionService } from './notificacion.service';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { TipoNotificacion } from '@prisma/client';

@ApiTags('Notificaciones')
@Controller('notificaciones')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificacionController {
  constructor(private readonly notificacionService: NotificacionService) {}

  // ─── Dispositivos ───

  @Post('dispositivos')
  @ApiOperation({ summary: 'Registrar dispositivo para push notifications' })
  registrarDispositivo(
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.notificacionService.registrarDispositivo(
      usuarioId,
      dto.fcmToken,
      dto.platform,
      dto.deviceInfo,
    );
  }

  @Delete('dispositivos')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desactivar dispositivo (logout)' })
  desactivarDispositivo(
    @CurrentUser('sub') usuarioId: string,
    @Body('fcmToken') fcmToken: string,
  ) {
    if (!fcmToken) throw new BadRequestException('fcmToken es requerido');
    return this.notificacionService.desactivarDispositivo(usuarioId, fcmToken);
  }

  // ─── Preferencias ───

  @Get('preferencias')
  @ApiOperation({ summary: 'Obtener preferencias de notificación' })
  getPreferencias(
    @CurrentUser('sub') usuarioId: string,
  ) {
    return this.notificacionService.getPreferencias(usuarioId);
  }

  @Patch('preferencias/:tipo')
  @ApiOperation({ summary: 'Actualizar preferencia de un tipo de notificación' })
  updatePreferencia(
    @CurrentUser('sub') usuarioId: string,
    @Param('tipo') tipo: string,
    @Body('habilitado') habilitado: boolean,
  ) {
    if (!Object.values(TipoNotificacion).includes(tipo as TipoNotificacion)) {
      throw new BadRequestException(
        `Tipo inválido. Valores permitidos: ${Object.values(TipoNotificacion).join(', ')}`,
      );
    }
    if (typeof habilitado !== 'boolean') {
      throw new BadRequestException('habilitado debe ser true o false');
    }
    return this.notificacionService.updatePreferencia(
      usuarioId,
      tipo as TipoNotificacion,
      habilitado,
    );
  }

  // ─── Notificaciones ───

  @Get()
  @ApiOperation({ summary: 'Listar mis notificaciones' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  listarNotificaciones(
    @CurrentUser('sub') usuarioId: string,
    @Headers('x-tenant-id') empresaId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notificacionService.listarNotificaciones(usuarioId, {
      empresaId: empresaId || undefined,
      page: page ? Math.max(1, parseInt(page)) : 1,
      limit: limit ? Math.min(50, Math.max(1, parseInt(limit))) : 20,
    });
  }

  @Get('no-leidas/count')
  @ApiOperation({ summary: 'Contar notificaciones no leídas' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  async contarNoLeidas(
    @CurrentUser('sub') usuarioId: string,
    @Headers('x-tenant-id') empresaId?: string,
  ) {
    const count = await this.notificacionService.contarNoLeidas(
      usuarioId,
      empresaId || undefined,
    );
    return { count };
  }

  @Patch(':id/leida')
  @ApiOperation({ summary: 'Marcar notificación como leída' })
  marcarLeida(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
  ) {
    return this.notificacionService.marcarLeida(usuarioId, id);
  }

  @Patch('marcar-todas-leidas')
  @ApiOperation({ summary: 'Marcar todas las notificaciones como leídas' })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  marcarTodasLeidas(
    @CurrentUser('sub') usuarioId: string,
    @Headers('x-tenant-id') empresaId?: string,
  ) {
    return this.notificacionService.marcarTodasLeidas(
      usuarioId,
      empresaId || undefined,
    );
  }
}
