import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ProductoComponenteService } from './producto-componente.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';

/**
 * Vista GLOBAL de producción (lotes fabricados de toda la empresa), distinta
 * del historial por-producto que vive bajo /productos/:id/componentes.
 */
@ApiTags('Producción')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('produccion')
export class ProduccionController {
  constructor(private readonly service: ProductoComponenteService) {}

  @Get('lotes')
  @RequiresPermission(Permission.VIEW_PRODUCTS)
  @ApiOperation({
    summary:
      'Lista todos los lotes fabricados de la empresa (filtros: sede, búsqueda, rango de fechas)',
  })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async lotes(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('search') search?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.listarLotesProduccion(empresaId, {
      sedeId,
      search,
      desde: desde ? new Date(desde) : undefined,
      hasta: hasta ? new Date(hasta) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }
}
