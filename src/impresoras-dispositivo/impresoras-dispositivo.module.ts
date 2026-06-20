import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ImpresorasDispositivoController } from './impresoras-dispositivo.controller';
import { ImpresorasDispositivoService } from './impresoras-dispositivo.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ImpresorasDispositivoController],
  providers: [ImpresorasDispositivoService],
  exports: [ImpresorasDispositivoService],
})
export class ImpresorasDispositivoModule {}
