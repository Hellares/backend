import { Body, Controller, Delete, Get, Headers, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { VariantePlantillaService } from './variante-plantilla.service';
import {
  AplicarVariantePlantillaDto,
  GuardarVariantePlantillaDto,
  VariantePlantillaDesdeColeccionDto,
} from './dto/variante-plantilla.dto';

/**
 * Plantillas de VARIANTES ("Edredones", "Peluches"): la estructura de una
 * colección para crear otra igual con un toque. Ver `VariantePlantillaService`.
 */
@ApiTags('Plantillas de Variantes')
@ApiBearerAuth()
@ApiHeader({ name: 'x-tenant-id', required: true })
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@Controller('variante-plantillas')
export class VariantePlantillaController {
  constructor(private readonly service: VariantePlantillaService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Plantillas de variantes de la empresa' })
  listar(@Headers('x-tenant-id') empresaId: string) {
    return this.service.listar(empresaId);
  }

  @Post('desde-coleccion')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Crear una plantilla copiando la estructura de una colección existente' })
  desdeColeccion(@Headers('x-tenant-id') empresaId: string, @Body() dto: VariantePlantillaDesdeColeccionDto) {
    return this.service.desdeColeccion(empresaId, dto);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Una plantilla de variantes' })
  obtener(@Headers('x-tenant-id') empresaId: string, @Param('id') id: string) {
    return this.service.obtener(empresaId, id);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Crear una plantilla de variantes' })
  crear(@Headers('x-tenant-id') empresaId: string, @Body() dto: GuardarVariantePlantillaDto) {
    return this.service.crear(empresaId, dto);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Reemplazar una plantilla de variantes' })
  actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: GuardarVariantePlantillaDto,
  ) {
    return this.service.actualizar(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Eliminar una plantilla de variantes (baja lógica)' })
  eliminar(@Headers('x-tenant-id') empresaId: string, @Param('id') id: string) {
    return this.service.eliminar(empresaId, id);
  }

  @Post(':id/aplicar')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Aplicar la plantilla en un producto: crea la colección nueva',
    description:
      'Crea las combinaciones elegidas con el valor de la colección nueva (DINOSAURIO), ' +
      'en 0 y con sus precios. Las que ya existen se omiten y se informan.',
  })
  aplicar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: AplicarVariantePlantillaDto,
  ) {
    return this.service.aplicar(empresaId, id, dto);
  }
}
