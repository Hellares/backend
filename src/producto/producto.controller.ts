import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Patch,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { ProductoService } from './producto.service';
import { ProductoVarianteService } from './producto-variante.service';
import { ProductoAtributoService } from './producto-atributo.service';
import { ProductoAtributoValorService } from './producto-atributo-valor.service';
import { PrecioNivelService } from './precio-nivel.service';
import { ProductoPrecioHistorialService } from './producto-precio-historial.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission, Permission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { QueryProductoDto } from './dto/query-producto.dto';
import {
  ProductoResponseDto,
  PaginatedProductoResponseDto,
} from './dto/producto-response.dto';
import { CreateProductoVarianteDto } from './dto/create-producto-variante.dto';
import { UpdateProductoVarianteDto } from './dto/update-producto-variante.dto';
import { ProductoVarianteResponseDto } from './dto/producto-variante-response.dto';
import { CreateProductoAtributoDto } from './dto/create-producto-atributo.dto';
import { SetProductoAtributosDto } from './dto/create-producto-atributo-valor.dto';
import { CreatePrecioNivelDto } from './dto/create-precio-nivel.dto';
import { UpdatePrecioNivelDto } from './dto/update-precio-nivel.dto';
import { PrecioNivelResponseDto } from './dto/precio-nivel-response.dto';
import {
  AjusteMasivoPreciosDto,
  AjusteMasivoPreciosResponseDto,
} from './dto/ajuste-masivo-precios.dto';

@ApiTags('Productos')
@Controller('productos')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ProductoController {
  constructor(
    private readonly productoService: ProductoService,
    private readonly varianteService: ProductoVarianteService,
    private readonly atributoService: ProductoAtributoService,
    private readonly atributoValorService: ProductoAtributoValorService,
    private readonly precioNivelService: PrecioNivelService,
    private readonly precioHistorialService: ProductoPrecioHistorialService,
  ) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Crear un nuevo producto' })
  @ApiResponse({
    status: 201,
    description: 'Producto creado exitosamente',
    type: ProductoResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async create(
    @Body() createProductoDto: CreateProductoDto,
    @CurrentUser() user: any,
  ): Promise<ProductoResponseDto> {
    return await this.productoService.create(createProductoDto, user.sub);
  }

  // @Get()
  // @ApiOperation({ summary: 'Obtener lista de productos con filtros' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Lista de productos obtenida exitosamente',
  //   type: PaginatedProductoResponseDto,
  // })
  // @ApiQuery({ name: 'empresaId', required: true, type: String })
  // @ApiQuery({ name: 'page', required: false, type: Number })
  // @ApiQuery({ name: 'limit', required: false, type: Number })
  // @ApiQuery({ name: 'search', required: false, type: String })
  // @ApiQuery({ name: 'empresaCategoriaId', required: false, type: String })
  // @ApiQuery({ name: 'empresaMarcaId', required: false, type: String })
  // @ApiQuery({ name: 'sedeId', required: false, type: String })
  // @ApiQuery({ name: 'visibleMarketplace', required: false, type: Boolean })
  // @ApiQuery({ name: 'destacado', required: false, type: Boolean })
  // @ApiQuery({ name: 'enOferta', required: false, type: Boolean })
  // @ApiQuery({ name: 'stockBajo', required: false, type: Boolean })
  // async findAll(
  //   @Query('empresaId') empresaId: string,
  //   @Query() queryDto: QueryProductoDto,
  // ): Promise<PaginatedProductoResponseDto> {
  //   return await this.productoService.findAll(empresaId, queryDto);
  // }

  @Get()
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener lista de productos con filtros' })
  @ApiResponse({
    status: 200,
    description: 'Lista de productos obtenida exitosamente',
    type: PaginatedProductoResponseDto,
  })
  @ApiHeader({  // ✅ Documentación del header
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'empresaCategoriaId', required: false, type: String })
  @ApiQuery({ name: 'empresaMarcaId', required: false, type: String })
  @ApiQuery({ name: 'sedeId', required: false, type: String })
  @ApiQuery({ name: 'visibleMarketplace', required: false, type: Boolean })
  @ApiQuery({ name: 'destacado', required: false, type: Boolean })
  @ApiQuery({ name: 'enOferta', required: false, type: Boolean })
  @ApiQuery({ name: 'stockBajo', required: false, type: Boolean })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,  // ✅ Del header
    @Query() queryDto: QueryProductoDto,        // ✅ Sin empresaId
  ): Promise<PaginatedProductoResponseDto> {
    return await this.productoService.findAll(empresaId, queryDto);
  }

  // =========================================
  // ENDPOINTS DE ATRIBUTOS (ANTES DE :id)
  // =========================================

  @Post('atributos')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Crear un atributo de producto' })
  @ApiResponse({
    status: 201,
    description: 'Atributo creado exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async createAtributo(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateProductoAtributoDto,
  ) {
    return await this.atributoService.create(empresaId, dto);
  }

  @Get('atributos')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener todos los atributos de la empresa' })
  @ApiResponse({
    status: 200,
    description: 'Lista de atributos obtenida exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async findAllAtributos(@Headers('x-tenant-id') empresaId: string) {
    return await this.atributoService.findAll(empresaId);
  }

  @Get('atributos/:atributoId')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener un atributo por ID' })
  @ApiResponse({
    status: 200,
    description: 'Atributo obtenido exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async findOneAtributo(
    @Param('atributoId') atributoId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return await this.atributoService.findOne(atributoId, empresaId);
  }

  @Put('atributos/:atributoId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar un atributo' })
  @ApiResponse({
    status: 200,
    description: 'Atributo actualizado exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async updateAtributo(
    @Param('atributoId') atributoId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: Partial<CreateProductoAtributoDto>,
  ) {
    return await this.atributoService.update(atributoId, empresaId, dto);
  }

  @Delete('atributos/:atributoId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Eliminar un atributo' })
  @ApiResponse({
    status: 200,
    description: 'Atributo eliminado exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async removeAtributo(
    @Param('atributoId') atributoId: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<void> {
    return await this.atributoService.remove(atributoId, empresaId);
  }

  // =========================================
  // ENDPOINTS ESTÁTICOS DE COMBOS (ANTES DE :id)
  // =========================================

  @Get('disponibles-para-combo')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Obtener productos disponibles para usar como componentes de combo',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de productos disponibles para combo',
    type: PaginatedProductoResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async getProductosDisponiblesParaCombo(
    @Headers('x-tenant-id') empresaId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ): Promise<PaginatedProductoResponseDto> {
    return await this.productoService.getProductosDisponiblesParaCombo(
      empresaId,
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
      search,
    );
  }

  @Post('ajuste-masivo-precios')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Ajuste masivo de precios por porcentaje',
    description: `
      Permite incrementar o decrementar precios de múltiples productos de forma masiva.

      **Características:**
      - Ajuste por porcentaje (1-100%)
      - Aplicar a TODOS los productos o productos SELECCIONADOS
      - Incluye variantes opcionalmente
      - Redondeo a 2 decimales
      - Modo PREVIEW para ver cambios antes de aplicar
      - Registra todos los cambios en historial de precios

      **Casos de uso:**
      - Ajustes por inflación
      - Cambios de temporada
      - Actualizaciones de costos de proveedores
    `,
  })
  @ApiResponse({
    status: 200,
    description: 'Ajuste masivo aplicado exitosamente o preview generado',
    schema: {
      type: 'object',
      properties: {
        resumen: {
          type: 'object',
          properties: {
            totalProductosAfectados: { type: 'number' },
            totalVariantesAfectadas: { type: 'number' },
            ajustePromedio: { type: 'number' },
            operacion: { type: 'string' },
            valorAjuste: { type: 'number' },
          },
        },
        cambios: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              productoId: { type: 'string' },
              nombre: { type: 'string' },
              precioAnterior: { type: 'number' },
              precioNuevo: { type: 'number' },
              diferencia: { type: 'number' },
              diferenciaPercentual: { type: 'number' },
              varianteId: { type: 'string', nullable: true },
              varianteNombre: { type: 'string', nullable: true },
            },
          },
        },
        advertencias: {
          type: 'array',
          items: { type: 'string' },
          nullable: true,
        },
        esPreview: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos o no hay productos para ajustar' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async ajusteMasivoPrecios(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
    @Body() dto: AjusteMasivoPreciosDto,
  ): Promise<AjusteMasivoPreciosResponseDto> {
    return await this.productoService.ajusteMasivoPrecios(
      empresaId,
      user.sub,
      dto,
    );
  }

  // =========================================
  // ENDPOINTS DINÁMICOS CON :id
  // =========================================

  @Get(':id')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener un producto por ID' })
  @ApiResponse({
    status: 200,
    description: 'Producto obtenido exitosamente',
    type: ProductoResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async findOne(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<ProductoResponseDto> {
    return await this.productoService.findOne(id, empresaId);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar un producto' })
  @ApiResponse({
    status: 200,
    description: 'Producto actualizado exitosamente',
    type: ProductoResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() updateProductoDto: UpdateProductoDto,
    @CurrentUser() user: any,
  ): Promise<ProductoResponseDto> {
    return await this.productoService.update(
      id,
      empresaId,
      updateProductoDto,
      user.sub,
    );
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Eliminar un producto (soft delete)' })
  @ApiResponse({
    status: 200,
    description: 'Producto eliminado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
  ): Promise<{ success: boolean }> {
    return await this.productoService.remove(id, empresaId, user.sub);
  }

  @Patch(':id/stock')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Actualizar stock de un producto (MIGRADO a ProductoStock)',
    description:
      'Actualiza el stock de un producto en una sede específica. ' +
      'IMPORTANTE: Ahora requiere sedeId. Usa ProductoStock en lugar del sistema legacy.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stock actualizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        stock: {
          type: 'number',
          description: 'Stock actualizado en la sede especificada',
        },
        stockTotal: {
          type: 'number',
          description: 'Stock total del producto en todas las sedes',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Stock insuficiente o producto no tiene stock en sede' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async updateStock(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      sedeId: string;
      cantidad: number;
      operacion: 'agregar' | 'quitar';
    },
  ): Promise<{ stock: number; stockTotal: number }> {
    return await this.productoService.updateStock(
      id,
      empresaId,
      body.sedeId,
      body.cantidad,
      body.operacion,
      user.sub,
    );
  }

  @Get(':id/stock-total')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener stock total de un producto (incluyendo variantes)' })
  @ApiResponse({
    status: 200,
    description: 'Stock total obtenido exitosamente',
    schema: {
      type: 'object',
      properties: {
        stockTotal: {
          type: 'number',
          description: 'Stock total del producto. Si tiene variantes, es la suma de todas las variantes activas. Si no tiene variantes, es el stock del producto base.',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async getStockTotal(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<{ stockTotal: number }> {
    const stockTotal = await this.productoService.getStockTotal(id, empresaId);
    return { stockTotal };
  }

  @Get(':id/historial-precios')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Obtener el historial de cambios de precio de un producto',
    description: 'Retorna todos los cambios de precio registrados para auditoría y trazabilidad'
  })
  @ApiResponse({
    status: 200,
    description: 'Historial de precios obtenido exitosamente',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          productoId: { type: 'string', nullable: true },
          varianteId: { type: 'string', nullable: true },
          precioAnterior: { type: 'number', nullable: true },
          precioNuevo: { type: 'number' },
          precioCostoAnterior: { type: 'number', nullable: true },
          precioCostoNuevo: { type: 'number', nullable: true },
          tipoCambio: {
            type: 'string',
            enum: ['MANUAL', 'OFERTA_ACTIVADA', 'OFERTA_DESACTIVADA', 'COSTO_ACTUALIZADO', 'AJUSTE_MASIVO', 'CORRECCION']
          },
          razon: { type: 'string', nullable: true },
          origenModulo: { type: 'string', nullable: true },
          creadoEn: { type: 'string', format: 'date-time' },
          usuario: {
            type: 'object',
            properties: {
              persona: {
                type: 'object',
                properties: {
                  nombre: { type: 'string' },
                  apellido: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiQuery({
    name: 'varianteId',
    description: 'ID de la variante (opcional). Si se proporciona, obtiene el historial de la variante específica.',
    required: false,
    type: String,
  })
  async getHistorialPrecios(
    @Param('id') productoId: string,
    @Query('varianteId') varianteId?: string,
  ) {
    return await this.precioHistorialService.getHistorial(productoId, varianteId);
  }

  @Get(':id/historial-precios/estadisticas')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Obtener estadísticas del historial de precios',
    description: 'Retorna métricas agregadas sobre los cambios de precio: precio inicial, actual, variación, promedios, etc.'
  })
  @ApiResponse({
    status: 200,
    description: 'Estadísticas obtenidas exitosamente',
    schema: {
      type: 'object',
      properties: {
        totalCambios: { type: 'number' },
        precioInicial: { type: 'number', nullable: true },
        precioActual: { type: 'number', nullable: true },
        variacionPorcentaje: { type: 'number', nullable: true },
        promedioPrecios: { type: 'number', nullable: true },
        precioMinimo: { type: 'number', nullable: true },
        precioMaximo: { type: 'number', nullable: true },
        cambiosPorTipo: {
          type: 'object',
          description: 'Cantidad de cambios por cada tipo',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiQuery({
    name: 'varianteId',
    description: 'ID de la variante (opcional). Si se proporciona, obtiene estadísticas de la variante específica.',
    required: false,
    type: String,
  })
  async getEstadisticasPrecios(
    @Param('id') productoId: string,
    @Query('varianteId') varianteId?: string,
  ) {
    return await this.precioHistorialService.getEstadisticas(productoId, varianteId);
  }

  // =========================================
  // ENDPOINTS DE COMBOS
  // =========================================

  // =========================================
  // ENDPOINT DEPRECADO - NO USAR
  // =========================================
  /**
   * @deprecated Este endpoint está deprecado.
   * En su lugar, crea combos directamente usando POST /api/combos
   *
   * Razón: Convertir productos existentes a combos causa pérdida de stock/precio.
   * Es mejor crear combos específicos desde el inicio.
   */
  // @Patch(':id/convertir-a-combo')
  // @ApiOperation({
  //   summary: 'DEPRECADO - Convertir un producto existente en combo',
  //   deprecated: true,
  // })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Producto convertido a combo exitosamente',
  //   type: ProductoResponseDto,
  // })
  // @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  // @ApiResponse({ status: 400, description: 'El producto ya es un combo' })
  // @ApiHeader({
  //   name: 'x-tenant-id',
  //   description: 'ID de la empresa (tenant)',
  //   required: true,
  // })
  // async convertirACombo(
  //   @Param('id') id: string,
  //   @Headers('x-tenant-id') empresaId: string,
  //   @Body()
  //   body: {
  //     tipoPrecioCombo: 'FIJO' | 'CALCULADO' | 'CALCULADO_CON_DESCUENTO';
  //     descuentoPorcentaje?: number;
  //   },
  // ): Promise<ProductoResponseDto> {
  //   return await this.productoService.convertirACombo(
  //     id,
  //     empresaId,
  //     body.tipoPrecioCombo,
  //     body.descuentoPorcentaje,
  //   );
  // }

  // =========================================
  // ENDPOINTS DE VARIANTES
  // =========================================

  @Post(':productoId/variantes')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Crear una variante para un producto' })
  @ApiResponse({
    status: 201,
    description: 'Variante creada exitosamente',
    type: ProductoVarianteResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async createVariante(
    @Param('productoId') productoId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateProductoVarianteDto,
  ): Promise<ProductoVarianteResponseDto> {
    return await this.varianteService.create(productoId, empresaId, dto);
  }

  @Get(':productoId/variantes')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener todas las variantes de un producto' })
  @ApiResponse({
    status: 200,
    description: 'Lista de variantes obtenida exitosamente',
    type: [ProductoVarianteResponseDto],
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async findVariantes(
    @Param('productoId') productoId: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<ProductoVarianteResponseDto[]> {
    return await this.varianteService.findByProducto(productoId, empresaId);
  }

  @Get('variantes/:varianteId')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener una variante por ID' })
  @ApiResponse({
    status: 200,
    description: 'Variante obtenida exitosamente',
    type: ProductoVarianteResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async findOneVariante(
    @Param('varianteId') varianteId: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<ProductoVarianteResponseDto> {
    return await this.varianteService.findOne(varianteId, empresaId);
  }

  @Put('variantes/:varianteId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar una variante' })
  @ApiResponse({
    status: 200,
    description: 'Variante actualizada exitosamente',
    type: ProductoVarianteResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async updateVariante(
    @Param('varianteId') varianteId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: UpdateProductoVarianteDto,
  ): Promise<ProductoVarianteResponseDto> {
    return await this.varianteService.update(varianteId, empresaId, dto);
  }

  @Delete('variantes/:varianteId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Eliminar una variante' })
  @ApiResponse({
    status: 200,
    description: 'Variante eliminada exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async removeVariante(
    @Param('varianteId') varianteId: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<void> {
    return await this.varianteService.remove(varianteId, empresaId);
  }

  @Patch('variantes/:varianteId/stock')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar stock de una variante' })
  @ApiResponse({
    status: 200,
    description: 'Stock de variante actualizado exitosamente',
    type: ProductoVarianteResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async updateVarianteStock(
    @Param('varianteId') varianteId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() body: { cantidad: number },
  ): Promise<ProductoVarianteResponseDto> {
    return await this.varianteService.updateStock(
      varianteId,
      empresaId,
      body.cantidad,
    );
  }

  // =============================================================================
  // ENDPOINTS DE ATRIBUTOS DE PRODUCTOS
  // =============================================================================

  @Post(':id/atributos')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Asignar o actualizar atributos de un producto' })
  @ApiResponse({
    status: 200,
    description: 'Atributos asignados exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async setProductoAtributos(
    @Param('id') productoId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: SetProductoAtributosDto,
  ) {
    return await this.atributoValorService.setProductoAtributos(
      empresaId,
      productoId,
      dto,
    );
  }

  @Get(':id/atributos')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener atributos de un producto' })
  @ApiResponse({
    status: 200,
    description: 'Atributos obtenidos exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async getProductoAtributos(
    @Param('id') productoId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return await this.atributoValorService.getProductoAtributos(
      empresaId,
      productoId,
    );
  }

  @Post('variantes/:varianteId/atributos')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Asignar o actualizar atributos de una variante' })
  @ApiResponse({
    status: 200,
    description: 'Atributos asignados exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async setVarianteAtributos(
    @Param('varianteId') varianteId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: SetProductoAtributosDto,
  ) {
    return await this.atributoValorService.setVarianteAtributos(
      empresaId,
      varianteId,
      dto,
    );
  }

  @Get('variantes/:varianteId/atributos')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener atributos de una variante' })
  @ApiResponse({
    status: 200,
    description: 'Atributos obtenidos exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async getVarianteAtributos(
    @Param('varianteId') varianteId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return await this.atributoValorService.getVarianteAtributos(
      empresaId,
      varianteId,
    );
  }

  // ============================================
  // ENDPOINTS DE PRECIOS POR NIVEL (VOLUMEN)
  // ============================================

  @Post(':id/precios-nivel')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Agregar nivel de precio a un producto' })
  @ApiResponse({
    status: 201,
    description: 'Nivel de precio creado exitosamente',
    type: PrecioNivelResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async agregarPrecioNivel(
    @Param('id') productoId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreatePrecioNivelDto,
  ): Promise<PrecioNivelResponseDto> {
    return await this.precioNivelService.create(
      empresaId,
      productoId,
      undefined,
      dto,
    );
  }

  @Post('variantes/:varianteId/precios-nivel')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Agregar nivel de precio a una variante' })
  @ApiResponse({
    status: 201,
    description: 'Nivel de precio creado exitosamente',
    type: PrecioNivelResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async agregarPrecioNivelVariante(
    @Param('varianteId') varianteId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreatePrecioNivelDto,
  ): Promise<PrecioNivelResponseDto> {
    return await this.precioNivelService.create(
      empresaId,
      undefined,
      varianteId,
      dto,
    );
  }

  @Get(':id/precios-nivel')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener niveles de precio de un producto' })
  @ApiResponse({
    status: 200,
    description: 'Niveles de precio obtenidos exitosamente',
    type: [PrecioNivelResponseDto],
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async obtenerPreciosNivel(
    @Param('id') productoId: string,
  ): Promise<PrecioNivelResponseDto[]> {
    return await this.precioNivelService.findAll(productoId, undefined);
  }

  @Get('variantes/:varianteId/precios-nivel')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener niveles de precio de una variante' })
  @ApiResponse({
    status: 200,
    description: 'Niveles de precio obtenidos exitosamente',
    type: [PrecioNivelResponseDto],
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async obtenerPreciosNivelVariante(
    @Param('varianteId') varianteId: string,
  ): Promise<PrecioNivelResponseDto[]> {
    return await this.precioNivelService.findAll(undefined, varianteId);
  }

  @Get('precios-nivel/:nivelId')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener un nivel de precio por ID' })
  @ApiResponse({
    status: 200,
    description: 'Nivel de precio obtenido exitosamente',
    type: PrecioNivelResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async obtenerPrecioNivel(
    @Param('nivelId') nivelId: string,
  ): Promise<PrecioNivelResponseDto> {
    return await this.precioNivelService.findOne(nivelId);
  }

  @Patch('precios-nivel/:nivelId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar un nivel de precio' })
  @ApiResponse({
    status: 200,
    description: 'Nivel de precio actualizado exitosamente',
    type: PrecioNivelResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async actualizarPrecioNivel(
    @Param('nivelId') nivelId: string,
    @Body() dto: UpdatePrecioNivelDto,
  ): Promise<PrecioNivelResponseDto> {
    return await this.precioNivelService.update(nivelId, dto);
  }

  @Delete('precios-nivel/:nivelId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Eliminar un nivel de precio' })
  @ApiResponse({
    status: 200,
    description: 'Nivel de precio eliminado exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async eliminarPrecioNivel(@Param('nivelId') nivelId: string): Promise<void> {
    return await this.precioNivelService.remove(nivelId);
  }

  @Get(':id/calcular-precio')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Calcular precio según cantidad para un producto' })
  @ApiQuery({
    name: 'cantidad',
    description: 'Cantidad de unidades',
    required: true,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Precio calculado exitosamente',
    schema: {
      type: 'object',
      properties: {
        precioUnitario: { type: 'number', example: 1350.0 },
        nivelAplicado: { type: 'string', example: 'Por Mayor' },
        descuentoAplicado: { type: 'number', example: 10.0 },
        precioBase: { type: 'number', example: 1500.0 },
      },
    },
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async calcularPrecioProducto(
    @Param('id') productoId: string,
    @Query('cantidad') cantidad: string,
  ) {
    return await this.precioNivelService.calcularPrecioSegunCantidad(
      productoId,
      null,
      parseInt(cantidad, 10),
    );
  }

  @Get('variantes/:varianteId/calcular-precio')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Calcular precio según cantidad para una variante',
  })
  @ApiQuery({
    name: 'cantidad',
    description: 'Cantidad de unidades',
    required: true,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: 'Precio calculado exitosamente',
    schema: {
      type: 'object',
      properties: {
        precioUnitario: { type: 'number', example: 1350.0 },
        nivelAplicado: { type: 'string', example: 'Por Mayor' },
        descuentoAplicado: { type: 'number', example: 10.0 },
        precioBase: { type: 'number', example: 1500.0 },
      },
    },
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async calcularPrecioVariante(
    @Param('varianteId') varianteId: string,
    @Query('cantidad') cantidad: string,
  ) {
    return await this.precioNivelService.calcularPrecioSegunCantidad(
      null,
      varianteId,
      parseInt(cantidad, 10),
    );
  }
}
