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
import { TercerizacionService } from './tercerizacion.service';
import { CreateTercerizacionDto } from './dto/create-tercerizacion.dto';
import { RespondTercerizacionDto } from './dto/respond-tercerizacion.dto';
import { CompleteTercerizacionDto } from './dto/complete-tercerizacion.dto';
import { QueryTercerizacionDto } from './dto/query-tercerizacion.dto';
import { QueryDirectorioDto } from './dto/query-directorio.dto';

@ApiTags('Tercerización')
@Controller('tercerizacion')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
export class TercerizacionController {
  constructor(private readonly tercerizacionService: TercerizacionService) {}

  // ─── Empresas vinculadas ───

  @Get('vinculadas')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener empresas vinculadas que aceptan tercerización' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getEmpresasVinculadas(@Headers('x-tenant-id') empresaId: string) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.tercerizacionService.getEmpresasVinculadas(empresaId);
  }

  // ─── Directorio de empresas ───

  @Get('directorio')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Buscar empresas que aceptan tercerización' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  buscarEmpresas(
    @Headers('x-tenant-id') empresaId: string,
    @Query() dto: QueryDirectorioDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.tercerizacionService.buscarEmpresas(empresaId, dto);
  }

  // ─── CRUD Tercerizaciones ───

  @Post()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Crear solicitud de tercerización' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateTercerizacionDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    dto.empresaOrigenId = empresaId;
    return this.tercerizacionService.crear(dto);
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar tercerizaciones de la empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query() dto: QueryTercerizacionDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.tercerizacionService.listar(empresaId, dto);
  }

  @Get('pendientes')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener solicitudes pendientes de respuesta' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getPendientes(@Headers('x-tenant-id') empresaId: string) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.tercerizacionService.getPendientes(empresaId);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener detalle de una tercerización' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getById(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.tercerizacionService.getById(id, empresaId);
  }

  // ─── Acciones ───

  @Patch(':id/responder')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Aceptar o rechazar solicitud de tercerización' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  responder(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: RespondTercerizacionDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.tercerizacionService.responder(id, empresaId, dto);
  }

  @Patch(':id/completar')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Marcar tercerización como completada con precio B2B' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  completar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: CompleteTercerizacionDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.tercerizacionService.completar(id, empresaId, dto);
  }

  @Patch(':id/cancelar')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Cancelar solicitud de tercerización' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  cancelar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.tercerizacionService.cancelar(id, empresaId);
  }
}
