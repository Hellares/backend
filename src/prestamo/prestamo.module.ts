import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { PrestamoController } from './prestamo.controller';
import { PrestamoService } from './prestamo.service';

@Module({
  imports: [PrismaModule, AuthModule, CajaModule],
  controllers: [PrestamoController],
  providers: [PrestamoService],
})
export class PrestamoModule {}
