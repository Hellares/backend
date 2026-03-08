import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { LoggerModule } from '../common/logger/logger.module';
import { ServicioModule } from '../servicio/servicio.module';
import { AvisoMantenimientoService } from './aviso-mantenimiento.service';
import { AvisoMantenimientoController } from './aviso-mantenimiento.controller';
import { AvisoMantenimientoTaskService } from './aviso-mantenimiento-task.service';

@Module({
  imports: [PrismaModule, AuthModule, LoggerModule, forwardRef(() => ServicioModule)],
  controllers: [AvisoMantenimientoController],
  providers: [AvisoMantenimientoService, AvisoMantenimientoTaskService],
  exports: [AvisoMantenimientoService],
})
export class AvisoMantenimientoModule {}
