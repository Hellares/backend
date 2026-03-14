import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { VinculacionController } from './vinculacion.controller';
import { VinculacionService } from './vinculacion.service';

@Module({
  imports: [PrismaModule, AuthModule, ConfiguracionCodigosModule],
  controllers: [VinculacionController],
  providers: [VinculacionService],
  exports: [VinculacionService],
})
export class VinculacionModule {}
