import { Global, Module } from '@nestjs/common';
import { UbigeoService } from './ubigeo.service';

/**
 * Catálogo de ubigeo compartido. Global porque es data estática sin
 * dependencias: lo usan guía de remisión y delivery local, y no tiene
 * sentido que cada módulo cargue su propia copia del archivo.
 */
@Global()
@Module({
  providers: [UbigeoService],
  exports: [UbigeoService],
})
export class UbigeoModule {}
