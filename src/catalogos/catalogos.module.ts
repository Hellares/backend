import { Module } from '@nestjs/common';
import { CatalogosController } from './catalogos.controller';
import { CatalogosService } from './catalogos.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ProductoModule } from '../producto/producto.module';

@Module({
  // ProductoModule aporta TextoBusquedaService: renombrar una marca o una
  // categoría obliga a rehacer el texto de búsqueda de todos sus productos.
  imports: [PrismaModule, AuthModule, ProductoModule],
  controllers: [CatalogosController],
  providers: [CatalogosService],
  exports: [CatalogosService],
})
export class CatalogosModule {}
