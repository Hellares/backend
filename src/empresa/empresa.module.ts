import { Module } from '@nestjs/common';
import { EmpresaService } from './empresa.service';
import { EmpresaController } from './empresa.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SeedPlanesService } from './scripts/seed-planes.service';
import { CatalogosModule } from '../catalogos/catalogos.module';
import { ConfiguracionDocumentosModule } from '../configuracion-documentos/configuracion-documentos.module';
import { PlanLimitsService } from '../common/services/plan-limits.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    CatalogosModule,
    ConfiguracionDocumentosModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN', '24h'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [EmpresaController],
  providers: [EmpresaService, SeedPlanesService, PlanLimitsService],
  exports: [EmpresaService],
})
export class EmpresaModule {}