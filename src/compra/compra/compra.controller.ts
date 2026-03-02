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
import { CreateCompraDto, CreateCompraDesdeOcDto } from '../dto';
import { EstadoCompra } from '@prisma/client';

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
  @ApiOperation({ summary: 'Listar compras' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('proveedorId') proveedorId?: string,
    @Query('estado') estado?: EstadoCompra,
    @Query('ordenCompraId') ordenCompraId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('search') search?: string,
  ) {
    return this.compraService.findAll(empresaId, {
      sedeId,
      proveedorId,
      estado,
      ordenCompraId,
      fechaDesde,
      fechaHasta,
      search,
    });
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
  @ApiOperation({ summary: 'Confirmar compra (actualiza stock y crea lotes)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async confirmar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.compraService.confirmar(id, empresaId, user.sub);
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
