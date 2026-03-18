import { Module } from '@nestjs/common';
import { DireccionPersonaController } from './direccion-persona.controller';
import { DireccionPersonaService } from './direccion-persona.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [DireccionPersonaController],
  providers: [DireccionPersonaService],
  exports: [DireccionPersonaService],
})
export class DireccionPersonaModule {}
