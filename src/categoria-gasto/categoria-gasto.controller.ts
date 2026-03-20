import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CategoriaGastoService } from './categoria-gasto.service';

@ApiTags('Categorias de Gasto')
@Controller('categorias-gasto')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CategoriaGastoController {
  constructor(private readonly service: CategoriaGastoService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Listar categorias de gasto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('tipo') tipo?: string,
  ) {
    return this.service.listar(empresaId, tipo);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Crear categoria de gasto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() body: { nombre: string; tipo: string; icono?: string; color?: string },
  ) {
    return this.service.crear(empresaId, body);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Actualizar categoria de gasto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() body: { nombre?: string; tipo?: string; icono?: string; color?: string },
  ) {
    return this.service.actualizar(empresaId, id, body);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Eliminar categoria de gasto (soft delete)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async eliminar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.eliminar(empresaId, id);
  }
}
