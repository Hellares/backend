import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GastosRecurrentesService } from './gastos-recurrentes.service';
import { CrearGastoRecurrenteDto } from './dto/crear-gasto-recurrente.dto';
import { ActualizarGastoRecurrenteDto } from './dto/actualizar-gasto-recurrente.dto';
import { ListarGastosRecurrentesQueryDto } from './dto/listar-gastos-recurrentes.query.dto';
import { PagarGastoRecurrenteDto } from './dto/pagar-gasto-recurrente.dto';

@ApiTags('Gastos Recurrentes')
@Controller('gastos-recurrentes')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
@ApiHeader({ name: 'x-tenant-id', required: true })
export class GastosRecurrentesController {
  constructor(private readonly service: GastosRecurrentesService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_GASTOS_RECURRENTES)
  @ApiOperation({ summary: 'Crear gasto recurrente' })
  crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CrearGastoRecurrenteDto,
  ) {
    return this.service.crear(empresaId, dto);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_GASTOS_RECURRENTES)
  @ApiOperation({ summary: 'Listar gastos recurrentes' })
  listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: ListarGastosRecurrentesQueryDto,
  ) {
    return this.service.listar(empresaId, query);
  }

  @Post('upload-comprobante')
  @RequiresPermission(Permission.MANAGE_GASTOS_RECURRENTES)
  @ApiOperation({
    summary: 'Subir foto/PDF del comprobante de pago a S3',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadComprobante(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
    @UploadedFile() file: any,
  ) {
    return this.service.uploadComprobante(empresaId, usuarioId, file);
  }

  @Get('dashboard')
  @RequiresPermission(Permission.VIEW_GASTOS_RECURRENTES)
  @ApiOperation({
    summary: 'Tablero por período (estado pagado/pendiente/vencido por gasto activo)',
  })
  @ApiQuery({ name: 'periodo', required: false, example: '2026-05' })
  @ApiQuery({ name: 'sedeId', required: false, description: '"null" para gastos globales' })
  dashboard(
    @Headers('x-tenant-id') empresaId: string,
    @Query('periodo') periodo?: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.service.dashboard(empresaId, periodo, sedeId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_GASTOS_RECURRENTES)
  @ApiOperation({ summary: 'Detalle de gasto recurrente con últimos 12 pagos' })
  obtener(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.obtener(empresaId, id);
  }

  @Post(':id/pagar')
  @RequiresPermission(Permission.MANAGE_GASTOS_RECURRENTES)
  @ApiOperation({
    summary: 'Registrar pago del período (híbrido CAJA/BANCO transaccional)',
  })
  pagar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: PagarGastoRecurrenteDto,
  ) {
    return this.service.pagar(empresaId, id, usuarioId, dto);
  }

  @Get(':id/pagos')
  @RequiresPermission(Permission.VIEW_GASTOS_RECURRENTES)
  @ApiOperation({ summary: 'Histórico paginado de pagos del gasto' })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  listarPagos(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.service.listarPagos(empresaId, id, {
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
    });
  }

  @Patch(':id')
  @RequiresPermission(Permission.MANAGE_GASTOS_RECURRENTES)
  @ApiOperation({ summary: 'Actualizar gasto recurrente' })
  actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: ActualizarGastoRecurrenteDto,
  ) {
    return this.service.actualizar(empresaId, id, dto);
  }

  @Patch(':id/toggle-activo')
  @RequiresPermission(Permission.MANAGE_GASTOS_RECURRENTES)
  @ApiOperation({ summary: 'Activar / inactivar gasto recurrente' })
  toggleActivo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.toggleActivo(empresaId, id);
  }

  @Delete(':id')
  @RequiresPermission(Permission.MANAGE_GASTOS_RECURRENTES)
  @ApiOperation({
    summary: 'Eliminar gasto recurrente (solo si no tiene pagos)',
  })
  eliminar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.service.eliminar(empresaId, id);
  }
}
