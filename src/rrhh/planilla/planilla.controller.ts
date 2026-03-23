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
import { PlanillaService } from './planilla.service';
import { PlanillaCalculoService } from './planilla-calculo.service';
import { CreatePeriodoPlanillaDto } from './dto/create-periodo-planilla.dto';
import { QueryPeriodosPlanillaDto } from './dto/query-periodos-planilla.dto';
import { PagarBoletaDto } from './dto/pagar-boleta.dto';
import { EstadoBoletaPago } from '@prisma/client';

@ApiTags('RRHH - Planilla')
@Controller('planilla')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PlanillaController {
  constructor(
    private readonly planillaService: PlanillaService,
    private readonly planillaCalculoService: PlanillaCalculoService,
  ) {}

  // =============================================================
  // PERIODOS
  // =============================================================

  @Post('periodos')
  @RequiresPermission(Permission.MANAGE_PLANILLA)
  @ApiOperation({ summary: 'Crear periodo de planilla' })
  @ApiResponse({ status: 201, description: 'Periodo creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos o periodo duplicado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async createPeriodo(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreatePeriodoPlanillaDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.planillaService.createPeriodo(empresaId, dto, usuarioId);
  }

  @Get('periodos')
  @RequiresPermission(Permission.VIEW_PLANILLA)
  @ApiOperation({ summary: 'Listar periodos de planilla' })
  @ApiResponse({ status: 200, description: 'Lista paginada de periodos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAllPeriodos(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryPeriodosPlanillaDto,
  ) {
    return this.planillaService.findAllPeriodos(empresaId, query);
  }

  @Get('periodos/:id')
  @RequiresPermission(Permission.VIEW_PLANILLA)
  @ApiOperation({ summary: 'Obtener detalle de un periodo con boletas' })
  @ApiResponse({ status: 200, description: 'Detalle del periodo' })
  @ApiResponse({ status: 404, description: 'Periodo no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOnePeriodo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.planillaService.findOnePeriodo(empresaId, id);
  }

  @Post('periodos/:id/calcular')
  @RequiresPermission(Permission.MANAGE_PLANILLA)
  @ApiOperation({ summary: 'Calcular todas las boletas del periodo' })
  @ApiResponse({ status: 200, description: 'Planilla calculada exitosamente' })
  @ApiResponse({ status: 400, description: 'Estado inválido para cálculo' })
  @ApiResponse({ status: 404, description: 'Periodo no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async calcularPeriodo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.planillaCalculoService.calcularPlanilla(empresaId, id, usuarioId);
  }

  @Patch('periodos/:id/aprobar')
  @RequiresPermission(Permission.APPROVE_PLANILLA)
  @ApiOperation({ summary: 'Aprobar periodo de planilla' })
  @ApiResponse({ status: 200, description: 'Periodo aprobado exitosamente' })
  @ApiResponse({ status: 400, description: 'Estado inválido para aprobación' })
  @ApiResponse({ status: 404, description: 'Periodo no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async aprobarPeriodo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.planillaService.aprobarPeriodo(empresaId, id, usuarioId);
  }

  @Post('periodos/:id/pagar')
  @RequiresPermission(Permission.MANAGE_PLANILLA)
  @ApiOperation({ summary: 'Pagar todas las boletas pendientes del periodo (bulk)' })
  @ApiResponse({ status: 200, description: 'Boletas pagadas exitosamente' })
  @ApiResponse({ status: 400, description: 'Estado inválido o sin boletas pendientes' })
  @ApiResponse({ status: 404, description: 'Periodo no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async pagarPlanilla(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: PagarBoletaDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.planillaService.pagarPlanilla(empresaId, id, dto, usuarioId);
  }

  // =============================================================
  // BOLETAS
  // =============================================================

  @Get('boletas')
  @RequiresPermission(Permission.VIEW_PLANILLA)
  @ApiOperation({ summary: 'Listar boletas de pago con filtros' })
  @ApiResponse({ status: 200, description: 'Lista paginada de boletas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'periodoId', required: false })
  @ApiQuery({ name: 'empleadoId', required: false })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoBoletaPago })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findBoletas(
    @Headers('x-tenant-id') empresaId: string,
    @Query('periodoId') periodoId?: string,
    @Query('empleadoId') empleadoId?: string,
    @Query('estado') estado?: EstadoBoletaPago,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.planillaService.findBoletas(empresaId, {
      periodoId,
      empleadoId,
      estado,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('boletas/:id')
  @RequiresPermission(Permission.VIEW_PLANILLA)
  @ApiOperation({ summary: 'Obtener detalle de una boleta con detalles' })
  @ApiResponse({ status: 200, description: 'Detalle de la boleta' })
  @ApiResponse({ status: 404, description: 'Boleta no encontrada' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOneBoleta(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.planillaService.findOneBoleta(empresaId, id);
  }

  @Post('boletas/:id/pagar')
  @RequiresPermission(Permission.MANAGE_PLANILLA)
  @ApiOperation({ summary: 'Pagar boleta individual' })
  @ApiResponse({ status: 200, description: 'Boleta pagada exitosamente' })
  @ApiResponse({ status: 400, description: 'Estado inválido para pago' })
  @ApiResponse({ status: 404, description: 'Boleta no encontrada' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async pagarBoleta(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: PagarBoletaDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.planillaService.pagarBoleta(empresaId, id, dto, usuarioId);
  }
}
