import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { CajaChicaController } from './caja-chica.controller';
import { CajaChicaService } from './caja-chica.service';

@Module({
  imports: [PrismaModule, AuthModule, CajaModule],
  controllers: [CajaChicaController],
  providers: [CajaChicaService],
  exports: [CajaChicaService],
})
export class CajaChicaModule {}
