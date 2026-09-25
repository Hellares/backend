import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { AuthModule } from '../auth/auth.module';
import { CompradorCuentaController } from './comprador-cuenta.controller';
import { CompradorCuentaService } from './comprador-cuenta.service';

/**
 * Cuenta del comprador de la tienda web (DNI + código por WhatsApp). Módulo
 * aparte y no dentro de AuthModule para no acoplar auth con WhatsApp.
 */
@Module({
  imports: [PrismaModule, RedisModule, WhatsappModule, ConsultasExternasModule, AuthModule],
  controllers: [CompradorCuentaController],
  providers: [CompradorCuentaService],
})
export class CompradorCuentaModule {}
