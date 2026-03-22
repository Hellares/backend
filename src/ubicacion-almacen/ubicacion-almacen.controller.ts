import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { UbicacionAlmacenService } from './ubicacion-almacen.service';
import { TipoUbicacion } from '@prisma/client';

@ApiTags('Ubicaciones de Almacén')
@Controller('ubicaciones-almacen')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UbicacionAlmacenController {
  constructor(private readonly service: UbicacionAlmacenService) {}

  @Post('sede/:sedeId')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Crear ubicación de almacén' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Body() dto: { codigo: string; nombre: string; tipo?: TipoUbicacion; parentId?: string; capacidadMaxima?: number; descripcion?: string },
  ) {
    return this.service.crear(empresaId, sedeId, dto);
  }

  @Get('sede/:sedeId')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Listar ubicaciones de una sede' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Query('tipo') tipo?: TipoUbicacion,
    @Query('parentId') parentId?: string,
    @Query('search') search?: string,
  ) {
    return this.service.listar(empresaId, sedeId, { tipo, parentId, search });
  }

  @Get('sede/:sedeId/arbol')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Árbol jerárquico de ubicaciones' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getArbol(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
  ) {
    return this.service.getArbol(empresaId, sedeId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Detalle de una ubicación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getDetalle(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.getDetalle(empresaId, id);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar ubicación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: { nombre?: string; tipo?: TipoUbicacion; capacidadMaxima?: number; descripcion?: string },
  ) {
    return this.service.actualizar(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Desactivar ubicación' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async desactivar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.desactivar(empresaId, id);
  }

  @Post('sede/:sedeId/bulk')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Crear ubicaciones en bulk' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearBulk(
    @Headers('x-tenant-id') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Body() dto: { items: Array<{ codigo: string; nombre: string; tipo?: TipoUbicacion; parentId?: string }> },
  ) {
    return this.service.crearBulk(empresaId, sedeId, dto.items);
  }
}
