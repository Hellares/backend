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
import {
  ActivarUnidadMedidaDto,
  ActivarCategoriaDto,
  ActivarMarcaDto,
} from './dto';

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
    @Body() body: ActivarCategoriaDto,
    @CurrentUser() user: any,
  ) {
    // TODO: Verificar que el usuario tenga permisos en la empresa
    // Descomentar cuando tengas el método de validación:
    // const tieneAcceso = await this.authService.userBelongsToEmpresa(
    //   user.id,
    //   body.empresaId,
    // );
    // if (!tieneAcceso) {
    //   throw new ForbiddenException('No tienes acceso a esta empresa');
    // }
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
  @ApiResponse({ status: 400, description: 'Marca ya activada' })
  async activarMarca(@Body() body: ActivarMarcaDto, @CurrentUser() user: any) {
    // TODO: Verificar que el usuario tenga permisos en la empresa
    // Descomentar cuando tengas el método de validación:
    // const tieneAcceso = await this.authService.userBelongsToEmpresa(
    //   user.id,
    //   body.empresaId,
    // );
    // if (!tieneAcceso) {
    //   throw new ForbiddenException('No tienes acceso a esta empresa');
    // }
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

  // ============================================
  // UNIDADES DE MEDIDA MAESTRAS (Públicas)
  // ============================================

  @Get('unidades-maestras')
  @Public()
  @ApiOperation({
    summary: 'Obtener catálogo global de unidades de medida SUNAT',
    description:
      'Retorna todas las unidades de medida estándar (SUNAT) disponibles en el sistema',
  })
  @ApiQuery({
    name: 'categoria',
    required: false,
    type: String,
    description: 'Filtrar por categoría (CANTIDAD, MASA, LONGITUD, etc.)',
  })
  @ApiQuery({
    name: 'soloPopulares',
    required: false,
    type: Boolean,
    description: 'Solo unidades populares',
  })
  @ApiResponse({ status: 200, description: 'Catálogo de unidades de medida' })
  async getUnidadesMaestras(
    @Query('categoria') categoria?: string,
    @Query('soloPopulares') soloPopulares?: boolean,
  ) {
    return await this.catalogosService.getUnidadesMaestras({
      categoria,
      soloPopulares: soloPopulares === true,
    });
  }

  // ============================================
  // UNIDADES DE MEDIDA POR EMPRESA (Privadas)
  // ============================================

  @Get('unidades/empresa/:empresaId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener unidades de medida activas de una empresa',
    description:
      'Retorna unidades de medida activadas para la empresa (maestras + personalizadas)',
  })
  @ApiResponse({
    status: 200,
    description: 'Unidades de medida disponibles para la empresa',
  })
  async getUnidadesEmpresa(@Param('empresaId') empresaId: string) {
    return await this.catalogosService.getUnidadesDisponiblesParaEmpresa(
      empresaId,
    );
  }

  @Post('unidades/activar')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Activar unidad de medida para una empresa',
    description:
      'Activa una unidad de medida maestra o crea una personalizada para la empresa',
  })
  @ApiResponse({
    status: 201,
    description: 'Unidad de medida activada exitosamente',
    schema: {
      example: {
        id: 'clx123456',
        empresaId: 'clx789012',
        unidadMaestraId: 'clx345678',
        nombreLocal: 'Kilogramo',
        simboloLocal: null,
        orden: 1,
        isVisible: true,
        isActive: true,
        creadoEn: '2024-01-15T10:30:00.000Z',
        actualizadoEn: '2024-01-15T10:30:00.000Z',
        unidadMaestra: {
          id: 'clx345678',
          codigo: 'KGM',
          nombre: 'Kilogramo',
          simbolo: 'kg',
          categoria: 'MASA',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Unidad ya activada' })
  async activarUnidadMedida(
    @Body() body: ActivarUnidadMedidaDto,
    @CurrentUser() user: any,
  ) {
    // TODO: Verificar que el usuario tenga permisos en la empresa
    // Descomentar cuando tengas el método de validación:
    // const tieneAcceso = await this.authService.userBelongsToEmpresa(
    //   user.id,
    //   body.empresaId,
    // );
    // if (!tieneAcceso) {
    //   throw new ForbiddenException('No tienes acceso a esta empresa');
    // }
    return await this.catalogosService.activarUnidadMedidaParaEmpresa(body);
  }

  @Delete('unidades/empresa/:empresaId/:unidadId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Desactivar unidad de medida de una empresa' })
  @ApiResponse({
    status: 200,
    description: 'Unidad de medida desactivada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'No se puede desactivar - hay productos/servicios asociados',
  })
  async desactivarUnidadMedida(
    @Param('empresaId') empresaId: string,
    @Param('unidadId') unidadId: string,
  ) {
    return await this.catalogosService.desactivarUnidadMedidaParaEmpresa(
      unidadId,
      empresaId,
    );
  }

  @Post('unidades/activar-populares')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Activar unidades de medida populares automáticamente',
    description:
      'Activa todas las unidades de medida marcadas como populares para la empresa (Unidad, Kilogramo, Metro, Litro, etc.)',
  })
  @ApiResponse({ status: 201, description: 'Unidades activadas' })
  async activarUnidadesPopulares(@Body() body: { empresaId: string }) {
    return await this.catalogosService.activarUnidadesPopularesParaEmpresa(
      body.empresaId,
    );
  }
}
