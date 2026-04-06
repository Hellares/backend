import {
  Controller, Get, Post, Put, Param, Query, Body, Headers,
  UseGuards, Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { GuiaRemisionService } from './guia-remision.service';
import { CreateGuiaRemisionDto } from './dto/create-guia-remision.dto';
import { QueryGuiasRemisionDto } from './dto/query-guias-remision.dto';

@Controller('guias-remision')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GuiaRemisionController {
  constructor(private readonly guiaRemisionService: GuiaRemisionService) {}

  // ── Guías de Remisión ──

  @Post()
  crear(
    @Headers('x-tenant-id') empresaId: string,
    @Body() dto: CreateGuiaRemisionDto,
    @Req() req: any,
  ) {
    return this.guiaRemisionService.crear(empresaId, dto, req.user?.id);
  }

  @Get()
  listar(
    @Headers('x-tenant-id') empresaId: string,
    @Query() query: QueryGuiasRemisionDto,
  ) {
    return this.guiaRemisionService.listar(empresaId, query);
  }

  @Get('prefill/venta/:ventaId')
  prefillDesdeVenta(
    @Headers('x-tenant-id') empresaId: string,
    @Param('ventaId') ventaId: string,
  ) {
    return this.guiaRemisionService.prefillDesdeVenta(ventaId, empresaId);
  }

  @Get(':id')
  obtener(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.guiaRemisionService.obtener(id, empresaId);
  }

  @Put(':id')
  actualizar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.guiaRemisionService.actualizar(id, empresaId, dto);
  }

  @Post(':id/enviar')
  enviar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.guiaRemisionService.enviarYConsultar(id, empresaId);
  }

  @Get(':id/consultar')
  consultar(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
  ) {
    return this.guiaRemisionService.consultar(id, empresaId);
  }

  @Post('enviar-pendientes')
  enviarPendientes(
    @Headers('x-tenant-id') empresaId: string,
  ) {
    return this.guiaRemisionService.enviarPendientes(empresaId);
  }

  // ── Ubigeos (catálogo estático) ──

  @Get('catalogos/ubigeos')
  getUbigeos() {
    return this.guiaRemisionService.getUbigeos();
  }

  // ── Vehículos de la empresa ──

  @Get('catalogos/vehiculos')
  listarVehiculos(@Headers('x-tenant-id') empresaId: string) {
    return this.guiaRemisionService.listarVehiculos(empresaId);
  }

  @Post('catalogos/vehiculos')
  crearVehiculo(
    @Headers('x-tenant-id') empresaId: string,
    @Body() data: { placaNumero: string; marca?: string; modelo?: string; tipo?: string; capacidadTM?: number; tuc?: string },
  ) {
    return this.guiaRemisionService.crearVehiculo(empresaId, data);
  }

  @Put('catalogos/vehiculos/:id')
  actualizarVehiculo(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.guiaRemisionService.actualizarVehiculo(empresaId, id, data);
  }

  // ── Conductores de la empresa ──

  @Get('catalogos/conductores')
  listarConductores(@Headers('x-tenant-id') empresaId: string) {
    return this.guiaRemisionService.listarConductores(empresaId);
  }

  @Post('catalogos/conductores')
  crearConductor(
    @Headers('x-tenant-id') empresaId: string,
    @Body() data: { tipoDocumento?: string; numeroDocumento: string; nombre: string; apellidos: string; numeroLicencia: string; categoriaLicencia?: string; empleadoId?: string },
  ) {
    return this.guiaRemisionService.crearConductor(empresaId, data);
  }

  @Put('catalogos/conductores/:id')
  actualizarConductor(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.guiaRemisionService.actualizarConductor(empresaId, id, data);
  }

  // ── Transportistas ──

  @Get('catalogos/transportistas')
  listarTransportistas(@Headers('x-tenant-id') empresaId: string) {
    return this.guiaRemisionService.listarTransportistas(empresaId);
  }

  @Post('catalogos/transportistas')
  crearTransportista(
    @Headers('x-tenant-id') empresaId: string,
    @Body() data: { ruc: string; razonSocial: string; direccion?: string; telefono?: string; email?: string; registroMtc?: string },
  ) {
    return this.guiaRemisionService.crearTransportista(empresaId, data);
  }

  @Put('catalogos/transportistas/:id')
  actualizarTransportista(
    @Headers('x-tenant-id') empresaId: string,
    @Param('id') id: string,
    @Body() data: any,
  ) {
    return this.guiaRemisionService.actualizarTransportista(empresaId, id, data);
  }
}
