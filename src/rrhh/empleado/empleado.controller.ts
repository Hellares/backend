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
import { EmpleadoService } from './empleado.service';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';
import { QueryEmpleadosDto } from './dto/query-empleados.dto';

@ApiTags('RRHH - Empleados')
@Controller('empleados')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class EmpleadoController {
  constructor(private readonly empleadoService: EmpleadoService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @ApiOperation({ summary: 'Crear nuevo empleado' })
  @ApiResponse({ status: 201, description: 'Empleado creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Usuario o sede no encontrados' })
  @ApiResponse({ status: 409, description: 'Ya existe un empleado para este usuario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateEmpleadoDto,
  ) {
    return this.empleadoService.create(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_EMPLEADOS)
  @ApiOperation({ summary: 'Listar empleados con filtros y paginación' })
  @ApiResponse({ status: 200, description: 'Lista paginada de empleados' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryEmpleadosDto,
  ) {
    return this.empleadoService.findAll(empresaId, query);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_EMPLEADOS)
  @ApiOperation({ summary: 'Obtener detalle de un empleado' })
  @ApiResponse({ status: 200, description: 'Detalle del empleado' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.empleadoService.findOne(empresaId, id);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @ApiOperation({ summary: 'Actualizar datos de un empleado' })
  @ApiResponse({ status: 200, description: 'Empleado actualizado exitosamente' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmpleadoDto,
  ) {
    return this.empleadoService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_EMPLEADOS)
  @ApiOperation({ summary: 'Eliminar empleado (soft delete)' })
  @ApiResponse({ status: 200, description: 'Empleado eliminado exitosamente' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.empleadoService.remove(empresaId, id);
  }
}
