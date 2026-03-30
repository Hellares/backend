import { Module } from '@nestjs/common';
import { ConfiguracionSistemaController } from './configuracion-sistema.controller';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [AdminModule],
  controllers: [ConfiguracionSistemaController],
})
export class ConfiguracionSistemaModule {}
