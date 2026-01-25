import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ProductoStockService } from './producto-stock.service';
import {
  CrearStockDto,
  AjustarStockDto,
  ActualizarPreciosSedeDto,
  AjusteMasivoPreciosDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Inventarios - Stock por Sede')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('producto-stock')
export class ProductoStockController {
  constructor(private readonly stockService: ProductoStockService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear registro de stock',
    description: 'Crea un nuevo registro de stock para un producto/variante en una sede',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async crearStock(
    @Body() dto: CrearStockDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.stockService.crearStock(empresaId, dto, user.sub);
  }

  @Get('sede/:sedeId')
  @ApiOperation({
    summary: 'Listar stock de una sede',
    description: 'Obtiene todos los productos con stock en una sede específica',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getStocksPorSede(
    @Param('sedeId') sedeId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return await this.stockService.getStocksPorSede(
      sedeId,
      empresaId,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @Get('producto/:productoId/sede/:sedeId')
  @ApiOperation({
    summary: 'Obtener stock de producto en sede',
    description: 'Consulta el stock actual de un producto específico en una sede',
  })
  async getStockProductoEnSede(
    @Param('productoId') productoId: string,
    @Param('sedeId') sedeId: string,
  ) {
    return await this.stockService.getStockPorSede(sedeId, productoId);
  }

  @Put(':id/ajustar')
  @ApiOperation({
    summary: 'Ajustar stock',
    description: 'Ajusta el stock de un producto (entrada, salida, ajuste, etc)',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async ajustarStock(
    @Param('id') id: string,
    @Body() dto: AjustarStockDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.stockService.ajustarStock(id, empresaId, dto, user.sub);
  }

  @Get(':id/movimientos')
  @ApiOperation({
    summary: 'Historial de movimientos',
    description: 'Obtiene el historial de movimientos de stock',
  })
  async getHistorialMovimientos(
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    return await this.stockService.getHistorialMovimientos(
      id,
      limit ? +limit : 50,
    );
  }

  @Get('producto/:productoId/todas-sedes')
  @ApiOperation({
    summary: 'Stock en todas las sedes',
    description: 'Obtiene el stock de un producto en todas las sedes con resumen total',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getStockEnTodasSedes(
    @Param('productoId') productoId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('varianteId') varianteId?: string,
  ) {
    return await this.stockService.getStockEnTodasSedes(
      empresaId,
      productoId,
      varianteId,
    );
  }

  @Get('alertas/bajo-minimo')
  @ApiOperation({
    summary: 'Productos bajo stock mínimo',
    description: 'Obtiene lista de productos con stock igual o inferior al mínimo configurado',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getProductosBajoMinimo(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return await this.stockService.getProductosBajoMinimo(empresaId, sedeId);
  }

  @Post('combo/validar-stock')
  @ApiOperation({
    summary: 'Validar stock de combo',
    description: 'Verifica si hay stock suficiente de todos los componentes de un combo',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async validarStockCombo(
    @Headers('x-tenant-id') empresaId: string,
    @Body()
    body: {
      comboId: string;
      sedeId: string;
      cantidad: number;
    },
  ) {
    return await this.stockService.validarStockCombo(
      body.comboId,
      body.sedeId,
      empresaId,
      body.cantidad,
    );
  }

  @Post('combo/descontar-stock')
  @ApiOperation({
    summary: 'Descontar stock de combo',
    description:
      'Descuenta el stock de todos los componentes de un combo al realizar una venta',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async descontarStockCombo(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      comboId: string;
      sedeId: string;
      cantidad: number;
      tipoDocumento?: string;
      numeroDocumento?: string;
    },
  ) {
    return await this.stockService.descontarStockCombo(
      body.comboId,
      body.sedeId,
      empresaId,
      body.cantidad,
      user.sub,
      body.tipoDocumento,
      body.numeroDocumento,
    );
  }

  // =====================================================
  // 💰 ENDPOINTS DE GESTIÓN DE PRECIOS POR SEDE
  // =====================================================

  @Patch(':id/precios')
  @ApiOperation({
    summary: 'Actualizar precios de producto en sede',
    description:
      'Actualiza los precios de un producto específico en una sede. ' +
      'Permite establecer precios independientes por sede. ' +
      'Registra el cambio en el historial para auditoría.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async actualizarPreciosSede(
    @Param('id') productoStockId: string,
    @Body() dto: ActualizarPreciosSedeDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.stockService.actualizarPreciosSede(
      productoStockId,
      empresaId,
      dto,
      user.sub,
    );
  }

  @Get('precio')
  @ApiOperation({
    summary: 'Obtener precio de producto en sede',
    description:
      'Obtiene el precio configurado de un producto/variante en una sede específica. ' +
      'Retorna null si no tiene precio configurado. ' +
      'También verifica si hay ofertas activas por fechas.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async obtenerPrecio(
    @Query('sedeId') sedeId: string,
    @Query('productoId') productoId?: string,
    @Query('varianteId') varianteId?: string,
  ) {
    return await this.stockService.obtenerPrecio(
      sedeId,
      productoId,
      varianteId,
    );
  }

  @Get('validar-venta')
  @ApiOperation({
    summary: 'Validar disponibilidad para venta',
    description:
      'Valida si un producto está disponible para venta en una sede. ' +
      'Verifica: precio configurado, stock suficiente, producto activo. ' +
      'Retorna lista de razones si no está disponible.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async validarDisponibleParaVenta(
    @Query('sedeId') sedeId: string,
    @Query('productoId') productoId: string,
    @Query('varianteId') varianteId?: string,
    @Query('cantidad') cantidad?: number,
  ) {
    return await this.stockService.validarDisponibleParaVenta(
      sedeId,
      productoId,
      varianteId || null,
      cantidad ? +cantidad : 1,
    );
  }

  @Get('sede/:sedeId/pendientes-precio')
  @ApiOperation({
    summary: 'Productos pendientes de configuración de precio',
    description:
      'Lista productos con stock disponible pero sin precio configurado en una sede. ' +
      'Útil para dashboards y alertas de productos pendientes.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getProductosPendientesPrecio(
    @Param('sedeId') sedeId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return await this.stockService.getProductosPendientesPrecio(
      sedeId,
      empresaId,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @Get('sede/:sedeId/listos-venta')
  @ApiOperation({
    summary: 'Productos listos para venta',
    description:
      'Lista productos con precio configurado, stock disponible y activos en una sede. ' +
      'Estos productos están listos para ser vendidos.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getProductosListosVenta(
    @Param('sedeId') sedeId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return await this.stockService.getProductosListosVenta(
      sedeId,
      empresaId,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @Get('marketplace')
  @ApiOperation({
    summary: 'Productos para marketplace',
    description:
      'Lista productos disponibles para mostrar en el marketplace. ' +
      'Filtra por: precio configurado, stock disponible, visible en marketplace.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getProductosMarketplace(
    @Headers('x-tenant-id') empresaId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return await this.stockService.getProductosMarketplace(
      empresaId,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @Get('estadisticas-precios')
  @ApiOperation({
    summary: 'Estadísticas de configuración de precios',
    description:
      'Obtiene métricas sobre el estado de configuración de precios. ' +
      'Incluye: total, con precio, sin precio, listos para venta, pendientes, etc. ' +
      'Útil para dashboards y reportes.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getEstadisticasPrecios(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return await this.stockService.getEstadisticasPrecios(empresaId, sedeId);
  }

  @Get(':id/precios/historial')
  @ApiOperation({
    summary: 'Historial de cambios de precios',
    description:
      'Obtiene el historial completo de cambios de precio de un producto en una sede. ' +
      'Incluye información de usuario, fechas, precios anteriores/nuevos, tipo de cambio y razón.',
  })
  async obtenerHistorialPrecios(
    @Param('id') productoStockId: string,
    @Query('limit') limit?: number,
  ) {
    return await this.stockService.obtenerHistorialPreciosSede(
      productoStockId,
      limit ? +limit : 50,
    );
  }

  @Post('sedes/:sedeId/precios/ajuste-masivo')
  @ApiOperation({
    summary: 'Ajuste masivo de precios en una sede',
    description:
      'Actualiza precios de forma masiva para todos o algunos productos de una sede. ' +
      'Permite ajustes por porcentaje o monto fijo, tanto para precio de venta como precio de costo. ' +
      'Útil para ajustes por inflación, cambios de estrategia, o actualizaciones de costos. ' +
      'Todos los cambios se registran en el historial para auditoría.',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async ajusteMasivoPrecios(
    @Param('sedeId') sedeId: string,
    @Body() dto: AjusteMasivoPreciosDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.stockService.actualizarPreciosMasivosPorSede(
      sedeId,
      empresaId,
      {
        tipo: dto.tipo,
        valor: dto.valor,
        aplicarA: dto.aplicarA,
        operacion: dto.operacion,
        productoIds: dto.productoIds,
      },
      user.sub,
    );
  }
}
