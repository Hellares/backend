import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ValidationPipe } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { EmpresaModule } from './empresa/empresa.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { LoggerModule } from './common/logger/logger.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { validate } from './config/validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate,
    }),
    LoggerModule, // Logger global
    PrismaModule,
    AuthModule,
    UsuariosModule,
    EmpresaModule,
    MarketplaceModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: 'APP_PIPE',
      useClass: ValidationPipe,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Aplicar RequestContextMiddleware a todas las rutas
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
