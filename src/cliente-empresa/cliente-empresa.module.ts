import { Module } from '@nestjs/common';
import { ClienteEmpresaController } from './cliente-empresa.controller';
import { ClienteEmpresaService } from './cliente-empresa.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';

@Module({
  imports: [PrismaModule, AuthModule, ConfiguracionCodigosModule],
  controllers: [ClienteEmpresaController],
  providers: [ClienteEmpresaService],
  exports: [ClienteEmpresaService],
})
export class ClienteEmpresaModule {}
