import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { CajaModule } from '../caja/caja.module';
import { TercerizacionController } from './tercerizacion.controller';
import { TercerizacionService } from './tercerizacion.service';

@Module({
  imports: [PrismaModule, AuthModule, ConfiguracionCodigosModule, CajaModule],
  controllers: [TercerizacionController],
  providers: [TercerizacionService],
  exports: [TercerizacionService],
})
export class TercerizacionModule {}
