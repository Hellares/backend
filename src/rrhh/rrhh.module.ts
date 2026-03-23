import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { TurnoController } from './turno/turno.controller';
import { TurnoService } from './turno/turno.service';
import { HorarioController } from './horario/horario.controller';
import { HorarioService } from './horario/horario.service';
import { EmpleadoController } from './empleado/empleado.controller';
import { EmpleadoService } from './empleado/empleado.service';
import { AsistenciaController } from './asistencia/asistencia.controller';
import { AsistenciaService } from './asistencia/asistencia.service';
import { IncidenciaController } from './incidencia/incidencia.controller';
import { IncidenciaService } from './incidencia/incidencia.service';
import { DashboardRrhhController } from './dashboard/dashboard-rrhh.controller';
import { DashboardRrhhService } from './dashboard/dashboard-rrhh.service';
import { PlanillaController } from './planilla/planilla.controller';
import { PlanillaService } from './planilla/planilla.service';
import { PlanillaCalculoService } from './planilla/planilla-calculo.service';
import { AdelantoController } from './adelanto/adelanto.controller';
import { AdelantoService } from './adelanto/adelanto.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    forwardRef(() => CajaModule),
  ],
  controllers: [
    TurnoController,
    HorarioController,
    EmpleadoController,
    AsistenciaController,
    IncidenciaController,
    DashboardRrhhController,
    PlanillaController,
    AdelantoController,
  ],
  providers: [
    TurnoService,
    HorarioService,
    EmpleadoService,
    AsistenciaService,
    IncidenciaService,
    DashboardRrhhService,
    PlanillaService,
    PlanillaCalculoService,
    AdelantoService,
  ],
  exports: [EmpleadoService],
})
export class RrhhModule {}
