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
import { ConfiguracionCodigosModule } from './configuracion-codigos/configuracion-codigos.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { ClientesModule } from './clientes/clientes.module';
import { PoliticaDescuentoModule } from './politica-descuento/politica-descuento.module';
import { SedeModule } from './sede/sede.module';
import { ProductoStockModule } from './producto-stock/producto-stock.module';
import { TransferenciaStockModule } from './transferencia-stock/transferencia-stock.module';
import { ProveedorModule } from './proveedor/proveedor.module';
import { ReporteIncidenciaModule } from './reporte-incidencia/reporte-incidencia.module';
import { InventarioModule } from './inventario/inventario.module';
import { CotizacionModule } from './cotizacion/cotizacion.module';
import { ConfiguracionDocumentosModule } from './configuracion-documentos/configuracion-documentos.module';
import { ConsultasExternasModule } from './consultas-externas/consultas-externas.module';
import { CompraModule } from './compra/compra.module';
import { ServicioModule } from './servicio/servicio.module';
import { ArchivingModule } from './archiving/archiving.module';
import { AvisoMantenimientoModule } from './aviso-mantenimiento/aviso-mantenimiento.module';
import { TercerizacionModule } from './tercerizacion/tercerizacion.module';
import { VinculacionModule } from './vinculacion/vinculacion.module';
import { ClienteEmpresaModule } from './cliente-empresa/cliente-empresa.module';
import { CitaModule } from './cita/cita.module';
import { NotificacionModule } from './notificacion/notificacion.module';
import { VentaModule } from './venta/venta.module';
import { DevolucionVentaModule } from './devolucion-venta/devolucion-venta.module';
import { LoggerModule } from './common/logger/logger.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { CurrentEmpresaMiddleware } from './common/middleware/current-empresa.middleware';
import { validate } from './config/validation';
import { ScheduleModule } from '@nestjs/schedule';
import { SubscriptionTasksService } from './common/tasks/subscription-tasks.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate,
    }),
    ScheduleModule.forRoot(),
    LoggerModule, // Logger global
    PrismaModule,
    AuthModule,
    UsuariosModule,
    EmpresaModule,
    MarketplaceModule,
    StorageModule,
    ConfiguracionCodigosModule,
    ProductoModule,
    CatalogosModule,
    ClientesModule,
    PoliticaDescuentoModule,
    SedeModule,
    ProductoStockModule,
    TransferenciaStockModule,
    ProveedorModule,
    ReporteIncidenciaModule,
    InventarioModule,
    CotizacionModule,
    VentaModule,
    DevolucionVentaModule,
    ConfiguracionDocumentosModule,
    ConsultasExternasModule,
    CompraModule,
    ServicioModule,
    ArchivingModule,
    AvisoMantenimientoModule,
    TercerizacionModule,
    VinculacionModule,
    ClienteEmpresaModule,
    CitaModule,
    NotificacionModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    SubscriptionTasksService,
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
