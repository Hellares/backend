import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Headers,
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
import { EstadoLote } from '@prisma/client';

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
    @Query('sedeId') sedeId?: string,
    @Query('productoStockId') productoStockId?: string,
    @Query('proveedorId') proveedorId?: string,
    @Query('estado') estado?: EstadoLote,
    @Query('search') search?: string,
  ) {
    return this.loteService.findAll(empresaId, {
      sedeId,
      productoStockId,
      proveedorId,
      estado,
      search,
    });
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
}
