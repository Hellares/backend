import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
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
import { PlantillaServicioService } from './plantilla-servicio.service';
import { CreatePlantillaServicioDto } from './dto/create-plantilla-servicio.dto';
import { UpdatePlantillaServicioDto } from './dto/update-plantilla-servicio.dto';
import { CreateConfiguracionCampoDto } from './dto/create-configuracion-campo.dto';

@ApiTags('Plantillas de Servicio')
@Controller('plantillas-servicio')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PlantillaServicioController {
  constructor(
    private readonly plantillaServicioService: PlantillaServicioService,
  ) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Crear una plantilla de servicio con campos opcionales' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Plantilla creada' })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreatePlantillaServicioDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.plantillaServicioService.create(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_SERVICES)
  @ApiOperation({ summary: 'Listar plantillas de servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(@Headers('x-tenant-id') empresaId: string) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.plantillaServicioService.findAll(empresaId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_SERVICES)
  @ApiOperation({ summary: 'Obtener una plantilla de servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.plantillaServicioService.findOne(empresaId, id);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Actualizar una plantilla de servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlantillaServicioDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.plantillaServicioService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Eliminar una plantilla (soft delete)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.plantillaServicioService.remove(empresaId, id);
  }

  @Post(':id/campos')
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Agregar un campo a la plantilla' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  addCampo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') plantillaId: string,
    @Body() dto: CreateConfiguracionCampoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.plantillaServicioService.addCampo(empresaId, plantillaId, dto);
  }

  @Get(':id/campos')
  @RequiresPermission(Permission.VIEW_SERVICES)
  @ApiOperation({ summary: 'Obtener campos de una plantilla' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getCampos(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') plantillaId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.plantillaServicioService.getCamposByPlantillaId(empresaId, plantillaId);
  }

  @Get('por-servicio/:servicioId')
  @RequiresPermission(Permission.VIEW_SERVICES)
  @ApiOperation({ summary: 'Obtener campos de la plantilla vinculada a un servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getCamposByServicio(
    @Headers('x-tenant-id') empresaId: string,
    @Param('servicioId') servicioId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.plantillaServicioService.getCamposByServicioId(empresaId, servicioId);
  }
}
