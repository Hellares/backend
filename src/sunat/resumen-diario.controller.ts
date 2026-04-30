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
import { ResumenDiarioService } from './resumen-diario.service';
import { CrearResumenDiarioDto } from './dto/resumen-diario.dto';

@ApiTags('SUNAT / Resumenes Diarios')
@Controller('sunat/resumenes-diarios')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ResumenDiarioController {
  constructor(private readonly service: ResumenDiarioService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un Resumen Diario (RC) de anulación de boletas' })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CrearResumenDiarioDto,
    @Req() req: any,
  ) {
    const userId = req?.user?.sub || req?.user?.id;
    return this.service.crear(empresaId, dto, userId);
  }

  @Post(':id/enviar')
  @ApiOperation({ summary: 'Enviar el RC a SUNAT (asíncrono, devuelve estado actualizado)' })
  async enviar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.enviar(id, empresaId);
  }

  @Post(':id/consultar')
  @ApiOperation({ summary: 'Re-consultar estado SUNAT de un RC en PROCESANDO' })
  async consultar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.consultar(id, empresaId);
  }

  @Get()
  @ApiOperation({ summary: 'Listar resúmenes diarios con filtros' })
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
    summary: 'Listar boletas elegibles para anular vía RC en una fecha',
  })
  async elegibles(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId: string,
    @Query('fechaReferencia') fechaReferencia: string,
  ) {
    return this.service.obtenerElegibles(empresaId, sedeId, fechaReferencia);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de un RC con sus boletas' })
  async obtener(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.obtenerPorId(id, empresaId);
  }
}
