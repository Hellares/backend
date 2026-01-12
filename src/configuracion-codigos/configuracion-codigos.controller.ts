import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { ConfiguracionCodigosService } from './configuracion-codigos.service';
import { UpdateConfigProductosDto } from './dto/update-config-productos.dto';
import { UpdateConfigVariantesDto } from './dto/update-config-variantes.dto';
import { UpdateConfigVentasDto } from './dto/update-config-ventas.dto';
import {
  PreviewCodigoDto,
  PreviewCodigoResponseDto,
} from './dto/preview-codigo.dto';
import { ConfiguracionResponseDto } from './dto/configuracion-response.dto';

@ApiTags('Configuración de Códigos')
@ApiBearerAuth()
@Controller('configuracion-codigos')
@UseGuards(JwtAuthGuard, TenantAuthGuard)
export class ConfiguracionCodigosController {
  constructor(
    private readonly service: ConfiguracionCodigosService,
  ) {}

  @Get(':empresaId')
  @ApiOperation({
    summary: 'Obtener configuración de códigos',
    description:
      'Obtiene la configuración completa de nomenclaturas de códigos para una empresa',
  })
  @ApiParam({ name: 'empresaId', description: 'ID de la empresa' })
  @ApiResponse({
    status: 200,
    description: 'Configuración obtenida exitosamente',
    type: ConfiguracionResponseDto,
  })
  getConfiguracion(
    @Param('empresaId') empresaId: string,
  ): Promise<ConfiguracionResponseDto> {
    return this.service.getConfiguracion(empresaId);
  }

  @Put(':empresaId/productos')
  @ApiOperation({
    summary: 'Actualizar configuración de productos',
    description:
      'Actualiza la configuración de nomenclatura para códigos de productos. Solo se puede cambiar el prefijo si no existen productos.',
  })
  @ApiParam({ name: 'empresaId', description: 'ID de la empresa' })
  @ApiResponse({
    status: 200,
    description: 'Configuración actualizada exitosamente',
    type: ConfiguracionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'No se puede cambiar el prefijo (existen productos activos)',
  })
  updateConfigProductos(
    @Param('empresaId') empresaId: string,
    @Body() dto: UpdateConfigProductosDto,
  ): Promise<ConfiguracionResponseDto> {
    return this.service.updateConfigProductos(empresaId, dto);
  }

  @Put(':empresaId/variantes')
  @ApiOperation({
    summary: 'Actualizar configuración de variantes',
    description:
      'Actualiza la configuración de nomenclatura para códigos de variantes. Solo se puede cambiar el prefijo si no existen variantes.',
  })
  @ApiParam({ name: 'empresaId', description: 'ID de la empresa' })
  @ApiResponse({
    status: 200,
    description: 'Configuración actualizada exitosamente',
    type: ConfiguracionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'No se puede cambiar el prefijo (existen variantes activas)',
  })
  updateConfigVariantes(
    @Param('empresaId') empresaId: string,
    @Body() dto: UpdateConfigVariantesDto,
  ): Promise<ConfiguracionResponseDto> {
    return this.service.updateConfigVariantes(empresaId, dto);
  }

  @Put(':empresaId/ventas')
  @ApiOperation({
    summary: 'Actualizar configuración de ventas (Notas de Venta)',
    description:
      'Actualiza la configuración de nomenclatura para códigos de ventas (Notas de Venta internas).',
  })
  @ApiParam({ name: 'empresaId', description: 'ID de la empresa' })
  @ApiResponse({
    status: 200,
    description: 'Configuración actualizada exitosamente',
    type: ConfiguracionResponseDto,
  })
  updateConfigVentas(
    @Param('empresaId') empresaId: string,
    @Body() dto: UpdateConfigVentasDto,
  ): Promise<ConfiguracionResponseDto> {
    return this.service.updateConfigVentas(empresaId, dto);
  }

  @Post(':empresaId/preview')
  @ApiOperation({
    summary: 'Vista previa de código',
    description:
      'Genera una vista previa de cómo se verá un código con la configuración actual o propuesta',
  })
  @ApiParam({ name: 'empresaId', description: 'ID de la empresa' })
  @ApiResponse({
    status: 200,
    description: 'Vista previa generada exitosamente',
    type: PreviewCodigoResponseDto,
  })
  previewCodigo(
    @Param('empresaId') empresaId: string,
    @Body() dto: PreviewCodigoDto,
  ): Promise<PreviewCodigoResponseDto> {
    return this.service.previewCodigo(empresaId, dto);
  }

  @Post(':empresaId/sincronizar/:tipo')
  @ApiOperation({
    summary: 'Sincronizar contador',
    description:
      'Sincroniza el contador con el estado real de la base de datos. Útil si hay inconsistencias.',
  })
  @ApiParam({ name: 'empresaId', description: 'ID de la empresa' })
  @ApiParam({
    name: 'tipo',
    description: 'Tipo de entidad a sincronizar',
    enum: ['PRODUCTO', 'VARIANTE', 'SERVICIO'],
  })
  @ApiResponse({
    status: 200,
    description: 'Contador sincronizado exitosamente',
    schema: {
      type: 'object',
      properties: {
        sincronizado: { type: 'boolean', example: true },
        nuevoContador: { type: 'number', example: 15 },
      },
    },
  })
  sincronizarContador(
    @Param('empresaId') empresaId: string,
    @Param('tipo') tipo: 'PRODUCTO' | 'VARIANTE' | 'SERVICIO',
  ): Promise<{ sincronizado: boolean; nuevoContador: number }> {
    return this.service.sincronizarContador(empresaId, tipo);
  }
}
