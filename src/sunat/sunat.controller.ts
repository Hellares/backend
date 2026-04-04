import {
  Controller,
  Post,
  Get,
  Put,
  Param,
  Body,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NubefactService } from './nubefact.service';
import { AnularComprobanteDto } from './dto/anular-comprobante.dto';
import { CrearNotaDto } from './dto/crear-nota.dto';
import { ConfiguracionFacturacionDto } from './dto/configuracion-facturacion.dto';

@ApiTags('SUNAT / Facturación Electrónica')
@Controller('sunat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SunatController {
  constructor(private readonly nubefactService: NubefactService) {}

  // ── Monitor: listar comprobantes con filtros ──
  @Get('comprobantes')
  @ApiOperation({ summary: 'Listar comprobantes electrónicos con filtros' })
  async listarComprobantes(
    @Headers('x-tenant-id') empresaId: string,
    @Query('tipo') tipo?: string,
    @Query('sunatStatus') sunatStatus?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('busqueda') busqueda?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.nubefactService.listarComprobantes(empresaId, {
      tipo, sunatStatus, fechaDesde, fechaHasta, busqueda,
      page: parseInt(page || '1', 10),
      limit: parseInt(limit || '20', 10),
    });
  }

  // ── Enviar masivo: reenviar todos los pendientes ──
  @Post('comprobantes/enviar-pendientes')
  @ApiOperation({ summary: 'Reenviar todos los comprobantes pendientes a Nubefact' })
  async enviarPendientes(@Headers('x-tenant-id') empresaId: string) {
    return this.nubefactService.enviarPendientes(empresaId);
  }

  // ── Enviar/Reenviar comprobante a Nubefact ──
  @Post('comprobantes/:id/enviar')
  @ApiOperation({ summary: 'Enviar o reenviar comprobante a SUNAT via Nubefact' })
  async enviarComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteId: string,
  ) {
    return this.nubefactService.reenviarComprobante(comprobanteId, empresaId);
  }

  // ── Listar emisores disponibles (RUCs configurados) ──
  @Get('emisores')
  @ApiOperation({ summary: 'Listar emisores disponibles (empresa + sedes con RUC propio)' })
  async listarEmisores(@Headers('x-tenant-id') empresaId: string) {
    return this.nubefactService.listarEmisores(empresaId);
  }

  // ── Consultar estado en SUNAT ──
  @Get('comprobantes/:id/consultar')
  @ApiOperation({ summary: 'Consultar estado del comprobante en SUNAT' })
  async consultarComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteId: string,
  ) {
    return this.nubefactService.consultarComprobante(comprobanteId, empresaId);
  }

  // ── Anular comprobante ──
  @Post('comprobantes/:id/anular')
  @ApiOperation({ summary: 'Generar comunicación de baja (anulación) en SUNAT' })
  async anularComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteId: string,
    @Body() dto: AnularComprobanteDto,
  ) {
    return this.nubefactService.anularComprobante(comprobanteId, empresaId, dto.motivo);
  }

  // ── Consultar anulación ──
  @Get('comprobantes/:id/consultar-anulacion')
  @ApiOperation({ summary: 'Consultar estado de anulación en SUNAT' })
  async consultarAnulacion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteId: string,
  ) {
    return this.nubefactService.consultarAnulacion(comprobanteId, empresaId);
  }

  // ── Nota de Crédito ──
  @Post('comprobantes/:id/nota-credito')
  @ApiOperation({ summary: 'Crear nota de crédito asociada a un comprobante' })
  async crearNotaCredito(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteOrigenId: string,
    @Body() dto: CrearNotaDto,
  ) {
    return this.nubefactService.crearNotaCredito(comprobanteOrigenId, empresaId, dto);
  }

  // ── Nota de Débito ──
  @Post('comprobantes/:id/nota-debito')
  @ApiOperation({ summary: 'Crear nota de débito asociada a un comprobante' })
  async crearNotaDebito(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') comprobanteOrigenId: string,
    @Body() dto: CrearNotaDto,
  ) {
    return this.nubefactService.crearNotaDebito(comprobanteOrigenId, empresaId, dto);
  }

  // ── Configuración de facturación ──
  @Get('configuracion')
  @ApiOperation({ summary: 'Obtener configuración efectiva de facturación (sede > empresa)' })
  async getConfiguracion(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.nubefactService.getConfigFacturacionEfectiva(empresaId, sedeId || null);
  }

  @Put('configuracion')
  @ApiOperation({ summary: 'Actualizar configuración de facturación electrónica' })
  async updateConfiguracion(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: ConfiguracionFacturacionDto,
  ) {
    return this.nubefactService.updateConfiguracion(empresaId, dto);
  }
}
