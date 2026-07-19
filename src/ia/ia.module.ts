import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VentaModule } from '../venta/venta.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { IaAgenteService } from './ia.service';

/**
 * Módulo del agente IA vendedor por WhatsApp. Reusa los servicios reales
 * (VentaService y, a futuro, ClientesService) para que las tools de
 * escritura ejecuten el flujo determinístico existente.
 *
 * Aún NO se registra en AppModule: el enganche al bot de WhatsApp es
 * Fase 1. Por ahora el módulo queda listo y verificado (tsc).
 */
@Module({
  imports: [PrismaModule, VentaModule, ConsultasExternasModule],
  providers: [IaAgenteService],
  exports: [IaAgenteService],
})
export class IaModule {}
