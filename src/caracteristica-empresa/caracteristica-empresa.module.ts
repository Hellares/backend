import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CaracteristicaEmpresaService } from './caracteristica-empresa.service';

@Module({
  imports: [PrismaModule],
  providers: [CaracteristicaEmpresaService],
  exports: [CaracteristicaEmpresaService],
})
export class CaracteristicaEmpresaModule {}
