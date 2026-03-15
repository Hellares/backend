import {
  Controller,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { MarketplaceService } from './marketplace.service';

@ApiTags('Marketplace Público')
@Controller('marketplace')
@Public() // Todos los endpoints son públicos
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  /**
   * Buscar productos en todo el marketplace
   */
  @Get('productos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Buscar productos en todo el marketplace' })
  async searchProductos(
    @Query('search') search?: string,
    @Query('categoriaId') categoriaId?: string,
    @Query('marcaId') marcaId?: string,
    @Query('precioMin') precioMin?: string,
    @Query('precioMax') precioMax?: string,
    @Query('departamento') departamento?: string,
    @Query('orden') orden?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.marketplaceService.searchProductos({
      search,
      categoriaId,
      marcaId,
      precioMin: precioMin ? parseFloat(precioMin) : undefined,
      precioMax: precioMax ? parseFloat(precioMax) : undefined,
      departamento,
      orden,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  /**
   * Detalle de un producto del marketplace
   */
  @Get('productos/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detalle de un producto del marketplace' })
  async getProductoDetalle(@Param('id') id: string) {
    return this.marketplaceService.getProductoDetalle(id);
  }

  /**
   * Categorías disponibles en el marketplace
   */
  @Get('categorias')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Categorías con productos en el marketplace' })
  async getCategorias() {
    return this.marketplaceService.getCategorias();
  }

  /**
   * Obtener todas las empresas del marketplace
   */
  @Get('empresas')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar todas las empresas disponibles en el marketplace',
    description: 'Endpoint público para ver todas las empresas registradas y activas',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'empresa' })
  @ApiResponse({
    status: 200,
    description: 'Lista de empresas con paginación',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              nombre: { type: 'string' },
              subdominio: { type: 'string' },
              logo: { type: 'string', nullable: true },
              descripcion: { type: 'string', nullable: true },
              email: { type: 'string', nullable: true },
              telefono: { type: 'string', nullable: true },
              web: { type: 'string', nullable: true },
              direccion: { type: 'string', nullable: true },
              planSuscripcion: {
                type: 'object',
                properties: {
                  nombre: { type: 'string' },
                },
              },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  async getAllEmpresas(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.marketplaceService.getAllEmpresas(pageNum, limitNum, search);
  }

  /**
   * Obtener detalles de una empresa por subdominio
   */
  @Get('empresas/:subdominio')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener detalles de una empresa específica',
    description: 'Endpoint público para ver los detalles completos de una empresa por su subdominio',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles de la empresa',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nombre: { type: 'string' },
        ruc: { type: 'string', nullable: true },
        subdominio: { type: 'string' },
        logo: { type: 'string', nullable: true },
        descripcion: { type: 'string', nullable: true },
        email: { type: 'string', nullable: true },
        telefono: { type: 'string', nullable: true },
        web: { type: 'string', nullable: true },
        direccion: { type: 'string', nullable: true },
        planSuscripcion: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            nombre: { type: 'string' },
            descripcion: { type: 'string' },
          },
        },
        createdAt: { type: 'string', format: 'date-time' },
        _count: {
          type: 'object',
          properties: {
            productos: { type: 'number' },
            servicios: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async getEmpresaBySubdominio(@Param('subdominio') subdominio: string) {
    return this.marketplaceService.getEmpresaBySubdominio(subdominio);
  }

  /**
   * Obtener productos de una empresa
   */
  @Get('empresas/:subdominio/productos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar productos de una empresa',
    description: 'Endpoint público para ver todos los productos de una empresa específica',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'producto' })
  @ApiResponse({
    status: 200,
    description: 'Lista de productos con paginación',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              nombre: { type: 'string' },
              codigo: { type: 'string' },
              descripcion: { type: 'string', nullable: true },
              precio: { type: 'number' },
              precioVenta: { type: 'number' },
              stock: { type: 'number' },
              imagenes: { type: 'array', items: { type: 'string' }, nullable: true },
              categoria: {
                type: 'object',
                nullable: true,
                properties: {
                  id: { type: 'string' },
                  nombre: { type: 'string' },
                },
              },
              marca: {
                type: 'object',
                nullable: true,
                properties: {
                  id: { type: 'string' },
                  nombre: { type: 'string' },
                },
              },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async getProductosByEmpresa(
    @Param('subdominio') subdominio: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.marketplaceService.getProductosByEmpresa(
      subdominio,
      pageNum,
      limitNum,
      search,
    );
  }

  /**
   * Obtener detalle de un producto específico
   */
  @Get('empresas/:subdominio/productos/:productoId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener detalles de un producto específico',
    description: 'Endpoint público para ver los detalles completos de un producto',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles del producto',
  })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  async getProductoById(
    @Param('subdominio') subdominio: string,
    @Param('productoId') productoId: string,
  ) {
    return this.marketplaceService.getProductoById(subdominio, productoId);
  }

  /**
   * Obtener servicios de una empresa
   */
  @Get('empresas/:subdominio/servicios')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar servicios de una empresa',
    description: 'Endpoint público para ver todos los servicios de una empresa específica',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiQuery({ name: 'search', required: false, type: String, example: 'servicio' })
  @ApiResponse({
    status: 200,
    description: 'Lista de servicios con paginación',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              nombre: { type: 'string' },
              codigoEmpresa: { type: 'string' },
              descripcion: { type: 'string', nullable: true },
              precio: { type: 'number' },
              duracionEstimada: { type: 'number', nullable: true },
              imagenes: { type: 'array', items: { type: 'string' }, nullable: true },
              categoria: {
                type: 'object',
                nullable: true,
                properties: {
                  id: { type: 'string' },
                  nombre: { type: 'string' },
                },
              },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async getServiciosByEmpresa(
    @Param('subdominio') subdominio: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.marketplaceService.getServiciosByEmpresa(
      subdominio,
      pageNum,
      limitNum,
      search,
    );
  }

  /**
   * Obtener detalle de un servicio específico
   */
  @Get('empresas/:subdominio/servicios/:servicioId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Obtener detalles de un servicio específico',
    description: 'Endpoint público para ver los detalles completos de un servicio',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles del servicio',
  })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  async getServicioById(
    @Param('subdominio') subdominio: string,
    @Param('servicioId') servicioId: string,
  ) {
    return this.marketplaceService.getServicioById(subdominio, servicioId);
  }
}
