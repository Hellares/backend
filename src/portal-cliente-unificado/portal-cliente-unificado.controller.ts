import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PortalClienteUnificadoService } from './portal-cliente-unificado.service';

@ApiTags('Portal Cliente Unificado')
@Controller('portal-cliente')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PortalClienteUnificadoController {
  constructor(private readonly service: PortalClienteUnificadoService) {}

  @Get('mi-actividad')
  @ApiOperation({
    summary: 'Obtener actividad del cliente en todas sus empresas',
    description: 'Retorna cotizaciones, ventas, citas y órdenes de servicio agrupadas por empresa',
  })
  async getActividadUnificada(@CurrentUser('sub') usuarioId: string) {
    return this.service.getActividadUnificada(usuarioId);
  }
}
