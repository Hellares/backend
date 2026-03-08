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
import { ComponenteService } from './componente.service';
import { CreateComponenteDto } from './dto/create-componente.dto';
import { UpdateComponenteDto } from './dto/update-componente.dto';

@ApiTags('Componentes')
@Controller('componentes')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ComponenteController {
  constructor(private readonly componenteService: ComponenteService) {}

  @Get()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Listar componentes' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findAll(
    @Headers('x-tenant-id') empresaId: string,
    @Query()
    query: {
      tipoComponenteId?: string;
      marca?: string;
      modelo?: string;
      serie?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.componenteService.findAll(empresaId, query);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Crear componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Componente creado' })
  create(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateComponenteDto,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.componenteService.create(empresaId, dto);
  }

  @Post('find-or-create')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Buscar componente existente o crear nuevo' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiResponse({ status: 201, description: 'Componente encontrado o creado' })
  findOrCreate(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateComponenteDto,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.componenteService.findOrCreate(empresaId, dto);
  }

  @Get('marcas')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener marcas distintas por tipo de componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getMarcas(
    @Headers('x-tenant-id') empresaId: string,
    @Query('tipoComponenteId') tipoComponenteId: string,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    if (!tipoComponenteId)
      throw new BadRequestException('tipoComponenteId es requerido');
    return this.componenteService.getMarcas(empresaId, tipoComponenteId);
  }

  @Get('modelos')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener modelos distintos por tipo y marca' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  getModelos(
    @Headers('x-tenant-id') empresaId: string,
    @Query('tipoComponenteId') tipoComponenteId: string,
    @Query('marca') marca: string,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    if (!tipoComponenteId)
      throw new BadRequestException('tipoComponenteId es requerido');
    if (!marca)
      throw new BadRequestException('marca es requerido');
    return this.componenteService.getModelos(empresaId, tipoComponenteId, marca);
  }

  @Get(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Obtener un componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  findOne(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.componenteService.findOne(empresaId, id);
  }

  @Put(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Actualizar un componente' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  update(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: UpdateComponenteDto,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.componenteService.update(empresaId, id, dto);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_ORDERS)
  @ApiOperation({ summary: 'Eliminar un componente (soft delete)' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  remove(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.componenteService.remove(empresaId, id);
  }
}
