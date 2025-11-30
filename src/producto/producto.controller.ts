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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { ProductoService } from './producto.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateProductoDto } from './dto/create-producto.dto';
import { UpdateProductoDto } from './dto/update-producto.dto';
import { QueryProductoDto } from './dto/query-producto.dto';
import {
  ProductoResponseDto,
  PaginatedProductoResponseDto,
} from './dto/producto-response.dto';

@ApiTags('Productos')
@Controller('productos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductoController {
  constructor(private readonly productoService: ProductoService) {}

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

  @Get()
  @ApiOperation({ summary: 'Obtener lista de productos con filtros' })
  @ApiResponse({
    status: 200,
    description: 'Lista de productos obtenida exitosamente',
    type: PaginatedProductoResponseDto,
  })
  @ApiQuery({ name: 'empresaId', required: true, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiQuery({ name: 'categoriaId', required: false, type: String })
  @ApiQuery({ name: 'marcaId', required: false, type: String })
  @ApiQuery({ name: 'sedeId', required: false, type: String })
  @ApiQuery({ name: 'visibleMarketplace', required: false, type: Boolean })
  @ApiQuery({ name: 'destacado', required: false, type: Boolean })
  @ApiQuery({ name: 'enOferta', required: false, type: Boolean })
  @ApiQuery({ name: 'stockBajo', required: false, type: Boolean })
  async findAll(
    @Query('empresaId') empresaId: string,
    @Query() queryDto: QueryProductoDto,
  ): Promise<PaginatedProductoResponseDto> {
    return await this.productoService.findAll(empresaId, queryDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un producto por ID' })
  @ApiResponse({
    status: 200,
    description: 'Producto obtenido exitosamente',
    type: ProductoResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  async findOne(
    @Param('id') id: string,
    @Query('empresaId') empresaId: string,
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
  async update(
    @Param('id') id: string,
    @Query('empresaId') empresaId: string,
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
  async remove(
    @Param('id') id: string,
    @Query('empresaId') empresaId: string,
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
  async updateStock(
    @Param('id') id: string,
    @Query('empresaId') empresaId: string,
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
}
