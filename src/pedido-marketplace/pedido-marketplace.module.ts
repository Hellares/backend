import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { StorageModule } from '../storage/storage.module';
import { CarritoController } from './carrito.controller';
import { CarritoService } from './carrito.service';
import { PedidoMarketplaceController } from './pedido-marketplace.controller';
import { PedidoMarketplaceService } from './pedido-marketplace.service';
import { PedidoMarketplaceEmpresaController } from './pedido-marketplace-empresa.controller';
import { PedidoMarketplaceEmpresaService } from './pedido-marketplace-empresa.service';
import { PedidoMarketplaceTasksService } from './pedido-marketplace-tasks.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    ConfiguracionCodigosModule,
    NotificacionModule,
    StorageModule,
  ],
  controllers: [
    CarritoController,
    PedidoMarketplaceController,
    PedidoMarketplaceEmpresaController,
  ],
  providers: [
    CarritoService,
    PedidoMarketplaceService,
    PedidoMarketplaceEmpresaService,
    PedidoMarketplaceTasksService,
  ],
  exports: [CarritoService, PedidoMarketplaceService],
})
export class PedidoMarketplaceModule {}
