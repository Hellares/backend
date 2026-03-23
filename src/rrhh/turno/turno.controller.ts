import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { TurnoService } from './turno.service';
import { CreateTurnoDto } from './dto/create-turno.dto';
import { UpdateTurnoDto } from './dto/update-turno.dto';
import { QueryTurnosDto } from './dto/query-turnos.dto';

@ApiTags('RRHH - Turnos')
@Controller('turnos')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TurnoController {
  constructor(private readonly turnoService: TurnoService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @ApiOperation({ summary: 'Crear un nuevo turno de trabajo' })
  @ApiResponse({ status: 201, description: 'Turno creado exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateTurnoDto,
  ) {
    return this.turnoService.create(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_EMPLEADOS)
  @ApiOperation({ summary: 'Listar turnos de trabajo' })
  @ApiResponse({ status: 200, description: 'Lista de turnos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryTurnosDto,
  ) {
    return this.turnoService.findAll(empresaId, query);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_EMPLEADOS)
  @ApiOperation({ summary: 'Obtener un turno por ID' })
  @ApiResponse({ status: 200, description: 'Turno encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.turnoService.findOne(empresaId, id);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @ApiOperation({ summary: 'Actualizar un turno de trabajo' })
  @ApiResponse({ status: 200, description: 'Turno actualizado exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTurnoDto,
  ) {
    return this.turnoService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @ApiOperation({ summary: 'Desactivar un turno de trabajo (soft delete)' })
  @ApiResponse({ status: 200, description: 'Turno desactivado exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.turnoService.remove(empresaId, id);
  }
}
