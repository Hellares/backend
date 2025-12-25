import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Headers,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { ProductoComboService } from './producto-combo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateComponenteComboDto, CreateComponentesComboBatchDto } from './dto/create-producto-combo.dto';
import { UpdateComponenteComboDto } from './dto/update-producto-combo.dto';
import { CreateComboDto } from './dto/create-combo.dto';
import {
  ProductoComboResponseDto,
  ComboCompletoResponseDto,
} from './dto/producto-combo-response.dto';

/**
 * Controller para gestión de combos de productos
 * Maneja componentes de combos y cálculos de stock/precio
 */
@ApiTags('Productos - Combos')
@Controller('combos')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ProductoComboController {
  constructor(private readonly comboService: ProductoComboService) {}

  /**
   * Obtener todos los combos de una empresa
   */
  @Get()
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Obtener todos los combos de una empresa con información completa',
    description: 'Retorna todos los combos con componentes, stock calculado y precio calculado',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de combos obtenida',
    type: [ComboCompletoResponseDto],
  })
  async getAllCombos(
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<ComboCompletoResponseDto[]> {
    return await this.comboService.getAllCombos(empresaId);
  }

  /**
   * Crear un nuevo combo directamente
   */
  @Post()
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Crear un nuevo combo directamente',
    description: 'Crea un combo como producto desde el inicio con esCombo=true. Stock y precio se manejan según componentes.',
  })
  @ApiResponse({
    status: 201,
    description: 'Combo creado exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async createCombo(
    @Body() createComboDto: CreateComboDto,
    @CurrentUser() user: any,
  ): Promise<any> {
    return await this.comboService.createCombo(createComboDto, user.sub);
  }

  /**
   * Agregar un componente a un combo
   */
  @Post(':id/componentes')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Agregar componente a un combo' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 201,
    description: 'Componente agregado exitosamente',
    type: ProductoComboResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Combo no encontrado' })
  async agregarComponente(
    @Param('id') comboId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateComponenteComboDto,
  ): Promise<ProductoComboResponseDto> {
    return await this.comboService.agregarComponente(comboId, empresaId, dto);
  }

  /**
   * Agregar múltiples componentes a un combo en batch
   */
  @Post(':id/componentes/batch')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Agregar múltiples componentes a un combo en una sola operación' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 201,
    description: 'Componentes agregados exitosamente en batch',
    type: [ProductoComboResponseDto],
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Combo no encontrado' })
  async agregarComponentesBatch(
    @Param('id') comboId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateComponentesComboBatchDto,
  ): Promise<ProductoComboResponseDto[]> {
    return await this.comboService.agregarComponentesBatch(comboId, empresaId, dto.componentes);
  }

  /**
   * Obtener todos los componentes de un combo
   */
  @Get(':id/componentes')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener componentes de un combo' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de componentes obtenida',
    type: [ProductoComboResponseDto],
  })
  @ApiResponse({ status: 404, description: 'Combo no encontrado' })
  async getComponentes(
    @Param('id') comboId: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<ProductoComboResponseDto[]> {
    return await this.comboService.getComponentesCombo(comboId, empresaId);
  }

  /**
   * Obtener información completa del combo con cálculos
   */
  @Get(':id/combo-completo')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Obtener combo completo con componentes, stock y precio calculado',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Información completa del combo',
    type: ComboCompletoResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Combo no encontrado' })
  async getComboCompleto(
    @Param('id') comboId: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<ComboCompletoResponseDto> {
    return await this.comboService.getComboCompleto(comboId, empresaId);
  }

  /**
   * Obtener stock disponible del combo
   */
  @Get(':id/stock-disponible-combo')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Calcular stock disponible del combo (máximo de combos que se pueden armar)',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Stock disponible calculado',
  })
  async getStockDisponible(
    @Param('id') comboId: string,
  ): Promise<{ stockDisponible: number }> {
    const stock = await this.comboService.getStockDisponibleCombo(comboId);
    return { stockDisponible: stock };
  }

  /**
   * Calcular precio del combo
   */
  @Get(':id/precio-calculado-combo')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Calcular precio del combo según su tipo (FIJO, CALCULADO, CALCULADO_CON_DESCUENTO)',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Precio calculado',
  })
  async getPrecioCalculado(
    @Param('id') comboId: string,
  ): Promise<{ precioCalculado: number }> {
    const precio = await this.comboService.calcularPrecioCombo(comboId);
    return { precioCalculado: precio };
  }

  /**
   * Actualizar un componente del combo
   */
  @Put('componentes/:id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar componente de un combo' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Componente actualizado exitosamente',
    type: ProductoComboResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Componente no encontrado' })
  async actualizarComponente(
    @Param('id') componenteId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: UpdateComponenteComboDto,
  ): Promise<ProductoComboResponseDto> {
    return await this.comboService.actualizarComponente(componenteId, empresaId, dto);
  }

  /**
   * Eliminar un componente del combo
   */
  @Delete('componentes/:id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Eliminar componente de un combo' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Componente eliminado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Componente no encontrado' })
  async eliminarComponente(
    @Param('id') componenteId: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<{ message: string }> {
    await this.comboService.eliminarComponente(componenteId, empresaId);
    return { message: 'Componente eliminado exitosamente' };
  }

  /**
   * Validar si combo tiene stock suficiente
   */
  @Get(':id/validar-stock-combo/:cantidad')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Validar si el combo tiene stock suficiente para la cantidad solicitada',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Validación de stock',
  })
  async validarStock(
    @Param('id') comboId: string,
    @Param('cantidad') cantidad: string,
  ): Promise<{ tieneStock: boolean; stockDisponible: number }> {
    const cantidadNum = parseInt(cantidad, 10);
    const tieneStock = await this.comboService.validarStockCombo(comboId, cantidadNum);
    const stockDisponible = await this.comboService.getStockDisponibleCombo(comboId);

    return {
      tieneStock,
      stockDisponible,
    };
  }
}
