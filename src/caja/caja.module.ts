import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { CajaController } from './caja.controller';
import { CajaService } from './caja.service';
import { SedeAccessGuard } from '../auth/guards/sede-access.guard';

@Module({
  imports: [PrismaModule, AuthModule, NotificacionModule],
  controllers: [CajaController],
  providers: [CajaService, SedeAccessGuard],
  exports: [CajaService],
})
export class CajaModule {}
