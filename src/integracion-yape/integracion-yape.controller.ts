import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  HttpCode,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { IntegracionYapeService } from './integracion-yape.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import {
  UpdateIntegracionYapeDto,
  IntegracionYapeResponseDto,
  ProbarConexionResponseDto,
} from './dto/integracion-yape.dto';

@ApiTags('Integración Yape')
@Controller('empresas')
export class IntegracionYapeController {
  constructor(private readonly integracionYapeService: IntegracionYapeService) {}

  /**
   * Obtener la configuración de integración Yape de la empresa (secretos enmascarados).
   */
  @Get(':id/integracion-yape')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener configuración de integración Yape' })
  @ApiResponse({ status: 200, type: IntegracionYapeResponseDto })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos' })
  async getIntegracionYape(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<IntegracionYapeResponseDto> {
    return this.integracionYapeService.getConfig(id, user.sub);
  }

  /**
   * Crear/actualizar la configuración de integración Yape (solo administradores).
   */
  @Put(':id/integracion-yape')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear/actualizar la integración Yape' })
  @ApiResponse({ status: 200, type: IntegracionYapeResponseDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos o incompletos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos' })
  async updateIntegracionYape(
    @Param('id') id: string,
    @Body() dto: UpdateIntegracionYapeDto,
    @CurrentUser() user: any,
  ): Promise<IntegracionYapeResponseDto> {
    return this.integracionYapeService.upsertConfig(id, user.sub, dto);
  }

  /**
   * Probar la conexión con api-yape (cobro de prueba S/1 que se cancela al instante).
   */
  @Post(':id/integracion-yape/probar')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Probar la conexión con api-yape' })
  @ApiResponse({ status: 200, type: ProbarConexionResponseDto })
  @ApiResponse({ status: 400, description: 'Integración no configurada' })
  async probarIntegracionYape(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<ProbarConexionResponseDto> {
    return this.integracionYapeService.probarConexion(id, user.sub);
  }
}
