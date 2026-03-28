import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { EmpresaService } from './empresa.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import {
  CreateEmpresaDto,
  UpdateEmpresaDto,
  CambiarPlanDto,
  EmpresaContextResponseDto,
  PersonalizacionEmpresaDto,
  PersonalizacionEmpresaResponseDto,
  ConfiguracionEmpresaDto,
  ConfiguracionEmpresaResponseDto,
} from './dto';
import { CreateEmpresaConCatalogosDto } from './dto/create-empresa-con-catalogos.dto';

@ApiTags('Gestión de Empresas')
@Controller('empresas')
export class EmpresaController {
  constructor(private readonly empresaService: EmpresaService) {}

  /**
   * Crear nueva empresa
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear nueva empresa' })
  @ApiResponse({
    status: 201,
    description: 'Empresa creada exitosamente',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nombre: { type: 'string' },
        ruc: { type: 'string' },
        subdominio: { type: 'string' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        web: { type: 'string' },
        descripcion: { type: 'string' },
        isActive: { type: 'boolean' },
        planSuscripcion: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            nombre: { type: 'string' },
            descripcion: { type: 'string' },
            precio: { type: 'number' },
            periodo: { type: 'string' },
          },
        },
        estadoSuscripcion: { type: 'string' },
        fechaInicioSuscripcion: { type: 'string', format: 'date-time' },
        fechaVencimiento: { type: 'string', format: 'date-time' },
        usuariosActuales: { type: 'number' },
        creadoEn: { type: 'string', format: 'date-time' },
        actualizadoEn: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 409, description: 'Empresa ya existe con estos datos' })
  async createEmpresa(
    @Body() createEmpresaDto: CreateEmpresaDto,
    @CurrentUser() user: any,
  ) {
    return this.empresaService.createEmpresa(createEmpresaDto, user.sub);
  }

  /**
   * Crear empresa con selección personalizada de catálogos
   */
  @Post('con-catalogos')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Crear empresa con selección personalizada de catálogos',
    description:
      'Permite crear una empresa y especificar qué categorías y marcas activar. ' +
      'Si no se especifican catálogos, se activan los recomendados del rubro.',
  })
  @ApiResponse({
    status: 201,
    description: 'Empresa creada con catálogos personalizados',
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 409, description: 'Empresa ya existe con estos datos' })
  async createEmpresaConCatalogos(
    @Body() createDto: CreateEmpresaConCatalogosDto,
    @CurrentUser() user: any,
  ) {
    return this.empresaService.createEmpresaConCatalogos(createDto, user.sub);
  }

  /**
   * Obtener empresas del usuario
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener lista de empresas del usuario' })
  @ApiResponse({
    status: 200,
    description: 'Lista de empresas del usuario',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nombre: { type: 'string' },
          ruc: { type: 'string' },
          subdominio: { type: 'string' },
          email: { type: 'string' },
          telefono: { type: 'string' },
          web: { type: 'string' },
          descripcion: { type: 'string' },
          isActive: { type: 'boolean' },
          planSuscripcion: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              nombre: { type: 'string' },
              descripcion: { type: 'string' },
              precio: { type: 'number' },
              periodo: { type: 'string' },
            },
          },
          estadoSuscripcion: { type: 'string' },
          usuariosActuales: { type: 'number' },
          creadoEn: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getEmpresas(@CurrentUser() user: any) {
    return this.empresaService.getEmpresasByUsuario(user.sub);
  }

  /**
   * Obtener planes de suscripción disponibles
   */
  @Get('planes')
  @Public()
  @ApiOperation({ summary: 'Obtener planes de suscripción disponibles' })
  @ApiResponse({
    status: 200,
    description: 'Lista de planes disponibles',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          nombre: { type: 'string' },
          descripcion: { type: 'string' },
          precio: { type: 'number' },
          periodo: { type: 'string' },
          limiteProductos: { type: 'number' },
          limiteServicios: { type: 'number' },
          limiteUsuarios: { type: 'number' },
          limiteSedes: { type: 'number' },
          tienePersonalizacion: { type: 'boolean' },
          tieneDominioPropio: { type: 'boolean' },
          tieneApi: { type: 'boolean' },
          tieneReportesAvanzados: { type: 'boolean' },
          caracteristicas: { type: 'object' },
        },
      },
    },
  })
  async getPlanesDisponibles() {
    return this.empresaService.getPlanesDisponibles();
  }

  /**
   * Obtener empresa específica
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener detalles de una empresa específica' })
  @ApiResponse({
    status: 200,
    description: 'Detalles de la empresa',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nombre: { type: 'string' },
        ruc: { type: 'string' },
        subdominio: { type: 'string' },
        email: { type: 'string' },
        telefono: { type: 'string' },
        web: { type: 'string' },
        descripcion: { type: 'string' },
        isActive: { type: 'boolean' },
        planSuscripcion: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            nombre: { type: 'string' },
            descripcion: { type: 'string' },
            precio: { type: 'number' },
            periodo: { type: 'string' },
          },
        },
        estadoSuscripcion: { type: 'string' },
        usuariosActuales: { type: 'number' },
        creadoEn: { type: 'string', format: 'date-time' },
        actualizadoEn: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada o sin acceso' })
  async getEmpresaById(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.empresaService.getEmpresaById(id, user.sub);
  }

  /**
   * Obtener contexto completo de la empresa
   * Incluye información de la empresa, roles del usuario, sedes, permisos y estadísticas
   */
  @Get(':id/context')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener contexto completo de la empresa',
    description: 'Obtiene información completa de la empresa incluyendo roles del usuario, sedes, permisos calculados y estadísticas',
  })
  @ApiResponse({
    status: 200,
    description: 'Contexto de la empresa obtenido exitosamente',
    type: EmpresaContextResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a esta empresa' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async getEmpresaContext(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<EmpresaContextResponseDto> {
    return this.empresaService.getEmpresaContext(id, user.sub);
  }

  /**
   * Actualizar empresa
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar información de una empresa' })
  @ApiResponse({
    status: 200,
    description: 'Empresa actualizada exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada o sin permisos' })
  @ApiResponse({ status: 409, description: 'Datos duplicados (RUC o subdominio)' })
  async updateEmpresa(
    @Param('id') id: string,
    @Body() updateEmpresaDto: UpdateEmpresaDto,
    @CurrentUser() user: any,
  ) {
    return this.empresaService.updateEmpresa(id, user.sub, updateEmpresaDto);
  }

  /**
   * Cambiar plan de suscripción
   */
  @Post(':id/cambiar-plan')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.CHANGE_PLAN)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar plan de suscripción de la empresa' })
  @ApiResponse({
    status: 200,
    description: 'Plan cambiado exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Empresa o plan no encontrados' })
  async cambiarPlan(
    @Param('id') id: string,
    @Body() cambiarPlanDto: CambiarPlanDto,
    @CurrentUser() user: any,
  ) {
    return this.empresaService.cambiarPlan(id, user.sub, cambiarPlanDto.planId, cambiarPlanDto.periodo);
  }

  /**
   * Obtener personalización de la empresa
   */
  @Get(':id/personalizacion')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener personalización de la empresa',
    description: 'Obtiene la configuración de personalización para marketplace, web y app',
  })
  @ApiResponse({
    status: 200,
    description: 'Personalización obtenida exitosamente',
    type: PersonalizacionEmpresaResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a esta empresa' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async getPersonalizacion(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<PersonalizacionEmpresaResponseDto> {
    return this.empresaService.getPersonalizacion(id, user.sub);
  }

  /**
   * Actualizar personalización de la empresa
   */
  @Put(':id/personalizacion')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar personalización de la empresa',
    description: 'Actualiza la configuración de personalización (solo administradores)',
  })
  @ApiResponse({
    status: 200,
    description: 'Personalización actualizada exitosamente',
    type: PersonalizacionEmpresaResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos de administrador' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async updatePersonalizacion(
    @Param('id') id: string,
    @Body() personalizacionDto: PersonalizacionEmpresaDto,
    @CurrentUser() user: any,
  ): Promise<PersonalizacionEmpresaResponseDto> {
    return this.empresaService.updatePersonalizacion(id, user.sub, personalizacionDto);
  }

  /**
   * Obtener etiquetas por defecto según rubro
   */
  @Get('etiquetas-equipo/:rubro')
  @ApiOperation({ summary: 'Obtener etiquetas de equipo por defecto según rubro' })
  getEtiquetasDefault(@Param('rubro') rubro: string) {
    return this.empresaService.getEtiquetasDefaultPorRubro(rubro);
  }

  /**
   * Obtener configuración fiscal/operativa de la empresa
   */
  @Get(':id/configuracion')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener configuración fiscal/operativa de la empresa',
    description: 'Obtiene la configuración de impuestos, moneda y cotizaciones',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuración obtenida exitosamente',
    type: ConfiguracionEmpresaResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes acceso a esta empresa' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async getConfiguracion(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ): Promise<ConfiguracionEmpresaResponseDto> {
    return this.empresaService.getConfiguracion(id, user.sub);
  }

  /**
   * Actualizar configuración fiscal/operativa de la empresa
   */
  @Put(':id/configuracion')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Actualizar configuración fiscal/operativa de la empresa',
    description: 'Actualiza impuestos, moneda y configuración de cotizaciones (solo administradores)',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuración actualizada exitosamente',
    type: ConfiguracionEmpresaResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos de entrada inválidos' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'No tienes permisos de administrador' })
  @ApiResponse({ status: 404, description: 'Empresa no encontrada' })
  async updateConfiguracion(
    @Param('id') id: string,
    @Body() configuracionDto: ConfiguracionEmpresaDto,
    @CurrentUser() user: any,
  ): Promise<ConfiguracionEmpresaResponseDto> {
    return this.empresaService.updateConfiguracion(id, user.sub, configuracionDto);
  }
}