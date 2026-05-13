import { Module, Global } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { FirebaseAdminService } from './firebase-admin.service';
import { NotificacionService } from './notificacion.service';
import { NotificacionController } from './notificacion.controller';
import { RealtimeInvalidationService } from './realtime-invalidation.service';

@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificacionController],
  providers: [
    FirebaseAdminService,
    NotificacionService,
    RealtimeInvalidationService,
  ],
  exports: [
    NotificacionService,
    FirebaseAdminService,
    RealtimeInvalidationService,
  ],
})
export class NotificacionModule {}
