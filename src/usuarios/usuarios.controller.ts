import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { UsuariosService } from './usuarios.service';
import {
  CreateUsuarioDto,
  UpdateUsuarioDto,
  QueryUsuarioDto,
  RegistroUsuarioResponseDto,
  UsuarioResponseDto,
  PaginatedUsuarioResponseDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Usuarios')
@Controller('usuarios')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  /**
   * POST /usuarios/registrar
   * Registrar un nuevo usuario/trabajador o asignar uno existente
   */
  @Post('registrar')
  @RequiresPermission(Permission.MANAGE_USERS)
  @ApiOperation({
    summary: 'Registrar un nuevo usuario/trabajador o asignar uno existente',
    description:
      'Detecta si el usuario ya existe (por DNI) y crea solo las relaciones necesarias. Si no existe, crea todo el registro completo incluyendo cuenta de acceso.',
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario registrado exitosamente',
    type: RegistroUsuarioResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 403, description: 'Sin permisos para esta empresa' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async registrarUsuario(
    @Body() createUsuarioDto: CreateUsuarioDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
  ): Promise<RegistroUsuarioResponseDto> {
    return this.usuariosService.registrarUsuario(
      empresaId,
      createUsuarioDto,
      user.sub,
    );
  }

  /**
   * GET /usuarios
   * Obtener lista de usuarios de la empresa con paginación
   */
  @Get()
  @RequiresPermission(Permission.VIEW_USERS)
  @ApiOperation({
    summary: 'Obtener lista de usuarios/trabajadores de la empresa',
    description:
      'Lista paginada con filtros de búsqueda y ordenamiento',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de usuarios obtenida exitosamente',
    type: PaginatedUsuarioResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async obtenerUsuarios(
    @Headers('x-tenant-id') empresaId: string,
    @Query() queryDto: QueryUsuarioDto,
  ): Promise<PaginatedUsuarioResponseDto> {
    return this.usuariosService.obtenerUsuarios(empresaId, queryDto);
  }

  /**
   * GET /usuarios/:id
   * Obtener un usuario específico
   */
  @Get(':id')
  @RequiresPermission(Permission.VIEW_USERS)
  @ApiOperation({ summary: 'Obtener un usuario/trabajador por ID' })
  @ApiResponse({
    status: 200,
    description: 'Usuario obtenido exitosamente',
    type: UsuarioResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async obtenerUsuario(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<UsuarioResponseDto> {
    return this.usuariosService.obtenerUsuario(empresaId, id);
  }

  /**
   * PATCH /usuarios/:id
   * Actualizar datos de un usuario
   */
  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_USERS)
  @ApiOperation({
    summary: 'Actualizar datos de un usuario/trabajador',
    description:
      'Permite actualizar nombres, apellidos, email, teléfono, rol, sedes y configuración de permisos del usuario',
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario actualizado exitosamente',
    type: UsuarioResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos o email/teléfono duplicado',
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async actualizarUsuario(
    @Param('id') id: string,
    @Body() updateUsuarioDto: UpdateUsuarioDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
  ): Promise<UsuarioResponseDto> {
    return this.usuariosService.actualizarUsuario(
      empresaId,
      id,
      updateUsuarioDto,
      user.sub,
    );
  }

  /**
   * DELETE /usuarios/:id
   * Desactivar un usuario de la empresa
   */
  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_USERS)
  @ApiOperation({
    summary: 'Desactivar un usuario/trabajador de la empresa',
    description:
      'Realiza un soft delete del usuario, desactivándolo en la empresa y en todas sus sedes asignadas',
  })
  @ApiResponse({
    status: 200,
    description: 'Usuario desactivado exitosamente',
    schema: {
      type: 'object',
      properties: {
        mensaje: {
          type: 'string',
          example: 'Usuario desactivado exitosamente de la empresa',
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async desactivarUsuario(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
  ): Promise<{ mensaje: string }> {
    return this.usuariosService.desactivarUsuario(empresaId, id, user.sub);
  }
}
