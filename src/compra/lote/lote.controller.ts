import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { LoteService } from './lote.service';
import {
  CorregirVencimientoLoteDto,
  DarDeBajaLoteDto,
  QueryLotesDto,
} from '../dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Lotes')
@Controller('empresas/:empresaId/lotes')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LoteController {
  constructor(private readonly loteService: LoteService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Listar lotes con filtros' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() queryDto: QueryLotesDto,
  ) {
    return this.loteService.findAll(empresaId, queryDto);
  }

  @Get('proximos-vencer')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Lotes próximos a vencer' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getLotesProximosVencer(
    @Headers('x-tenant-id') empresaId: string,
    @Query('dias') dias?: string,
  ) {
    return this.loteService.getLotesProximosVencer(
      empresaId,
      dias ? parseInt(dias, 10) : 30,
    );
  }

  @Get('producto-stock/:productoStockId')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Lotes de un producto por sede (FIFO)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getLotesPorProductoStock(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoStockId') productoStockId: string,
  ) {
    return this.loteService.getLotesPorProductoStock(productoStockId, empresaId);
  }

  @Get('resumen-costo/:productoStockId')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Resumen de costos por producto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getResumenCostoPorProducto(
    @Headers('x-tenant-id') empresaId: string,
    @Param('productoStockId') productoStockId: string,
  ) {
    return this.loteService.getResumenCostoPorProducto(productoStockId, empresaId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Obtener detalle de un lote' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.loteService.findOne(id, empresaId);
  }

  @Post('marcar-vencidos')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Marcar lotes vencidos (batch)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async marcarLotesVencidos(
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.loteService.marcarLotesVencidos(empresaId);
  }

  @Post(':id/baja')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Dar de baja un lote (venció, se rompió, se perdió)',
    description:
      'Saca las unidades del inventario: baja el lote Y el stock, en una ' +
      'transacción.\n\n' +
      '🔴 Es la ÚNICA salida cuando un producto de CADUCIDAD vence. El guard ' +
      'de la venta lo bloquea sin autorización posible, y como FEFO pone lo ' +
      'vencido PRIMERO en la fila, sin esto ese lote frena toda venta de ese ' +
      'producto para siempre.\n\n' +
      'Sin `cantidad` se da de baja todo lo que queda, que es el caso normal. ' +
      'Exige `canManageProducts`: mueve inventario.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async darDeBaja(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: DarDeBajaLoteDto,
    @CurrentUser() user: any,
  ) {
    return this.loteService.darDeBaja(id, empresaId, user.sub, dto);
  }

  @Patch(':id/vencimiento')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Corregir la fecha de vencimiento de un lote',
    description:
      'La otra salida del bloqueo de CADUCIDAD: si la fecha se tipeó mal, no ' +
      'hay que tirar mercadería buena, hay que arreglar el dato.\n\n' +
      '🔴 Queda RASTRO en las observaciones del lote —qué decía antes, qué ' +
      'dice ahora, quién y por qué—: cambiar un vencimiento es exactamente lo ' +
      'que alguien haría para saltarse el bloqueo.\n\n' +
      'Un lote VENCIDO cuya fecha corregida todavía no llegó vuelve a ACTIVO.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async corregirVencimiento(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CorregirVencimientoLoteDto,
    @CurrentUser() user: any,
  ) {
    return this.loteService.corregirVencimiento(id, empresaId, user.sub, dto);
  }
}
