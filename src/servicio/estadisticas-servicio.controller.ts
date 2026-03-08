import {
  Controller,
  Get,
  Query,
  Headers,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  RequiresPermission,
  Permission,
} from '../auth/decorators/requires-permission.decorator';
import { EstadisticasServicioService } from './estadisticas-servicio.service';
import { QueryEstadisticasDto } from './dto/estadisticas-servicio.dto';

@ApiTags('Estadísticas Servicio')
@Controller('ordenes-servicio')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class EstadisticasServicioController {
  constructor(
    private readonly estadisticasService: EstadisticasServicioService,
  ) {}

  @Get('estadisticas')
  @RequiresPermission(Permission.VIEW_STATISTICS)
  @ApiOperation({ summary: 'Obtener estadísticas de órdenes de servicio' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getEstadisticas(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryEstadisticasDto,
  ) {
    if (!empresaId)
      throw new BadRequestException('x-tenant-id es requerido');
    return this.estadisticasService.getEstadisticas(empresaId, query);
  }
}
