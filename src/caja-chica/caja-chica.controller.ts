import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequiresPermission } from '../auth/decorators/requires-permission.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CajaChicaService } from './caja-chica.service';
import { CrearCajaChicaDto } from './dto/crear-caja-chica.dto';
import { CrearGastoCajaChicaDto } from './dto/crear-gasto-caja-chica.dto';
import { CrearRendicionDto } from './dto/crear-rendicion.dto';
import { AprobarRendicionDto } from './dto/aprobar-rendicion.dto';
import { RechazarRendicionDto } from './dto/rechazar-rendicion.dto';

@ApiTags('Caja Chica')
@Controller('caja-chica')
@UseGuards(JwtAuthGuard, TenantAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class CajaChicaController {
  constructor(private readonly cajaChicaService: CajaChicaService) {}

  @Post()
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Crear una nueva caja chica' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearCajaChica(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: CrearCajaChicaDto,
  ) {
    return this.cajaChicaService.crearCajaChica(empresaId, dto, usuarioId);
  }

  @Get()
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Listar cajas chicas' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listarCajasChicas(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
  ) {
    return this.cajaChicaService.listarCajasChicas(empresaId, sedeId);
  }

  @Get(':id')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Obtener detalle de caja chica' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getCajaChica(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.cajaChicaService.getCajaChica(empresaId, id);
  }

  @Patch(':id/estado')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Activar/Inactivar caja chica' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async actualizarEstado(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @CurrentUser('id') usuarioId: string,
    @Body() body: { estado: string },
  ) {
    return this.cajaChicaService.actualizarEstado(
      empresaId,
      id,
      body.estado as any,
      usuarioId,
    );
  }

  @Post(':id/gastos')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Registrar gasto en caja chica' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async registrarGasto(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaChicaId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: CrearGastoCajaChicaDto,
  ) {
    return this.cajaChicaService.registrarGasto(empresaId, cajaChicaId, usuarioId, dto);
  }

  @Get(':id/gastos')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Listar gastos de caja chica' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listarGastos(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaChicaId: string,
    @Query('pendientes') pendientes?: string,
  ) {
    return this.cajaChicaService.listarGastos(
      empresaId,
      cajaChicaId,
      pendientes === 'true',
    );
  }

  @Patch('gastos/:gastoId/comprobante')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Adjuntar/actualizar el comprobante de un gasto' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async adjuntarComprobanteGasto(
    @Headers('x-tenant-id') empresaId: string,
    @Param('gastoId') gastoId: string,
    @Body() body: { comprobanteUrl: string },
  ) {
    return this.cajaChicaService.adjuntarComprobanteGasto(
      empresaId,
      gastoId,
      body.comprobanteUrl,
    );
  }

  @Post(':id/rendiciones')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Crear rendición de caja chica' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async crearRendicion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') cajaChicaId: string,
    @Body() dto: CrearRendicionDto,
  ) {
    return this.cajaChicaService.crearRendicion(empresaId, cajaChicaId, dto);
  }

  @Get('rendiciones/lista')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Listar rendiciones' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async listarRendiciones(
    @Headers('x-tenant-id') empresaId: string,
    @Query('cajaChicaId') cajaChicaId?: string,
    @Query('estado') estado?: string,
  ) {
    return this.cajaChicaService.listarRendiciones(empresaId, cajaChicaId, estado);
  }

  @Get('rendiciones/:rendicionId')
  @RequiresPermission(Permission.VIEW_CAJA)
  @ApiOperation({ summary: 'Obtener detalle de rendición' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async getRendicion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('rendicionId') rendicionId: string,
  ) {
    return this.cajaChicaService.getRendicion(empresaId, rendicionId);
  }

  @Post('rendiciones/:rendicionId/aprobar')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Aprobar rendición de caja chica' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async aprobarRendicion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('rendicionId') rendicionId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: AprobarRendicionDto,
  ) {
    return this.cajaChicaService.aprobarRendicion(
      empresaId,
      rendicionId,
      usuarioId,
      dto.observaciones,
    );
  }

  @Post('rendiciones/:rendicionId/rechazar')
  @RequiresPermission(Permission.MANAGE_CAJA)
  @ApiOperation({ summary: 'Rechazar rendición de caja chica' })
  @ApiHeader({ name: 'x-tenant-id', required: true })
  async rechazarRendicion(
    @Headers('x-tenant-id') empresaId: string,
    @Param('rendicionId') rendicionId: string,
    @CurrentUser('id') usuarioId: string,
    @Body() dto: RechazarRendicionDto,
  ) {
    return this.cajaChicaService.rechazarRendicion(
      empresaId,
      rendicionId,
      usuarioId,
      dto.observaciones,
    );
  }
}
