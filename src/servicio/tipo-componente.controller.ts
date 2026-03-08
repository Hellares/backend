import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequiresPermission,
  Permission,
} from '../auth/decorators/requires-permission.decorator';
import { TipoComponenteService } from './tipo-componente.service';
import { CreateTipoComponenteDto } from './dto/create-tipo-componente.dto';
import { UpdateTipoComponenteDto } from './dto/update-tipo-componente.dto';

@ApiTags('Tipos de Componente')
@Controller('tipos-componente')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class TipoComponenteController {
  constructor(
    private readonly tipoComponenteService: TipoComponenteService,
  ) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar tipos de componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(@Headers('x-tenant-id') empresaId: string) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.tipoComponenteService.findAll(empresaId);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Crear tipo de componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Tipo de componente creado' })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateTipoComponenteDto,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.tipoComponenteService.create(empresaId, dto);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener un tipo de componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.tipoComponenteService.findOne(empresaId, id);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Actualizar un tipo de componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTipoComponenteDto,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.tipoComponenteService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Eliminar un tipo de componente (soft delete)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.tipoComponenteService.remove(empresaId, id);
  }
}
