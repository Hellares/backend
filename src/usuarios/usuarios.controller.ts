import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { UsuariosService } from './usuarios.service';
import { CreateUsuarioDto } from './dto/create-usuario.dto';
import { UpdateUsuarioDto } from './dto/update-usuario.dto';
import { QueryUsuarioDto } from './dto/query-usuario.dto';
import {
  UsuarioResponseDto,
  PaginatedUsuarioResponseDto,
} from './dto/usuario-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';

@ApiTags('usuarios')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Crear un nuevo usuario' })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado exitosamente',
  })
  create(@Body() createUsuarioDto: CreateUsuarioDto) {
    return this.usuariosService.create(createUsuarioDto);
  }

  @Get()
  @RequiresPermission(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Obtener lista de usuarios con paginación y filtros' })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de usuarios',
    type: PaginatedUsuarioResponseDto,
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Número de página' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Registros por página' })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Búsqueda por email, teléfono o nombre' })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean, description: 'Filtrar por estado activo' })
  @ApiQuery({ name: 'emailVerificado', required: false, type: Boolean, description: 'Filtrar por email verificado' })
  @ApiQuery({ name: 'empresaId', required: false, type: String, description: 'Filtrar por empresa' })
  async findAll(@Query() queryDto: QueryUsuarioDto): Promise<PaginatedUsuarioResponseDto> {
    return this.usuariosService.findAll(queryDto);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Obtener un usuario por ID' })
  @ApiResponse({
    status: 200,
    description: 'Usuario encontrado',
    type: UsuarioResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  async findOne(@Param('id') id: string): Promise<UsuarioResponseDto> {
    return this.usuariosService.findOne(id);
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Actualizar un usuario' })
  @ApiResponse({
    status: 200,
    description: 'Usuario actualizado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  update(@Param('id') id: string, @Body() updateUsuarioDto: UpdateUsuarioDto) {
    return this.usuariosService.update(id, updateUsuarioDto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_USERS)
  @ApiOperation({ summary: 'Eliminar un usuario (soft delete)' })
  @ApiResponse({
    status: 200,
    description: 'Usuario eliminado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Usuario no encontrado' })
  remove(@Param('id') id: string) {
    return this.usuariosService.remove(id);
  }
}
