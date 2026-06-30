import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { ConfiguracionCamposService } from './configuracion-campos.service';
import { ConfiguracionCamposController } from './configuracion-campos.controller';
import { ServicioService } from './servicio.service';
import { ServicioController } from './servicio.controller';
import { OrdenServicioService } from './orden-servicio.service';
import { OrdenServicioController } from './orden-servicio.controller';
import { ServicioComponenteService } from './servicio-componente.service';
import { PlantillaServicioService } from './plantilla-servicio.service';
import { PlantillaServicioController } from './plantilla-servicio.controller';
import { TipoComponenteService } from './tipo-componente.service';
import { TipoComponenteController } from './tipo-componente.controller';
import { ComponenteService } from './componente.service';
import { ComponenteController } from './componente.controller';
import { EstadisticasServicioService } from './estadisticas-servicio.service';
import { EstadisticasServicioController } from './estadisticas-servicio.controller';
import { ModeloEquipoService } from './modelo-equipo.service';
import { ModeloEquipoController } from './modelo-equipo.controller';
import { AvisoMantenimientoModule } from '../aviso-mantenimiento/aviso-mantenimiento.module';
import { CajaModule } from '../caja/caja.module';
import { SedeAccessGuard } from '../auth/guards/sede-access.guard';

@Module({
  imports: [PrismaModule, AuthModule, ConfiguracionCodigosModule, forwardRef(() => AvisoMantenimientoModule), CajaModule],
  controllers: [
    ConfiguracionCamposController,
    ServicioController,
    EstadisticasServicioController,
    OrdenServicioController,
    PlantillaServicioController,
    TipoComponenteController,
    ComponenteController,
    ModeloEquipoController,
  ],
  providers: [
    ConfiguracionCamposService,
    ServicioService,
    OrdenServicioService,
    ServicioComponenteService,
    PlantillaServicioService,
    PlanLimitsService,
    TipoComponenteService,
    ComponenteService,
    EstadisticasServicioService,
    ModeloEquipoService,
    SedeAccessGuard,
  ],
  exports: [
    ConfiguracionCamposService,
    ServicioService,
    OrdenServicioService,
    ServicioComponenteService,
    PlantillaServicioService,
    TipoComponenteService,
    ComponenteService,
    EstadisticasServicioService,
    ModeloEquipoService,
  ],
})
export class ServicioModule {}
