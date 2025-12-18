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
import { StorageModule } from './storage/storage.module';
import { ProductoModule } from './producto/producto.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { ClientesModule } from './clientes/clientes.module';
import { LoggerModule } from './common/logger/logger.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { CurrentEmpresaMiddleware } from './common/middleware/current-empresa.middleware';
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
    StorageModule,
    ProductoModule,
    CatalogosModule,
    ClientesModule,
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
    // Aplicar middlewares a todas las rutas
    consumer
      .apply(RequestContextMiddleware, CurrentEmpresaMiddleware)
      .forRoutes('*');
  }
}
