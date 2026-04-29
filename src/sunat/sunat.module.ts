import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { FacturacionService } from './facturacion.service';
import { NubefactProvider } from './providers/nubefact.provider';
import { SyncrofactProvider } from './providers/syncrofact.provider';
import { FacturacionProviderFactory } from './providers/facturacion-provider.factory';
import { SunatController } from './sunat.controller';
import { ComunicacionBajaService } from './comunicacion-baja.service';
import { ComunicacionBajaController } from './comunicacion-baja.controller';

@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [SunatController, ComunicacionBajaController],
  providers: [
    // Registro de todos los providers soportados. El factory decide cuál usar
    // en cada operación según el proveedorEmisor del comprobante.
    NubefactProvider,
    SyncrofactProvider,
    FacturacionProviderFactory,
    FacturacionService,
    ComunicacionBajaService,
  ],
  exports: [FacturacionService, ComunicacionBajaService],
})
export class SunatModule {}
