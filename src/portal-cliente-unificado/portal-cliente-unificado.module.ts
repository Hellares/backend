import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PortalClienteUnificadoController } from './portal-cliente-unificado.controller';
import { PortalClienteUnificadoService } from './portal-cliente-unificado.service';

@Module({
  imports: [PrismaModule],
  controllers: [PortalClienteUnificadoController],
  providers: [PortalClienteUnificadoService],
})
export class PortalClienteUnificadoModule {}
