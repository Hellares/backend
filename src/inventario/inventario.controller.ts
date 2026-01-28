import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
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
import { EstadoInventario } from '@prisma/client';

@Controller('inventarios')
@UseGuards(JwtAuthGuard)
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  /**
   * Crear un nuevo inventario
   * POST /inventarios
   */
  @Post()
  async crear(@Request() req, @Body() dto: CrearInventarioDto) {
    const empresaId = req.user.empresaId;
    const usuarioId = req.user.userId;
    return this.inventarioService.crear(empresaId, dto, usuarioId);
  }

  /**
   * Listar inventarios con filtros
   * GET /inventarios
   */
  @Get()
  async listar(
    @Request() req,
    @Query('sedeId') sedeId?: string,
    @Query('estado') estado?: EstadoInventario,
    @Query('tipoInventario') tipoInventario?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
  ) {
    const empresaId = req.user.empresaId;
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
  async obtenerPorId(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.inventarioService.obtenerPorId(empresaId, id);
  }

  /**
   * Actualizar información del inventario
   * PUT /inventarios/:id
   */
  @Put(':id')
  async actualizar(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: ActualizarInventarioDto,
  ) {
    const empresaId = req.user.empresaId;
    return this.inventarioService.actualizar(empresaId, id, dto);
  }

  /**
   * Iniciar inventario (cambiar a EN_PROCESO)
   * POST /inventarios/:id/iniciar
   */
  @Post(':id/iniciar')
  async iniciar(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.inventarioService.iniciar(empresaId, id);
  }

  /**
   * Registrar conteo de un item
   * POST /inventarios/:id/items/:itemId/contar
   */
  @Post(':id/items/:itemId/contar')
  async registrarConteo(
    @Request() req,
    @Param('id') inventarioId: string,
    @Param('itemId') itemId: string,
    @Body() dto: RegistrarConteoDto,
  ) {
    const empresaId = req.user.empresaId;
    const usuarioId = req.user.userId;
    return this.inventarioService.registrarConteo(
      empresaId,
      inventarioId,
      itemId,
      dto,
      usuarioId,
    );
  }

  /**
   * Finalizar conteo
   * POST /inventarios/:id/finalizar-conteo
   */
  @Post(':id/finalizar-conteo')
  async finalizarConteo(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.inventarioService.finalizarConteo(empresaId, id);
  }

  /**
   * Aprobar inventario
   * POST /inventarios/:id/aprobar
   */
  @Post(':id/aprobar')
  async aprobar(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    const usuarioId = req.user.userId;
    return this.inventarioService.aprobar(empresaId, id, usuarioId);
  }

  /**
   * Aplicar ajustes al sistema
   * POST /inventarios/:id/aplicar-ajustes
   */
  @Post(':id/aplicar-ajustes')
  async aplicarAjustes(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    const usuarioId = req.user.userId;
    return this.inventarioService.aplicarAjustes(empresaId, id, usuarioId);
  }

  /**
   * Cancelar inventario
   * POST /inventarios/:id/cancelar
   */
  @Post(':id/cancelar')
  async cancelar(@Request() req, @Param('id') id: string) {
    const empresaId = req.user.empresaId;
    return this.inventarioService.cancelar(empresaId, id);
  }
}
