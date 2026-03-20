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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CotizacionService } from './cotizacion.service';
import { CreateCotizacionDto } from './dto/create-cotizacion.dto';
import { UpdateCotizacionDto } from './dto/update-cotizacion.dto';
import { UpdateEstadoCotizacionDto } from './dto/update-estado-cotizacion.dto';
import { CreateCotizacionDetalleDto } from './dto/create-cotizacion-detalle.dto';
import { EstadoCotizacion } from '@prisma/client';

@ApiTags('Cotizaciones')
@Controller('cotizaciones')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CotizacionController {
  constructor(private readonly cotizacionService: CotizacionService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_COTIZACIONES)
  @ApiOperation({ summary: 'Crear cotizacion' })
  @ApiResponse({ status: 201, description: 'Cotizacion creada exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateCotizacionDto,
  ) {
    return this.cotizacionService.create(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_COTIZACIONES)
  @ApiOperation({ summary: 'Listar cotizaciones' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('tenantRole') userRole: string,
    @Query('sedeId') sedeId?: string,
    @Query('estado') estado?: EstadoCotizacion,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('clienteId') clienteId?: string,
    @Query('search') search?: string,
  ) {
    return this.cotizacionService.findAll(empresaId, {
      sedeId,
      estado,
      fechaDesde,
      fechaHasta,
      clienteId,
      search,
      userId,
      userRole,
    });
  }

  @Get('cola-pos')
  @RequiresPermission(Permission.VIEW_COTIZACIONES)
  @ApiOperation({ summary: 'Cola POS - Cotizaciones aprobadas para cobro' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async colaPOS(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('tenantRole') userRole: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.cotizacionService.getColaPOS(empresaId, sedeId, userId, userRole);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_COTIZACIONES)
  @ApiOperation({ summary: 'Obtener cotizacion por ID' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.cotizacionService.findOne(id, empresaId);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_COTIZACIONES)
  @ApiOperation({ summary: 'Actualizar cotizacion (solo BORRADOR)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCotizacionDto,
  ) {
    return this.cotizacionService.update(id, empresaId, dto);
  }

  @Patch(':id/estado')
  @RequiresPermission(Permission.MANAGE_COTIZACIONES)
  @ApiOperation({ summary: 'Cambiar estado de cotizacion' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async updateEstado(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEstadoCotizacionDto,
  ) {
    return this.cotizacionService.updateEstado(id, empresaId, dto);
  }

  @Post(':id/duplicar')
  @RequiresPermission(Permission.MANAGE_COTIZACIONES)
  @ApiOperation({ summary: 'Duplicar cotizacion' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async duplicar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.cotizacionService.duplicar(id, empresaId);
  }

  @Post('validar-compatibilidad')
  @RequiresPermission(Permission.VIEW_COTIZACIONES)
  @ApiOperation({ summary: 'Validar compatibilidad de items' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async validarCompatibilidad(
    @Headers('x-tenant-id') empresaId: string,
    @Body() detalles: CreateCotizacionDetalleDto[],
  ) {
    return this.cotizacionService.validarCompatibilidadItems(
      empresaId,
      detalles,
    );
  }

  @Get(':id/validar-stock')
  @RequiresPermission(Permission.VIEW_COTIZACIONES)
  @ApiOperation({ summary: 'Validar stock disponible de items de cotizacion' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async validarStock(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.cotizacionService.validarStockCotizacion(id, empresaId);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_COTIZACIONES)
  @ApiOperation({ summary: 'Eliminar cotizacion (solo BORRADOR)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.cotizacionService.remove(id, empresaId);
  }
}
