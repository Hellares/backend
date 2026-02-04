import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Headers,
  Query,
  UseGuards,
  BadRequestException,
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
import { ReservarStockComboDto } from './dto/reservar-stock-combo.dto';
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
    description: 'Retorna todos los combos con componentes, stock calculado y precio calculado por sede',
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
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  async getAllCombos(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ): Promise<ComboCompletoResponseDto[]> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.comboService.getAllCombos(empresaId, sedeId);
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
  @ApiResponse({ status: 400, description: 'Datos inválidos o sedeId requerido' })
  @ApiResponse({ status: 404, description: 'Combo no encontrado' })
  async agregarComponente(
    @Param('id') comboId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId: string | undefined,
    @Body() dto: CreateComponenteComboDto,
  ): Promise<ProductoComboResponseDto> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.comboService.agregarComponente(comboId, empresaId, sedeId, dto);
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
  @ApiResponse({ status: 400, description: 'Datos inválidos o sedeId requerido' })
  @ApiResponse({ status: 404, description: 'Combo no encontrado' })
  async agregarComponentesBatch(
    @Param('id') comboId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId: string | undefined,
    @Body() dto: CreateComponentesComboBatchDto,
  ): Promise<ProductoComboResponseDto[]> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.comboService.agregarComponentesBatch(comboId, empresaId, sedeId, dto.componentes);
  }

  /**
   * Obtener todos los componentes de un combo
   */
  @Get(':id/componentes')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener componentes de un combo con precios y stock por sede' })
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
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  @ApiResponse({ status: 404, description: 'Combo no encontrado' })
  async getComponentes(
    @Param('id') comboId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ): Promise<ProductoComboResponseDto[]> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.comboService.getComponentesCombo(comboId, empresaId, sedeId);
  }

  /**
   * Obtener información completa del combo con cálculos
   */
  @Get(':id/combo-completo')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Obtener combo completo con componentes, stock y precio calculado por sede',
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
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  @ApiResponse({ status: 404, description: 'Combo no encontrado' })
  async getComboCompleto(
    @Param('id') comboId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ): Promise<ComboCompletoResponseDto> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.comboService.getComboCompleto(comboId, empresaId, sedeId);
  }

  /**
   * Obtener stock disponible del combo
   */
  @Get(':id/stock-disponible-combo')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Calcular stock disponible del combo en una sede (máximo de combos que se pueden armar)',
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
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  async getStockDisponible(
    @Param('id') comboId: string,
    @Query('sedeId') sedeId?: string,
  ): Promise<{ stockDisponible: number }> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    const stock = await this.comboService.getStockDisponibleCombo(comboId, sedeId);
    return { stockDisponible: stock };
  }

  /**
   * Calcular precio del combo
   */
  @Get(':id/precio-calculado-combo')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary: 'Calcular precio del combo según su tipo (FIJO, CALCULADO, CALCULADO_CON_DESCUENTO) para una sede',
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
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  async getPrecioCalculado(
    @Param('id') comboId: string,
    @Query('sedeId') sedeId?: string,
  ): Promise<{ precioCalculado: number }> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    const precio = await this.comboService.calcularPrecioCombo(comboId, sedeId);
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
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  @ApiResponse({ status: 404, description: 'Componente no encontrado' })
  async actualizarComponente(
    @Param('id') componenteId: string,
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId: string | undefined,
    @Body() dto: UpdateComponenteComboDto,
  ): Promise<ProductoComboResponseDto> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.comboService.actualizarComponente(componenteId, empresaId, sedeId, dto);
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
    summary: 'Validar si el combo tiene stock suficiente para la cantidad solicitada en una sede',
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
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  async validarStock(
    @Param('id') comboId: string,
    @Param('cantidad') cantidad: string,
    @Query('sedeId') sedeId?: string,
  ): Promise<{ tieneStock: boolean; stockDisponible: number }> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    const cantidadNum = parseInt(cantidad, 10);
    const tieneStock = await this.comboService.validarStockCombo(comboId, sedeId, cantidadNum);
    const stockDisponible = await this.comboService.getStockDisponibleCombo(comboId, sedeId);

    return {
      tieneStock,
      stockDisponible,
    };
  }

  /**
   * Obtener la reservación actual de un combo en una sede
   */
  @Get(':id/reservacion')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener reservación de stock del combo en una sede' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Cantidad de combos reservados' })
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  async getReservacion(
    @Param('id') comboId: string,
    @Query('sedeId') sedeId?: string,
  ): Promise<{ cantidad: number }> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.comboService.getReservacionCombo(comboId, sedeId);
  }

  /**
   * Reservar stock para un combo (crear/actualizar reservación)
   */
  @Post(':id/reservar-stock')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({
    summary: 'Reservar stock para un combo',
    description: 'Crea o actualiza la reservación de stock. La cantidad es el TOTAL de combos a reservar (no delta).',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Reservación actualizada' })
  @ApiResponse({ status: 400, description: 'Stock insuficiente o datos inválidos' })
  async reservarStock(
    @Param('id') comboId: string,
    @Query('sedeId') sedeId: string | undefined,
    @Body() dto: ReservarStockComboDto,
    @CurrentUser() user: any,
  ): Promise<{ cantidad: number }> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    return await this.comboService.reservarStockCombo(comboId, sedeId, dto.cantidad, user.sub);
  }

  /**
   * Liberar toda la reservación de un combo en una sede
   */
  @Delete(':id/reservar-stock')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Liberar reservación de stock del combo' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa (tenant)',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'Reservación liberada' })
  @ApiResponse({ status: 400, description: 'SedeId es requerido' })
  async liberarReserva(
    @Param('id') comboId: string,
    @Query('sedeId') sedeId: string | undefined,
    @CurrentUser() user: any,
  ): Promise<{ cantidad: number; message: string }> {
    if (!sedeId) {
      throw new BadRequestException('El parámetro sedeId es requerido');
    }
    const result = await this.comboService.liberarReservaCombo(comboId, sedeId, user.sub);
    return { ...result, message: 'Reservación liberada exitosamente' };
  }
}
