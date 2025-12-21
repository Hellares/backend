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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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

@ApiTags('Productos')
@Controller('productos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductoController {
  constructor(
    private readonly productoService: ProductoService,
    private readonly varianteService: ProductoVarianteService,
    private readonly atributoService: ProductoAtributoService,
    private readonly atributoValorService: ProductoAtributoValorService,
  ) {}

  @Post()
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

  // =========================================
  // ENDPOINTS DINÁMICOS CON :id
  // =========================================

  @Get(':id')
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
  @ApiOperation({ summary: 'Actualizar stock de un producto' })
  @ApiResponse({
    status: 200,
    description: 'Stock actualizado exitosamente',
    type: ProductoResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Stock insuficiente' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async updateStock(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body()
    body: {
      cantidad: number;
      operacion: 'agregar' | 'quitar';
    },
  ): Promise<ProductoResponseDto> {
    return await this.productoService.updateStock(
      id,
      empresaId,
      body.cantidad,
      body.operacion,
    );
  }

  @Get(':id/stock-total')
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
}
