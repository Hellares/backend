import { Controller, Get, Query, UseGuards, Headers, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { LibroContableService } from './libro-contable.service';
import { QueryLibroContableDto } from './dto/query-libro.dto';

@ApiTags('Libro Contable')
@Controller('libro-contable')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class LibroContableController {
  constructor(private readonly service: LibroContableService) {}

  @Get()
  @RequiresPermission(Permission.VIEW_REPORTS)
  @ApiOperation({ summary: 'Obtener libro contable de un mes' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  @ApiQuery({ name: 'mes', type: Number, example: 3 })
  @ApiQuery({ name: 'anio', type: Number, example: 2026 })
  async getLibro(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryLibroContableDto,
  ) {
    return this.service.getLibro(empresaId, query.mes, query.anio);
  }
}
