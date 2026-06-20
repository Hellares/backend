import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CuentasRecaudacionController } from './cuentas-recaudacion.controller';
import { CuentasRecaudacionService } from './cuentas-recaudacion.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CuentasRecaudacionController],
  providers: [CuentasRecaudacionService],
  exports: [CuentasRecaudacionService],
})
export class CuentasRecaudacionModule {}
