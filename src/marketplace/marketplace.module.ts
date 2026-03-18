import { Module } from '@nestjs/common';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import { PreguntaProductoController } from './pregunta-producto.controller';
import { PreguntaProductoService } from './pregunta-producto.service';
import { OpinionProductoController } from './opinion-producto.controller';
import { OpinionProductoService } from './opinion-producto.service';
import { MarketplaceUsuarioController } from './marketplace-usuario.controller';
import { MarketplaceUsuarioService } from './marketplace-usuario.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MarketplaceController, PreguntaProductoController, OpinionProductoController, MarketplaceUsuarioController],
  providers: [MarketplaceService, PreguntaProductoService, OpinionProductoService, MarketplaceUsuarioService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}
