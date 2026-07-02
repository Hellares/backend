import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PedidoMarketplaceService } from './pedido-marketplace.service';
import { CheckoutDto, SubirComprobanteDto } from './dto/checkout.dto';
import { EstadoPedidoMarketplace } from '@prisma/client';

@ApiTags('Marketplace - Pedidos')
@Controller('marketplace')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PedidoMarketplaceController {
  constructor(private readonly pedidoService: PedidoMarketplaceService) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Crear pedidos desde el carrito' })
  async checkout(
    @CurrentUser('sub') usuarioId: string,
    @Body() dto: CheckoutDto,
  ) {
    return this.pedidoService.checkout(usuarioId, dto);
  }

  @Get('mis-pedidos')
  @ApiOperation({ summary: 'Listar mis pedidos' })
  async misPedidos(
    @CurrentUser('sub') usuarioId: string,
    @Query('estado') estado?: EstadoPedidoMarketplace,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.pedidoService.misPedidos(
      usuarioId,
      estado,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Get('mis-pedidos/:id')
  @ApiOperation({ summary: 'Detalle de un pedido' })
  async miPedidoDetalle(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') pedidoId: string,
  ) {
    return this.pedidoService.miPedidoDetalle(usuarioId, pedidoId);
  }

  @Post('mis-pedidos/:id/cobro-yape')
  @ApiOperation({
    summary:
      'Iniciar cobro Yape/Plin automático (api-yape). Devuelve payAmount exacto + QR; el webhook valida el pago solo.',
  })
  async cobroYapePedido(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') pedidoId: string,
  ) {
    return this.pedidoService.cobroYapePedido(usuarioId, pedidoId);
  }

  @Post('mis-pedidos/:id/comprobante-pago')
  @ApiOperation({ summary: 'Subir comprobante de pago (imagen Yape/Plin)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
          cb(new BadRequestException('Solo se permiten imágenes (JPG, PNG, GIF, WebP)'), false);
        } else {
          cb(null, true);
        }
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máximo
    }),
  )
  async subirComprobantePago(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') pedidoId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: SubirComprobanteDto,
  ) {
    if (!file) {
      throw new BadRequestException('Debe adjuntar la imagen del comprobante');
    }
    return this.pedidoService.subirComprobantePago(
      usuarioId,
      pedidoId,
      file,
      dto.metodoPago,
    );
  }

  @Post('mis-pedidos/:id/cancelar')
  @ApiOperation({ summary: 'Cancelar pedido (solo si pendiente de pago)' })
  async cancelarPedido(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') pedidoId: string,
  ) {
    return this.pedidoService.cancelarPedido(usuarioId, pedidoId);
  }

  @Post('mis-pedidos/:id/confirmar-recepcion')
  @ApiOperation({ summary: 'Confirmar recepción del pedido' })
  async confirmarRecepcion(
    @CurrentUser('sub') usuarioId: string,
    @Param('id') pedidoId: string,
  ) {
    return this.pedidoService.confirmarRecepcion(usuarioId, pedidoId);
  }
}
