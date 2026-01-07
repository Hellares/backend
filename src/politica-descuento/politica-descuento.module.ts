import { Module } from '@nestjs/common';
import { PoliticaDescuentoController } from './politica-descuento.controller';
import { PoliticaDescuentoService } from './services/politica-descuento.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PoliticaDescuentoController],
  providers: [PoliticaDescuentoService],
  exports: [PoliticaDescuentoService],
})
export class PoliticaDescuentoModule {}
