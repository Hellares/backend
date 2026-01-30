import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ReporteIncidenciaService } from './reporte-incidencia.service';
import {
  CrearReporteIncidenciaDto,
  ActualizarReporteIncidenciaDto,
  AgregarItemReporteDto,
  ResolverItemDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { EstadoReporteIncidencia } from '@prisma/client';

@Controller('reportes-incidencia')
@UseGuards(JwtAuthGuard)
export class ReporteIncidenciaController {
  constructor(
    private readonly reporteIncidenciaService: ReporteIncidenciaService,
  ) {}

  /**
   * Crear un nuevo reporte de incidencia
   * POST /reportes-incidencia
   */
  @Post()
  async crear(@Request() req, @Body() dto: CrearReporteIncidenciaDto) {
    try {
      const empresaId = req.user.empresaId || req.get('x-tenant-id');
      const usuarioId = req.user.userId;

      console.log('=== DEBUG CREAR REPORTE ===');
      console.log('empresaId:', empresaId);
      console.log('usuarioId:', usuarioId);
      console.log('dto:', JSON.stringify(dto, null, 2));
      console.log('req.user:', JSON.stringify(req.user, null, 2));

      return await this.reporteIncidenciaService.crear(empresaId, dto, usuarioId);
    } catch (error) {
      console.error('=== ERROR EN CREAR REPORTE ===');
      console.error('Error:', error);
      console.error('Stack:', error.stack);
      throw error;
    }
  }

  /**
   * Listar reportes de incidencia con filtros
   * GET /reportes-incidencia
   */
  @Get()
  async listar(
    @Request() req,
    @Query('sedeId') sedeId?: string,
    @Query('estado') estado?: EstadoReporteIncidencia,
    @Query('tipoReporte') tipoReporte?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    return this.reporteIncidenciaService.listar(empresaId, {
      sedeId,
      estado,
      tipoReporte,
      fechaDesde,
      fechaHasta,
    });
  }

  /**
   * Obtener detalle de un reporte específico
   * GET /reportes-incidencia/:id
   */
  @Get(':id')
  async obtenerPorId(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    return this.reporteIncidenciaService.obtenerPorId(empresaId, id);
  }

  /**
   * Actualizar información del reporte
   * PUT /reportes-incidencia/:id
   */
  @Put(':id')
  async actualizar(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ActualizarReporteIncidenciaDto,
  ) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    return this.reporteIncidenciaService.actualizar(empresaId, id, dto);
  }

  /**
   * Agregar item (producto) al reporte
   * POST /reportes-incidencia/:id/items
   */
  @Post(':id/items')
  async agregarItem(
    @Request() req,
    @Param('id') reporteId: string,
    @Body() dto: AgregarItemReporteDto,
  ) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    return this.reporteIncidenciaService.agregarItem(empresaId, reporteId, dto);
  }

  /**
   * Eliminar item del reporte
   * DELETE /reportes-incidencia/:id/items/:itemId
   */
  @Delete(':id/items/:itemId')
  async eliminarItem(
    @Request() req,
    @Param('id') reporteId: string,
    @Param('itemId') itemId: string,
  ) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    return this.reporteIncidenciaService.eliminarItem(
      empresaId,
      reporteId,
      itemId,
    );
  }

  /**
   * Enviar reporte para revisión
   * POST /reportes-incidencia/:id/enviar
   */
  @Post(':id/enviar')
  async enviarParaRevision(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    return this.reporteIncidenciaService.enviarParaRevision(empresaId, id);
  }

  /**
   * Aprobar reporte
   * POST /reportes-incidencia/:id/aprobar
   */
  @Post(':id/aprobar')
  async aprobar(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    const usuarioId = req.user.userId;
    return this.reporteIncidenciaService.aprobar(empresaId, id, usuarioId);
  }

  /**
   * Rechazar reporte
   * POST /reportes-incidencia/:id/rechazar
   */
  @Post(':id/rechazar')
  async rechazar(
    @Request() req,
    @Param('id') id: string,
    @Body('motivo') motivo?: string,
  ) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    const usuarioId = req.user.userId;
    return this.reporteIncidenciaService.rechazar(
      empresaId,
      id,
      usuarioId,
      motivo,
    );
  }

  /**
   * Resolver un item específico del reporte
   * POST /reportes-incidencia/:id/items/:itemId/resolver
   */
  @Post(':id/items/:itemId/resolver')
  async resolverItem(
    @Request() req,
    @Param('id') reporteId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ResolverItemDto,
  ) {
    const empresaId = req.user.empresaId || req.get('x-tenant-id');
    const usuarioId = req.user.userId;
    return this.reporteIncidenciaService.resolverItem(
      empresaId,
      reporteId,
      itemId,
      dto,
      usuarioId,
    );
  }
}
