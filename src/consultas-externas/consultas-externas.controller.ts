import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards';
import { ConsultasExternasService } from './consultas-externas.service';
import { ConsultaDniResponseDto } from './dto/consulta-dni-response.dto';
import { ConsultaRucResponseDto } from './dto/consulta-ruc-response.dto';
import { ConsultaLicenciaResponseDto } from './dto/consulta-licencia-response.dto';
import { ConsultaPlacaResponseDto } from './dto/consulta-placa-response.dto';
import { TipoCambioResponseDto } from './dto/tipo-cambio-response.dto';

// Nota: el guard JWT se aplica método por método porque `consultarDni` se
// expone público (con throttling) para que el form de registro pueda
// autocompletar datos desde RENIEC sin requerir sesión.
@ApiTags('Consultas Externas')
@Controller('consultas')
@ApiBearerAuth()
export class ConsultasExternasController {
  constructor(private readonly consultasService: ConsultasExternasService) {}

  @Get('ruc/:ruc')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Consultar datos de empresa por RUC (SUNAT)' })
  @ApiParam({ name: 'ruc', description: 'RUC de 11 dígitos', example: '20552103816' })
  @ApiResponse({ status: 200, description: 'Datos del contribuyente', type: ConsultaRucResponseDto })
  @ApiResponse({ status: 400, description: 'RUC inválido o no encontrado' })
  @ApiResponse({ status: 503, description: 'Servicio de consulta no disponible' })
  async consultarRuc(@Param('ruc') ruc: string): Promise<ConsultaRucResponseDto> {
    return this.consultasService.consultarRuc(ruc);
  }

  @Get('guia/:numero')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Consultar Guía de Remisión Electrónica (GRE) en SUNAT' })
  @ApiParam({
    name: 'numero',
    description: 'RUC-tipo-serie-número',
    example: '20132373958-09-T290-120',
  })
  @ApiResponse({ status: 200, description: 'Datos de la guía' })
  @ApiResponse({ status: 400, description: 'Formato inválido o guía no encontrada' })
  @ApiResponse({ status: 503, description: 'Servicio de consulta no disponible' })
  async consultarGuia(@Param('numero') numero: string): Promise<any> {
    return this.consultasService.consultarGuia(numero);
  }

  // Público + throttled: necesario en la pantalla de registro para
  // autocompletar nombres/apellidos antes de que exista sesión.
  @Get('dni/:dni')
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Consultar datos de persona por DNI (RENIEC)' })
  @ApiParam({ name: 'dni', description: 'DNI de 8 dígitos', example: '27427864' })
  @ApiResponse({ status: 200, description: 'Datos de la persona', type: ConsultaDniResponseDto })
  @ApiResponse({ status: 400, description: 'DNI inválido o no encontrado' })
  @ApiResponse({ status: 429, description: 'Demasiadas consultas. Intenta más tarde.' })
  @ApiResponse({ status: 503, description: 'Servicio de consulta no disponible' })
  async consultarDni(@Param('dni') dni: string): Promise<ConsultaDniResponseDto> {
    return this.consultasService.consultarDni(dni);
  }

  @Get('licencia/:dni')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Consultar licencia de conducir por DNI' })
  @ApiParam({ name: 'dni', description: 'DNI de 8 dígitos del conductor', example: '41410641' })
  @ApiResponse({ status: 200, description: 'Datos de la licencia', type: ConsultaLicenciaResponseDto })
  @ApiResponse({ status: 400, description: 'DNI inválido o licencia no encontrada' })
  async consultarLicencia(@Param('dni') dni: string): Promise<ConsultaLicenciaResponseDto> {
    return this.consultasService.consultarLicencia(dni);
  }

  @Get('placa/:placa')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Consultar datos de vehiculo por placa' })
  @ApiParam({ name: 'placa', description: 'Numero de placa', example: 'T7R831' })
  @ApiResponse({ status: 200, description: 'Datos del vehiculo', type: ConsultaPlacaResponseDto })
  @ApiResponse({ status: 400, description: 'Placa invalida o no encontrada' })
  async consultarPlaca(@Param('placa') placa: string): Promise<ConsultaPlacaResponseDto> {
    return this.consultasService.consultarPlaca(placa);
  }

  @Get('tipo-cambio')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Obtener tipo de cambio del dia (USD/PEN)' })
  @ApiResponse({ status: 200, description: 'Tipo de cambio', type: TipoCambioResponseDto })
  @ApiResponse({ status: 503, description: 'Servicio no disponible' })
  async consultarTipoCambio(): Promise<TipoCambioResponseDto> {
    return this.consultasService.consultarTipoCambio();
  }
}
