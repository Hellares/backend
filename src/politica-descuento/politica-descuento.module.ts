import { Module } from '@nestjs/common';
import { PoliticaDescuentoController } from './politica-descuento.controller';
import { PoliticaDescuentoService } from './services/politica-descuento.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PoliticaDescuentoController],
  providers: [PoliticaDescuentoService],
  exports: [PoliticaDescuentoService],
})
export class PoliticaDescuentoModule {}
