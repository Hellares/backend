import {
  Controller,
  Post,
  Get,
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
}
