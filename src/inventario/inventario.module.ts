import { Module } from '@nestjs/common';
import { InventarioController } from './inventario.controller';
import { InventarioService } from './inventario.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';

@Module({
  imports: [PrismaModule, ConfiguracionCodigosModule],
  controllers: [InventarioController],
  providers: [InventarioService],
  exports: [InventarioService],
})
export class InventarioModule {}
