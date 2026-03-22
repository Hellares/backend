import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { CajaModule } from '../caja/caja.module';
import { AgenteBancarioController } from './agente-bancario.controller';
import { AgenteBancarioService } from './agente-bancario.service';

@Module({
  imports: [PrismaModule, AuthModule, CajaModule],
  controllers: [AgenteBancarioController],
  providers: [AgenteBancarioService],
  exports: [AgenteBancarioService],
})
export class AgenteBancarioModule {}
