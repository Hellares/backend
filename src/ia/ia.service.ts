import { Injectable, Logger } from '@nestjs/common';
import { IntegracionAgenteIA, ModoAgenteIA } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VentaService } from '../venta/venta.service';
import { ConsultasExternasService } from '../consultas-externas/consultas-externas.service';
import { descifrarSecreto } from '../ia-config/crypto-key.util';
import { AnthropicProvider } from './provider/anthropic.provider';
import { AgenteIaProvider, MensajeAgente } from './provider/agente-ia.provider';
import { EjecutorTools } from './ejecutor-tools';
import { AgenteService, ResultadoConversacion } from './agente.service';
import { construirSystemPrompt } from './prompt-sistema';
import { crearBuscarProductoTool } from './tools/buscar-producto.tool';
import { crearVerDetalleTool } from './tools/ver-detalle.tool';
import { crearResolverClienteTool } from './tools/resolver-cliente.tool';
import { crearCrearVentaTool } from './tools/crear-venta.tool';
import { ContextoTool } from './tools/tool.types';

/** Resultado de atender un mensaje. Si el agente está apagado para la empresa
 *  (`habilitado=false`), `atendido=false` → el bot NO responde (fallback humano). */
export interface ResultadoAtencion {
  atendido: boolean;
  /** Motivo cuando `atendido=false` (DESHABILITADO / SIN_CONFIG). */
  motivo?: string;
  /** Saludo configurado por la empresa (para el primer mensaje del bot). */
  mensajeBienvenida?: string | null;
  resultado?: ResultadoConversacion;
}

/**
 * Punto de entrada del agente IA en el backend. Resuelve la config por empresa
 * (IntegracionAgenteIA) y a partir de ella arma:
 *   - el PROVIDER (BYOK: propio aprobado → global),
 *   - las TOOLS según el modo (SOLO_CONSULTA vs VENDE),
 *   - el PROMPT (Capa B con la personalidad de la empresa),
 * y corre el loop. La IA conversa; el código determinístico (tools) ejecuta.
 */
@Injectable()
export class IaAgenteService {
  private readonly logger = new Logger(IaAgenteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly venta: VentaService,
    private readonly consultas: ConsultasExternasService,
  ) {}

  /**
   * Atiende un mensaje del cliente aplicando la config de la empresa.
   * Devuelve `atendido=false` si el agente está apagado (el bot debe seguir
   * su flujo normal / derivar a humano).
   */
  async atender(params: {
    empresaId: string;
    sedeId?: string | null;
    celular?: string | null;
    mensaje: string;
    historialPrevio?: MensajeAgente[];
    /** El bot ya envió la bienvenida → el agente no debe re-saludar. */
    omitirSaludo?: boolean;
  }): Promise<ResultadoAtencion> {
    const cfg = await this.prisma.integracionAgenteIA.findUnique({
      where: { empresaId: params.empresaId },
    });

    if (!cfg) return { atendido: false, motivo: 'SIN_CONFIG' };
    if (!cfg.habilitado) return { atendido: false, motivo: 'DESHABILITADO' };

    const ctx: ContextoTool = {
      empresaId: params.empresaId,
      sedeId: params.sedeId ?? null,
      celular: params.celular ?? null,
    };

    const provider = this.resolverProvider(cfg);
    const ejecutor = this.construirEjecutor(cfg);
    const agente = new AgenteService(provider, ejecutor);
    const system = await this.construirPrompt(ctx, cfg, params.omitirSaludo);

    const resultado = await agente.responder({
      system,
      mensajeCliente: params.mensaje,
      ctx,
      historialPrevio: params.historialPrevio,
    });

    return {
      atendido: true,
      mensajeBienvenida: cfg.mensajeBienvenida,
      resultado,
    };
  }

  /**
   * Provider según BYOK (README §9.1): si la empresa trae proveedor propio
   * APROBADO y con key, se usa esa (descifrada); si no, la key global del env.
   * Cualquier problema con el propio (tipo no soportado, key ilegible, falta
   * IA_KEY_SECRET) degrada al global — nunca bloquea la atención.
   */
  private resolverProvider(cfg: IntegracionAgenteIA): AgenteIaProvider {
    if (cfg.proveedorPropio && cfg.proveedorAprobado && cfg.proveedorApiKey) {
      try {
        const apiKey = descifrarSecreto(cfg.proveedorApiKey);
        const tipo = (cfg.proveedorTipo ?? 'claude').toLowerCase();
        if (tipo === 'claude' || tipo === 'anthropic') {
          return new AnthropicProvider({
            apiKey,
            modelo: cfg.proveedorModelo ?? undefined,
          });
        }
        this.logger.warn(
          `Proveedor propio '${tipo}' aún no implementado; uso el global.`,
        );
      } catch (e) {
        this.logger.warn(
          `No se pudo usar el proveedor propio de la empresa ${cfg.empresaId} ` +
            `(${(e as Error).message}); uso el global.`,
        );
      }
    }

    const apiKey = process.env.IA_ANTHROPIC_API_KEY ?? '';
    if (!apiKey) throw new Error('Agente IA: falta IA_ANTHROPIC_API_KEY');
    return new AnthropicProvider({
      apiKey,
      modelo: cfg.modeloProveedor ?? undefined,
    });
  }

  /**
   * Tools según el modo. Lectura siempre; `crearVenta` SOLO en modo VENDE con
   * cobro Yape habilitado (registra la venta y genera el charge). El tope de
   * productos a mostrar sale de la config.
   */
  private construirEjecutor(cfg: IntegracionAgenteIA): EjecutorTools {
    const ejecutor = new EjecutorTools().registrar(
      crearBuscarProductoTool(this.prisma, cfg.maxProductosMostrar),
      crearVerDetalleTool(this.prisma),
      crearResolverClienteTool(this.prisma, this.consultas),
    );
    if (cfg.modo === ModoAgenteIA.VENDE && cfg.puedeCobrarYape) {
      ejecutor.registrar(crearCrearVentaTool(this.prisma, this.venta));
    }
    return ejecutor;
  }

  /** System prompt: Capa A fija + Capa B (personalidad de la empresa) + Capa C. */
  private async construirPrompt(
    ctx: ContextoTool,
    cfg: IntegracionAgenteIA,
    omitirSaludo?: boolean,
  ): Promise<string> {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: cfg.empresaId },
      select: { nombre: true },
    });

    const personalidad =
      [
        cfg.nombreAgente ? `Te llamas ${cfg.nombreAgente}.` : null,
        cfg.promptPersonalidad?.trim() || null,
        cfg.horarioTexto ? `Horario de atención: ${cfg.horarioTexto}.` : null,
        !cfg.escalarAHumano
          ? 'No ofrezcas derivar a un asesor humano.'
          : null,
      ]
        .filter(Boolean)
        .join('\n') || null;

    return construirSystemPrompt(ctx, {
      personalidad,
      empresaNombre: empresa?.nombre ?? null,
      saludoYaEnviado: omitirSaludo,
      modoVenta: cfg.modo === ModoAgenteIA.VENDE && cfg.puedeCobrarYape,
    });
  }
}
