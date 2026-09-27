import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MisComprasTiendaService } from './mis-compras-tienda.service';

/**
 * "Mis compras" del comprador en la tienda web (por subdominio): sus ventas
 * pagadas y a crédito, con lo que le debe a la tienda. La sesión de la tienda
 * no trae empresa: el acceso se valida en el servicio (igual que Mis servicios).
 */
@ApiTags('Tienda web - Mis compras')
@Controller('marketplace/empresas/:subdominio/mis-compras')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MisComprasTiendaController {
  constructor(private readonly compras: MisComprasTiendaService) {}

  @Get()
  @ApiOperation({ summary: 'Mis compras en esta tienda + resumen de deuda' })
  async listar(@Param('subdominio') subdominio: string, @CurrentUser() user: { personaId: string }) {
    const empresaId = await this.compras.empresaIdTienda(subdominio);
    return this.compras.listar(empresaId, user.personaId);
  }

  // Antes de `:id`: si no, "estado-cuenta" se tomaría como el id de una venta.
  @Get('estado-cuenta')
  @ApiOperation({ summary: 'Estado de cuenta (crédito) personal o de una empresa donde es contacto' })
  async estadoCuenta(
    @Param('subdominio') subdominio: string,
    @Query('empresa') clienteEmpresaId: string | undefined,
    @CurrentUser() user: { personaId: string },
  ) {
    const empresaId = await this.compras.empresaIdTienda(subdominio);
    return this.compras.estadoCuenta(empresaId, user.personaId, clienteEmpresaId?.trim() || null);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una compra: productos, cuotas y pagos' })
  async detalle(
    @Param('subdominio') subdominio: string,
    @Param('id') id: string,
    @CurrentUser() user: { personaId: string },
  ) {
    const empresaId = await this.compras.empresaIdTienda(subdominio);
    return this.compras.detalle(empresaId, user.personaId, id);
  }
}
