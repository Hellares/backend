import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClienteEmpresaService } from './cliente-empresa.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import {
  CreateClienteEmpresaDto,
  UpdateClienteEmpresaDto,
  QueryClienteEmpresaDto,
} from './dto';
import { CreateClienteEmpresaContactoDto } from './dto/create-cliente-empresa.dto';

@ApiTags('Clientes Empresa')
@Controller('empresas/:empresaId/clientes-empresa')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ClienteEmpresaController {
  constructor(
    private readonly clienteEmpresaService: ClienteEmpresaService,
  ) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  async create(
    @Param('empresaId') empresaId: string,
    @Body() dto: CreateClienteEmpresaDto,
    @CurrentUser() user: any,
  ) {
    dto.empresaId = empresaId;
    dto.creadoPor = user.sub;
    return this.clienteEmpresaService.create(dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_CLIENTS)
  async findAll(
    @Param('empresaId') empresaId: string,
    @Query() query: QueryClienteEmpresaDto,
  ) {
    return this.clienteEmpresaService.findAll(empresaId, query);
  }

  /// Delta-sync del catálogo B2B (patrón /clientes/sync). Declarado antes
  /// de ':id' para que la ruta estática gane.
  @Get('sync')
  @RequiresPermission(Permission.VIEW_CLIENTS)
  async sync(
    @Param('empresaId') empresaId: string,
    @Query('lastSync') lastSync?: string,
  ) {
    return this.clienteEmpresaService.syncDeltas(empresaId, lastSync);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_CLIENTS)
  async findOne(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.clienteEmpresaService.findOne(id, empresaId);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  async update(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateClienteEmpresaDto,
    @CurrentUser() user: any,
  ) {
    dto.actualizadoPor = user.sub;
    return this.clienteEmpresaService.update(id, empresaId, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @Body('motivo') motivo?: string,
  ) {
    await this.clienteEmpresaService.remove(id, empresaId, motivo);
  }

  // ─── Contactos ───

  @Post(':id/contactos')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  async addContacto(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @Body() dto: CreateClienteEmpresaContactoDto,
  ) {
    return this.clienteEmpresaService.addContacto(id, empresaId, dto);
  }

  @Put(':id/contactos/:contactoId')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  async updateContacto(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @Param('contactoId') contactoId: string,
    @Body() dto: Partial<CreateClienteEmpresaContactoDto>,
  ) {
    return this.clienteEmpresaService.updateContacto(
      id,
      contactoId,
      empresaId,
      dto,
    );
  }

  @Delete(':id/contactos/:contactoId')
  @RequiresPermission(Permission.MANAGE_CLIENTS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeContacto(
    @Param('empresaId') empresaId: string,
    @Param('id') id: string,
    @Param('contactoId') contactoId: string,
  ) {
    await this.clienteEmpresaService.removeContacto(id, contactoId, empresaId);
  }
}
