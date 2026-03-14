import {
  Controller,
  Get,
  Post,
  Put,
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
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequiresPermission,
  Permission,
} from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CitaService } from './cita.service';
import { CreateCitaDto } from './dto/create-cita.dto';
import { UpdateCitaDto } from './dto/update-cita.dto';
import {
  QueryCitaDto,
  QueryDisponibilidadDto,
  QueryTecnicosDisponiblesDto,
} from './dto/query-cita.dto';
import { TransitionEstadoCitaDto } from './dto/transition-estado-cita.dto';

@ApiTags('Citas')
@Controller('citas')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CitaController {
  constructor(private readonly citaService: CitaService) {}

  @Get('disponibilidad')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener slots disponibles para agendar' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getDisponibilidad(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryDisponibilidadDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.getDisponibilidad(empresaId, query);
  }

  @Get('tecnicos-disponibles')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener técnicos disponibles para un horario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getTecnicosDisponibles(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryTecnicosDisponiblesDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.getTecnicosDisponibles(empresaId, query);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Crear una cita' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateCitaDto,
    @CurrentUser('sub') usuarioId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    dto.empresaId = empresaId;
    dto.creadoPor = usuarioId;
    return this.citaService.create(dto);
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar citas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryCitaDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.findAll(empresaId, query);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener detalle de una cita' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.findOne(empresaId, id);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Actualizar una cita (solo PENDIENTE/CONFIRMADA)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCitaDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.update(empresaId, id, dto);
  }

  @Patch(':id/estado')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Cambiar estado de una cita' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  transitionEstado(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: TransitionEstadoCitaDto,
    @CurrentUser('sub') usuarioId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.transitionEstado(empresaId, id, dto, usuarioId);
  }
}
