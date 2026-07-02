import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { IntegracionYapeModule } from '../integracion-yape/integracion-yape.module';
import { CaracteristicaEmpresaModule } from '../caracteristica-empresa/caracteristica-empresa.module';
import { CotizacionModule } from '../cotizacion/cotizacion.module';
import { SolicitudCotizacionService } from './solicitud-cotizacion.service';
import { SolicitudCotizacionTasksService } from './solicitud-cotizacion-tasks.service';
import {
  SolicitudCotizacionClienteController,
  SolicitudCotizacionEmpresaController,
} from './solicitud-cotizacion.controller';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    NotificacionModule,
    IntegracionYapeModule,
    CaracteristicaEmpresaModule,
    CotizacionModule,
  ],
  controllers: [
    SolicitudCotizacionClienteController,
    SolicitudCotizacionEmpresaController,
  ],
  providers: [SolicitudCotizacionService, SolicitudCotizacionTasksService],
  exports: [SolicitudCotizacionService],
})
export class SolicitudCotizacionModule {}
