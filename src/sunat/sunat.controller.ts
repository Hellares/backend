import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  Headers,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FacturacionService } from './facturacion.service';
import { AnularComprobanteDto } from './dto/anular-comprobante.dto';
import { CrearNotaDto } from './dto/crear-nota.dto';
import { ConfiguracionFacturacionDto } from './dto/configuracion-facturacion.dto';
import { ProbarConexionDto } from './dto/probar-conexion.dto';
import { PreviewSincronizacionQueryDto, AplicarSincronizacionDto } from './dto/sincronizar-series.dto';

@ApiTags('SUNAT / Facturación Electrónica')
@Controller('sunat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SunatController {
  constructor(private readonly facturacionService: FacturacionService) {}

  // ── Reporte de correlativos ──
  @Get('reporte-correlativos')
  @ApiOperation({ summary: 'Reporte de integridad de correlativos por serie' })
  async reporteCorrelativos(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.facturacionService.reporteCorrelativos(empresaId, sedeId || undefined, fechaDesde, fechaHasta);
  }

  // ── Monitor: listar comprobantes con filtros ──
  @Get('comprobantes')
  @ApiOperation({ summary: 'Listar comprobantes electrónicos con filtros' })
  async listarComprobantes(
    @Headers('x-tenant-id') empresaId: string,
    @Query('tipo') tipo?: string,
    @Query('sunatStatus') sunatStatus?: string,
    @Query('sedeId') sedeId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('busqueda') busqueda?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.facturacionService.listarComprobantes(empresaId, {
      tipo, sunatStatus, sedeId, fechaDesde, fechaHasta, busqueda,
      page: parseInt(page || '1', 10),
      limit: parseInt(limit || '20', 10),
    });
  }

  // ── Enviar masivo: reenviar todos los pendientes ──
  @Post('comprobantes/enviar-pendientes')
  @ApiOperation({ summary: 'Reenviar todos los comprobantes pendientes al proveedor' })
  async enviarPendientes(@Headers('x-tenant-id') empresaId: string) {
    return this.facturacionService.enviarPendientes(empresaId);
  }

  // ── Consultar masivo: actualizar estado SUNAT de todos los PROCESANDO ──
  @Post('comprobantes/consultar-pendientes')
  @ApiOperation({
    summary: 'Consulta masiva del estado SUNAT de comprobantes PROCESANDO (batch-status del proveedor)',
  })
  async consultarPendientes(@Headers('x-tenant-id') empresaId: string) {
    return this.facturacionService.consultarPendientesBatch(empresaId);
  }

  // ── Enviar/Reenviar comprobante ──
  @Post('comprobantes/:id/enviar')
  @ApiOperation({ summary: 'Enviar o reenviar comprobante a SUNAT' })
  async enviarComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteId: string,
  ) {
    return this.facturacionService.reenviarComprobante(comprobanteId, empresaId);
  }

  // ── Listar emisores disponibles (RUCs configurados) ──
  @Get('emisores')
  @ApiOperation({ summary: 'Listar emisores disponibles (empresa + sedes con RUC propio)' })
  async listarEmisores(@Headers('x-tenant-id') empresaId: string) {
    return this.facturacionService.listarEmisores(empresaId);
  }

  // ── Consultar estado en SUNAT ──
  @Get('comprobantes/:id/consultar')
  @ApiOperation({ summary: 'Consultar estado del comprobante en SUNAT' })
  async consultarComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteId: string,
  ) {
    return this.facturacionService.consultarComprobante(comprobanteId, empresaId);
  }

  // ── Anular comprobante ──
  @Post('comprobantes/:id/anular')
  @ApiOperation({ summary: 'Generar comunicación de baja (anulación) en SUNAT' })
  async anularComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteId: string,
    @Body() dto: AnularComprobanteDto,
  ) {
    return this.facturacionService.anularComprobante(comprobanteId, empresaId, dto.motivo);
  }

  // ── Consultar anulación ──
  @Get('comprobantes/:id/consultar-anulacion')
  @ApiOperation({ summary: 'Consultar estado de anulación en SUNAT' })
  async consultarAnulacion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteId: string,
  ) {
    return this.facturacionService.consultarAnulacion(comprobanteId, empresaId);
  }

  // ── Catálogos SUNAT ──
  @Get('catalogos/motivos-nota')
  @ApiOperation({
    summary: 'Listar motivos válidos para nota de crédito (catálogo 09) o débito (catálogo 10)',
  })
  async getMotivosNota(@Query('tipo') tipo: string) {
    return this.facturacionService.getMotivosNota(tipo);
  }

  // ── Nota de Crédito ──
  @Post('comprobantes/:id/nota-credito')
  @ApiOperation({ summary: 'Crear nota de crédito asociada a un comprobante' })
  async crearNotaCredito(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteOrigenId: string,
    @Body() dto: CrearNotaDto,
  ) {
    return this.facturacionService.crearNotaCredito(comprobanteOrigenId, empresaId, dto);
  }

  // ── Nota de Débito ──
  @Post('comprobantes/:id/nota-debito')
  @ApiOperation({ summary: 'Crear nota de débito asociada a un comprobante' })
  async crearNotaDebito(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteOrigenId: string,
    @Body() dto: CrearNotaDto,
  ) {
    return this.facturacionService.crearNotaDebito(comprobanteOrigenId, empresaId, dto);
  }

  // ── Configuración de facturación ──
  @Get('configuracion')
  @ApiOperation({ summary: 'Obtener configuración efectiva de facturación (sede > empresa)' })
  async getConfiguracion(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.facturacionService.getConfigFacturacionEfectiva(empresaId, sedeId || null);
  }

  @Put('configuracion')
  @ApiOperation({ summary: 'Actualizar configuración de facturación electrónica' })
  async updateConfiguracion(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: ConfiguracionFacturacionDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.sub || req?.user?.id;
    return this.facturacionService.updateConfiguracion(empresaId, dto, userId);
  }

  @Post('configuracion/probar')
  @ApiOperation({
    summary: 'Probar conexión con el proveedor usando credenciales tentativas (no persiste)',
  })
  async probarConexion(@Body() dto: ProbarConexionDto) {
    return this.facturacionService.probarConexion(dto);
  }

  // ── Sincronización de series con el proveedor ──

  @Get('series/preview')
  @ApiOperation({
    summary: 'Consultar series del proveedor y comparar contra la Sede (dry-run, no modifica)',
  })
  async previewSincronizacionSeries(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: PreviewSincronizacionQueryDto,
  ) {
    return this.facturacionService.previewSincronizacionSeries(empresaId, query.sedeId);
  }

  @Post('series/sincronizar')
  @ApiOperation({
    summary: 'Aplicar selecciones de sincronización a la Sede (rechaza CONFLICTO)',
  })
  async aplicarSincronizacionSeries(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: AplicarSincronizacionDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.sub || req?.user?.id;
    return this.facturacionService.aplicarSincronizacionSeries(empresaId, dto, userId);
  }
}
