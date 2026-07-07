import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CaracteristicaEmpresaModule } from '../caracteristica-empresa/caracteristica-empresa.module';
import { BannerMarketplaceService } from './banner-marketplace.service';
import {
  AdminAvisoPlataformaController,
  AdminLottieFondoController,
  EmpresaBannerController,
  MarketplaceBannerPublicController,
} from './banner-marketplace.controller';

@Module({
  imports: [PrismaModule, AuthModule, CaracteristicaEmpresaModule],
  controllers: [
    MarketplaceBannerPublicController,
    EmpresaBannerController,
    AdminAvisoPlataformaController,
    AdminLottieFondoController,
  ],
  providers: [BannerMarketplaceService],
  exports: [BannerMarketplaceService],
})
export class BannerMarketplaceModule {}
