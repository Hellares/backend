import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  Headers,
  UseGuards,
  Request,
} from '@nestjs/common';
import { InventarioService } from './inventario.service';
import {
  CrearInventarioDto,
  ActualizarInventarioDto,
  RegistrarConteoDto,
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantAuthGuard } from '../auth/guards/tenant-auth.guard';
import { EstadoInventario } from '@prisma/client';

@Controller('inventarios')
@UseGuards(JwtAuthGuard, TenantAuthGuard)
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  /**
   * Crear un nuevo inventario
   * POST /inventarios
   */
  @Post()
  async crear(
    @Request() req,
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CrearInventarioDto,
  ) {
    return this.inventarioService.crear(empresaId, dto, req.user.userId);
  }

  /**
   * Listar inventarios con filtros
   * GET /inventarios
   */
  @Get()
  async listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query('sedeId') sedeId?: string,
    @Query('estado') estado?: EstadoInventario,
    @Query('tipoInventario') tipoInventario?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    return this.inventarioService.listar(empresaId, {
      sedeId,
      estado,
      tipoInventario,
      fechaDesde,
      fechaHasta,
    });
  }

  /**
   * Obtener detalle de un inventario específico
   * GET /inventarios/:id
   */
  @Get(':id')
  async obtenerPorId(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.inventarioService.obtenerPorId(empresaId, id);
  }

  /**
   * Actualizar información del inventario
   * PUT /inventarios/:id
   */
  @Put(':id')
  async actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: ActualizarInventarioDto,
  ) {
    return this.inventarioService.actualizar(empresaId, id, dto);
  }

  /**
   * Iniciar inventario (cambiar a EN_PROCESO)
   * POST /inventarios/:id/iniciar
   */
  @Post(':id/iniciar')
  async iniciar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.inventarioService.iniciar(empresaId, id);
  }

  /**
   * Registrar conteo de un item
   * POST /inventarios/:id/items/:itemId/contar
   */
  @Post(':id/items/:itemId/contar')
  async registrarConteo(
    @Request() req,
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') inventarioId: string,
    @Param('itemId') itemId: string,
    @Body() dto: RegistrarConteoDto,
  ) {
    return this.inventarioService.registrarConteo(
      empresaId,
      inventarioId,
      itemId,
      dto,
      req.user.userId,
    );
  }

  /**
   * Finalizar conteo
   * POST /inventarios/:id/finalizar-conteo
   */
  @Post(':id/finalizar-conteo')
  async finalizarConteo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.inventarioService.finalizarConteo(empresaId, id);
  }

  /**
   * Aprobar inventario
   * POST /inventarios/:id/aprobar
   */
  @Post(':id/aprobar')
  async aprobar(
    @Request() req,
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.inventarioService.aprobar(empresaId, id, req.user.userId);
  }

  /**
   * Aplicar ajustes al sistema
   * POST /inventarios/:id/aplicar-ajustes
   */
  @Post(':id/aplicar-ajustes')
  async aplicarAjustes(
    @Request() req,
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.inventarioService.aplicarAjustes(empresaId, id, req.user.userId);
  }

  /**
   * Cancelar inventario
   * POST /inventarios/:id/cancelar
   */
  @Post(':id/cancelar')
  async cancelar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.inventarioService.cancelar(empresaId, id);
  }
}
