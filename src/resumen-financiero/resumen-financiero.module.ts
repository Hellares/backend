import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { ResumenFinancieroController } from './resumen-financiero.controller';
import { ResumenFinancieroService } from './resumen-financiero.service';
import { AlertasFinancierasTasksService } from './alertas-financieras-tasks.service';

@Module({
  imports: [PrismaModule, AuthModule, NotificacionModule],
  controllers: [ResumenFinancieroController],
  providers: [ResumenFinancieroService, AlertasFinancierasTasksService],
})
export class ResumenFinancieroModule {}
