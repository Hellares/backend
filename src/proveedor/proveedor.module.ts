import { Module } from '@nestjs/common';
import { ProveedorController } from './proveedor.controller';
import { ProveedorService } from './proveedor.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LoggerModule } from '../common/logger/logger.module';
import { AuthModule } from '../auth/auth.module';
import { ConfiguracionCodigosModule } from '../configuracion-codigos/configuracion-codigos.module';
import { ClienteEmpresaModule } from '../cliente-empresa/cliente-empresa.module';

@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, ConfiguracionCodigosModule, ClienteEmpresaModule],
  controllers: [ProveedorController],
  providers: [ProveedorService],
  exports: [ProveedorService],
})
export class ProveedorModule {}
