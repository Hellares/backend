import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ProductoComponenteService } from './producto-componente.service';
import {
  CrearComponenteDto,
  ActualizarComponenteDto,
  FabricarDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Producto Compuesto / BOM')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('productos/:productoId/componentes')
export class ProductoComponenteController {
  constructor(private readonly service: ProductoComponenteService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Lista los componentes (receta) de un producto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.service.listar(empresaId, productoId, sedeId);
  }

  @Get('calcular-costo')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary:
      'Calcula el costo total sumando cantidad × precioCosto de cada componente en la sede',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async calcularCosto(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Query('sedeId') sedeId: string,
  ) {
    return this.service.calcularCosto(empresaId, productoId, sedeId);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Agrega un componente a la receta del producto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Body() dto: CrearComponenteDto,
  ) {
    return this.service.crear(empresaId, productoId, dto);
  }

  @Patch(':componenteRowId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualiza la cantidad o notas de un componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Param('componenteRowId') componenteRowId: string,
    @Body() dto: ActualizarComponenteDto,
  ) {
    return this.service.actualizar(
      empresaId,
      productoId,
      componenteRowId,
      dto,
    );
  }

  @Delete(':componenteRowId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Quita un componente de la receta' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async eliminar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Param('componenteRowId') componenteRowId: string,
  ) {
    return this.service.eliminar(empresaId, productoId, componenteRowId);
  }

  @Post('fabricar')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary:
      'Fabrica N unidades del producto desde sus componentes (descuenta insumos + suma stock final + genera kardex PRODUCCION_ENTRADA/SALIDA)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async fabricar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Body() dto: FabricarDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.fabricar(empresaId, productoId, dto, user.sub);
  }

  @Get('fabricaciones')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Lista los lotes de fabricación de un producto (historial)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async historialFabricaciones(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Query('sedeId') sedeId?: string,
    @Query('limit') limit?: string,
  ) {
    const lim = limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200) : 50;
    return this.service.historialFabricaciones(
      empresaId,
      productoId,
      sedeId,
      lim,
    );
  }

  @Get('fabricaciones/:numeroDocumento')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary:
      'Detalle de un lote de fabricación (producto final + insumos consumidos)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async detalleFabricacion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoId') productoId: string,
    @Param('numeroDocumento') numeroDocumento: string,
  ) {
    return this.service.detalleFabricacion(empresaId, productoId, numeroDocumento);
  }
}
