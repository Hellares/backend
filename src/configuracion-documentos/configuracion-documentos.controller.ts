import {
  Controller,
  Get,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission, Permission } from '../auth/decorators/requires-permission.decorator';
import { TipoDocumento, FormatoPapel } from '@prisma/client';
import { ConfiguracionDocumentosService } from './configuracion-documentos.service';
import { UpdateConfiguracionDocumentosDto } from './dto/update-configuracion-documentos.dto';
import { UpdatePlantillaDocumentoDto } from './dto/update-plantilla-documento.dto';

@ApiTags('Configuracion de Documentos')
@ApiBearerAuth()
@Controller('configuracion-documentos')
@UseGuards(JwtAuthGuard, TenantAuthGuard)
export class ConfiguracionDocumentosController {
  constructor(
    private readonly service: ConfiguracionDocumentosService,
  ) {}

  @Get()
  @UseGuards(PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({
    summary: 'Obtener configuracion global de documentos',
    description: 'Retorna la configuracion de identidad de la empresa para documentos PDF',
  })
  @ApiResponse({ status: 200, description: 'Configuracion obtenida exitosamente' })
  getConfiguracion(@Request() req: any) {
    const empresaId = req.currentEmpresa.id;
    return this.service.getOrCreateConfiguracion(empresaId);
  }

  @Put()
  @UseGuards(PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({
    summary: 'Actualizar configuracion global de documentos',
    description: 'Actualiza colores, logo, datos de empresa y pie de pagina para documentos PDF',
  })
  @ApiResponse({ status: 200, description: 'Configuracion actualizada exitosamente' })
  updateConfiguracion(
    @Request() req: any,
    @Body() dto: UpdateConfiguracionDocumentosDto,
  ) {
    const empresaId = req.currentEmpresa.id;
    return this.service.updateConfiguracion(empresaId, dto);
  }

  @Get('plantillas')
  @UseGuards(PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({
    summary: 'Listar todas las plantillas de documentos',
    description: 'Retorna todas las plantillas configuradas para la empresa',
  })
  @ApiResponse({ status: 200, description: 'Plantillas obtenidas exitosamente' })
  getPlantillas(@Request() req: any) {
    const empresaId = req.currentEmpresa.id;
    return this.service.getPlantillas(empresaId);
  }

  @Get('plantillas/:tipo')
  @UseGuards(PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({
    summary: 'Obtener plantilla por tipo de documento',
    description: 'Retorna la plantilla para un tipo de documento especifico',
  })
  @ApiParam({
    name: 'tipo',
    enum: TipoDocumento,
    description: 'Tipo de documento',
  })
  @ApiQuery({
    name: 'formato',
    enum: FormatoPapel,
    required: false,
    description: 'Formato de papel (default: A4)',
  })
  @ApiResponse({ status: 200, description: 'Plantilla obtenida exitosamente' })
  getPlantillaByTipo(
    @Request() req: any,
    @Param('tipo') tipo: TipoDocumento,
    @Query('formato') formato?: FormatoPapel,
  ) {
    const empresaId = req.currentEmpresa.id;
    return this.service.getPlantillaByTipo(
      empresaId,
      tipo,
      formato ?? FormatoPapel.A4,
    );
  }

  @Put('plantillas/:tipo')
  @UseGuards(PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({
    summary: 'Actualizar plantilla por tipo de documento',
    description: 'Actualiza margenes, secciones visibles y colores de una plantilla',
  })
  @ApiParam({
    name: 'tipo',
    enum: TipoDocumento,
    description: 'Tipo de documento',
  })
  @ApiResponse({ status: 200, description: 'Plantilla actualizada exitosamente' })
  updatePlantilla(
    @Request() req: any,
    @Param('tipo') tipo: TipoDocumento,
    @Body() dto: UpdatePlantillaDocumentoDto,
  ) {
    const empresaId = req.currentEmpresa.id;
    return this.service.updatePlantilla(empresaId, tipo, dto);
  }

  @Get('completa/:tipo')
  @ApiOperation({
    summary: 'Obtener configuracion completa para generacion de PDF',
    description:
      'Retorna la configuracion global + plantilla especifica + sede opcional. Endpoint clave para Flutter antes de generar un PDF.',
  })
  @ApiParam({
    name: 'tipo',
    enum: TipoDocumento,
    description: 'Tipo de documento',
  })
  @ApiQuery({
    name: 'formato',
    enum: FormatoPapel,
    required: false,
    description: 'Formato de papel (default: A4)',
  })
  @ApiQuery({
    name: 'sedeId',
    required: false,
    description: 'ID de la sede emisora del documento (para usar su direccion/telefono)',
  })
  @ApiResponse({ status: 200, description: 'Configuracion completa obtenida exitosamente' })
  getConfiguracionCompleta(
    @Request() req: any,
    @Param('tipo') tipo: TipoDocumento,
    @Query('formato') formato?: FormatoPapel,
    @Query('sedeId') sedeId?: string,
  ) {
    const empresaId = req.currentEmpresa.id;
    return this.service.getConfiguracionCompleta(
      empresaId,
      tipo,
      formato ?? FormatoPapel.A4,
      sedeId,
    );
  }
}
