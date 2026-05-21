import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ProductoStockService } from './producto-stock.service';
import {
  CrearStockDto,
  AjustarStockDto,
  ActualizarPreciosSedeDto,
  AjusteMasivoPreciosDto,
  QueryHistorialPreciosDto,
  ActivarLiquidacionDto,
  VerificarPreciosDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ProductoComboService } from '../producto/producto-combo.service';

@ApiTags('Inventarios - Stock por Sede')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('producto-stock')
export class ProductoStockController {
  constructor(
    private readonly stockService: ProductoStockService,
    private readonly comboService: ProductoComboService,
  ) {}

  @Get('reportes/mermas')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Resumen de mermas y perdidas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getResumenMermas(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.stockService.getResumenMermas(empresaId, sedeId, fechaDesde, fechaHasta);
  }

  @Get('reportes/valorizacion')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Valorizacion del inventario' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getValorizacionInventario(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.stockService.getValorizacionInventario(empresaId, sedeId);
  }

  @Get('reportes/sugerencias-reorden')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Sugerencias de reorden (productos bajo stock minimo)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getSugerenciasReorden(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.stockService.getSugerenciasReorden(empresaId, sedeId);
  }

  @Get('reportes/rotacion')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Reporte de rotacion de productos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getReporteRotacion(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('dias') dias?: string,
  ) {
    return this.stockService.getReporteRotacion(empresaId, sedeId, dias ? parseInt(dias) : 90);
  }

  // =====================================================
  // MONITOR DE PRODUCTOS
  // =====================================================

  @Get('monitor')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Monitor de estado de productos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getMonitor(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.stockService.getMonitorProductos(empresaId, sedeId);
  }

  @Get('marketplace-productos')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Listar productos con estado marketplace' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getProductosMarketplaceEstado(
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.stockService.getProductosMarketplaceEstado(empresaId);
  }

  @Patch('bulk/marketplace')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Bulk activar/desactivar marketplace' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async bulkMarketplace(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: { productoIds: string[]; visible: boolean },
  ) {
    return this.stockService.bulkMarketplace(empresaId, dto.productoIds, dto.visible);
  }

  @Patch('bulk/ubicacion')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Bulk asignar ubicacion' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async bulkUbicacion(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: { productoStockIds: string[]; ubicacion: string },
  ) {
    return this.stockService.bulkUbicacion(empresaId, dto.productoStockIds, dto.ubicacion);
  }

  @Patch('bulk/precio-igv')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Bulk marcar precio incluye IGV' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async bulkPrecioIgv(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: { productoStockIds: string[]; precioIncluyeIgv: boolean },
  ) {
    return this.stockService.bulkPrecioIgv(empresaId, dto.productoStockIds, dto.precioIncluyeIgv);
  }

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

  @Get('variante/:varianteId/sede/:sedeId')
  @ApiOperation({
    summary: 'Obtener stock de variante en sede',
    description: 'Consulta el stock actual de una variante específica en una sede',
  })
  async getStockVarianteEnSede(
    @Param('varianteId') varianteId: string,
    @Param('sedeId') sedeId: string,
  ) {
    return await this.stockService.getStockPorSede(sedeId, undefined, varianteId);
  }

  @Get('sede/:sedeId/ubicaciones')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener ubicaciones de una sede' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getUbicaciones(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
  ) {
    return this.stockService.getUbicaciones(empresaId, sedeId);
  }

  @Patch('sede/:sedeId/stock-minmax-bulk')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar stock minimo/maximo en bulk' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizarStockMinMaxBulk(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Body() body: { items: Array<{ productoStockId: string; stockMinimo?: number; stockMaximo?: number }> },
  ) {
    return this.stockService.actualizarStockMinMaxBulk(empresaId, sedeId, body.items);
  }

  @Get('sede/:sedeId/por-ubicacion')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Stock filtrado por ubicacion' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getStockPorUbicacion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Query('ubicacion') ubicacion: string,
  ) {
    return this.stockService.getStockPorUbicacion(empresaId, sedeId, ubicacion);
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

  @Get(':id/movimientos/export')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Exportar Kardex a Excel' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportKardex(
    @Param('id') id: string,
    @Query('tipo') tipo?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Res() res?: Response,
  ) {
    return this.stockService.exportKardex(id, { tipo, fechaDesde, fechaHasta }, res);
  }

  @Get(':id/movimientos')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Kardex: historial de movimientos de stock' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getHistorialMovimientos(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('tipo') tipo?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.stockService.getHistorialMovimientos(id, {
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      tipo,
      fechaDesde,
      fechaHasta,
    });
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
    const [valido, stockDisponible] = await Promise.all([
      this.comboService.validarStockCombo(body.comboId, body.sedeId, body.cantidad),
      this.comboService.getStockDisponibleCombo(body.comboId, body.sedeId),
    ]);

    return {
      valido,
      stockDisponible,
      faltantes: [],
    };
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
    await this.comboService.descontarStockCombo(
      body.comboId,
      body.sedeId,
      user.sub,
      body.cantidad,
    );

    return { success: true, message: 'Stock descontado exitosamente' };
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

  // =====================================================
  // HISTORIAL DE PRECIOS GLOBAL
  // =====================================================

  // =====================================================
  // LIQUIDACIÓN (remate por debajo de costo)
  // =====================================================

  @Patch(':id/liquidacion/activar')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Activar liquidación sobre un ProductoStock',
    description:
      'Marca el producto como EN LIQUIDACIÓN con un precio menor al costo y motivo justificado. ' +
      'Requiere autorización gerencial (DNI+password via /auth/autorizar-operacion); el frontend pasa el autorizadoPorId resultante.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async activarLiquidacion(
    @Param('id') productoStockId: string,
    @Body() dto: ActivarLiquidacionDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.stockService.activarLiquidacion(productoStockId, empresaId, dto, user.sub);
  }

  @Patch(':id/liquidacion/desactivar')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Desactivar la liquidación de un ProductoStock' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async desactivarLiquidacion(
    @Param('id') productoStockId: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body?: { razon?: string },
  ) {
    return this.stockService.desactivarLiquidacion(productoStockId, empresaId, user.sub, body?.razon);
  }

  @Get('liquidaciones')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Listar productos en liquidación activa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listarLiquidaciones(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.stockService.listarLiquidacionesActivas(
      empresaId,
      sedeId,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  // =====================================================
  // VERIFICACIÓN / AUDITORÍA DE PRECIOS
  // =====================================================

  @Get('verificacion-precios')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Lista productos filtrados por valor de precio para auditoría',
    description:
      'Pensado para localizar productos con precios mal cargados. Filtros: ' +
      'sede, campo (PRECIO/COSTO/OFERTA/LIQUIDACION), modo (RANGO/EXACTO/SIN_VALOR), ' +
      'categoría, marca, stock, activo. Response plano.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async verificarPrecios(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VerificarPreciosDto,
  ) {
    return this.stockService.verificarPrecios(empresaId, query);
  }

  @Get('verificacion-precios/export')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Exporta verificación de precios a Excel' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportVerificacionPrecios(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: VerificarPreciosDto,
    @Res() res: Response,
  ) {
    await this.stockService.exportVerificacionPrecios(empresaId, query, res);
  }

  @Get('historial-precios')
  @ApiOperation({
    summary: 'Historial global de cambios de precios',
    description:
      'Lista el historial de cambios de precios de todos los productos con filtros por sede, producto, fecha y tipo de cambio.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getHistorialPreciosGlobal(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryHistorialPreciosDto,
  ) {
    return await this.stockService.getHistorialPreciosGlobal(empresaId, query);
  }

  @Get('historial-precios/export')
  @ApiOperation({
    summary: 'Exportar historial de precios a Excel',
    description: 'Exporta el historial de cambios de precios filtrado a un archivo Excel.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async exportHistorialPrecios(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryHistorialPreciosDto,
    @Res() res: Response,
  ) {
    if (!query.fechaInicio || !query.fechaFin) {
      throw new BadRequestException('fechaInicio y fechaFin son requeridos para exportar');
    }
    const inicio = new Date(query.fechaInicio);
    const fin = new Date(query.fechaFin);
    const maxFin = new Date(inicio);
    maxFin.setMonth(maxFin.getMonth() + 3);
    if (fin > maxFin) {
      throw new BadRequestException('El rango maximo de exportacion es de 3 meses');
    }
    await this.stockService.exportHistorialPrecios(empresaId, query, res);
  }
}
