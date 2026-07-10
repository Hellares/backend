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
import { BannerMarketplaceModule } from './banner-marketplace/banner-marketplace.module';
import { SorteosModule } from './sorteos/sorteos.module';
import { StorageModule } from './storage/storage.module';
import { ProductoModule } from './producto/producto.module';
import { ConfiguracionCodigosModule } from './configuracion-codigos/configuracion-codigos.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { ClientesModule } from './clientes/clientes.module';
import { PoliticaDescuentoModule } from './politica-descuento/politica-descuento.module';
import { SedeModule } from './sede/sede.module';
import { ProductoStockModule } from './producto-stock/producto-stock.module';
import { ProductoComponenteModule } from './producto-componente/producto-componente.module';
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
import { PromocionModule } from './promocion/promocion.module';
import { DireccionPersonaModule } from './direccion-persona/direccion-persona.module';
import { PortalClienteUnificadoModule } from './portal-cliente-unificado/portal-cliente-unificado.module';
import { PedidoMarketplaceModule } from './pedido-marketplace/pedido-marketplace.module';
import { SolicitudCotizacionModule } from './solicitud-cotizacion/solicitud-cotizacion.module';
import { VentaModule } from './venta/venta.module';
import { DevolucionVentaModule } from './devolucion-venta/devolucion-venta.module';
import { CajaModule } from './caja/caja.module';
import { CuentasPorCobrarModule } from './cuentas-por-cobrar/cuentas-por-cobrar.module';
import { CuentasPorPagarModule } from './cuentas-por-pagar/cuentas-por-pagar.module';
import { EmpresaBancoModule } from './empresa-banco/empresa-banco.module';
import { CuentasRecaudacionModule } from './cuentas-recaudacion/cuentas-recaudacion.module';
import { ImpresorasDispositivoModule } from './impresoras-dispositivo/impresoras-dispositivo.module';
import { ResumenFinancieroModule } from './resumen-financiero/resumen-financiero.module';
import { PrestamoModule } from './prestamo/prestamo.module';
import { LibroContableModule } from './libro-contable/libro-contable.module';
import { FlujoProyectadoModule } from './flujo-proyectado/flujo-proyectado.module';
import { CajaChicaModule } from './caja-chica/caja-chica.module';
import { GastosRecurrentesModule } from './gastos-recurrentes/gastos-recurrentes.module';
import { CategoriaGastoModule } from './categoria-gasto/categoria-gasto.module';
import { MetaFinancieraModule } from './meta-financiera/meta-financiera.module';
import { ReportesFinancierosModule } from './reportes-financieros/reportes-financieros.module';
import { TipoCambioModule } from './tipo-cambio/tipo-cambio.module';
import { UbicacionAlmacenModule } from './ubicacion-almacen/ubicacion-almacen.module';
import { AgenteBancarioModule } from './agente-bancario/agente-bancario.module';
import { RrhhModule } from './rrhh/rrhh.module';
import { AdminModule } from './admin/admin.module';
import { PagoSuscripcionModule } from './pago-suscripcion/pago-suscripcion.module';
import { ConfiguracionSistemaModule } from './configuracion-sistema/configuracion-sistema.module';
import { AuditModule } from './audit/audit.module';
import { SunatModule } from './sunat/sunat.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { IntegracionYapeModule } from './integracion-yape/integracion-yape.module';
import { CaracteristicaEmpresaModule } from './caracteristica-empresa/caracteristica-empresa.module';
import { GuiaRemisionModule } from './guia-remision/guia-remision.module';
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
    AuditModule,
    SunatModule,
    WebhooksModule,
    IntegracionYapeModule,
    CaracteristicaEmpresaModule,
    LoggerModule, // Logger global
    PrismaModule,
    AuthModule,
    UsuariosModule,
    EmpresaModule,
    MarketplaceModule,
    BannerMarketplaceModule,
    SorteosModule,
    StorageModule,
    ConfiguracionCodigosModule,
    ProductoModule,
    CatalogosModule,
    ClientesModule,
    PoliticaDescuentoModule,
    SedeModule,
    ProductoStockModule,
    ProductoComponenteModule,
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
    PromocionModule,
    DireccionPersonaModule,
    PortalClienteUnificadoModule,
    PedidoMarketplaceModule,
    SolicitudCotizacionModule,
    CajaModule,
    CajaChicaModule,
    GastosRecurrentesModule,
    CuentasPorCobrarModule,
    CuentasPorPagarModule,
    EmpresaBancoModule,
    CuentasRecaudacionModule,
    ImpresorasDispositivoModule,
    ResumenFinancieroModule,
    PrestamoModule,
    LibroContableModule,
    FlujoProyectadoModule,
    CategoriaGastoModule,
    MetaFinancieraModule,
    ReportesFinancierosModule,
    TipoCambioModule,
    UbicacionAlmacenModule,
    AgenteBancarioModule,
    RrhhModule,
    AdminModule,
    PagoSuscripcionModule,
    ConfiguracionSistemaModule,
    GuiaRemisionModule,
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
