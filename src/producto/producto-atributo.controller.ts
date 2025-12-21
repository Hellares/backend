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
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProductoAtributoService, ProductoAtributoResponse } from './producto-atributo.service';
import { CreateProductoAtributoDto } from './dto/create-producto-atributo.dto';

@ApiTags('Producto Atributos')
@Controller('producto-atributos')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProductoAtributoController {
  constructor(private readonly atributoService: ProductoAtributoService) {}

  /**
   * Crear un nuevo atributo de producto
   * POST /producto-atributos
   */
  @Post()
  @ApiOperation({ summary: 'Crear atributo de producto' })
  @ApiResponse({ status: 201, description: 'Atributo creado exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateProductoAtributoDto,
  ): Promise<ProductoAtributoResponse> {
    return this.atributoService.create(empresaId, dto);
  }

  /**
   * Obtener todos los atributos de la empresa
   * GET /producto-atributos
   */
  @Get()
  @ApiOperation({ summary: 'Listar atributos de producto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<ProductoAtributoResponse[]> {
    return this.atributoService.findAll(empresaId, includeInactive === 'true');
  }

  /**
   * Obtener atributos por categoría
   * GET /producto-atributos/categoria/:categoriaId
   */
  @Get('categoria/:categoriaId')
  @ApiOperation({ summary: 'Listar atributos por categoría' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findByCategoria(
    @Headers('x-tenant-id') empresaId: string,
    @Param('categoriaId') categoriaId: string,
  ): Promise<ProductoAtributoResponse[]> {
    return this.atributoService.findByCategoria(empresaId, categoriaId);
  }

  /**
   * Obtener un atributo por ID
   * GET /producto-atributos/:id
   */
  @Get(':id')
  @ApiOperation({ summary: 'Obtener atributo por ID' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ): Promise<ProductoAtributoResponse> {
    return this.atributoService.findOne(id, empresaId);
  }

  /**
   * Actualizar un atributo
   * PUT /producto-atributos/:id
   */
  @Put(':id')
  @ApiOperation({ summary: 'Actualizar atributo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: Partial<CreateProductoAtributoDto>,
  ): Promise<ProductoAtributoResponse> {
    return this.atributoService.update(id, empresaId, dto);
  }

  /**
   * Eliminar un atributo
   * DELETE /producto-atributos/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar atributo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    await this.atributoService.remove(id, empresaId);
    return { message: 'Atributo eliminado exitosamente' };
  }
}
