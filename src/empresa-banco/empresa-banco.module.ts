import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EmpresaBancoController } from './empresa-banco.controller';
import { EmpresaBancoService } from './empresa-banco.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [EmpresaBancoController],
  providers: [EmpresaBancoService],
  exports: [EmpresaBancoService],
})
export class EmpresaBancoModule {}
