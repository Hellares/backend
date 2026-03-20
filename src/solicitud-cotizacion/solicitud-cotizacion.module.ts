import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { NotificacionModule } from '../notificacion/notificacion.module';
import { SolicitudCotizacionService } from './solicitud-cotizacion.service';
import {
  SolicitudCotizacionClienteController,
  SolicitudCotizacionEmpresaController,
} from './solicitud-cotizacion.controller';

@Module({
  imports: [PrismaModule, AuthModule, NotificacionModule],
  controllers: [
    SolicitudCotizacionClienteController,
    SolicitudCotizacionEmpresaController,
  ],
  providers: [SolicitudCotizacionService],
  exports: [SolicitudCotizacionService],
})
export class SolicitudCotizacionModule {}
