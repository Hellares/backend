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
import { SedeContextHelper } from '../common/helpers/sede-context.helper';
// Nuevos servicios especializados (Modular Monolith)
import { ProductoCatalogService } from './producto-catalog.service';
import { ProductoInventoryService } from './producto-inventory.service';
import { ProductoPricingService } from './producto-pricing.service';
import { ProductoPrecioHistorialService } from './producto-precio-historial.service';

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
    // Facade (orquestador)
    ProductoService,

    // Servicios especializados (Modular Monolith)
    ProductoCatalogService,
    ProductoInventoryService,
    ProductoPricingService,
    ProductoPrecioHistorialService,

    // Servicios existentes
    ProductoVarianteService,
    ProductoAtributoService,
    ProductoAtributoValorService,
    ProductoComboService,
    ProductoAtributoPlantillaService,
    PrecioNivelService,
    ConfiguracionPrecioService,
    PlanLimitsService,

    // Helpers
    SedeContextHelper,
  ],
  exports: [
    // Facade (para otros módulos)
    ProductoService,

    // Servicios especializados (opcional - si otros módulos los necesitan)
    ProductoCatalogService,
    ProductoInventoryService,
    ProductoPricingService,
    ProductoPrecioHistorialService,

    // Servicios existentes
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
