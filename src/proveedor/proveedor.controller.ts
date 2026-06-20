import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { ProveedorService } from './proveedor.service';
import { ClienteEmpresaService } from '../cliente-empresa/cliente-empresa.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CreateProveedorDto, UpdateProveedorDto, EvaluarProveedorDto } from './dto';

@ApiTags('Gestión de Proveedores')
@Controller('empresas/:empresaId/proveedores')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ProveedorController {
  constructor(
    private readonly proveedorService: ProveedorService,
    private readonly clienteEmpresaService: ClienteEmpresaService,
  ) {}

  /**
   * Registra/vincula este proveedor como cliente (mismo tercero: le compramos
   * Y le vendemos). Idempotente. Devuelve { clienteEmpresa, accion }.
   */
  @Post(':id/registrar-como-cliente')
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @ApiOperation({ summary: 'Registrar/vincular el proveedor como cliente (cuenta corriente)' })
  @ApiParam({ name: 'empresaId', type: 'string' })
  async registrarComoCliente(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.clienteEmpresaService.vincularDesdeProveedor(empresaId, id, user.sub);
  }

  /**
   * Crear nuevo proveedor
   */
  @Post()
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @ApiOperation({
    summary: 'Crear nuevo proveedor',
    description: 'Crea un nuevo proveedor para la empresa con información completa.',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiResponse({
    status: 201,
    description: 'Proveedor creado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un proveedor con ese número de documento',
  })
  async create(
    @Param('empresaId') empresaId: string,
    @Body() createProveedorDto: CreateProveedorDto,
    @CurrentUser() user: any,
  ) {
    createProveedorDto.empresaId = empresaId;
    createProveedorDto.creadoPor = user.sub;
    return this.proveedorService.create(createProveedorDto);
  }

  /**
   * Listar todos los proveedores
   */
  @Get()
  @RequiresPermission(Permission.VIEW_PROVEEDORES)
  @ApiOperation({
    summary: 'Listar proveedores',
    description: 'Obtiene todos los proveedores de la empresa',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiQuery({
    name: 'includeInactive',
    description: 'Incluir proveedores inactivos',
    required: false,
    type: 'boolean',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de proveedores',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async findAll(
    @Param('empresaId') empresaId: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.proveedorService.findAll(empresaId, includeInactive === 'true');
  }

  /**
   * Obtener un proveedor por ID
   */
  @Get(':id')
  @RequiresPermission(Permission.VIEW_PROVEEDORES)
  @ApiOperation({
    summary: 'Obtener proveedor por ID',
    description: 'Obtiene información completa de un proveedor específico',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del proveedor',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Proveedor encontrado',
  })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async findOne(@Param('empresaId') empresaId: string, @Param('id') id: string) {
    return this.proveedorService.findOne(id, empresaId);
  }

  /**
   * Actualizar proveedor
   */
  @Put(':id')
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @ApiOperation({
    summary: 'Actualizar proveedor',
    description: 'Actualiza la información de un proveedor',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del proveedor',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Proveedor actualizado exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({
    status: 409,
    description: 'Ya existe un proveedor con ese número de documento',
  })
  async update(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @Body() updateProveedorDto: UpdateProveedorDto,
    @CurrentUser() user: any,
  ) {
    updateProveedorDto.actualizadoPor = user.sub;
    return this.proveedorService.update(id, empresaId, updateProveedorDto);
  }

  /**
   * Eliminar proveedor (soft delete)
   */
  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar proveedor',
    description: 'Desactiva un proveedor (soft delete)',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del proveedor',
    type: 'string',
  })
  @ApiResponse({
    status: 204,
    description: 'Proveedor eliminado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async remove(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body('motivo') motivo?: string,
  ) {
    await this.proveedorService.remove(id, empresaId, user.sub, motivo);
  }

  /**
   * Evaluar proveedor
   */
  @Post(':id/evaluar')
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @ApiOperation({
    summary: 'Evaluar proveedor',
    description: 'Registra una evaluación de desempeño del proveedor',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del proveedor',
    type: 'string',
  })
  @ApiResponse({
    status: 201,
    description: 'Evaluación registrada exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async evaluar(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @Body() evaluarProveedorDto: EvaluarProveedorDto,
    @CurrentUser() user: any,
  ) {
    evaluarProveedorDto.proveedorId = id;
    evaluarProveedorDto.empresaId = empresaId;
    evaluarProveedorDto.evaluadoPor = user.sub;
    return this.proveedorService.evaluar(evaluarProveedorDto);
  }

  /**
   * Obtener evaluaciones de un proveedor
   */
  @Get(':id/evaluaciones')
  @RequiresPermission(Permission.VIEW_PROVEEDORES)
  @ApiOperation({
    summary: 'Obtener evaluaciones del proveedor',
    description: 'Obtiene el historial de evaluaciones de un proveedor',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'id',
    description: 'ID del proveedor',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de evaluaciones',
  })
  @ApiResponse({ status: 404, description: 'Proveedor no encontrado' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  async getEvaluaciones(@Param('empresaId') empresaId: string, @Param('id') id: string) {
    return this.proveedorService.getEvaluaciones(id, empresaId);
  }

  // ─── CUENTAS BANCARIAS DEL PROVEEDOR ───

  @Get(':id/bancos')
  @RequiresPermission(Permission.VIEW_PROVEEDORES)
  @ApiOperation({ summary: 'Listar cuentas bancarias del proveedor' })
  async listarBancos(
    @Param('empresaId') empresaId: string,
    @Param('id') proveedorId: string,
  ) {
    return this.proveedorService.listarBancos(proveedorId, empresaId);
  }

  @Post(':id/bancos')
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @ApiOperation({ summary: 'Agregar cuenta bancaria al proveedor' })
  async crearBanco(
    @Param('empresaId') empresaId: string,
    @Param('id') proveedorId: string,
    @Body() body: any,
  ) {
    return this.proveedorService.crearBanco(proveedorId, empresaId, body);
  }

  @Put(':id/bancos/:bancoId')
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @ApiOperation({ summary: 'Actualizar cuenta bancaria' })
  async actualizarBanco(
    @Param('empresaId') empresaId: string,
    @Param('id') proveedorId: string,
    @Param('bancoId') bancoId: string,
    @Body() body: any,
  ) {
    return this.proveedorService.actualizarBanco(bancoId, proveedorId, empresaId, body);
  }

  @Delete(':id/bancos/:bancoId')
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar cuenta bancaria' })
  async eliminarBanco(
    @Param('empresaId') empresaId: string,
    @Param('id') proveedorId: string,
    @Param('bancoId') bancoId: string,
  ) {
    return this.proveedorService.eliminarBanco(bancoId, proveedorId, empresaId);
  }

  @Post(':id/bancos/:bancoId/principal')
  @RequiresPermission(Permission.MANAGE_PROVEEDORES)
  @ApiOperation({ summary: 'Marcar cuenta bancaria como principal' })
  async marcarBancoPrincipal(
    @Param('empresaId') empresaId: string,
    @Param('id') proveedorId: string,
    @Param('bancoId') bancoId: string,
  ) {
    return this.proveedorService.marcarBancoPrincipal(bancoId, proveedorId, empresaId);
  }
}
