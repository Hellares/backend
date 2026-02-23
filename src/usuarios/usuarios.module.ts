import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { PlanLimitsService } from '../common/services/plan-limits.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsuariosController],
  providers: [UsuariosService, PlanLimitsService],
  exports: [UsuariosService],
})
export class UsuariosModule {}
