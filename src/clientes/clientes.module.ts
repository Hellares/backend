import { Module } from '@nestjs/common';
import { ClientesController } from './clientes.controller';
import { ClientesService } from './clientes.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { ClienteEmpresaModule } from '../cliente-empresa/cliente-empresa.module';

@Module({
  imports: [PrismaModule, AuthModule, ConsultasExternasModule, ClienteEmpresaModule],
  controllers: [ClientesController],
  providers: [ClientesService],
  exports: [ClientesService],
})
export class ClientesModule {}
