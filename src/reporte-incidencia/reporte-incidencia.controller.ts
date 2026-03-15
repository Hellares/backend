import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
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
import { EstadoReporteIncidencia } from '@prisma/client';

@Controller('reportes-incidencia')
@UseGuards(JwtAuthGuard, TenantAuthGuard)
export class ReporteIncidenciaController {
  constructor(
    private readonly reporteIncidenciaService: ReporteIncidenciaService,
  ) {}

  /**
   * Crear un nuevo reporte de incidencia
   * POST /reportes-incidencia
   */
  @Post()
  async crear(
    @Request() req,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CrearReporteIncidenciaDto,
  ) {
    return this.reporteIncidenciaService.crear(empresaId, dto, req.user.userId);
  }

  /**
   * Listar reportes de incidencia con filtros
   * GET /reportes-incidencia
   */
  @Get()
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('estado') estado?: EstadoReporteIncidencia,
    @Query('tipoReporte') tipoReporte?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
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
  async obtenerPorId(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.reporteIncidenciaService.obtenerPorId(empresaId, id);
  }

  /**
   * Actualizar información del reporte
   * PUT /reportes-incidencia/:id
   */
  @Put(':id')
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: ActualizarReporteIncidenciaDto,
  ) {
    return this.reporteIncidenciaService.actualizar(empresaId, id, dto);
  }

  /**
   * Agregar item (producto) al reporte
   * POST /reportes-incidencia/:id/items
   */
  @Post(':id/items')
  async agregarItem(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') reporteId: string,
    @Body() dto: AgregarItemReporteDto,
  ) {
    return this.reporteIncidenciaService.agregarItem(empresaId, reporteId, dto);
  }

  /**
   * Eliminar item del reporte
   * DELETE /reportes-incidencia/:id/items/:itemId
   */
  @Delete(':id/items/:itemId')
  async eliminarItem(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') reporteId: string,
    @Param('itemId') itemId: string,
  ) {
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
  async enviarParaRevision(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.reporteIncidenciaService.enviarParaRevision(empresaId, id);
  }

  /**
   * Aprobar reporte
   * POST /reportes-incidencia/:id/aprobar
   */
  @Post(':id/aprobar')
  async aprobar(
    @Request() req,
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.reporteIncidenciaService.aprobar(empresaId, id, req.user.userId);
  }

  /**
   * Rechazar reporte
   * POST /reportes-incidencia/:id/rechazar
   */
  @Post(':id/rechazar')
  async rechazar(
    @Request() req,
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body('motivo') motivo?: string,
  ) {
    return this.reporteIncidenciaService.rechazar(
      empresaId,
      id,
      req.user.userId,
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
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') reporteId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ResolverItemDto,
  ) {
    return this.reporteIncidenciaService.resolverItem(
      empresaId,
      reporteId,
      itemId,
      dto,
      req.user.userId,
    );
  }
}
