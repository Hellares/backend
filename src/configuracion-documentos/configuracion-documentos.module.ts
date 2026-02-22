import { Module } from '@nestjs/common';
import { ConfiguracionDocumentosService } from './configuracion-documentos.service';
import { ConfiguracionDocumentosController } from './configuracion-documentos.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [ConfiguracionDocumentosController],
  providers: [ConfiguracionDocumentosService],
  exports: [ConfiguracionDocumentosService],
})
export class ConfiguracionDocumentosModule {}
