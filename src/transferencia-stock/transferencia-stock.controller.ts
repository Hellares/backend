import {
  Controller,
  Get,
  Post,
  Put,
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
  ApiQuery,
} from '@nestjs/swagger';
import { TransferenciaStockService } from './transferencia-stock.service';
import { CrearTransferenciaDto } from './dto/crear-transferencia.dto';
import { AprobarTransferenciaDto } from './dto/aprobar-transferencia.dto';
import { RecibirTransferenciaDto } from './dto/recibir-transferencia.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { EstadoTransferencia } from '@prisma/client';

@ApiTags('Inventarios - Transferencias entre Sedes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transferencias-stock')
export class TransferenciaStockController {
  constructor(
    private readonly transferenciaService: TransferenciaStockService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Crear transferencia de stock',
    description:
      'Crea una nueva solicitud de transferencia entre sedes. Valida stock disponible en origen.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async crear(
    @Body() dto: CrearTransferenciaDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.transferenciaService.crear(empresaId, dto, user.sub);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar transferencias',
    description: 'Obtiene lista de transferencias con filtros opcionales',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  @ApiQuery({ name: 'sedeId', required: false, description: 'Filtrar por sede (origen o destino)' })
  @ApiQuery({ name: 'estado', required: false, enum: EstadoTransferencia })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('estado') estado?: EstadoTransferencia,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return await this.transferenciaService.listar(
      empresaId,
      sedeId,
      estado,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtener transferencia por ID',
    description: 'Consulta detalle completo de una transferencia incluyendo movimientos',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async obtener(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return await this.transferenciaService.obtener(id, empresaId);
  }

  @Put(':id/aprobar')
  @ApiOperation({
    summary: 'Aprobar transferencia',
    description: 'Aprueba una transferencia pendiente. Requiere permisos de supervisor.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async aprobar(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto?: AprobarTransferenciaDto,
  ) {
    return await this.transferenciaService.aprobar(
      id,
      empresaId,
      user.sub,
      dto,
    );
  }

  @Put(':id/enviar')
  @ApiOperation({
    summary: 'Enviar transferencia (marcar en tránsito)',
    description:
      'Marca la transferencia como enviada. Descuenta stock de la sede origen.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async enviar(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.transferenciaService.enviar(id, empresaId, user.sub);
  }

  @Put(':id/recibir')
  @ApiOperation({
    summary: 'Recibir transferencia',
    description:
      'Registra recepción en sede destino. Incrementa stock destino. Auto-crea ProductoStock si no existe.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async recibir(
    @Param('id') id: string,
    @Body() dto: RecibirTransferenciaDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.transferenciaService.recibir(
      id,
      empresaId,
      user.sub,
      dto,
    );
  }

  @Put(':id/rechazar')
  @ApiOperation({
    summary: 'Rechazar transferencia',
    description: 'Rechaza una transferencia pendiente.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async rechazar(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { motivo: string },
  ) {
    return await this.transferenciaService.rechazar(
      id,
      empresaId,
      user.sub,
      body.motivo,
    );
  }

  @Put(':id/cancelar')
  @ApiOperation({
    summary: 'Cancelar transferencia',
    description: 'Cancela una transferencia (solo si está pendiente o aprobada).',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async cancelar(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { motivo: string },
  ) {
    return await this.transferenciaService.cancelar(
      id,
      empresaId,
      user.sub,
      body.motivo,
    );
  }
}
