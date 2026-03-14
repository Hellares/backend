import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { VinculacionService } from './vinculacion.service';
import { CreateVinculacionDto } from './dto/create-vinculacion.dto';
import { RespondVinculacionDto } from './dto/respond-vinculacion.dto';
import { QueryVinculacionDto } from './dto/query-vinculacion.dto';

@ApiTags('Vinculación B2B')
@Controller('vinculacion')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
export class VinculacionController {
  constructor(private readonly vinculacionService: VinculacionService) {}

  // ─── Check RUC ───

  @Get('check-ruc/:ruc')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Verificar si existe una empresa con ese RUC' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  checkRuc(
    @Headers('x-tenant-id') empresaId: string,
    @Param('ruc') ruc: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.vinculacionService.checkRuc(ruc, empresaId);
  }

  // ─── CRUD Vinculaciones ───

  @Post()
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Enviar solicitud de vinculación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateVinculacionDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    dto.empresaSolicitanteId = empresaId;
    return this.vinculacionService.crear(dto);
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Listar vinculaciones de la empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query() dto: QueryVinculacionDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.vinculacionService.listar(empresaId, dto);
  }

  @Get('pendientes')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Obtener solicitudes de vinculación pendientes' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getPendientes(@Headers('x-tenant-id') empresaId: string) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.vinculacionService.getPendientes(empresaId);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Obtener detalle de una vinculación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getById(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.vinculacionService.getById(id, empresaId);
  }

  // ─── Acciones ───

  @Patch(':id/responder')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Aceptar o rechazar solicitud de vinculación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  responder(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: RespondVinculacionDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.vinculacionService.responder(id, empresaId, dto);
  }

  @Patch(':id/cancelar')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Cancelar solicitud de vinculación (solo solicitante, solo PENDIENTE)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  cancelar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.vinculacionService.cancelar(id, empresaId);
  }

  @Patch(':id/desvincular')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Desvincular (cualquier parte, solo ACEPTADA)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  desvincular(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.vinculacionService.desvincular(id, empresaId);
  }
}
