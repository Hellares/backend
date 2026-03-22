import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { TipoCambioController } from './tipo-cambio.controller';
import { TipoCambioService } from './tipo-cambio.service';

@Module({
  imports: [PrismaModule, AuthModule, ConsultasExternasModule],
  controllers: [TipoCambioController],
  providers: [TipoCambioService],
  exports: [TipoCambioService],
})
export class TipoCambioModule {}
