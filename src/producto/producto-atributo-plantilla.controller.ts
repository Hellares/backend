import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { ProductoAtributoPlantillaService } from './producto-atributo-plantilla.service';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { CreateProductoAtributoPlantillaDto } from './dto/create-producto-atributo-plantilla.dto';
import { UpdateProductoAtributoPlantillaDto } from './dto/update-producto-atributo-plantilla.dto';
import { AplicarPlantillaDto } from './dto/aplicar-plantilla.dto';
import { ProductoAtributoPlantillaResponseDto } from './dto/producto-atributo-plantilla-response.dto';

@ApiTags('Plantillas de Atributos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@Controller('producto-atributo-plantillas')
export class ProductoAtributoPlantillaController {
  constructor(
    private readonly plantillaService: ProductoAtributoPlantillaService,
    private readonly planLimitsService: PlanLimitsService,
  ) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Crear una nueva plantilla de atributos',
    description: 'Crea una plantilla reutilizable con múltiples atributos. Límite según plan de suscripción.',
  })
  @ApiResponse({
    status: 201,
    description: 'Plantilla creada exitosamente',
    type: ProductoAtributoPlantillaResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Límite de plantillas alcanzado según el plan',
  })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() createDto: CreateProductoAtributoPlantillaDto,
  ): Promise<ProductoAtributoPlantillaResponseDto> {
    return this.plantillaService.create(empresaId, createDto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Listar plantillas de atributos',
    description: 'Obtiene todas las plantillas activas de la empresa',
  })
  @ApiQuery({
    name: 'categoriaId',
    required: false,
    description: 'Filtrar por categoría',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de plantillas',
    type: [ProductoAtributoPlantillaResponseDto],
  })
  findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query('categoriaId') categoriaId?: string,
  ): Promise<ProductoAtributoPlantillaResponseDto[]> {
    return this.plantillaService.findAll(empresaId, categoriaId);
  }

  @Get('limits-info')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Obtener información de límites del plan',
    description: 'Muestra límites y uso actual de plantillas según el plan de suscripción',
  })
  @ApiResponse({
    status: 200,
    description: 'Información de límites',
  })
  async getLimitsInfo(@Headers('x-tenant-id') empresaId: string) {
    return this.planLimitsService.getPlanLimitsInfo(empresaId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Obtener una plantilla por ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Plantilla encontrada',
    type: ProductoAtributoPlantillaResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Plantilla no encontrada',
  })
  findOne(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<ProductoAtributoPlantillaResponseDto> {
    return this.plantillaService.findOne(id, empresaId);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Actualizar una plantilla',
    description: 'Solo se pueden editar plantillas personalizadas (no las predefinidas)',
  })
  @ApiResponse({
    status: 200,
    description: 'Plantilla actualizada',
    type: ProductoAtributoPlantillaResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'No se pueden editar plantillas predefinidas',
  })
  update(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() updateDto: UpdateProductoAtributoPlantillaDto,
  ): Promise<ProductoAtributoPlantillaResponseDto> {
    return this.plantillaService.update(id, empresaId, updateDto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Eliminar una plantilla',
    description: 'Solo se pueden eliminar plantillas personalizadas (soft delete)',
  })
  @ApiResponse({
    status: 200,
    description: 'Plantilla eliminada',
  })
  @ApiResponse({
    status: 400,
    description: 'No se pueden eliminar plantillas predefinidas',
  })
  remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<void> {
    return this.plantillaService.remove(id, empresaId);
  }

  @Post('aplicar')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Aplicar plantilla a un producto o variante',
    description: 'Crea la estructura de atributos basándose en la plantilla seleccionada',
  })
  @ApiResponse({
    status: 200,
    description: 'Plantilla aplicada exitosamente',
  })
  aplicarPlantilla(
    @Headers('x-tenant-id') empresaId: string,
    @Body() aplicarDto: AplicarPlantillaDto,
  ): Promise<{ atributosCreados: number }> {
    return this.plantillaService.aplicarPlantilla(
      aplicarDto.plantillaId,
      empresaId,
      aplicarDto.productoId,
      aplicarDto.varianteId,
    );
  }
}
