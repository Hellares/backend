import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { OrdenServicioService } from './orden-servicio.service';

/**
 * "Mis servicios" del comprador en la tienda web: sus órdenes de servicio en
 * ESA empresa (por subdominio). La sesión de la tienda no trae empresa, por
 * eso no sirve `ordenes-servicio/mis-ordenes` (pide x-tenant-id y el
 * TenantAuthGuard del app). La pertenencia se valida en el servicio: la orden
 * tiene que ser de la EmpresaPersona de su persona.
 */
@ApiTags('Tienda web - Mis servicios')
@Controller('marketplace/empresas/:subdominio/mis-servicios')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MisServiciosTiendaController {
  constructor(private readonly ordenes: OrdenServicioService) {}

  @Get()
  @ApiOperation({ summary: 'Mis órdenes de servicio en esta tienda' })
  async listar(@Param('subdominio') subdominio: string, @CurrentUser() user: { personaId: string }) {
    const empresaId = await this.ordenes.empresaIdTienda(subdominio);
    return this.ordenes.listarMisServiciosTienda(empresaId, user.personaId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una de mis órdenes' })
  async detalle(
    @Param('subdominio') subdominio: string,
    @Param('id') id: string,
    @CurrentUser() user: { personaId: string },
  ) {
    const empresaId = await this.ordenes.empresaIdTienda(subdominio);
    return this.ordenes.detalleMiServicioTienda(empresaId, user.personaId, id);
  }

  @Get(':id/mensajes')
  @ApiOperation({ summary: 'Chat con el técnico (marca leídos los del técnico)' })
  async mensajes(
    @Param('subdominio') subdominio: string,
    @Param('id') id: string,
    @CurrentUser() user: { personaId: string },
  ) {
    const empresaId = await this.ordenes.empresaIdTienda(subdominio);
    return this.ordenes.listarMensajesCliente(empresaId, user.personaId, id);
  }

  @Post(':id/mensajes')
  @ApiOperation({ summary: 'Escribirle al técnico' })
  async enviarMensaje(
    @Param('subdominio') subdominio: string,
    @Param('id') id: string,
    @Body('contenido') contenido: string,
    @CurrentUser() user: { personaId: string; sub: string },
  ) {
    const texto = typeof contenido === 'string' ? contenido.trim() : '';
    if (!texto) throw new BadRequestException('El mensaje no puede estar vacío');
    if (texto.length > 1000) throw new BadRequestException('El mensaje es muy largo (máximo 1000 caracteres)');
    const empresaId = await this.ordenes.empresaIdTienda(subdominio);
    return this.ordenes.enviarMensajeCliente(empresaId, user.personaId, user.sub, id, texto);
  }

  @Post(':id/aprobar')
  @ApiOperation({ summary: 'Aprobar el presupuesto (ESPERANDO_APROBACION → EN_REPARACION)' })
  async aprobar(
    @Param('subdominio') subdominio: string,
    @Param('id') id: string,
    @CurrentUser() user: { personaId: string; sub: string },
  ) {
    const empresaId = await this.ordenes.empresaIdTienda(subdominio);
    return this.ordenes.aprobarPresupuestoCliente(empresaId, user.personaId, user.sub, id);
  }
}
