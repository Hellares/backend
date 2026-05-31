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
  BadRequestException,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
  ApiHeader,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ProductoService } from './producto.service';
import { ProductoVarianteService } from './producto-variante.service';
import { ProductoAtributoService } from './producto-atributo.service';
import { ProductoAtributoValorService } from './producto-atributo-valor.service';
import { PrecioNivelService } from './precio-nivel.service';
import { ProductoPrecioHistorialService } from './producto-precio-historial.service';
import { ProductoBulkUploadService } from './producto-bulk-upload.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission, Permission } from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { UpdateImagenesProductoDto } from './dto/update-imagenes-producto.dto';
import {
  SyncDeltasQueryDto,
  SyncDeltasResponseDto,
} from './dto/sync-deltas.dto';
import { QueryProductoDto } from './dto/query-producto.dto';
import {
  ProductoResponseDto,
  PaginatedProductoResponseDto,
} from './dto/producto-response.dto';
import { CreateProductoVarianteDto } from './dto/create-producto-variante.dto';
import { UpdateProductoVarianteDto } from './dto/update-producto-variante.dto';
import { ProductoVarianteResponseDto } from './dto/producto-variante-response.dto';
import { GenerateVarianteCombinationsDto } from './dto/generate-variante-combinations.dto';
import { CreateProductoAtributoDto } from './dto/create-producto-atributo.dto';
import { SetProductoAtributosDto } from './dto/create-producto-atributo-valor.dto';
import { CreatePrecioNivelDto } from './dto/create-precio-nivel.dto';
import { UpdatePrecioNivelDto } from './dto/update-precio-nivel.dto';
import { PrecioNivelResponseDto } from './dto/precio-nivel-response.dto';
import { ProductoTrazabilidadService } from './producto-trazabilidad.service';
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
    private readonly bulkUploadService: ProductoBulkUploadService,
    private readonly trazabilidadService: ProductoTrazabilidadService,
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
  @ApiQuery({ name: 'mostrarTodos', required: false, type: Boolean, description: 'Mostrar todos los productos incluso sin stock en la sede seleccionada' })
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
  // ENDPOINTS DE ATRIBUTOS - ELIMINADOS (DUPLICADOS)
  // Usar /producto-atributos (ProductoAtributoController) en su lugar
  // Flutter ya usa /producto-atributos exclusivamente
  // =========================================

  // @Post('atributos')
  // @RequiresPermission(Permission.MANAGE_PRODUCTS)
  // @ApiOperation({ summary: 'Crear un atributo de producto' })
  // @ApiResponse({
  //   status: 201,
  //   description: 'Atributo creado exitosamente',
  // })
  // @ApiHeader({
  //   name: 'x-tenant-id',
  //   description: 'ID de la empresa (tenant)',
  //   required: true,
  // })
  // async createAtributo(
  //   @Headers('x-tenant-id') empresaId: string,
  //   @Body() dto: CreateProductoAtributoDto,
  // ) {
  //   return await this.atributoService.create(empresaId, dto);
  // }

  // @Get('atributos')
  // @RequiresPermission(Permission.VIEW_PRODUCTS)
  // @ApiOperation({ summary: 'Obtener todos los atributos de la empresa' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Lista de atributos obtenida exitosamente',
  // })
  // @ApiHeader({
  //   name: 'x-tenant-id',
  //   description: 'ID de la empresa (tenant)',
  //   required: true,
  // })
  // async findAllAtributos(@Headers('x-tenant-id') empresaId: string) {
  //   return await this.atributoService.findAll(empresaId);
  // }

  // @Get('atributos/:atributoId')
  // @RequiresPermission(Permission.VIEW_PRODUCTS)
  // @ApiOperation({ summary: 'Obtener un atributo por ID' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Atributo obtenido exitosamente',
  // })
  // @ApiHeader({
  //   name: 'x-tenant-id',
  //   description: 'ID de la empresa (tenant)',
  //   required: true,
  // })
  // async findOneAtributo(
  //   @Param('atributoId') atributoId: string,
  //   @Headers('x-tenant-id') empresaId: string,
  // ) {
  //   return await this.atributoService.findOne(atributoId, empresaId);
  // }

  // @Put('atributos/:atributoId')
  // @RequiresPermission(Permission.MANAGE_PRODUCTS)
  // @ApiOperation({ summary: 'Actualizar un atributo' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Atributo actualizado exitosamente',
  // })
  // @ApiHeader({
  //   name: 'x-tenant-id',
  //   description: 'ID de la empresa (tenant)',
  //   required: true,
  // })
  // async updateAtributo(
  //   @Param('atributoId') atributoId: string,
  //   @Headers('x-tenant-id') empresaId: string,
  //   @Body() dto: Partial<CreateProductoAtributoDto>,
  // ) {
  //   return await this.atributoService.update(atributoId, empresaId, dto);
  // }

  // @Delete('atributos/:atributoId')
  // @RequiresPermission(Permission.MANAGE_PRODUCTS)
  // @ApiOperation({ summary: 'Eliminar un atributo' })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Atributo eliminado exitosamente',
  // })
  // @ApiHeader({
  //   name: 'x-tenant-id',
  //   description: 'ID de la empresa (tenant)',
  //   required: true,
  // })
  // async removeAtributo(
  //   @Param('atributoId') atributoId: string,
  //   @Headers('x-tenant-id') empresaId: string,
  // ): Promise<void> {
  //   return await this.atributoService.remove(atributoId, empresaId);
  // }

  // =========================================
  // ENDPOINTS DE CARGA MASIVA (ANTES DE :id)
  // =========================================

  @Get('bulk-upload/template')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Descargar plantilla Excel para carga masiva de productos' })
  @ApiResponse({
    status: 200,
    description: 'Plantilla Excel descargada exitosamente',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async downloadBulkUploadTemplate(
    @Headers('x-tenant-id') empresaId: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.bulkUploadService.generateTemplate(empresaId);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=plantilla_productos.xlsx',
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  }

  @Post('bulk-upload')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Carga masiva de productos desde archivo Excel' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'Archivo Excel (.xlsx)' },
        sedesIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'IDs de sedes donde crear stock (opcional)',
        },
      },
      required: ['file'],
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Productos creados exitosamente (éxito parcial posible)',
  })
  @ApiResponse({ status: 400, description: 'Archivo inválido o sin datos' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async bulkUpload(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { sedesIds?: string | string[] },
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó un archivo');
    }

    // Validar extensión
    const fileName = file.originalname?.toLowerCase() || '';
    if (!fileName.endsWith('.xlsx')) {
      throw new BadRequestException('Solo se aceptan archivos Excel (.xlsx)');
    }

    // Parsear sedesIds del body (puede venir como string JSON o array)
    let sedesIds: string[] | undefined;
    if (body.sedesIds) {
      if (typeof body.sedesIds === 'string') {
        try {
          sedesIds = JSON.parse(body.sedesIds);
        } catch {
          sedesIds = [body.sedesIds];
        }
      } else if (Array.isArray(body.sedesIds)) {
        sedesIds = body.sedesIds;
      }
    }

    return await this.bulkUploadService.parseAndValidate(
      file.buffer,
      empresaId,
      user.sub,
      sedesIds,
    );
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

  // =========================================
  // ENDPOINTS DE CÓDIGO DE BARRAS (ANTES DE :id)
  // =========================================

  @Get('sin-codigo-barras')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Listar productos sin código de barras' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getProductosSinBarcode(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.productoService.getProductosSinBarcode(empresaId, sedeId);
  }

  @Post('generar-codigos-barras')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Generar códigos de barras para productos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async generarCodigosBarras(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: { productoIds: string[]; formato?: 'INTERNO' | 'EAN13' },
  ) {
    return this.productoService.generarCodigosBarras(empresaId, dto.productoIds, dto.formato);
  }

  /**
   * Sync diferencial — Fase 3 del plan de carga rápida del catálogo.
   *
   * Devuelve solo los cambios desde `lastSync` (productos modificados
   * y eliminados). El cliente aplica los deltas a su cache local en
   * vez de re-descargar todo. Si `lastSync` es vacío/inválido/viejo o
   * hay demasiados cambios, responde `fullSyncRequired: true` y el
   * cliente debe llamar al endpoint estándar `GET /productos`.
   *
   * IMPORTANTE: ubicado antes de `:id` para que NestJS no matchee
   * "sync" como un id.
   */
  @Get('sync')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Sync diferencial del catálogo (deltas desde lastSync)',
  })
  @ApiResponse({
    status: 200,
    description: 'Deltas del catálogo o flag fullSyncRequired',
    type: SyncDeltasResponseDto,
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async syncDeltas(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: SyncDeltasQueryDto,
  ): Promise<SyncDeltasResponseDto> {
    return this.productoService.syncDeltas(empresaId, query);
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

  /**
   * Endpoint reducido para actualizar SOLO las imágenes de un producto.
   * No requiere MANAGE_PRODUCTS — basta con VIEW_PRODUCTS, para que
   * un vendedor/cajero pueda subir fotos desde Venta Rápida sin acceso
   * al resto de campos del producto (precio, costo, etc.).
   */
  @Patch(':id/imagenes')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary:
      'Actualizar SOLO las imágenes de un producto (no toca otros campos)',
  })
  @ApiResponse({ status: 200, description: 'Imágenes actualizadas' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async updateImagenes(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: UpdateImagenesProductoDto,
  ): Promise<{ ok: true }> {
    await this.productoService.updateImagenes(id, empresaId, dto.imagenesIds);
    return { ok: true };
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

  @Patch(':id/restaurar')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Restaurar un producto eliminado (papelera)',
    description:
      'Pone deletedAt=null y reactiva isActive. Falla si el SKU ya fue ' +
      'reasignado a otro producto activo (BadRequest). Usado desde la ' +
      'pantalla de papelera de productos.',
  })
  @ApiResponse({ status: 200, description: 'Producto restaurado' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado en papelera' })
  @ApiResponse({ status: 400, description: 'SKU en colisión con producto activo' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async restore(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
  ): Promise<{ success: boolean }> {
    return await this.productoService.restore(id, empresaId, user.sub);
  }

  @Patch(':id/toggle-active')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Activar/desactivar producto (toggle isActive)',
    description:
      'Invierte el flag isActive del producto. No afecta deletedAt. ' +
      'Producto inactivo NO aparece en POS / Venta Rápida pero sigue ' +
      'visible en listados de gestión. Si el producto está en papelera ' +
      '(deletedAt != null), restaurarlo primero.',
  })
  @ApiResponse({
    status: 200,
    description: 'Producto activado/desactivado. Devuelve isActive resultante.',
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado o en papelera' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async toggleActive(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
  ): Promise<{ success: boolean; isActive: boolean }> {
    return await this.productoService.toggleActive(id, empresaId, user.sub);
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

  @Get(':id/trazabilidad')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Ficha 360 / Trazabilidad de un producto',
    description:
      'Consolida stock por sede, compras, lotes, ventas y fabricación (lotes producidos o, si es insumo, en qué recetas se usa). Pasar varianteId para acotar a una variante.',
  })
  @ApiResponse({ status: 200, description: 'Trazabilidad obtenida' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async trazabilidad(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('varianteId') varianteId?: string,
  ) {
    return this.trazabilidadService.trazabilidad(empresaId, id, { varianteId });
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

  @Post(':productoId/variantes/generar-combinaciones')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Generar variantes automáticamente por combinación de atributos',
    description: 'Genera el producto cartesiano de los valores seleccionados de cada atributo. Máximo 50 combinaciones por operación.',
  })
  @ApiResponse({
    status: 201,
    description: 'Variantes generadas exitosamente',
    type: [ProductoVarianteResponseDto],
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos o más de 50 combinaciones' })
  @ApiResponse({ status: 409, description: 'Ya existe una variante con la misma combinación' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  async generarCombinaciones(
    @Param('productoId') productoId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: GenerateVarianteCombinationsDto,
  ): Promise<ProductoVarianteResponseDto[]> {
    return await this.varianteService.generarCombinaciones(productoId, empresaId, dto);
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
  @ApiQuery({
    name: 'sedeId',
    description: 'ID de la sede para obtener precios',
    required: true,
    type: String,
  })
  async calcularPrecioProducto(
    @Param('id') productoId: string,
    @Query('cantidad') cantidad: string,
    @Query('sedeId') sedeId: string,
  ) {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.precioNivelService.calcularPrecioSegunCantidad(
      productoId,
      null,
      sedeId,
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
  @ApiQuery({
    name: 'sedeId',
    description: 'ID de la sede para obtener precios',
    required: true,
    type: String,
  })
  async calcularPrecioVariante(
    @Param('varianteId') varianteId: string,
    @Query('cantidad') cantidad: string,
    @Query('sedeId') sedeId: string,
  ) {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.precioNivelService.calcularPrecioSegunCantidad(
      null,
      varianteId,
      sedeId,
      parseInt(cantidad, 10),
    );
  }
}
