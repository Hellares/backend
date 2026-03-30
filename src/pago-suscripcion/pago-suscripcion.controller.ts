import {
  Controller, Get, Post, Param, Query, Body, UseGuards, UseInterceptors, UploadedFile, Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PagoSuscripcionService } from './pago-suscripcion.service';
import { CrearSolicitudPagoDto } from './dto/crear-solicitud-pago.dto';
import { AuditInterceptor } from '../audit/audit.interceptor';

@ApiTags('Pagos Suscripcion')
@ApiBearerAuth('access-token')
@Controller('pagos-suscripcion')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditInterceptor)
export class PagoSuscripcionController {
  constructor(private readonly pagoService: PagoSuscripcionService) {}

  @Post('solicitar')
  async solicitarPago(
    @Headers('x-tenant-id') empresaId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CrearSolicitudPagoDto,
  ) {
    return this.pagoService.solicitarPago(empresaId, userId, dto);
  }

  @Post(':id/comprobante')
  @UseInterceptors(FileInterceptor('file'))
  async subirComprobante(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @UploadedFile() file: any,
  ) {
    if (!file) throw new Error('Archivo requerido');
    return this.pagoService.subirComprobante(id, userId, file);
  }

  @Get('mis-pagos')
  async getMisPagos(
    @Headers('x-tenant-id') empresaId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.pagoService.getMisPagos(
      empresaId,
      page ? parseInt(page) : 1,
      pageSize ? parseInt(pageSize) : 20,
    );
  }

  @Get(':id')
  async getPagoById(@Param('id') id: string) {
    return this.pagoService.getPagoById(id);
  }
}
