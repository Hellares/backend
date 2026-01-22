import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ProductoStockService } from './producto-stock.service';
import { CrearStockDto } from './dto/crear-stock.dto';
import { AjustarStockDto } from './dto/ajustar-stock.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@ApiTags('Inventarios - Stock por Sede')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('producto-stock')
export class ProductoStockController {
  constructor(private readonly stockService: ProductoStockService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear registro de stock',
    description: 'Crea un nuevo registro de stock para un producto/variante en una sede',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async crearStock(
    @Body() dto: CrearStockDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.stockService.crearStock(empresaId, dto, user.sub);
  }

  @Get('sede/:sedeId')
  @ApiOperation({
    summary: 'Listar stock de una sede',
    description: 'Obtiene todos los productos con stock en una sede específica',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getStocksPorSede(
    @Param('sedeId') sedeId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return await this.stockService.getStocksPorSede(
      sedeId,
      empresaId,
      page ? +page : 1,
      limit ? +limit : 50,
    );
  }

  @Get('producto/:productoId/sede/:sedeId')
  @ApiOperation({
    summary: 'Obtener stock de producto en sede',
    description: 'Consulta el stock actual de un producto específico en una sede',
  })
  async getStockProductoEnSede(
    @Param('productoId') productoId: string,
    @Param('sedeId') sedeId: string,
  ) {
    return await this.stockService.getStockPorSede(sedeId, productoId);
  }

  @Put(':id/ajustar')
  @ApiOperation({
    summary: 'Ajustar stock',
    description: 'Ajusta el stock de un producto (entrada, salida, ajuste, etc)',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async ajustarStock(
    @Param('id') id: string,
    @Body() dto: AjustarStockDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return await this.stockService.ajustarStock(id, empresaId, dto, user.sub);
  }

  @Get(':id/movimientos')
  @ApiOperation({
    summary: 'Historial de movimientos',
    description: 'Obtiene el historial de movimientos de stock',
  })
  async getHistorialMovimientos(
    @Param('id') id: string,
    @Query('limit') limit?: number,
  ) {
    return await this.stockService.getHistorialMovimientos(
      id,
      limit ? +limit : 50,
    );
  }

  @Get('producto/:productoId/todas-sedes')
  @ApiOperation({
    summary: 'Stock en todas las sedes',
    description: 'Obtiene el stock de un producto en todas las sedes con resumen total',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getStockEnTodasSedes(
    @Param('productoId') productoId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('varianteId') varianteId?: string,
  ) {
    return await this.stockService.getStockEnTodasSedes(
      empresaId,
      productoId,
      varianteId,
    );
  }

  @Get('alertas/bajo-minimo')
  @ApiOperation({
    summary: 'Productos bajo stock mínimo',
    description: 'Obtiene lista de productos con stock igual o inferior al mínimo configurado',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async getProductosBajoMinimo(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return await this.stockService.getProductosBajoMinimo(empresaId, sedeId);
  }

  @Post('combo/validar-stock')
  @ApiOperation({
    summary: 'Validar stock de combo',
    description: 'Verifica si hay stock suficiente de todos los componentes de un combo',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async validarStockCombo(
    @Headers('x-tenant-id') empresaId: string,
    @Body()
    body: {
      comboId: string;
      sedeId: string;
      cantidad: number;
    },
  ) {
    return await this.stockService.validarStockCombo(
      body.comboId,
      body.sedeId,
      empresaId,
      body.cantidad,
    );
  }

  @Post('combo/descontar-stock')
  @ApiOperation({
    summary: 'Descontar stock de combo',
    description:
      'Descuenta el stock de todos los componentes de un combo al realizar una venta',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async descontarStockCombo(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: JwtPayload,
    @Body()
    body: {
      comboId: string;
      sedeId: string;
      cantidad: number;
      tipoDocumento?: string;
      numeroDocumento?: string;
    },
  ) {
    return await this.stockService.descontarStockCombo(
      body.comboId,
      body.sedeId,
      empresaId,
      body.cantidad,
      user.sub,
      body.tipoDocumento,
      body.numeroDocumento,
    );
  }
}
