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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { PoliticaDescuentoService } from './services/politica-descuento.service';
import {
  CreatePoliticaDescuentoDto,
  UpdatePoliticaDescuentoDto,
  AsignarUsuariosDto,
  AsignarClientesDto,
  AgregarFamiliarDto,
  AsignarProductosDto,
  AsignarCategoriasDto,
  QueryPoliticaDescuentoDto,
  CalcularDescuentoDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequiresPermission,
  Permission,
} from '../auth/decorators/requires-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Políticas de Descuento')
@ApiBearerAuth()
@ApiHeader({
  name: 'x-tenant-id',
  description: 'ID de la empresa (tenant)',
  required: true,
})
@Controller('politicas-descuento')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
export class PoliticaDescuentoController {
  constructor(
    private readonly politicaDescuentoService: PoliticaDescuentoService,
  ) {}

  // =========================================
  // CRUD DE POLÍTICAS
  // =========================================

  @Post()
  @RequiresPermission(Permission.MANAGE_DISCOUNTS)
  @ApiOperation({ summary: 'Crear nueva política de descuento' })
  @ApiResponse({ status: 201, description: 'Política creada exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  async crear(
    @Body() createDto: CreatePoliticaDescuentoDto,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.crear(createDto, empresaId);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_DISCOUNTS)
  @ApiOperation({ summary: 'Obtener todas las políticas de descuento' })
  @ApiResponse({
    status: 200,
    description: 'Políticas obtenidas exitosamente',
  })
  async obtenerTodas(
    @Query() query: QueryPoliticaDescuentoDto,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.obtenerTodas(query, empresaId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_DISCOUNTS)
  @ApiOperation({ summary: 'Obtener política de descuento por ID' })
  @ApiResponse({ status: 200, description: 'Política encontrada' })
  @ApiResponse({ status: 404, description: 'Política no encontrada' })
  async obtenerPorId(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.obtenerPorId(id, empresaId);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_DISCOUNTS)
  @ApiOperation({ summary: 'Actualizar política de descuento' })
  @ApiResponse({
    status: 200,
    description: 'Política actualizada exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Política no encontrada' })
  async actualizar(
    @Param('id') id: string,
    @Body() updateDto: UpdatePoliticaDescuentoDto,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.actualizar(id, updateDto, empresaId);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_DISCOUNTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar política de descuento (soft delete)' })
  @ApiResponse({ status: 204, description: 'Política eliminada exitosamente' })
  @ApiResponse({ status: 404, description: 'Política no encontrada' })
  async eliminar(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    await this.politicaDescuentoService.eliminar(id, empresaId);
  }

  // =========================================
  // ASIGNACIÓN DE USUARIOS
  // =========================================

  @Post(':id/usuarios')
  @RequiresPermission(Permission.ASSIGN_DISCOUNTS)
  @ApiOperation({ summary: 'Asignar usuarios a una política de descuento' })
  @ApiResponse({ status: 201, description: 'Usuarios asignados exitosamente' })
  @ApiResponse({ status: 404, description: 'Política no encontrada' })
  async asignarUsuarios(
    @Param('id') politicaId: string,
    @Body() asignarDto: AsignarUsuariosDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.politicaDescuentoService.asignarUsuarios(
      politicaId,
      asignarDto,
      empresaId,
      usuarioId,
    );
  }

  @Get(':id/usuarios-asignados')
  @RequiresPermission(Permission.VIEW_DISCOUNTS)
  @ApiOperation({
    summary: 'Obtener IDs de usuarios asignados a una política',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de IDs de usuarios asignados',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          usuarioId: { type: 'string' },
        },
      },
    },
  })
  async obtenerUsuariosAsignados(
    @Param('id') politicaId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.obtenerUsuariosAsignados(
      politicaId,
      empresaId,
    );
  }

  @Delete(':politicaId/usuarios/:usuarioId')
  @RequiresPermission(Permission.ASSIGN_DISCOUNTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover usuario de una política de descuento' })
  @ApiResponse({ status: 204, description: 'Usuario removido exitosamente' })
  @ApiResponse({ status: 404, description: 'Asignación no encontrada' })
  async removerUsuario(
    @Param('politicaId') politicaId: string,
    @Param('usuarioId') usuarioId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    await this.politicaDescuentoService.removerUsuario(
      politicaId,
      usuarioId,
      empresaId,
    );
  }

  // =========================================
  // GESTIÓN DE FAMILIARES
  // =========================================

  @Post('trabajadores/:trabajadorId/familiares')
  @RequiresPermission(Permission.ASSIGN_DISCOUNTS)
  @ApiOperation({ summary: 'Agregar familiar a un trabajador' })
  @ApiResponse({ status: 201, description: 'Familiar agregado exitosamente' })
  @ApiResponse({ status: 404, description: 'Trabajador no encontrado' })
  @ApiResponse({
    status: 400,
    description: 'Límite de familiares alcanzado',
  })
  async agregarFamiliar(
    @Param('trabajadorId') trabajadorId: string,
    @Body() agregarDto: AgregarFamiliarDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.politicaDescuentoService.agregarFamiliar(
      trabajadorId,
      agregarDto,
      empresaId,
      usuarioId,
    );
  }

  @Get('trabajadores/:trabajadorId/familiares')
  @RequiresPermission(Permission.VIEW_DISCOUNTS)
  @ApiOperation({ summary: 'Obtener familiares de un trabajador' })
  @ApiResponse({
    status: 200,
    description: 'Familiares obtenidos exitosamente',
  })
  async obtenerFamiliares(
    @Param('trabajadorId') trabajadorId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.obtenerFamiliares(
      trabajadorId,
      empresaId,
    );
  }

  @Delete('trabajadores/:trabajadorId/familiares/:familiarId')
  @RequiresPermission(Permission.ASSIGN_DISCOUNTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover familiar de un trabajador' })
  @ApiResponse({ status: 204, description: 'Familiar removido exitosamente' })
  @ApiResponse({ status: 404, description: 'Familiar no encontrado' })
  async removerFamiliar(
    @Param('trabajadorId') trabajadorId: string,
    @Param('familiarId') familiarId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    await this.politicaDescuentoService.removerFamiliar(
      trabajadorId,
      familiarId,
      empresaId,
    );
  }

  // =========================================
  // PRODUCTOS Y CATEGORÍAS
  // =========================================

  @Post(':id/productos')
  @RequiresPermission(Permission.MANAGE_DISCOUNTS)
  @ApiOperation({ summary: 'Asignar productos a una política de descuento' })
  @ApiResponse({
    status: 201,
    description: 'Productos asignados exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Política no encontrada' })
  async asignarProductos(
    @Param('id') politicaId: string,
    @Body() asignarDto: AsignarProductosDto,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.asignarProductos(
      politicaId,
      asignarDto,
      empresaId,
    );
  }

  @Post(':id/categorias')
  @RequiresPermission(Permission.MANAGE_DISCOUNTS)
  @ApiOperation({ summary: 'Asignar categorías a una política de descuento' })
  @ApiResponse({
    status: 201,
    description: 'Categorías asignadas exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Política no encontrada' })
  async asignarCategorias(
    @Param('id') politicaId: string,
    @Body() asignarDto: AsignarCategoriasDto,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.asignarCategorias(
      politicaId,
      asignarDto,
      empresaId,
    );
  }

  // =========================================
  // ASIGNACIÓN DE CLIENTES VIP (precio especial)
  // =========================================

  @Post(':id/clientes')
  @RequiresPermission(Permission.ASSIGN_DISCOUNTS)
  @ApiOperation({ summary: 'Asignar clientes (VIP) a una política de precio especial' })
  @ApiResponse({ status: 201, description: 'Clientes asignados exitosamente' })
  @ApiResponse({ status: 404, description: 'Política no encontrada' })
  async asignarClientes(
    @Param('id') politicaId: string,
    @Body() dto: AsignarClientesDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
  ) {
    return this.politicaDescuentoService.asignarClientes(
      politicaId,
      dto,
      empresaId,
      usuarioId,
    );
  }

  @Get(':id/clientes')
  @RequiresPermission(Permission.VIEW_DISCOUNTS)
  @ApiOperation({ summary: 'Listar clientes asignados a una política' })
  @ApiResponse({ status: 200, description: 'Clientes asignados' })
  async obtenerClientesAsignados(
    @Param('id') politicaId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.obtenerClientesAsignados(
      politicaId,
      empresaId,
    );
  }

  @Delete(':id/clientes/:asignacionId')
  @RequiresPermission(Permission.ASSIGN_DISCOUNTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover un cliente de una política de precio especial' })
  @ApiResponse({ status: 204, description: 'Cliente removido exitosamente' })
  @ApiResponse({ status: 404, description: 'Asignación no encontrada' })
  async removerCliente(
    @Param('id') politicaId: string,
    @Param('asignacionId') asignacionId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    await this.politicaDescuentoService.removerCliente(
      politicaId,
      asignacionId,
      empresaId,
    );
  }

  @Get('cliente/:clienteId/vigentes')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary:
      'Políticas de precio especial vigentes de un cliente B2C (para preview en venta)',
  })
  @ApiResponse({ status: 200, description: 'Políticas vigentes del cliente' })
  async obtenerVigentesClienteB2C(
    @Param('clienteId') clienteId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.obtenerPoliticasVigentesCliente(
      empresaId,
      { clienteId },
    );
  }

  @Get('cliente-empresa/:clienteEmpresaId/vigentes')
  @RequiresPermission(Permission.MANAGE_VENTAS)
  @ApiOperation({
    summary:
      'Políticas de precio especial vigentes de un cliente B2B (para preview en venta)',
  })
  @ApiResponse({ status: 200, description: 'Políticas vigentes del cliente B2B' })
  async obtenerVigentesClienteB2B(
    @Param('clienteEmpresaId') clienteEmpresaId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.obtenerPoliticasVigentesCliente(
      empresaId,
      { clienteEmpresaId },
    );
  }

  // =========================================
  // CÁLCULO DE DESCUENTOS
  // =========================================

  @Post('calcular-descuento')
  @RequiresPermission(Permission.VIEW_DISCOUNTS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calcular descuento aplicable para un usuario y producto',
  })
  @ApiResponse({ status: 200, description: 'Descuento calculado exitosamente' })
  async calcularDescuento(
    @Body() calcularDto: CalcularDescuentoDto,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.calcularDescuento(
      calcularDto,
      empresaId,
    );
  }

  // =========================================
  // HISTORIAL Y REPORTES
  // =========================================

  @Get(':id/historial-uso')
  @RequiresPermission(Permission.VIEW_DISCOUNT_REPORTS)
  @ApiOperation({ summary: 'Obtener historial de uso de una política' })
  @ApiResponse({ status: 200, description: 'Historial obtenido exitosamente' })
  @ApiResponse({ status: 404, description: 'Política no encontrada' })
  async obtenerHistorialUso(
    @Param('id') politicaId: string,
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.politicaDescuentoService.obtenerHistorialUso(
      politicaId,
      empresaId,
    );
  }
}
