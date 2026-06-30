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
import { CrearTransferenciasMultiplesDto } from './dto/crear-transferencias-multiples.dto';
import { AprobarTransferenciaDto } from './dto/aprobar-transferencia.dto';
import { RecibirTransferenciaDto } from './dto/recibir-transferencia.dto';
import { ProcesarCompletoTransferenciaDto } from './dto/procesar-completo-transferencia.dto';
import { RecibirTransferenciaConIncidenciasDto } from './dto/recibir-transferencia-con-incidencias.dto';
import { ResolverIncidenciaDto } from './dto/resolver-incidencia.dto';
import { CrearIncidenciaPosteriorDto } from './dto/crear-incidencia-posterior.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SedeAccessGuard } from '../auth/guards/sede-access.guard';
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
  @UseGuards(SedeAccessGuard)
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

  @Post('multiples')
  @ApiOperation({
    summary: 'Crear múltiples transferencias',
    description:
      'Crea múltiples transferencias de diferentes productos en una sola operación. ' +
      'Todas las transferencias usan las mismas sedes (origen y destino). ' +
      'Valida stock de todos los productos antes de crear las transferencias.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async crearMultiples(
    @Body() dto: CrearTransferenciasMultiplesDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.transferenciaService.crearMultiples(
      empresaId,
      dto,
      user.sub,
    );
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

  // ========================================
  // ENDPOINTS DE INCIDENCIAS (deben ir ANTES de :id para evitar conflictos)
  // ========================================

  @Get('incidencias')
  @ApiOperation({
    summary: 'Listar incidencias de transferencias',
    description:
      'Obtiene la lista de incidencias reportadas en transferencias con filtros opcionales. ' +
      'Útil para dashboard de gestión logística y reportes de problemas.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  @ApiQuery({
    name: 'resuelto',
    required: false,
    type: Boolean,
    description: 'Filtrar por estado (true=resueltas, false=pendientes)',
  })
  @ApiQuery({
    name: 'tipo',
    required: false,
    type: String,
    description:
      'Filtrar por tipo: FALTANTE, DANADO, CALIDAD_RECHAZADA, EXCEDENTE, EMPAQUE_DANADO, PRODUCTO_INCORRECTO',
  })
  @ApiQuery({
    name: 'sedeId',
    required: false,
    type: String,
    description: 'Filtrar por sede (origen o destino)',
  })
  @ApiQuery({
    name: 'transferenciaId',
    required: false,
    type: String,
    description: 'Filtrar por transferencia específica',
  })
  async listarIncidencias(
    @Headers('x-tenant-id') empresaId: string,
    @Query('resuelto') resuelto?: string,
    @Query('tipo') tipo?: string,
    @Query('sedeId') sedeId?: string,
    @Query('transferenciaId') transferenciaId?: string,
  ) {
    return await this.transferenciaService.listarIncidencias(empresaId, {
      resuelto: resuelto === 'true' ? true : resuelto === 'false' ? false : undefined,
      tipo,
      sedeId,
      transferenciaId,
    });
  }

  @Post('incidencias/:incidenciaId/resolver')
  @ApiOperation({
    summary: 'Resolver incidencia de transferencia',
    description:
      'Toma una acción para resolver una incidencia reportada. ' +
      'Opciones: DEVOLVER_ORIGEN (crea transferencia inversa), DAR_DE_BAJA (elimina stock), ' +
      'REPARAR (mueve a garantía), ACEPTAR_CON_DESCUENTO (pasa a vendible), RECLAMAR_PROVEEDOR (solo marca como resuelto).',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async resolverIncidencia(
    @Param('incidenciaId') incidenciaId: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: ResolverIncidenciaDto,
  ) {
    return await this.transferenciaService.resolverIncidencia(
      incidenciaId,
      empresaId,
      user.sub,
      dto,
    );
  }

  // ========================================
  // ENDPOINTS POR ID (van después de rutas específicas)
  // ========================================

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

  @Post(':id/recibir-con-incidencias')
  @ApiOperation({
    summary: 'Recibir transferencia con registro de incidencias',
    description:
      'Registra la recepción de una transferencia permitiendo reportar productos dañados, faltantes y otros problemas. ' +
      'Crea tickets de incidencia para cada problema detectado. ' +
      'Actualiza el stock destino separando productos buenos (stockActual vendible) de dañados (stockDanado). ' +
      'Implementa Interpretación A: stockActual incluye todo el físico (buenos + dañados), ' +
      'stockDisponibleVenta = stockActual - stockDanado - stockEnGarantia - reservas. ' +
      'Permite recepción parcial item por item.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async recibirConIncidencias(
    @Param('id') id: string,
    @Body() dto: RecibirTransferenciaConIncidenciasDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.transferenciaService.recibirConIncidencias(
      id,
      empresaId,
      user.sub,
      dto,
    );
  }

  @Put(':id/procesar-completo')
  @ApiOperation({
    summary: 'Procesar completamente transferencia (aprobar + enviar + recibir)',
    description:
      'Ejecuta todo el flujo de la transferencia en una sola operación: aprueba, envía y recibe la transferencia. ' +
      'Útil cuando se sabe que todo es correcto y se quiere acelerar el proceso. ' +
      'Descuenta stock de origen, crea/actualiza stock en destino y marca la transferencia como recibida.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async procesarCompleto(
    @Param('id') id: string,
    @Body() dto: ProcesarCompletoTransferenciaDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.transferenciaService.procesarCompleto(
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

  @Post(':id/crear-incidencia')
  @ApiOperation({
    summary: 'Crear incidencia posterior a la recepción',
    description:
      'Permite reportar incidencias DESPUÉS de haber recibido una transferencia completamente. ' +
      'Útil para casos donde se recibió conforme, pero al abrir/verificar cajas se encontraron problemas. ' +
      'La transferencia debe estar en estado RECIBIDA.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async crearIncidenciaPosterior(
    @Param('id') transferenciaId: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CrearIncidenciaPosteriorDto,
  ) {
    return await this.transferenciaService.crearIncidenciaPosterior(
      transferenciaId,
      empresaId,
      user.sub,
      dto,
    );
  }
}
