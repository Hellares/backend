import { Module } from '@nestjs/common';
import { CitaController } from './cita.controller';
import { CitaService } from './cita.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';

@Module({
  imports: [PrismaModule, AuthModule, ConfiguracionCodigosModule],
  controllers: [CitaController],
  providers: [CitaService],
  exports: [CitaService],
})
export class CitaModule {}
