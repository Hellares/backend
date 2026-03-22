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
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AgenteBancarioService } from './agente-bancario.service';

@ApiTags('Agentes Bancarios')
@Controller('agentes-bancarios')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class AgenteBancarioController {
  constructor(private readonly service: AgenteBancarioService) {}

  @Post('sede/:sedeId')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Crear agente bancario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
    @CurrentUser('id') usuarioId: string,
    @Body()
    dto: {
      banco: string;
      codigoAgente?: string;
      fondoAsignado: number;
      comisionDeposito?: number;
      comisionRetiro?: number;
      responsableId?: string;
    },
  ) {
    return this.service.crear(empresaId, sedeId, dto, usuarioId);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Listar agentes bancarios' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.service.listar(empresaId, sedeId);
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Dashboard/resumen de agentes bancarios' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async resumen(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.service.getResumen(empresaId, sedeId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Detalle de un agente bancario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async detalle(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.getDetalle(empresaId, id);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Actualizar agente bancario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body()
    dto: {
      banco?: string;
      codigoAgente?: string;
      comisionDeposito?: number;
      comisionRetiro?: number;
      responsableId?: string;
      fondoAsignado?: number;
    },
  ) {
    return this.service.actualizar(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Desactivar agente bancario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async desactivar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.desactivar(empresaId, id);
  }

  @Post(':id/operacion')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Registrar operación (depósito/retiro)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarOperacion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') agenteId: string,
    @CurrentUser('id') usuarioId: string,
    @Body()
    dto: {
      tipo: 'DEPOSITO' | 'RETIRO';
      monto: number;
      nombreCliente?: string;
      documentoCliente?: string;
      numeroOperacion?: string;
      observaciones?: string;
    },
  ) {
    return this.service.registrarOperacion(empresaId, agenteId, dto, usuarioId);
  }

  @Post(':id/operacion/:opId/anular')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Anular operación de agente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async anularOperacion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('opId') opId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: { motivo: string },
  ) {
    return this.service.anularOperacion(empresaId, opId, dto.motivo, usuarioId);
  }

  @Get(':id/operaciones')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Historial de operaciones de un agente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getOperaciones(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') agenteId: string,
    @Query('tipo') tipo?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.getOperaciones(empresaId, agenteId, {
      tipo,
      fechaDesde,
      fechaHasta,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
