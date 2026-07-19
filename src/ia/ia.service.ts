import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VentaService } from '../venta/venta.service';
import { AnthropicProvider } from './provider/anthropic.provider';
import { MensajeAgente } from './provider/agente-ia.provider';
import { EjecutorTools } from './ejecutor-tools';
import { AgenteService, ResultadoConversacion } from './agente.service';
import { construirSystemPrompt } from './prompt-sistema';
import { crearBuscarProductoTool } from './tools/buscar-producto.tool';
import { crearVerDetalleTool } from './tools/ver-detalle.tool';
import { crearResolverClienteTool } from './tools/resolver-cliente.tool';
import { crearCrearVentaTool } from './tools/crear-venta.tool';
import { ContextoTool } from './tools/tool.types';

/**
 * Punto de entrada del agente IA en el backend. Inyecta los servicios
 * reales (PrismaService, VentaService...) y arma el ejecutor de tools +
 * el loop. Aquí se resolverá la config por empresa (IntegracionAgenteIA)
 * y el provider según BYOK; por ahora el provider y la key salen del env.
 */
@Injectable()
export class IaAgenteService {
  private readonly logger = new Logger(IaAgenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly venta: VentaService,
  ) {}

  /** Ejecutor con las tools disponibles (a futuro: según modo/config). */
  private construirEjecutor(): EjecutorTools {
    return new EjecutorTools().registrar(
      crearBuscarProductoTool(this.prisma),
      crearVerDetalleTool(this.prisma),
      crearResolverClienteTool(this.prisma),
      crearCrearVentaTool(this.prisma, this.venta),
    );
  }

  /**
   * Atiende un mensaje del cliente. TODO: resolver config por empresa
   * (habilitado, personalidad, modo VENDE/SOLO_CONSULTA, BYOK) desde
   * IntegracionAgenteIA; por ahora usa el provider/env global.
   */
  async atender(params: {
    empresaId: string;
    sedeId?: string | null;
    celular?: string | null;
    mensaje: string;
    historialPrevio?: MensajeAgente[];
  }): Promise<ResultadoConversacion> {
    const apiKey = process.env.IA_ANTHROPIC_API_KEY ?? '';
    if (!apiKey) {
      throw new Error('Agente IA: falta IA_ANTHROPIC_API_KEY');
    }

    const ctx: ContextoTool = {
      empresaId: params.empresaId,
      sedeId: params.sedeId ?? null,
      celular: params.celular ?? null,
    };

    const provider = new AnthropicProvider({ apiKey });
    const agente = new AgenteService(provider, this.construirEjecutor());
    const system = construirSystemPrompt(ctx, {
      // TODO: personalidad + nombre + agencia desde config de la empresa.
    });

    return agente.responder({
      system,
      mensajeCliente: params.mensaje,
      ctx,
      historialPrevio: params.historialPrevio,
    });
  }
}
