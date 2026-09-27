import {
  BadRequestException, Body, Controller, Get, Param, Post, Query, UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MisComprasTiendaService } from './mis-compras-tienda.service';
import { ReportarAbonoDto } from './dto/reportar-abono.dto';

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

  // Antes de `:id` (igual que estado-cuenta).
  @Get('medios-pago')
  @ApiOperation({ summary: 'QR de Yape/Plin y cuentas bancarias de la tienda para abonar' })
  async mediosPago(@Param('subdominio') subdominio: string) {
    const empresaId = await this.compras.empresaIdTienda(subdominio);
    return this.compras.mediosPago(empresaId);
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

  @Post(':id/abonos')
  @ApiOperation({ summary: 'Reportar un abono (Yape/Plin/transferencia) con 1 a 3 capturas; la tienda lo aprueba' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    // Hasta 3: un abono grande puede ir en varios Yape, cada uno con su captura.
    FilesInterceptor('comprobantes', 3, {
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          cb(new BadRequestException('La captura tiene que ser una imagen (JPG, PNG o WebP)'), false);
        } else {
          cb(null, true);
        }
      },
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async reportarAbono(
    @Param('subdominio') subdominio: string,
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: ReportarAbonoDto,
    @CurrentUser() user: { personaId: string; sub: string },
  ) {
    if (!files?.length) throw new BadRequestException('Adjunta la captura de tu pago');
    const empresaId = await this.compras.empresaIdTienda(subdominio);
    return this.compras.reportarAbono(empresaId, user.personaId, user.sub, id, dto, files);
  }
}
