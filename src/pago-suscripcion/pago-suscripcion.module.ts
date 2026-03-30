import { Module } from '@nestjs/common';
import { PagoSuscripcionController } from './pago-suscripcion.controller';
import { PagoSuscripcionService } from './pago-suscripcion.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [PagoSuscripcionController],
  providers: [PagoSuscripcionService],
  exports: [PagoSuscripcionService],
})
export class PagoSuscripcionModule {}
