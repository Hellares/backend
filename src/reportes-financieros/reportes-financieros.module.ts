import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { LibroContableModule } from '../libro-contable/libro-contable.module';
import { ReportesFinancierosController } from './reportes-financieros.controller';
import { ReportesFinancierosExportService } from './reportes-financieros-export.service';

@Module({
  imports: [PrismaModule, AuthModule, LibroContableModule],
  controllers: [ReportesFinancierosController],
  providers: [ReportesFinancierosExportService],
})
export class ReportesFinancierosModule {}
