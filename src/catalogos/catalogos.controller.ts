import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { CatalogosService } from './catalogos.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Catálogos')
@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  // ============================================
  // CATEGORÍAS MAESTRAS (Públicas)
  // ============================================

  @Get('categorias-maestras')
  @Public()
  @ApiOperation({
    summary: 'Obtener catálogo global de categorías',
    description:
      'Retorna todas las categorías maestras disponibles en el sistema',
  })
  @ApiQuery({
    name: 'incluirHijos',
    required: false,
    type: Boolean,
    description: 'Incluir subcategorías',
  })
  @ApiQuery({
    name: 'soloPopulares',
    required: false,
    type: Boolean,
    description: 'Solo categorías populares',
  })
  @ApiResponse({ status: 200, description: 'Catálogo de categorías' })
  async getCategoriasMaestras(
    @Query('incluirHijos') incluirHijos?: boolean,
    @Query('soloPopulares') soloPopulares?: boolean,
  ) {
    return await this.catalogosService.getCategoriasMaestras({
      incluirHijos: incluirHijos === true,
      soloPopulares: soloPopulares === true,
    });
  }

  // ============================================
  // CATEGORÍAS POR EMPRESA (Privadas)
  // ============================================

  @Get('categorias/empresa/:empresaId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener categorías activas de una empresa',
    description:
      'Retorna categorías maestras activadas + categorías personalizadas',
  })
  @ApiResponse({
    status: 200,
    description: 'Categorías disponibles para la empresa',
  })
  async getCategoriasEmpresa(@Param('empresaId') empresaId: string) {
    return await this.catalogosService.getCategoriasDisponiblesParaEmpresa(
      empresaId,
    );
  }

  @Post('categorias/activar')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Activar categoría para una empresa',
    description:
      'Activa una categoría maestra o crea una personalizada para la empresa',
  })
  @ApiResponse({ status: 201, description: 'Categoría activada exitosamente' })
  @ApiResponse({ status: 400, description: 'Categoría ya activada' })
  async activarCategoria(
    @Body()
    body: {
      empresaId: string;
      categoriaMaestraId?: string;
      nombrePersonalizado?: string;
      descripcionPersonalizada?: string;
      nombreLocal?: string;
      orden?: number;
    },
    @CurrentUser() user: any,
  ) {
    // TODO: Verificar que el usuario tenga permisos en la empresa
    return await this.catalogosService.activarCategoriaParaEmpresa(body);
  }

  @Delete('categorias/empresa/:empresaId/:empresaCategoriaId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar categoría de una empresa' })
  @ApiResponse({
    status: 200,
    description: 'Categoría desactivada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'No se puede desactivar - hay productos asociados',
  })
  async desactivarCategoria(
    @Param('empresaId') empresaId: string,
    @Param('empresaCategoriaId') empresaCategoriaId: string,
  ) {
    return await this.catalogosService.desactivarCategoriaParaEmpresa(
      empresaId,
      empresaCategoriaId,
    );
  }

  @Post('categorias/activar-populares')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Activar categorías populares automáticamente',
    description:
      'Activa todas las categorías marcadas como populares para la empresa',
  })
  @ApiResponse({ status: 201, description: 'Categorías activadas' })
  async activarCategoriasPopulares(@Body() body: { empresaId: string }) {
    return await this.catalogosService.activarCategoriasPopularesParaEmpresa(
      body.empresaId,
    );
  }

  // ============================================
  // MARCAS MAESTRAS (Públicas)
  // ============================================

  @Get('marcas-maestras')
  @Public()
  @ApiOperation({
    summary: 'Obtener catálogo global de marcas',
    description: 'Retorna todas las marcas maestras disponibles en el sistema',
  })
  @ApiQuery({
    name: 'soloPopulares',
    required: false,
    type: Boolean,
    description: 'Solo marcas populares',
  })
  @ApiResponse({ status: 200, description: 'Catálogo de marcas' })
  async getMarcasMaestras(@Query('soloPopulares') soloPopulares?: boolean) {
    return await this.catalogosService.getMarcasMaestras({
      soloPopulares: soloPopulares === true,
    });
  }

  // ============================================
  // MARCAS POR EMPRESA (Privadas)
  // ============================================

  @Get('marcas/empresa/:empresaId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener marcas activas de una empresa' })
  @ApiResponse({
    status: 200,
    description: 'Marcas disponibles para la empresa',
  })
  async getMarcasEmpresa(@Param('empresaId') empresaId: string) {
    return await this.catalogosService.getMarcasDisponiblesParaEmpresa(
      empresaId,
    );
  }

  @Post('marcas/activar')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activar marca para una empresa' })
  @ApiResponse({ status: 201, description: 'Marca activada exitosamente' })
  async activarMarca(
    @Body()
    body: {
      empresaId: string;
      marcaMaestraId?: string;
      nombrePersonalizado?: string;
      descripcionPersonalizada?: string;
      nombreLocal?: string;
      orden?: number;
    },
  ) {
    return await this.catalogosService.activarMarcaParaEmpresa(body);
  }

  @Delete('marcas/empresa/:empresaId/:empresaMarcaId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar marca de una empresa' })
  @ApiResponse({ status: 200, description: 'Marca desactivada exitosamente' })
  async desactivarMarca(
    @Param('empresaId') empresaId: string,
    @Param('empresaMarcaId') empresaMarcaId: string,
  ) {
    return await this.catalogosService.desactivarMarcaParaEmpresa(
      empresaId,
      empresaMarcaId,
    );
  }

  @Post('marcas/activar-populares')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Activar marcas populares automáticamente' })
  @ApiResponse({ status: 201, description: 'Marcas activadas' })
  async activarMarcasPopulares(@Body() body: { empresaId: string }) {
    return await this.catalogosService.activarMarcasPopularesParaEmpresa(
      body.empresaId,
    );
  }

  // ============================================
  // PREVIEW DE CATÁLOGOS POR RUBRO (Público)
  // ============================================

  @Get('preview/:rubro')
  @Public()
  @ApiOperation({
    summary: 'Preview de catálogos que se activarían para un rubro',
    description:
      'Útil para mostrar al usuario qué categorías y marcas se activarán automáticamente al crear una empresa con determinado rubro',
  })
  @ApiResponse({
    status: 200,
    description: 'Preview de catálogos',
    schema: {
      type: 'object',
      properties: {
        rubro: { type: 'string' },
        categorias: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              nombre: { type: 'string' },
              slug: { type: 'string' },
              icono: { type: 'string' },
              descripcion: { type: 'string' },
            },
          },
        },
        marcas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              nombre: { type: 'string' },
              slug: { type: 'string' },
              logo: { type: 'string' },
              descripcion: { type: 'string' },
            },
          },
        },
        total: { type: 'number' },
      },
    },
  })
  async getPreviewCatalogosPorRubro(@Param('rubro') rubro: string) {
    return await this.catalogosService.getPreviewCatalogosPorRubro(rubro);
  }
}
