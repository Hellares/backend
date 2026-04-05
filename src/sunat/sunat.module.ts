import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { FacturacionService } from './facturacion.service';
import { NubefactProvider } from './providers/nubefact.provider';
import { FACTURACION_PROVIDER } from './facturacion-provider.interface';
import { SunatController } from './sunat.controller';

@Module({
  imports: [PrismaModule, LoggerModule],
  controllers: [SunatController],
  providers: [
    // Provider de facturación: cambiar useClass para otro proveedor (EfactProvider, etc.)
    { provide: FACTURACION_PROVIDER, useClass: NubefactProvider },
    FacturacionService,
  ],
  exports: [FacturacionService],
})
export class SunatModule {}
