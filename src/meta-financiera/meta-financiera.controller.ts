import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { MetaFinancieraService } from './meta-financiera.service';
import { CrearMetaFinancieraDto } from './dto/meta-financiera.dto';

@ApiTags('Metas Financieras')
@Controller('metas-financieras')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class MetaFinancieraController {
  constructor(private readonly service: MetaFinancieraService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Listar metas financieras activas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listar(@Headers('x-tenant-id') empresaId: string) {
    return this.service.listar(empresaId);
  }

  @Get('resumen')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Resumen de todas las metas con progreso' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getResumen(@Headers('x-tenant-id') empresaId: string) {
    return this.service.getResumen(empresaId);
  }

  @Post()
  @RequiresPermission(Permission.MANAGE_SETTINGS)
  @ApiOperation({ summary: 'Crear meta financiera' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() body: CrearMetaFinancieraDto,
  ) {
    return this.service.crear(empresaId, body);
  }

  @Get(':id/progreso')
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Obtener progreso de una meta financiera' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getProgreso(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.getProgreso(empresaId, id);
  }
}
