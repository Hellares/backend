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
import { CrearComponenteDto, ActualizarComponenteDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';

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
}
