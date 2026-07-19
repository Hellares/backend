import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { IaConfigService } from './ia-config.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { UpdateIaConfigDto, IaConfigResponseDto } from './dto/ia-config.dto';

@ApiTags('Agente IA')
@Controller('empresas')
export class IaConfigController {
  constructor(private readonly iaConfigService: IaConfigService) {}

  /** Config del agente IA de la empresa (API key enmascarada). */
  @Get(':id/agente-ia')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener configuración del agente IA' })
  @ApiResponse({ status: 200, type: IaConfigResponseDto })
  async getConfig(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<IaConfigResponseDto> {
    return this.iaConfigService.getConfig(id, user.sub);
  }

  /** Crear/actualizar la config del agente IA. */
  @Put(':id/agente-ia')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear/actualizar la configuración del agente IA' })
  @ApiResponse({ status: 200, type: IaConfigResponseDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  async updateConfig(
    @Param('id') id: string,
    @Body() dto: UpdateIaConfigDto,
    @CurrentUser() user: any,
  ): Promise<IaConfigResponseDto> {
    return this.iaConfigService.upsertConfig(id, user.sub, dto);
  }
}
