import { Controller, Get, Post, Body, Param, Query, UseGuards, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrestamoService } from './prestamo.service';
import { EstadoPrestamo } from '@prisma/client';

@ApiTags('Préstamos')
@Controller('prestamos')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PrestamoController {
  constructor(private readonly service: PrestamoService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Listar préstamos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(@Headers('x-tenant-id') empresaId: string, @Query('estado') estado?: EstadoPrestamo) {
    return this.service.listar(empresaId, estado);
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Resumen de préstamos' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async resumen(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getResumen(empresaId);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Registrar préstamo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crear(@Headers('x-tenant-id') empresaId: string, @Body() body: any) {
    return this.service.crear(empresaId, body);
  }

  @Post(':id/pago')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Registrar pago de préstamo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarPago(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: any,
  ) {
    return this.service.registrarPago(empresaId, id, usuarioId, body);
  }
}
