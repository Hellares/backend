import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { StorageModule } from '../storage/storage.module';
import { CuentasPorPagarController } from './cuentas-por-pagar.controller';
import { CuentasPorPagarService } from './cuentas-por-pagar.service';

@Module({
  imports: [PrismaModule, AuthModule, CajaModule, StorageModule],
  controllers: [CuentasPorPagarController],
  providers: [CuentasPorPagarService],
  exports: [CuentasPorPagarService],
})
export class CuentasPorPagarModule {}
