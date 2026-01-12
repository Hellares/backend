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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { SedeService } from './sede.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import {
  CreateSedeDto,
  UpdateSedeDto,
  SedeDetailDto,
  AsignarUsuarioSedeDto,
} from './dto';

@ApiTags('Gestión de Sedes')
@Controller('empresas/:empresaId/sedes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class SedeController {
  constructor(private readonly sedeService: SedeService) {}

  /**
   * Crear nueva sede
   */
  @Post()
  @RequiresPermission(Permission.MANAGE_SEDES)
  @ApiOperation({
    summary: 'Crear nueva sede',
    description: 'Crea una nueva sede para la empresa. Valida límites según plan de suscripción.',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiResponse({
    status: 201,
    description: 'Sede creada exitosamente',
    type: SedeDetailDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o límite de sedes alcanzado',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 409, description: 'Código de sede ya existe' })
  async createSede(
    @Param('empresaId') empresaId: string,
    @Body() createSedeDto: CreateSedeDto,
    @CurrentUser() user: any,
  ): Promise<SedeDetailDto> {
    return this.sedeService.createSede(empresaId, user.sub, createSedeDto);
  }

  /**
   * Listar todas las sedes de una empresa
   */
  @Get()
  @ApiOperation({
    summary: 'Listar sedes',
    description: 'Obtiene todas las sedes activas de la empresa',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de sedes',
    type: [SedeDetailDto],
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin acceso a la empresa' })
  async listSedes(
    @Param('empresaId') empresaId: string,
    @CurrentUser() user: any,
  ): Promise<SedeDetailDto[]> {
    return this.sedeService.listSedes(empresaId, user.sub);
  }

  /**
   * Obtener detalles de una sede
   */
  @Get(':sedeId')
  @ApiOperation({
    summary: 'Obtener detalles de sede',
    description: 'Obtiene información completa de una sede específica',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'sedeId',
    description: 'ID de la sede',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Detalles de la sede',
    type: SedeDetailDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin acceso' })
  @ApiResponse({ status: 404, description: 'Sede no encontrada' })
  async getSede(
    @Param('empresaId') empresaId: string,
    @Param('sedeId') sedeId: string,
    @CurrentUser() user: any,
  ): Promise<SedeDetailDto> {
    return this.sedeService.getSede(empresaId, sedeId, user.sub);
  }

  /**
   * Actualizar sede
   */
  @Put(':sedeId')
  @RequiresPermission(Permission.MANAGE_SEDES)
  @ApiOperation({
    summary: 'Actualizar sede',
    description: 'Actualiza la información de una sede existente',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'sedeId',
    description: 'ID de la sede',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Sede actualizada exitosamente',
    type: SedeDetailDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 404, description: 'Sede no encontrada' })
  @ApiResponse({ status: 409, description: 'Código o series ya existen' })
  async updateSede(
    @Param('empresaId') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Body() updateSedeDto: UpdateSedeDto,
    @CurrentUser() user: any,
  ): Promise<SedeDetailDto> {
    return this.sedeService.updateSede(empresaId, sedeId, user.sub, updateSedeDto);
  }

  /**
   * Eliminar sede (soft delete)
   */
  @Delete(':sedeId')
  @RequiresPermission(Permission.MANAGE_SEDES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar sede',
    description:
      'Elimina una sede (soft delete). No se puede eliminar la sede principal ni sedes con productos/servicios asignados.',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'sedeId',
    description: 'ID de la sede a eliminar',
    type: 'string',
  })
  @ApiResponse({
    status: 204,
    description: 'Sede eliminada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'No se puede eliminar (sede principal o tiene items asignados)',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 404, description: 'Sede no encontrada' })
  async deleteSede(
    @Param('empresaId') empresaId: string,
    @Param('sedeId') sedeId: string,
    @CurrentUser() user: any,
  ): Promise<void> {
    return this.sedeService.deleteSede(empresaId, sedeId, user.sub);
  }

  /**
   * Asignar usuario a sede con rol
   */
  @Post(':sedeId/usuarios')
  @RequiresPermission(Permission.MANAGE_SEDES)
  @ApiOperation({
    summary: 'Asignar usuario a sede',
    description:
      'Asigna un usuario existente de la empresa a una sede con un rol específico',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'sedeId',
    description: 'ID de la sede',
    type: 'string',
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario asignado exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Usuario no está en la empresa',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 404, description: 'Sede no encontrada' })
  async asignarUsuarioSede(
    @Param('empresaId') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Body() asignarUsuarioDto: AsignarUsuarioSedeDto,
    @CurrentUser() user: any,
  ) {
    return this.sedeService.asignarUsuarioSede(
      empresaId,
      sedeId,
      user.sub,
      asignarUsuarioDto,
    );
  }

  /**
   * Listar usuarios de una sede
   */
  @Get(':sedeId/usuarios')
  @ApiOperation({
    summary: 'Listar usuarios de sede',
    description: 'Obtiene todos los usuarios asignados a una sede',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'sedeId',
    description: 'ID de la sede',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de usuarios asignados',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin acceso' })
  async listarUsuariosSede(
    @Param('empresaId') empresaId: string,
    @Param('sedeId') sedeId: string,
    @CurrentUser() user: any,
  ) {
    return this.sedeService.listarUsuariosSede(empresaId, sedeId, user.sub);
  }

  /**
   * Remover usuario de sede
   */
  @Delete(':sedeId/usuarios/:usuarioSedeRolId')
  @RequiresPermission(Permission.MANAGE_SEDES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remover usuario de sede',
    description: 'Elimina la asignación de un usuario en una sede',
  })
  @ApiParam({
    name: 'empresaId',
    description: 'ID de la empresa',
    type: 'string',
  })
  @ApiParam({
    name: 'sedeId',
    description: 'ID de la sede',
    type: 'string',
  })
  @ApiParam({
    name: 'usuarioSedeRolId',
    description: 'ID de la asignación usuario-sede-rol',
    type: 'string',
  })
  @ApiResponse({
    status: 204,
    description: 'Usuario removido exitosamente',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 403, description: 'Sin permisos' })
  @ApiResponse({ status: 404, description: 'Asignación no encontrada' })
  async removerUsuarioSede(
    @Param('empresaId') empresaId: string,
    @Param('sedeId') sedeId: string,
    @Param('usuarioSedeRolId') usuarioSedeRolId: string,
    @CurrentUser() user: any,
  ): Promise<void> {
    return this.sedeService.removerUsuarioSede(
      empresaId,
      sedeId,
      usuarioSedeRolId,
      user.sub,
    );
  }
}
