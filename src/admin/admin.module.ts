import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { CaracteristicaEmpresaModule } from '../caracteristica-empresa/caracteristica-empresa.module';

@Module({
  imports: [AuthModule, CaracteristicaEmpresaModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
