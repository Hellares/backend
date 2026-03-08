import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequiresPermission,
  Permission,
} from '../auth/decorators/requires-permission.decorator';
import { ConfiguracionCamposService } from './configuracion-campos.service';
import { CreateConfiguracionCampoDto } from './dto/create-configuracion-campo.dto';
import { UpdateConfiguracionCampoDto } from './dto/update-configuracion-campo.dto';
import { QueryConfiguracionCampoDto } from './dto/query-configuracion-campo.dto';

@ApiTags('Configuración Campos Servicio')
@Controller('configuracion-campos-servicio')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ConfiguracionCamposController {
  constructor(
    private readonly configuracionCamposService: ConfiguracionCamposService,
  ) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Crear un campo de configuración' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Campo creado' })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateConfiguracionCampoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.configuracionCamposService.create(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_SERVICES)
  @ApiOperation({ summary: 'Listar campos de configuración' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryConfiguracionCampoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.configuracionCamposService.findAll(empresaId, query);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_SERVICES)
  @ApiOperation({ summary: 'Obtener un campo de configuración' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.configuracionCamposService.findOne(empresaId, id);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Actualizar un campo de configuración' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConfiguracionCampoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.configuracionCamposService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Eliminar un campo de configuración (soft delete)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.configuracionCamposService.remove(empresaId, id);
  }

  @Patch('reorder')
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Reordenar campos de configuración' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  reorder(
    @Headers('x-tenant-id') empresaId: string,
    @Body() body: { orderedIds: string[] },
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.configuracionCamposService.reorder(empresaId, body.orderedIds);
  }
}
