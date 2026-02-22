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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CompatibilidadService } from './compatibilidad.service';
import { CreateReglaCompatibilidadDto } from './dto/create-regla-compatibilidad.dto';
import { UpdateReglaCompatibilidadDto } from './dto/update-regla-compatibilidad.dto';
import { ValidarCompatibilidadDto } from './dto/validar-compatibilidad.dto';

@ApiTags('Compatibilidad')
@Controller('compatibilidad')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CompatibilidadController {
  constructor(private readonly compatibilidadService: CompatibilidadService) {}

  /**
   * Crear una regla de compatibilidad
   * POST /compatibilidad/reglas
   */
  @Post('reglas')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Crear regla de compatibilidad' })
  @ApiResponse({ status: 201, description: 'Regla creada exitosamente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateReglaCompatibilidadDto,
  ) {
    return this.compatibilidadService.create(empresaId, dto);
  }

  /**
   * Listar reglas de compatibilidad
   * GET /compatibilidad/reglas
   */
  @Get('reglas')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Listar reglas de compatibilidad' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'categoriaId', required: false, type: String })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query('categoriaId') categoriaId?: string,
  ) {
    return this.compatibilidadService.findAll(empresaId, categoriaId);
  }

  /**
   * Obtener regla por ID
   * GET /compatibilidad/reglas/:id
   */
  @Get('reglas/:id')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Obtener regla de compatibilidad por ID' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.compatibilidadService.findOne(id, empresaId);
  }

  /**
   * Actualizar regla de compatibilidad
   * PUT /compatibilidad/reglas/:id
   */
  @Put('reglas/:id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Actualizar regla de compatibilidad' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReglaCompatibilidadDto,
  ) {
    return this.compatibilidadService.update(id, empresaId, dto);
  }

  /**
   * Eliminar regla de compatibilidad (soft delete)
   * DELETE /compatibilidad/reglas/:id
   */
  @Delete('reglas/:id')
  @RequiresPermission(Permission.MANAGE_PRODUCTS)
  @ApiOperation({ summary: 'Eliminar regla de compatibilidad' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.compatibilidadService.remove(id, empresaId);
  }

  /**
   * Validar compatibilidad entre productos
   * POST /compatibilidad/validar
   */
  @Post('validar')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({ summary: 'Validar compatibilidad entre productos' })
  @ApiResponse({ status: 200, description: 'Resultado de validación de compatibilidad' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async validar(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: ValidarCompatibilidadDto,
  ) {
    return this.compatibilidadService.validarCompatibilidad(empresaId, dto.productos);
  }
}
