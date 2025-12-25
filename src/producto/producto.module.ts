import { Module } from '@nestjs/common';
import { ProductoController } from './producto.controller';
import { ProductoService } from './producto.service';
import { ProductoVarianteService } from './producto-variante.service';
import { ProductoAtributoService } from './producto-atributo.service';
import { ProductoAtributoValorService } from './producto-atributo-valor.service';
import { ProductoAtributoController } from './producto-atributo.controller';
import { ProductoComboService } from './producto-combo.service';
import { ProductoComboController } from './producto-combo.controller';
import { ProductoAtributoPlantillaService } from './producto-atributo-plantilla.service';
import { ProductoAtributoPlantillaController } from './producto-atributo-plantilla.controller';
import { PrecioNivelService } from './precio-nivel.service';
import { ConfiguracionPrecioService } from './configuracion-precio.service';
import { ConfiguracionPrecioController } from './configuracion-precio.controller';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [
    ProductoController,
    ProductoComboController,
    ProductoAtributoController,
    ProductoAtributoPlantillaController,
    ConfiguracionPrecioController,
  ],
  providers: [
    ProductoService,
    ProductoVarianteService,
    ProductoAtributoService,
    ProductoAtributoValorService,
    ProductoComboService,
    ProductoAtributoPlantillaService,
    PrecioNivelService,
    ConfiguracionPrecioService,
    PlanLimitsService,
  ],
  exports: [
    ProductoService,
    ProductoVarianteService,
    ProductoAtributoService,
    ProductoAtributoValorService,
    ProductoComboService,
    ProductoAtributoPlantillaService,
    PrecioNivelService,
    ConfiguracionPrecioService,
  ],
})
export class ProductoModule {}
