import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { IaConfigService } from './ia-config.service';
import { IaConfigController } from './ia-config.controller';

/**
 * Configuración del agente IA vendedor por WhatsApp (IntegracionAgenteIA).
 * Solo el panel de config por empresa; el runtime del agente vive en IaModule.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [IaConfigController],
  providers: [IaConfigService],
  exports: [IaConfigService],
})
export class IaConfigModule {}
