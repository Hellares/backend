import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { HorarioService } from './horario.service';
import { CreateHorarioPlantillaDto } from './dto/create-horario-plantilla.dto';
import { UpdateHorarioPlantillaDto } from './dto/update-horario-plantilla.dto';

@ApiTags('RRHH - Horarios')
@Controller('horario-plantillas')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class HorarioController {
  constructor(private readonly horarioService: HorarioService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @ApiOperation({ summary: 'Crear plantilla de horario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Plantilla creada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 409, description: 'Ya existe una plantilla con ese nombre' })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateHorarioPlantillaDto,
    @CurrentUser() user: any,
  ) {
    return this.horarioService.create(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_EMPLEADOS)
  @ApiOperation({ summary: 'Listar plantillas de horario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Lista de plantillas de horario' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
  ) {
    return this.horarioService.findAll(empresaId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_EMPLEADOS)
  @ApiOperation({ summary: 'Obtener plantilla de horario por ID' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Detalle de la plantilla de horario' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 404, description: 'Plantilla no encontrada' })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.horarioService.findOne(empresaId, id);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @ApiOperation({ summary: 'Actualizar plantilla de horario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 200, description: 'Plantilla actualizada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 404, description: 'Plantilla no encontrada' })
  @ApiResponse({ status: 409, description: 'Ya existe una plantilla con ese nombre' })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateHorarioPlantillaDto,
    @CurrentUser() user: any,
  ) {
    return this.horarioService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Desactivar plantilla de horario (soft delete)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 204, description: 'Plantilla desactivada exitosamente' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 404, description: 'Plantilla no encontrada' })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.horarioService.remove(empresaId, id);
  }
}
