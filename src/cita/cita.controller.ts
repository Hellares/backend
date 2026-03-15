import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
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
import { CreateCitaItemDto, UpdateCitaItemDto } from './dto/cita-item.dto';

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

  @Get('mis-citas')
  @ApiOperation({ summary: 'Listar mis citas como cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findMisCitas(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
    @Query() query: QueryCitaDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.findCitasCliente(empresaId, user.personaId, query);
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

  @Get('clientes-con-citas')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar clientes que tienen citas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getClientesConCitas(
    @Headers('x-tenant-id') empresaId: string,
    @Query('search') search?: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.getClientesConCitas(empresaId, search);
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

  @Get('historial-cliente/:clienteId')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Historial de citas de un cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getHistorialCliente(
    @Headers('x-tenant-id') empresaId: string,
    @Param('clienteId') clienteId: string,
    @Query('clienteEmpresaId') clienteEmpresaId?: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.getHistorialCliente(empresaId, clienteId, clienteEmpresaId);
  }

  // ─── Items / Productos ───

  @Get(':id/items')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar items de una cita' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getItems(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.getItems(empresaId, id);
  }

  @Post(':id/items')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Agregar item/producto a una cita' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  addItem(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: CreateCitaItemDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.addItem(empresaId, id, dto);
  }

  @Put(':id/items/:itemId')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Actualizar item de una cita' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  updateItem(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCitaItemDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.updateItem(empresaId, id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar item de una cita' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  removeItem(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.citaService.removeItem(empresaId, id, itemId);
  }
}
