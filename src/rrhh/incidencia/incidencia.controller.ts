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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IncidenciaService } from './incidencia.service';
import { CreateIncidenciaDto } from './dto/create-incidencia.dto';
import { AprobarIncidenciaDto } from './dto/aprobar-incidencia.dto';
import { RechazarIncidenciaDto } from './dto/rechazar-incidencia.dto';
import { QueryIncidenciasDto } from './dto/query-incidencias.dto';

@ApiTags('RRHH - Incidencias')
@Controller('incidencias')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class IncidenciaController {
  constructor(private readonly incidenciaService: IncidenciaService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_ASISTENCIA)
  @ApiOperation({ summary: 'Crear nueva incidencia (vacación, licencia, permiso, etc.)' })
  @ApiResponse({ status: 201, description: 'Incidencia creada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos o fechas incorrectas' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
  @ApiResponse({ status: 409, description: 'Incidencia aprobada ya existe en el rango de fechas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateIncidenciaDto,
  ) {
    return this.incidenciaService.create(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_ASISTENCIA)
  @ApiOperation({ summary: 'Listar incidencias con filtros y paginación' })
  @ApiResponse({ status: 200, description: 'Lista paginada de incidencias' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryIncidenciasDto,
  ) {
    return this.incidenciaService.findAll(empresaId, query);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_ASISTENCIA)
  @ApiOperation({ summary: 'Obtener detalle de una incidencia' })
  @ApiResponse({ status: 200, description: 'Detalle de la incidencia' })
  @ApiResponse({ status: 404, description: 'Incidencia no encontrada' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.incidenciaService.findOne(empresaId, id);
  }

  @Patch(':id/aprobar')
  @RequiresPermission(Permission.APPROVE_INCIDENCIAS)
  @ApiOperation({ summary: 'Aprobar incidencia y generar registros de asistencia automáticos' })
  @ApiResponse({ status: 200, description: 'Incidencia aprobada exitosamente' })
  @ApiResponse({ status: 400, description: 'La incidencia no está en estado PENDIENTE' })
  @ApiResponse({ status: 404, description: 'Incidencia no encontrada' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async aprobar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: AprobarIncidenciaDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.incidenciaService.aprobar(empresaId, id, usuarioId);
  }

  @Patch(':id/rechazar')
  @RequiresPermission(Permission.APPROVE_INCIDENCIAS)
  @ApiOperation({ summary: 'Rechazar incidencia con motivo' })
  @ApiResponse({ status: 200, description: 'Incidencia rechazada exitosamente' })
  @ApiResponse({ status: 400, description: 'La incidencia no está en estado PENDIENTE' })
  @ApiResponse({ status: 404, description: 'Incidencia no encontrada' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async rechazar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: RechazarIncidenciaDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.incidenciaService.rechazar(empresaId, id, dto, usuarioId);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_ASISTENCIA)
  @ApiOperation({ summary: 'Cancelar incidencia pendiente' })
  @ApiResponse({ status: 200, description: 'Incidencia cancelada exitosamente' })
  @ApiResponse({ status: 400, description: 'Solo se pueden cancelar incidencias pendientes' })
  @ApiResponse({ status: 404, description: 'Incidencia no encontrada' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cancelar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.incidenciaService.cancelar(empresaId, id);
  }
}
