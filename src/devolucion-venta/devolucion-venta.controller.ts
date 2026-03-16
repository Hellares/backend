import {
  Controller,
  Get,
  Post,
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
import { DevolucionVentaService } from './devolucion-venta.service';
import { CreateDevolucionVentaDto } from './dto/create-devolucion-venta.dto';
import { QueryDevolucionVentaDto } from './dto/query-devolucion-venta.dto';

@ApiTags('Devoluciones Venta')
@Controller('devoluciones-venta')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class DevolucionVentaController {
  constructor(private readonly devolucionVentaService: DevolucionVentaService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_DEVOLUCIONES)
  @ApiOperation({ summary: 'Crear devolución de venta' })
  @ApiResponse({ status: 201, description: 'Devolución creada exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateDevolucionVentaDto,
  ) {
    return this.devolucionVentaService.create(empresaId, userId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_DEVOLUCIONES)
  @ApiOperation({ summary: 'Listar devoluciones de venta' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryDevolucionVentaDto,
  ) {
    return this.devolucionVentaService.findAll(empresaId, query);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_DEVOLUCIONES)
  @ApiOperation({ summary: 'Obtener detalle de devolución' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.devolucionVentaService.findOne(id, empresaId);
  }

  @Post(':id/aprobar')
  @RequiresPermission(Permission.MANAGE_DEVOLUCIONES)
  @ApiOperation({ summary: 'Aprobar devolución' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async aprobar(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.devolucionVentaService.aprobar(id, empresaId, userId);
  }

  @Post(':id/procesar')
  @RequiresPermission(Permission.MANAGE_DEVOLUCIONES)
  @ApiOperation({ summary: 'Procesar devolución (ejecutar acciones de stock)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async procesar(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.devolucionVentaService.procesar(id, empresaId, userId);
  }

  @Post(':id/rechazar')
  @RequiresPermission(Permission.MANAGE_DEVOLUCIONES)
  @ApiOperation({ summary: 'Rechazar devolución' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async rechazar(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() body: { motivo?: string },
  ) {
    return this.devolucionVentaService.rechazar(id, empresaId, userId, body.motivo);
  }

  @Post(':id/cancelar')
  @RequiresPermission(Permission.MANAGE_DEVOLUCIONES)
  @ApiOperation({ summary: 'Cancelar devolución' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cancelar(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.devolucionVentaService.cancelar(id, empresaId, userId);
  }
}
