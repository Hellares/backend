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
import { AuthModule } from '../auth/auth.module';
import { SedeContextHelper } from '../common/helpers/sede-context.helper';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
// Nuevos servicios especializados (Modular Monolith)
import { ProductoCatalogService } from './producto-catalog.service';
import { ProductoInventoryService } from './producto-inventory.service';
import { ProductoPricingService } from './producto-pricing.service';
import { ProductoPrecioHistorialService } from './producto-precio-historial.service';
import { CompatibilidadService } from './compatibilidad.service';
import { CompatibilidadController } from './compatibilidad.controller';
import { ProductoBulkUploadService } from './producto-bulk-upload.service';
import { ProductoTrazabilidadService } from './producto-trazabilidad.service';
import { TextoBusquedaService } from './texto-busqueda.service';

@Module({
  imports: [PrismaModule, AuthModule, ConfiguracionCodigosModule],
  controllers: [
    ProductoController,
    ProductoComboController,
    ProductoAtributoController,
    ProductoAtributoPlantillaController,
    ConfiguracionPrecioController,
    CompatibilidadController,
  ],
  providers: [
    // Facade (orquestador)
    ProductoService,

    // Servicios especializados (Modular Monolith)
    ProductoCatalogService,
    ProductoInventoryService,
    ProductoPricingService,
    ProductoPrecioHistorialService,

    // Carga masiva
    ProductoBulkUploadService,

    // Servicios existentes
    ProductoVarianteService,
    ProductoAtributoService,
    ProductoAtributoValorService,
    ProductoComboService,
    ProductoAtributoPlantillaService,
    PrecioNivelService,
    ConfiguracionPrecioService,
    CompatibilidadService,
    PlanLimitsService,

    // Trazabilidad / Ficha 360
    ProductoTrazabilidadService,

    // Índice de búsqueda unificada
    TextoBusquedaService,

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
    CompatibilidadService,

    // Lo usa CatalogosModule al renombrar una marca o categoría.
    TextoBusquedaService,
  ],
})
export class ProductoModule {}
