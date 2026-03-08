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
import { ModeloEquipoService } from './modelo-equipo.service';
import { CreateModeloEquipoDto } from './dto/create-modelo-equipo.dto';
import { UpdateModeloEquipoDto } from './dto/update-modelo-equipo.dto';

@ApiTags('Modelos de Equipo')
@Controller('modelos-equipo')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ModeloEquipoController {
  constructor(private readonly modeloEquipoService: ModeloEquipoService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar modelos de equipo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: { search?: string; tipoComponenteId?: string },
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.modeloEquipoService.findAll(empresaId, query);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Crear modelo de equipo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Modelo creado' })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateModeloEquipoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.modeloEquipoService.create(empresaId, dto);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener modelo de equipo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.modeloEquipoService.findOne(empresaId, id);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Actualizar modelo de equipo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateModeloEquipoDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.modeloEquipoService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Eliminar modelo de equipo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.modeloEquipoService.remove(empresaId, id);
  }
}
