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
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SedeAccessGuard } from '../auth/guards/sede-access.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequiresPermission,
  Permission,
} from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrdenServicioService } from './orden-servicio.service';
import { ServicioComponenteService } from './servicio-componente.service';
import { CreateOrdenServicioDto } from './dto/create-orden-servicio.dto';
import { UpdateOrdenServicioDto } from './dto/update-orden-servicio.dto';
import { TransitionEstadoDto } from './dto/transition-estado.dto';
import { QueryOrdenServicioDto } from './dto/query-orden-servicio.dto';
import { CreateServicioComponenteDto } from './dto/create-servicio-componente.dto';
import { UpdateServicioComponenteDto } from './dto/update-servicio-componente.dto';

@ApiTags('Órdenes de Servicio')
@Controller('ordenes-servicio')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OrdenServicioController {
  constructor(
    private readonly ordenServicioService: OrdenServicioService,
    private readonly servicioComponenteService: ServicioComponenteService,
  ) {}

  @Post()
  @UseGuards(SedeAccessGuard)
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Crear una orden de servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Orden creada' })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateOrdenServicioDto,
    @CurrentUser('sub') usuarioId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    dto.empresaId = empresaId;
    return this.ordenServicioService.create(dto, usuarioId);
  }

  @Get('mis-ordenes')
  @ApiOperation({ summary: 'Listar mis órdenes de servicio como cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findMisOrdenes(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
    @Query() query: QueryOrdenServicioDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.findOrdenesCliente(empresaId, user.personaId, query);
  }

  @Get('mis-ordenes/:id')
  @ApiOperation({ summary: 'Ver detalle de mi orden como cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findMiOrden(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.findOrdenCliente(empresaId, user.personaId, id);
  }

  @Get('mis-ordenes/:id/historial')
  @ApiOperation({ summary: 'Ver historial de mi orden como cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getMiOrdenHistorial(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.findHistorialCliente(empresaId, user.personaId, id);
  }

  // ─── Mensajes del cliente ───

  @Get('mis-ordenes/:id/mensajes')
  @ApiOperation({ summary: 'Listar mensajes de mi orden como cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getMisMensajes(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.listarMensajesCliente(empresaId, user.personaId, id);
  }

  @Post('mis-ordenes/:id/mensajes')
  @ApiOperation({ summary: 'Enviar mensaje como cliente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  enviarMiMensaje(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body('contenido') contenido: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    if (!contenido?.trim()) throw new BadRequestException('El mensaje no puede estar vacío');
    return this.ordenServicioService.enviarMensajeCliente(empresaId, user.personaId, user.sub, id, contenido.trim());
  }

  // ─── Mensajes del técnico/empresa ───

  @Get(':id/mensajes/no-leidos')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({
    summary: 'Contar mensajes no leídos del cliente (sin marcarlos leídos)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  contarMensajesNoLeidos(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.contarMensajesNoLeidos(empresaId, id);
  }

  @Get(':id/mensajes')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar mensajes de una orden' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getMensajes(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.listarMensajes(empresaId, id);
  }

  @Post(':id/mensajes')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Enviar mensaje como técnico/empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  enviarMensaje(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') usuarioId: string,
    @Param('id') id: string,
    @Body('contenido') contenido: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    if (!contenido?.trim()) throw new BadRequestException('El mensaje no puede estar vacío');
    return this.ordenServicioService.enviarMensajeTecnico(empresaId, usuarioId, id, contenido.trim());
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar órdenes de servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryOrdenServicioDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.findAll(empresaId, query);
  }

  @Get('cobrables')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({
    summary:
      'Órdenes cobrables desde Venta Rápida (REPARADO/LISTO_ENTREGA con saldo > 0 y sin venta vinculada)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findCobrables(
    @Headers('x-tenant-id') empresaId: string,
    @Query('search') search?: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.findCobrables(empresaId, search);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener una orden de servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.findOne(empresaId, id);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Actualizar una orden de servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrdenServicioDto,
    @CurrentUser('sub') usuarioId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.update(empresaId, id, dto, usuarioId);
  }

  @Patch(':id/estado')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Cambiar estado de una orden' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  transitionEstado(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: TransitionEstadoDto,
    @CurrentUser('sub') usuarioId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.transitionEstado(
      empresaId,
      id,
      dto,
      usuarioId,
    );
  }

  @Get(':id/historial')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener historial de cambios de una orden' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getHistorial(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.findHistorial(empresaId, id);
  }

  @Patch(':id/tecnico')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Asignar técnico a una orden' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  assignTecnico(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() body: { tecnicoId: string },
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.ordenServicioService.assignTecnico(
      empresaId,
      id,
      body.tecnicoId,
    );
  }

  @Post(':id/componentes')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Agregar componente a una orden' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  addComponente(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: CreateServicioComponenteDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.servicioComponenteService.create(empresaId, id, dto);
  }

  @Get(':id/componentes')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar componentes de una orden' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getComponentes(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.servicioComponenteService.findByOrden(empresaId, id);
  }

  @Patch(':id/componentes/:componenteId')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Actualizar componente de una orden' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  updateComponente(
    @Headers('x-tenant-id') empresaId: string,
    @Param('componenteId') componenteId: string,
    @Body() dto: UpdateServicioComponenteDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.servicioComponenteService.update(empresaId, componenteId, dto);
  }

  @Delete(':id/componentes/:componenteId')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Eliminar componente de una orden' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  removeComponente(
    @Headers('x-tenant-id') empresaId: string,
    @Param('componenteId') componenteId: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.servicioComponenteService.remove(empresaId, componenteId);
  }

  /**
   * RETIRADO (410): el cobro directo generaba comprobante sin registrar caja
   * ni enviar a SUNAT (y sin comprobante si la orden no tenía sede). El cobro
   * de órdenes vive en el pipeline de Venta Rápida (detalle.ordenServicioId).
   */
  @Post(':id/cobrar')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: '[RETIRADO] Cobrar orden — usar Venta Rápida (POS)' })
  @ApiResponse({ status: 410, description: 'Endpoint retirado' })
  cobrarOrden() {
    throw new GoneException(
      'El cobro directo de órdenes fue retirado. Cobra la orden desde Venta Rápida (POS): registra caja, emite el comprobante y soporta pagos mixtos. Actualiza el app si ves este mensaje.',
    );
  }
}
