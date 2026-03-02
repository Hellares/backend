import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
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
import { OrdenCompraService } from './orden-compra.service';
import {
  CreateOrdenCompraDto,
  UpdateOrdenCompraDto,
  UpdateEstadoOrdenCompraDto,
} from '../dto';
import { EstadoOrdenCompra } from '@prisma/client';

@ApiTags('Ordenes de Compra')
@Controller('empresas/:empresaId/ordenes-compra')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class OrdenCompraController {
  constructor(private readonly ordenCompraService: OrdenCompraService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Crear orden de compra' })
  @ApiResponse({ status: 201, description: 'OC creada exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateOrdenCompraDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordenCompraService.create(empresaId, dto, user.sub);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Listar órdenes de compra' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('proveedorId') proveedorId?: string,
    @Query('estado') estado?: EstadoOrdenCompra,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('search') search?: string,
  ) {
    return this.ordenCompraService.findAll(empresaId, {
      sedeId,
      proveedorId,
      estado,
      fechaDesde,
      fechaHasta,
      search,
    });
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Obtener orden de compra por ID' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.ordenCompraService.findOne(id, empresaId);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Actualizar OC (solo BORRADOR)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrdenCompraDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordenCompraService.update(id, empresaId, dto, user.sub);
  }

  @Patch(':id/estado')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Cambiar estado de OC' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async updateEstado(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEstadoOrdenCompraDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordenCompraService.updateEstado(id, empresaId, dto, user.sub);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Eliminar OC (solo BORRADOR)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.ordenCompraService.remove(id, empresaId);
  }

  @Get(':id/lineas-pendientes')
  @RequiresPermission(Permission.VIEW_COMPRAS)
  @ApiOperation({ summary: 'Obtener líneas pendientes de recepción' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getLineasPendientes(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.ordenCompraService.getLineasPendientes(id, empresaId);
  }

  @Post(':id/duplicar')
  @RequiresPermission(Permission.MANAGE_COMPRAS)
  @ApiOperation({ summary: 'Duplicar OC como BORRADOR' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async duplicar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.ordenCompraService.duplicar(id, empresaId, user.sub);
  }
}
