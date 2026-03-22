import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UbicacionAlmacenController } from './ubicacion-almacen.controller';
import { UbicacionAlmacenService } from './ubicacion-almacen.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UbicacionAlmacenController],
  providers: [UbicacionAlmacenService],
  exports: [UbicacionAlmacenService],
})
export class UbicacionAlmacenModule {}
