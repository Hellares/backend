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
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdelantoService } from './adelanto.service';
import { CreateAdelantoDto } from './dto/create-adelanto.dto';
import { QueryAdelantosDto } from './dto/query-adelantos.dto';
import { PagarAdelantoDto } from './dto/pagar-adelanto.dto';

@ApiTags('RRHH - Adelantos')
@Controller('adelantos')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AdelantoController {
  constructor(private readonly adelantoService: AdelantoService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_PLANILLA)
  @ApiOperation({ summary: 'Crear solicitud de adelanto de sueldo' })
  @ApiResponse({ status: 201, description: 'Adelanto creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Empleado no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateAdelantoDto,
  ) {
    return this.adelantoService.create(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_PLANILLA)
  @ApiOperation({ summary: 'Listar adelantos con filtros y paginación' })
  @ApiResponse({ status: 200, description: 'Lista paginada de adelantos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryAdelantosDto,
  ) {
    return this.adelantoService.findAll(empresaId, query);
  }

  @Patch(':id/aprobar')
  @RequiresPermission(Permission.APPROVE_PLANILLA)
  @ApiOperation({ summary: 'Aprobar adelanto de sueldo' })
  @ApiResponse({ status: 200, description: 'Adelanto aprobado exitosamente' })
  @ApiResponse({ status: 400, description: 'Estado inválido para aprobación' })
  @ApiResponse({ status: 404, description: 'Adelanto no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async aprobar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.adelantoService.aprobar(empresaId, id, usuarioId);
  }

  @Patch(':id/rechazar')
  @RequiresPermission(Permission.APPROVE_PLANILLA)
  @ApiOperation({ summary: 'Rechazar adelanto de sueldo' })
  @ApiResponse({ status: 200, description: 'Adelanto rechazado exitosamente' })
  @ApiResponse({ status: 400, description: 'Estado inválido para rechazo' })
  @ApiResponse({ status: 404, description: 'Adelanto no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async rechazar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body('motivoRechazo') motivoRechazo: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.adelantoService.rechazar(empresaId, id, motivoRechazo, usuarioId);
  }

  @Post(':id/pagar')
  @RequiresPermission(Permission.MANAGE_PLANILLA)
  @ApiOperation({ summary: 'Pagar adelanto de sueldo' })
  @ApiResponse({ status: 200, description: 'Adelanto pagado exitosamente' })
  @ApiResponse({ status: 400, description: 'Estado inválido para pago' })
  @ApiResponse({ status: 404, description: 'Adelanto no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async pagar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: PagarAdelantoDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.adelantoService.pagar(empresaId, id, dto, usuarioId);
  }

  @Post(':id/anular-pago')
  @RequiresPermission(Permission.MANAGE_PLANILLA)
  @ApiOperation({ summary: 'Anular el pago de un adelanto (devuelve el dinero)' })
  @ApiResponse({ status: 200, description: 'Pago anulado exitosamente' })
  @ApiResponse({ status: 400, description: 'Estado inválido para anular' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async anularPago(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body('motivo') motivo: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.adelantoService.anularPago(empresaId, id, usuarioId, motivo);
  }
}
