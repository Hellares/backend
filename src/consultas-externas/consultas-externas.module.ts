import { Module } from '@nestjs/common';
import { ConsultasExternasController } from './consultas-externas.controller';
import { ConsultasExternasService } from './consultas-externas.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ConsultasExternasController],
  providers: [ConsultasExternasService],
  exports: [ConsultasExternasService],
})
export class ConsultasExternasModule {}
