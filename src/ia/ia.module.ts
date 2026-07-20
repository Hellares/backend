import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VentaModule } from '../venta/venta.module';
import { ConsultasExternasModule } from '../consultas-externas/consultas-externas.module';
import { ClientesModule } from '../clientes/clientes.module';
import { IaAgenteService } from './ia.service';

/**
 * Módulo del agente IA vendedor por WhatsApp. Reusa los servicios reales
 * (VentaService, ClientesService) para que las tools de escritura ejecuten
 * el flujo determinístico existente — resolverCliente registra al cliente
 * nuevo con getOrCreateByDni (mismo camino que el bot de sorteos).
 */
@Module({
  imports: [PrismaModule, VentaModule, ConsultasExternasModule, ClientesModule],
  providers: [IaAgenteService],
  exports: [IaAgenteService],
})
export class IaModule {}
