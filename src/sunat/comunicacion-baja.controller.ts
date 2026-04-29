import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ComunicacionBajaService } from './comunicacion-baja.service';
import { CrearComunicacionBajaDto } from './dto/comunicacion-baja.dto';

@ApiTags('SUNAT / Comunicaciones de Baja')
@Controller('sunat/comunicaciones-baja')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ComunicacionBajaController {
  constructor(private readonly service: ComunicacionBajaService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una Comunicación de Baja (RA) en el proveedor' })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CrearComunicacionBajaDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.sub || req?.user?.id;
    return this.service.crear(empresaId, dto, userId);
  }

  @Post(':id/enviar')
  @ApiOperation({ summary: 'Enviar la CDB a SUNAT (asíncrono, devuelve estado actualizado)' })
  async enviar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.enviar(id, empresaId);
  }

  @Post(':id/consultar')
  @ApiOperation({ summary: 'Re-consultar estado SUNAT de una CDB en ENVIADO' })
  async consultar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.consultar(id, empresaId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar comunicaciones de baja con filtros' })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('estadoSunat') estadoSunat?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listar(empresaId, {
      estadoSunat,
      fechaDesde,
      fechaHasta,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('elegibles')
  @ApiOperation({
    summary: 'Listar comprobantes elegibles para anular vía CDB en una fecha',
  })
  async elegibles(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId: string,
    @Query('fechaReferencia') fechaReferencia: string,
  ) {
    return this.service.obtenerElegibles(empresaId, sedeId, fechaReferencia);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una CDB con sus comprobantes' })
  async obtener(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.obtenerPorId(id, empresaId);
  }
}
