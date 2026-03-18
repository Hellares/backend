import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { MarketplaceUsuarioService } from './marketplace-usuario.service';

@ApiTags('Marketplace Usuario')
@Controller('marketplace/usuario')
@UseGuards(JwtAuthGuard)
export class MarketplaceUsuarioController {
  constructor(private readonly service: MarketplaceUsuarioService) {}

  // ─── Favoritos ───

  @Post('favoritos/:productoId')
  @ApiOperation({ summary: 'Toggle favorito (agregar/quitar)' })
  toggleFavorito(
    @CurrentUser('sub') usuarioId: string,
    @Param('productoId') productoId: string,
  ) {
    return this.service.toggleFavorito(usuarioId, productoId);
  }

  @Get('favoritos')
  @ApiOperation({ summary: 'Listar mis favoritos' })
  listarFavoritos(
    @CurrentUser('sub') usuarioId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listarFavoritos(
      usuarioId,
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 20,
    );
  }

  @Get('favoritos/ids')
  @ApiOperation({ summary: 'Obtener IDs de productos favoritos' })
  getFavoritosIds(@CurrentUser('sub') usuarioId: string) {
    return this.service.getFavoritosIds(usuarioId);
  }

  // ─── Productos vistos ───

  @Post('vistos/:productoId')
  @ApiOperation({ summary: 'Registrar producto visto' })
  registrarVisto(
    @CurrentUser('sub') usuarioId: string,
    @Param('productoId') productoId: string,
  ) {
    return this.service.registrarVisto(usuarioId, productoId);
  }

  @Get('vistos')
  @ApiOperation({ summary: 'Listar productos vistos recientemente' })
  listarVistos(
    @CurrentUser('sub') usuarioId: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.listarVistos(usuarioId, limit ? parseInt(limit) : 20);
  }
}
