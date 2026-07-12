import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { WhatsappService } from './whatsapp.service';
import { UpdateWhatsappDto } from './dto/whatsapp.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';

@ApiTags('WhatsApp (Evolution)')
@Controller('empresas')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WhatsappEmpresaController {
  constructor(private readonly service: WhatsappService) {}

  @Get(':id/whatsapp')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Config + estado de la vinculación de WhatsApp' })
  async getConfig(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.getConfig(id, user.sub);
  }

  @Post(':id/whatsapp/vincular')
  @HttpCode(200)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Crea la instancia y devuelve el QR para escanear desde WhatsApp ' +
      '(Dispositivos vinculados). Reintentable: cada llamada refresca el QR.',
  })
  async vincular(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.vincular(id, user.sub);
  }

  @Put(':id/whatsapp')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualiza plantilla y/o habilitado' })
  async updateConfig(
    @Param('id') id: string,
    @Body() dto: UpdateWhatsappDto,
    @CurrentUser() user: any,
  ) {
    return this.service.updateConfig(id, user.sub, dto);
  }

  @Delete(':id/whatsapp')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desvincula el WhatsApp (cierra la sesión)' })
  async desvincular(@Param('id') id: string, @CurrentUser() user: any) {
    return this.service.desvincular(id, user.sub);
  }
}

/**
 * Receptor del webhook de Evolution (CONNECTION_UPDATE). PÚBLICO como
 * los demás webhooks: se autentica por el token derivado de la API key
 * que viaja en la URL (Evolution no firma HMAC).
 */
@ApiTags('WhatsApp (Evolution)')
@Controller('whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly service: WhatsappService) {}

  @Post('webhook/:token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Webhook de Evolution API (interno)' })
  async webhook(@Param('token') token: string, @Body() body: any) {
    return this.service.procesarWebhook(token, body);
  }
}
