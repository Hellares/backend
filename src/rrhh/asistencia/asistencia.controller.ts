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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AsistenciaService } from './asistencia.service';
import { RegistrarAsistenciaDto } from './dto/registrar-asistencia.dto';
import { RegistrarSalidaDto } from './dto/registrar-salida.dto';
import { QueryAsistenciasDto } from './dto/query-asistencias.dto';
import { BulkAsistenciaDto } from './dto/bulk-asistencia.dto';

@ApiTags('RRHH - Asistencia')
@Controller('asistencias')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AsistenciaController {
  constructor(private readonly asistenciaService: AsistenciaService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_ASISTENCIA)
  @ApiOperation({ summary: 'Registrar entrada / asistencia de un empleado' })
  @ApiResponse({ status: 201, description: 'Asistencia registrada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
  @ApiResponse({ status: 409, description: 'Ya existe registro para esta fecha' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarEntrada(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: RegistrarAsistenciaDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.asistenciaService.registrarEntrada(empresaId, dto, usuarioId);
  }

  @Patch(':id/salida')
  @RequiresPermission(Permission.MANAGE_ASISTENCIA)
  @ApiOperation({ summary: 'Registrar salida de un empleado' })
  @ApiResponse({ status: 200, description: 'Salida registrada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos o sin hora de entrada' })
  @ApiResponse({ status: 404, description: 'Registro de asistencia no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarSalida(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: RegistrarSalidaDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.asistenciaService.registrarSalida(empresaId, id, dto, usuarioId);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_ASISTENCIA)
  @ApiOperation({ summary: 'Listar asistencias con filtros y paginación' })
  @ApiResponse({ status: 200, description: 'Lista paginada de asistencias' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryAsistenciasDto,
  ) {
    return this.asistenciaService.findAll(empresaId, query);
  }

  @Get('resumen/:empleadoId')
  @RequiresPermission(Permission.VIEW_ASISTENCIA)
  @ApiOperation({ summary: 'Obtener resumen mensual de asistencia de un empleado' })
  @ApiResponse({ status: 200, description: 'Resumen mensual de asistencia' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'mes', required: true, type: Number, description: 'Mes (1-12)' })
  @ApiQuery({ name: 'anio', required: true, type: Number, description: 'Año' })
  async getResumenMensual(
    @Headers('x-tenant-id') empresaId: string,
    @Param('empleadoId') empleadoId: string,
    @Query('mes') mes: string,
    @Query('anio') anio: string,
  ) {
    return this.asistenciaService.getResumenMensual(
      empresaId,
      empleadoId,
      parseInt(mes, 10),
      parseInt(anio, 10),
    );
  }

  @Post('bulk')
  @RequiresPermission(Permission.MANAGE_ASISTENCIA)
  @ApiOperation({ summary: 'Registro masivo de asistencia para múltiples empleados' })
  @ApiResponse({ status: 201, description: 'Asistencias registradas exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos o empleados no encontrados' })
  @ApiResponse({ status: 404, description: 'Sede no encontrada' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarBulk(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: BulkAsistenciaDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.asistenciaService.registrarBulk(empresaId, dto, usuarioId);
  }
}
