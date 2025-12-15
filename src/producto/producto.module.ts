import { Module } from '@nestjs/common';
import { ProductoController } from './producto.controller';
import { ProductoService } from './producto.service';
import { ProductoVarianteService } from './producto-variante.service';
import { ProductoAtributoService } from './producto-atributo.service';
import { ProductoComboService } from './producto-combo.service';
import { ProductoComboController } from './producto-combo.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ProductoController, ProductoComboController],
  providers: [
    ProductoService,
    ProductoVarianteService,
    ProductoAtributoService,
    ProductoComboService,
  ],
  exports: [
    ProductoService,
    ProductoVarianteService,
    ProductoAtributoService,
    ProductoComboService,
  ],
})
export class ProductoModule {}
