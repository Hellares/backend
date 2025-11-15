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
import {
  CreateEmpresaDto,
  UpdateEmpresaDto,
  CambiarPlanDto,
} from './dto';

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
   * Actualizar empresa
   */
  @Put(':id')
  @UseGuards(JwtAuthGuard)
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
   * Cambiar plan de suscripción
   */
  @Post(':id/cambiar-plan')
  @UseGuards(JwtAuthGuard)
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
    return this.empresaService.cambiarPlan(id, user.sub, cambiarPlanDto.planId);
  }
}