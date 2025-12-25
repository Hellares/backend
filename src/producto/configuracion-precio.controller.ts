import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission, Permission } from '../auth/decorators/requires-permission.decorator';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { ConfiguracionPrecioService } from './configuracion-precio.service';
import { CreateConfiguracionPrecioDto } from './dto/create-configuracion-precio.dto';
import { UpdateConfiguracionPrecioDto } from './dto/update-configuracion-precio.dto';

@Controller('configuraciones-precio')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
export class ConfiguracionPrecioController {
  constructor(
    private readonly configuracionPrecioService: ConfiguracionPrecioService,
  ) {}

  /**
   * Crear una nueva configuración de precios
   * POST /configuraciones-precio
   */
  @Post()
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateConfiguracionPrecioDto,
  ) {
    return this.configuracionPrecioService.crear(empresaId, dto);
  }

  /**
   * Obtener todas las configuraciones de la empresa
   * GET /configuraciones-precio
   */
  @Get()
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  async obtenerTodas(@Headers('x-tenant-id') empresaId: string) {
    return this.configuracionPrecioService.obtenerTodas(empresaId);
  }

  /**
   * Obtener una configuración por ID
   * GET /configuraciones-precio/:id
   */
  @Get(':id')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  async obtenerPorId(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') configuracionId: string,
  ) {
    return this.configuracionPrecioService.obtenerPorId(
      empresaId,
      configuracionId,
    );
  }

  /**
   * Actualizar una configuración
   * PATCH /configuraciones-precio/:id
   */
  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') configuracionId: string,
    @Body() dto: UpdateConfiguracionPrecioDto,
  ) {
    return this.configuracionPrecioService.actualizar(
      empresaId,
      configuracionId,
      dto,
    );
  }

  /**
   * Eliminar una configuración
   * DELETE /configuraciones-precio/:id
   */
  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async eliminar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') configuracionId: string,
  ) {
    await this.configuracionPrecioService.eliminar(empresaId, configuracionId);
  }
}
