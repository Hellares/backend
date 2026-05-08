import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConsultasExternasController } from './consultas-externas.controller';
import { ConsultasExternasService } from './consultas-externas.service';
import { AuthModule } from '../auth/auth.module';
import { throttlerConfig } from '../config/throttler.config';

@Module({
  // ThrottlerModule registrado localmente — `consultarDni` se expone público
  // (sin JwtAuthGuard) para el flujo de registro, y necesita rate limiting
  // propio. El resto de endpoints siguen protegidos por JwtAuthGuard.
  imports: [AuthModule, ThrottlerModule.forRoot(throttlerConfig)],
  controllers: [ConsultasExternasController],
  providers: [ConsultasExternasService],
  exports: [ConsultasExternasService],
})
export class ConsultasExternasModule {}
