import {
  Controller,
  Get,
  Post,
  Patch,
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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PedidoMarketplaceEmpresaService } from './pedido-marketplace-empresa.service';
import { ValidarPagoDto, CambiarEstadoPedidoDto } from './dto/empresa-pedido.dto';
import { ConfiguracionEnvioDto } from './dto/configuracion-envio.dto';
import { EstadoPedidoMarketplace } from '@prisma/client';

@ApiTags('Pedidos Marketplace - Empresa')
@Controller('pedidos-marketplace')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class PedidoMarketplaceEmpresaController {
  constructor(private readonly service: PedidoMarketplaceEmpresaService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Listar pedidos recibidos del marketplace' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listarPedidos(
    @Headers('x-tenant-id') empresaId: string,
    @Query('estado') estado?: EstadoPedidoMarketplace,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listarPedidos(empresaId, {
      estado,
      search,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    });
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Resumen de pedidos marketplace para dashboard' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async resumen(@Headers('x-tenant-id') empresaId: string) {
    return this.service.resumen(empresaId);
  }

  // OJO: las rutas estáticas (configuracion-envio) van ANTES de ':id' — Nest
  // matchea en orden de declaración y ':id' se las tragaba (404 Pedido no
  // encontrado con id='configuracion-envio').
  @Get('configuracion-envio')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Obtener configuración de envío de la empresa' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getConfiguracionEnvio(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getConfiguracionEnvio(empresaId);
  }

  @Patch('configuracion-envio')
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Actualizar configuración de envío' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async updateConfiguracionEnvio(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: ConfiguracionEnvioDto,
  ) {
    return this.service.updateConfiguracionEnvio(empresaId, dto);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_VENTAS)
  @ApiOperation({ summary: 'Detalle de un pedido recibido' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async detallePedido(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') pedidoId: string,
  ) {
    return this.service.detallePedido(empresaId, pedidoId);
  }

  @Post(':id/validar-pago')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Validar pago (aprobar o rechazar)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async validarPago(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') pedidoId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: ValidarPagoDto,
  ) {
    return this.service.validarPago(empresaId, pedidoId, usuarioId, dto);
  }

  @Patch(':id/estado')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({ summary: 'Cambiar estado del pedido (EN_PREPARACION, ENVIADO)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async cambiarEstado(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') pedidoId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: CambiarEstadoPedidoDto,
  ) {
    return this.service.cambiarEstado(empresaId, pedidoId, usuarioId, dto);
  }
}
