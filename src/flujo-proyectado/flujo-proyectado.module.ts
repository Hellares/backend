import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { FlujoProyectadoController } from './flujo-proyectado.controller';
import { FlujoProyectadoService } from './flujo-proyectado.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [FlujoProyectadoController],
  providers: [FlujoProyectadoService],
})
export class FlujoProyectadoModule {}
