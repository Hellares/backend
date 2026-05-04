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
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { QueryClienteDto } from './dto/query-cliente.dto';
import {
  ClienteResponseDto,
  PaginatedClienteResponseDto,
  RegistroClienteResponseDto,
} from './dto/cliente-response.dto';

@ApiTags('Clientes')
@Controller('clientes')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClientesController {
  constructor(private readonly clientesService: ClientesService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({
    summary: 'Registrar un nuevo cliente o asociar uno existente',
    description:
      'Detecta si el cliente ya existe (por DNI) y crea solo las relaciones necesarias. Si no existe, crea todo el registro completo.',
  })
  @ApiResponse({
    status: 201,
    description: 'Cliente registrado exitosamente',
    type: RegistroClienteResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 403, description: 'Sin permisos para esta empresa' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async registrarCliente(
    @Body() createClienteDto: CreateClienteDto,
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser() user: any,
  ): Promise<RegistroClienteResponseDto> {
    return await this.clientesService.registrarCliente(
      createClienteDto,
      empresaId,
      user.sub,
    );
  }

  @Get()
  @RequiresPermission(Permission.VIEW_CLIENTS)
  @ApiOperation({
    summary: 'Obtener lista de clientes de la empresa',
    description:
      'Lista paginada con filtros de búsqueda y ordenamiento',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de clientes obtenida exitosamente',
    type: PaginatedClienteResponseDto,
  })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() queryDto: QueryClienteDto,
  ): Promise<PaginatedClienteResponseDto> {
    return await this.clientesService.findAll(empresaId, queryDto);
  }

  @Get('generico')
  @RequiresPermission(Permission.VIEW_CLIENTS)
  @ApiOperation({
    summary: 'Obtener (o crear) el cliente genérico CLIENTES VARIOS',
    description:
      'Devuelve el id del EmpresaPersona CLIENTES VARIOS (DNI 00000000) para esta empresa. Si no existe, lo crea on-the-fly. Usado por Venta Rápida cuando el cajero elige "Genérico".',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getGenerico(
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<{ id: string; nombres: string; apellidos: string; dni: string }> {
    return this.clientesService.getOrCreateGenerico(empresaId);
  }

  @Get('por-dni/:dni')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({
    summary: 'Buscar (o crear) cliente por DNI usando RENIEC/cache',
    description:
      'Resuelve los datos de la persona vía consulta interna o RENIEC, hace upsert de la Persona y de su EmpresaPersona como cliente, y devuelve el clienteEmpresaId listo para vincular a una venta. Idempotente.',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getClienteByDni(
    @Headers('x-tenant-id') empresaId: string,
    @Param('dni') dni: string,
  ): Promise<{
    clienteEmpresaId: string;
    personaId: string;
    dni: string;
    nombres: string;
    apellidos: string;
    nombreCompleto: string;
    direccion?: string;
    origen: 'INTERNO' | 'RENIEC';
  }> {
    return this.clientesService.getOrCreateByDni(empresaId, dni);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_CLIENTS)
  @ApiOperation({ summary: 'Obtener un cliente por ID' })
  @ApiResponse({
    status: 200,
    description: 'Cliente obtenido exitosamente',
    type: ClienteResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async findOne(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<ClienteResponseDto> {
    return await this.clientesService.findOne(id, empresaId);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Actualizar un cliente' })
  @ApiResponse({
    status: 200,
    description: 'Cliente actualizado exitosamente',
    type: ClienteResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async update(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
    @Body() updateClienteDto: UpdateClienteDto,
  ): Promise<ClienteResponseDto> {
    return await this.clientesService.update(
      id,
      empresaId,
      updateClienteDto,
    );
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @ApiOperation({ summary: 'Eliminar un cliente (soft delete)' })
  @ApiResponse({
    status: 200,
    description: 'Cliente eliminado exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Cliente no encontrado' })
  @ApiHeader({
    name: 'x-tenant-id',
    description: 'ID de la empresa',
    required: true,
  })
  async remove(
    @Param('id') id: string,
    @Headers('x-tenant-id') empresaId: string,
  ): Promise<{ message: string }> {
    return await this.clientesService.remove(id, empresaId);
  }
}
