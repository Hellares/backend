import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequiresPermission } from '../../auth/decorators/requires-permission.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { CompraService } from './compra.service';
import { CreateCompraDto, CreateCompraDesdeOcDto, DistribuirCompraDto, QueryComprasDto, ConfirmarCompraDto } from '../dto';

@ApiTags('Compras')
@Controller('empresas/:empresaId/compras')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CompraController {
  constructor(private readonly compraService: CompraService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Crear compra standalone (sin OC)' })
  @ApiResponse({ status: 201, description: 'Compra creada exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateCompraDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.compraService.create(empresaId, dto, user.sub);
  }

  @Post('desde-orden-compra')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Crear compra desde orden de compra' })
  @ApiResponse({ status: 201, description: 'Compra desde OC creada exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async createDesdeOrdenCompra(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateCompraDesdeOcDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.compraService.createDesdeOrdenCompra(empresaId, dto, user.sub);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Listar compras con paginación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() queryDto: QueryComprasDto,
  ) {
    return this.compraService.findAll(empresaId, queryDto);
  }

  @Get('reposicion-sugerida')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({
    summary: 'Reposición sugerida: productos con stock ≤ mínimo + mejor proveedor y cantidad sugerida',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async reposicionSugerida(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.compraService.reposicionSugerida(empresaId, sedeId);
  }

  @Post('guia/sugerir-mapeo')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({
    summary: 'Sugiere el mapeo de bienes de una guía → catálogo (alias proveedor + similitud)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async sugerirMapeoGuia(
    @Headers('x-tenant-id') empresaId: string,
    @Body()
    body: {
      proveedorId: string;
      bienes: Array<{ descripcion: string; cantidad?: number; unidad?: string }>;
    },
  ) {
    return this.compraService.sugerirMapeoGuia(empresaId, body.proveedorId, body.bienes ?? []);
  }

  @Post('proveedor-alias')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Guarda el alias del proveedor para tus productos (recordar nombres)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async guardarAliasProveedor(
    @Headers('x-tenant-id') empresaId: string,
    @Body()
    body: {
      proveedorId: string;
      items: Array<{
        descripcionProveedor: string;
        productoId: string;
        varianteId?: string | null;
        precioCompra?: number;
      }>;
    },
  ) {
    return this.compraService.guardarAliasProveedor(empresaId, body.proveedorId, body.items ?? []);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Obtener compra por ID' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.compraService.findOne(id, empresaId);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Actualizar compra (solo BORRADOR)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: CreateCompraDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.compraService.update(id, empresaId, dto, user.sub);
  }

  @Post(':id/confirmar')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Confirmar compra (stock + lotes). Contado: pago opcional; si se omite, cae en CxP.' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async confirmar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto?: ConfirmarCompraDto,
  ) {
    return this.compraService.confirmar(id, empresaId, user.sub, dto?.pago);
  }

  @Post(':id/anular')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Anular compra (reversa stock)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async anular(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.compraService.anular(id, empresaId, user.sub);
  }

  @Post(':id/distribuir')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Distribuir stock de compra a múltiples sedes' })
  @ApiResponse({ status: 200, description: 'Stock distribuido exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async distribuir(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: DistribuirCompraDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.compraService.distribuir(id, empresaId, dto, user.sub);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Eliminar compra (solo BORRADOR)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.compraService.remove(id, empresaId);
  }
}
