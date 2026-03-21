import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CategoriaGastoController } from './categoria-gasto.controller';
import { CategoriaGastoService } from './categoria-gasto.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CategoriaGastoController],
  providers: [CategoriaGastoService],
  exports: [CategoriaGastoService],
})
export class CategoriaGastoModule {}
