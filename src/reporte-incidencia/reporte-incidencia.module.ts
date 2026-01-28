import { Module } from '@nestjs/common';
import { ReporteIncidenciaController } from './reporte-incidencia.controller';
import { ReporteIncidenciaService } from './reporte-incidencia.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ReporteIncidenciaController],
  providers: [ReporteIncidenciaService],
  exports: [ReporteIncidenciaService],
})
export class ReporteIncidenciaModule {}
