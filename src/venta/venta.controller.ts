import {
  Controller,
  Get,
  Post,
  Put,
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
import { VentaService } from './venta.service';
import { CreateVentaDto } from './dto/create-venta.dto';
import { CreateVentaDesdeCotizacionDto } from './dto/create-venta-desde-cotizacion.dto';
import { CrearYCobrarVentaDto } from './dto/crear-y-cobrar-venta.dto';
import { UpdateVentaDto } from './dto/update-venta.dto';
import { ProcesarPagoDto } from './dto/procesar-pago.dto';
import { AnularVentaDto } from './dto/anular-venta.dto';
import { EstadoVenta } from '@prisma/client';

@ApiTags('Ventas')
@Controller('ventas')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class VentaController {
  constructor(private readonly ventaService: VentaService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Crear venta (BORRADOR)' })
  @ApiResponse({ status: 201, description: 'Venta creada exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateVentaDto,
  ) {
    return this.ventaService.create(empresaId, dto);
  }

  @Post('cobrar')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Crear y cobrar venta POS en un solo paso' })
  @ApiResponse({ status: 201, description: 'Venta creada y cobrada exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearYCobrar(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CrearYCobrarVentaDto,
    @CurrentUser('id') cajeroId: string,
  ) {
    return this.ventaService.crearYCobrar(empresaId, dto, cajeroId);
  }

  @Post('desde-cotizacion/:cotizacionId')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Crear venta desde cotizacion pendiente o aprobada' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearDesdeCotizacion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('cotizacionId') cotizacionId: string,
    @Body() dto: CreateVentaDesdeCotizacionDto,
    @CurrentUser('id') cajeroId: string,
  ) {
    return this.ventaService.crearDesdeCotizacion(
      empresaId,
      cotizacionId,
      dto,
      cajeroId,
    );
  }

  @Get()
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Listar ventas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('tenantRole') userRole: string,
    @Query('sedeId') sedeId?: string,
    @Query('estado') estado?: EstadoVenta,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('clienteId') clienteId?: string,
    @Query('search') search?: string,
  ) {
    return this.ventaService.findAll(empresaId, {
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

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Resumen de ventas para dashboard' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getResumen(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.ventaService.getResumen(empresaId, sedeId);
  }

  @Get('buscar')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Buscar venta por codigo de venta o comprobante' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async buscarPorCodigo(
    @Headers('x-tenant-id') empresaId: string,
    @Query('codigo') codigo: string,
  ) {
    return this.ventaService.buscarPorCodigo(empresaId, codigo);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Obtener venta por ID' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.ventaService.findOne(id, empresaId);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Actualizar venta (solo BORRADOR)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVentaDto,
  ) {
    return this.ventaService.update(id, empresaId, dto);
  }

  @Post(':id/confirmar')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Confirmar venta (impacta stock)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async confirmar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.ventaService.confirmar(id, empresaId, usuarioId);
  }

  @Post(':id/pago')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Registrar pago en venta' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async procesarPago(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: ProcesarPagoDto,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.ventaService.procesarPago(id, empresaId, dto, usuarioId);
  }

  @Post(':id/anular')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Anular venta (reversa stock)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async anular(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: AnularVentaDto,
  ) {
    return this.ventaService.anular(id, empresaId, usuarioId, dto);
  }
}
