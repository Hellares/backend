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
import { ServicioService } from './servicio.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { QueryServicioDto } from './dto/query-servicio.dto';

@ApiTags('Servicios')
@Controller('servicios')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ServicioController {
  constructor(private readonly servicioService: ServicioService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Crear un nuevo servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Servicio creado' })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateServicioDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    dto.empresaId = empresaId;
    return this.servicioService.create(dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_SERVICES)
  @ApiOperation({ summary: 'Listar servicios' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryServicioDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.servicioService.findAll(empresaId, query);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_SERVICES)
  @ApiOperation({ summary: 'Obtener un servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.servicioService.findOne(empresaId, id);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Actualizar un servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateServicioDto,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.servicioService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_SERVICES)
  @ApiOperation({ summary: 'Eliminar un servicio (soft delete)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId) throw new BadRequestException('x-tenant-id es requerido');
    return this.servicioService.remove(empresaId, id);
  }
}
