import { Injectable, Logger } from '@nestjs/common';
import { IntegracionAgenteIA, ModoAgenteIA } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VentaService } from '../venta/venta.service';
import { ConsultasExternasService } from '../consultas-externas/consultas-externas.service';
import { ClientesService } from '../clientes/clientes.service';
import { descifrarSecreto } from '../ia-config/crypto-key.util';
import { AnthropicProvider } from './provider/anthropic.provider';
import { AgenteIaProvider, MensajeAgente } from './provider/agente-ia.provider';
import { EjecutorTools } from './ejecutor-tools';
import {
  AgenteService,
  ResultadoConversacion,
  TrazaTurno,
} from './agente.service';
import { construirSystemPrompt } from './prompt-sistema';
import { crearBuscarProductoTool } from './tools/buscar-producto.tool';
import { crearVerDetalleTool } from './tools/ver-detalle.tool';
import { crearResolverClienteTool } from './tools/resolver-cliente.tool';
import { crearCrearVentaTool } from './tools/crear-venta.tool';
import { crearRegistrarEnvioTool } from './tools/registrar-envio.tool';
import { crearEscalarAsesorTool } from './tools/escalar-asesor.tool';
import { ContextoTool, CatalogoItem } from './tools/tool.types';

/** Resultado de atender un mensaje. Si el agente está apagado para la empresa
 *  (`habilitado=false`), `atendido=false` → el bot NO responde (fallback humano). */
export interface ResultadoAtencion {
  atendido: boolean;
  /** Motivo cuando `atendido=false` (DESHABILITADO / SIN_CONFIG). */
  motivo?: string;
  /** Saludo configurado por la empresa (para el primer mensaje del bot). */
  mensajeBienvenida?: string | null;
  resultado?: ResultadoConversacion;
  /** Catálogo mostrado (id+variante) — el bot lo persiste para el próximo turno. */
  catalogo?: CatalogoItem[];
  /** Última búsqueda (query/página/hayMas) — el bot la persiste para paginar. */
  busqueda?: { query: string; pagina: number; hayMas: boolean };
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

  /** Texto que NIEGA tener algo — compartido por el guard 3.7 y la red
   *  final determinística (si niega sin haber buscado, el código busca). */
  private static readonly NIEGA_DISPONIBILIDAD =
    /\bno\s+(lo|la|los|las)?\s?(tenemos|tengo|hay|manejamos|vendemos|trabajamos)\b|no\s+(tiene|tienen|existe|está|esta)n?\s[^.!?]{0,30}(diseñ|model|color|talla|stock|disponib|catalog)|no\s+(encontr[ée]|me aparecen)|sin resultados/i;

  constructor(
    private readonly prisma: PrismaService,
    private readonly venta: VentaService,
    private readonly consultas: ConsultasExternasService,
    private readonly clientes: ClientesService,
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
    /** Título del sorteo/evento activo (si hay) → el agente redirige a participar. */
    sorteoActivo?: string | null;
    /** Catálogo mostrado en turnos previos (para resolver ids en crearVenta). */
    catalogoPrevio?: CatalogoItem[];
    /** Última búsqueda de turnos previos (para paginar "muéstrame más"). */
    busquedaPrevia?: { query: string; pagina: number; hayMas: boolean } | null;
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
      catalogoReciente: params.catalogoPrevio ? [...params.catalogoPrevio] : [],
      ultimaBusqueda: params.busquedaPrevia ?? undefined,
    };

    const provider = this.resolverProvider(cfg);
    const ejecutor = this.construirEjecutor(cfg);
    const agente = new AgenteService(provider, ejecutor);
    const system = await this.construirPrompt(
      ctx,
      cfg,
      params.omitirSaludo,
      params.sorteoActivo,
      params.busquedaPrevia ?? null,
    );

    // Guards anti-alucinación (solo VENDE), determinísticos sobre la respuesta
    // final — Haiku a veces ignora el prompt:
    //  1) Número de 9 dígitos que NO es el numeroPago real ni el del cliente
    //     → INVENTADO: se rechaza y se fuerza a llamar crearVenta de verdad.
    //  2) Disculpa de "hubo un problema" cuando NINGUNA tool falló en el turno
    //     → error fantasma: se rechaza y se le ordena continuar el flujo.
    // Cierre de TODA corrección de guard: sin esto, Haiku traduce el regaño
    // interno en una disculpa al cliente ("disculpa, cometí un error") aunque
    // la venta haya salido perfecta — pasó en beta con el falso positivo del
    // nombre. La corrección es tramoya, el cliente jamás debe verla.
    const NOTA_INTERNA =
      ' IMPORTANTE: esta corrección es INTERNA (el cliente NO la vio y NO ' +
      'escribió nada nuevo). NO te disculpes, NO digas que hubo un error, NO ' +
      'menciones protocolos ni "para el futuro": su último mensaje sigue ' +
      `siendo «${params.mensaje.slice(0, 80)}» — respóndele SOLO a eso, ` +
      'directo, como si fuera tu primera respuesta.';
    let validarFinal:
      | ((texto: string, trazas: TrazaTurno[]) => string | null)
      | undefined;
    if (cfg.modo === ModoAgenteIA.VENDE && cfg.puedeCobrarYape) {
      const blancos = new Set<string>();
      const numeroPago = await this.resolverNumeroPago(params.empresaId);
      if (numeroPago) blancos.add(numeroPago.replace(/\D/g, ''));
      const cel = (params.celular ?? '').replace(/\D/g, '');
      if (cel) {
        blancos.add(cel);
        blancos.add(cel.replace(/^51/, ''));
      }
      validarFinal = (texto: string, trazas: TrazaTurno[]) => {
        // 0) META-FUGA: la respuesta menciona la TRAMOYA (el nudge de una
        //    corrección previa) como si el cliente la hubiera escrito —
        //    visto en beta: "tienes razón en recordarme el protocolo. Para
        //    el futuro: siempre busco primero". El cliente nunca dijo eso.
        const meta =
          /(tienes|tiene) raz[oó]n en record|recordarme el protocolo|el sistema me (corrigi[oó]|indic[oó]|record[oó])|\[SISTEMA\]|(instrucci[oó]n|correcci[oó]n) interna|protocolo interno|para el futuro:?[^.!?]{0,50}(buscar[eé]?|busco|verificar[eé]?|llamar[eé]?)/i.test(
            texto,
          );
        if (meta) {
          this.logger.warn(
            `Agente filtró la corrección interna al cliente (empresa ${params.empresaId}) — corrigiendo`,
          );
          return (
            '[SISTEMA] Tu respuesta menciona protocolos/correcciones que el ' +
            'cliente JAMÁS escribió ni puede ver. Bórralo todo y responde ' +
            'ÚNICAMENTE su último mensaje real, directo al grano.' +
            NOTA_INTERNA
          );
        }
        const nums = texto.match(/\b9\d{8}\b/g) ?? [];
        const falso = nums.find((n) => !blancos.has(n));
        if (falso) {
          this.logger.warn(
            `Agente inventó número ${falso} (empresa ${params.empresaId}) — corrigiendo`,
          );
          return (
            `[SISTEMA] El número ${falso} que diste NO existe: lo inventaste. ` +
            'NUNCA inventes números de Yape ni montos. Si aún no llamaste a ' +
            'crearVenta en esta conversación, llámala AHORA: el monto (payAmount) ' +
            'y el número (numeroPago) reales SOLO salen de su respuesta. Corrige ' +
            'tu mensaje al cliente usando los datos reales.' +
            NOTA_INTERNA
          );
        }
        const seDisculpa =
          /hubo un (problema|inconveniente)|no pud[eo] (procesar|registrar)|problema al (procesar|registrar)|no (lo |la )?(confirm[ée]|verifiqu[ée]|valid[ée])\b/i.test(
            texto,
          );
        const algunaFallo = trazas.some((t) =>
          t.tools.some((tl) => (tl.resultado as any)?.ok === false),
        );
        if (seDisculpa && !algunaFallo) {
          this.logger.warn(
            `Agente se disculpó sin fallo real (empresa ${params.empresaId}) — corrigiendo`,
          );
          return (
            '[SISTEMA] NO ocurrió ningún error: ninguna herramienta falló. No ' +
            'te disculpes, no vuelvas a pedir el DNI ni dudes del nombre ya ' +
            'confirmado, ni derives a un asesor. Continúa el flujo de venta ' +
            'donde quedó: si el cliente te dio su DNI/CE llama resolverCliente; ' +
            'si ya confirmó su nombre llama crearVenta con ese documento. Hazlo AHORA.' +
            NOTA_INTERNA
          );
        }
        // 3) Afirma que el envío "quedó registrado" sin haber llamado
        //    registrarEnvio con éxito → éxito fantasma: se rechaza y se fuerza
        //    la llamada real. (Los patrones son AFIRMACIONES de registro; la
        //    pregunta "¿usas tu dirección registrada?" no matchea.)
        const afirmaRegistro =
          /qued(ó|o)\s+registrad|registr(é|e)\s+(tu|el|la)\s|env[ií]o\s+(fue|est(á|a)|ha\s+sido)\s+registrad|se\s+registr(ó|o)\s|hemos\s+registrado/i.test(
            texto,
          );
        const envioRegistrado = trazas.some((t) =>
          t.tools.some(
            (tl) =>
              tl.nombre === 'registrarEnvio' &&
              (tl.resultado as any)?.ok === true,
          ),
        );
        if (afirmaRegistro && !envioRegistrado) {
          this.logger.warn(
            `Agente afirmó envío registrado sin llamar registrarEnvio (empresa ${params.empresaId}) — corrigiendo`,
          );
          return (
            '[SISTEMA] NO registraste ningún envío: no llamaste a la ' +
            'herramienta registrarEnvio. NUNCA afirmes que algo quedó ' +
            'registrado sin que la herramienta lo confirme. Llama AHORA a ' +
            'registrarEnvio con los datos que el cliente te dio (ciudad, ' +
            'departamento, sucursal/dirección de la agencia; si recoge otra ' +
            'persona, su nombre y DNI) y responde según su resultado.' +
            NOTA_INTERNA
          );
        }
        // 3.5) Afirma que lo pasa con un asesor SIN haber llamado
        //      escalarAsesor → derivación fantasma: el bot no se silencia y
        //      el agente sigue respondiendo (pasó en beta: "te conecto con
        //      un asesor" y siguió chateando él). Solo si la empresa tiene
        //      escalación activa (si no, la Capa B ya dice no ofrecerla).
        if (cfg.escalarAHumano) {
          const afirmaDerivar =
            /te (paso|conecto|comunico|derivo|transfiero) con|un asesor (te|se pondr|va a|se comunicar)|te atender[áa] (un|una|el|la)? ?(asesor|persona|humano)/i.test(
              texto,
            );
          const escaloReal = trazas.some((t) =>
            t.tools.some(
              (tl) =>
                tl.nombre === 'escalarAsesor' &&
                (tl.resultado as any)?.ok === true,
            ),
          );
          if (afirmaDerivar && !escaloReal) {
            this.logger.warn(
              `Agente afirmó derivar a asesor sin llamar escalarAsesor (empresa ${params.empresaId}) — corrigiendo`,
            );
            return (
              '[SISTEMA] Dijiste que lo pasas con un asesor pero NO llamaste ' +
              'a la herramienta escalarAsesor: nadie fue avisado y tú ' +
              'seguirías respondiendo. Llama AHORA a escalarAsesor (con un ' +
              'motivo corto) y despídete en una frase.' +
              NOTA_INTERNA
            );
          }
        }
        // 3.7) NIEGA disponibilidad SIN haber buscado en este turno →
        //      negación de memoria: Haiku concluye desde la lista ya
        //      mostrada en vez de re-buscar el término nuevo (caso real:
        //      "¿tienes de Alianza Lima?" → "no tienen ese diseño", y la
        //      variante EDREDON alianza lima EXISTÍA con stock — venta
        //      perdida). Si buscó y no hay, la negación es honesta y pasa.
        const niega = IaAgenteService.NIEGA_DISPONIBILIDAD.test(texto);
        // También la MENTIRA de obediencia: "acabo de buscar y no hay" sin
        // haber llamado la tool (visto en beta con "peluches": fingió buscar
        // dos veces y había 10). Afirmar que buscó sin traza = corregir.
        const fingeBuscar =
          /acab[oé] de (buscar|revisar)|ya (busqu[ée]|revis[ée])|he (buscado|revisado)/i.test(
            texto,
          );
        const buscoEnTurno = trazas.some((t) =>
          t.tools.some((tl) => tl.nombre === 'buscarProducto'),
        );
        if ((niega || fingeBuscar) && !buscoEnTurno) {
          this.logger.warn(
            `Agente negó disponibilidad sin buscar (empresa ${params.empresaId}) — corrigiendo`,
          );
          return (
            '[SISTEMA] Afirmaste que algo NO existe o no está disponible ' +
            'SIN haber llamado buscarProducto en este turno. PROHIBIDO ' +
            'negar de memoria: la lista que mostraste antes no prueba que ' +
            'no exista otra cosa (los diseños suelen estar en variantes). ' +
            `Llama AHORA buscarProducto con el término del cliente ` +
            `("${params.mensaje.slice(0, 60)}") y responde según ESE resultado.` +
            NOTA_INTERNA
          );
        }
        // 3.8) FOTO FANTASMA: afirma que las imágenes ya se enviaron ("Aquí
        //      están 👆") sin que NINGUNA tool del turno haya devuelto una
        //      imagen — visto en beta con "los dos Lucifer": dijo "aquí están"
        //      dos veces sin llamar verDetalle, y el cliente no recibió nada.
        //      El bot envía fotos SOLO desde trazas con urlImagen (verDetalle)
        //      o búsquedas acotadas (≤3 productos): fuera de eso, la
        //      afirmación es mentira.
        const afirmaFoto =
          /👆|aqu[ií]\s+(est[áa]n?|tienes|te\s+(dejo|van|va))[^.!?\n]{0,40}(foto|imagen|im[áa]gen)|te\s+(env[ií]o|mando|muestro|comparto|dej[oé])\s+(la|las|una|sus)\s+(foto|imagen|im[áa]gen)/i.test(
            texto,
          );
        const huboImagenReal = trazas.some((t) =>
          t.tools.some((tl) => {
            const res: any = tl.resultado;
            if (tl.nombre === 'verDetalle' && res?.ok) {
              return (
                !!res.producto?.urlImagen ||
                (res.producto?.variantes ?? []).some((v: any) => v?.urlImagen)
              );
            }
            if (tl.nombre === 'buscarProducto' && res?.ok) {
              // Búsqueda acotada → el bot manda las fotos él mismo.
              const idsDistintos = new Set(
                (res.productos ?? []).map((p: any) => p.id),
              );
              return idsDistintos.size >= 1 && idsDistintos.size <= 3;
            }
            return false;
          }),
        );
        if (afirmaFoto && !huboImagenReal) {
          this.logger.warn(
            `Agente afirmó fotos enviadas sin imagen real (empresa ${params.empresaId}) — corrigiendo`,
          );
          return (
            '[SISTEMA] Afirmaste que las fotos/imágenes ya se enviaron, pero ' +
            'NINGUNA herramienta de este turno devolvió una imagen: el ' +
            'cliente NO recibió nada. Llama AHORA verDetalle con el producto ' +
            'que pidió (uno por producto, máx 2) — sus fotos y las de sus ' +
            'variantes se envían solas. Si verDetalle no trae urlImagen, di ' +
            'honestamente que no tiene foto.' +
            NOTA_INTERNA
          );
        }
        // 4) Producto INVENTADO en la lista: un nombre en negrita en una línea
        //    con precio "S/" que NO matchea ningún producto del catálogo
        //    mostrado → Haiku completó la lista de memoria (pasó en beta:
        //    "EDREDON MICROFIBRA", que no existe). 1 corrección por turno.
        const norm = (s: string) =>
          s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const nombresCat = (ctx.catalogoReciente ?? []).map((c) =>
          norm(c.nombre),
        );
        const SEG_SAFE =
          /monto|pagar|precio|total|yape|numero|envio|recojo|stock|cantidad|compra|vta-|entrega|agencia/;
        // Nombre oficial del cliente (resolverCliente/crearVenta lo dejan en
        // ctx): "**KELI RODRIGUEZ SALINAS**" en la línea del monto NO es un
        // producto inventado (falso positivo real en beta — costó una
        // corrección y un round-trip al LLM).
        const cliNombre = ctx.clienteNombre ? norm(ctx.clienteNombre) : null;
        let inventado: string | null = null;
        for (const linea of texto.split('\n')) {
          // "S/ 40", "S/. 40" y "S/.40" — el punto tras S/ evadía el guard
          // (pasó: página 2 de almohadas TODA inventada con formato "S/.").
          if (!/S\/\.?\s*\d/.test(linea)) continue;
          // Línea del resumen "A nombre de: …" — no es lista de productos.
          if (/nombre\s+de/i.test(linea)) continue;
          for (const m of linea.matchAll(/\*\*([^*]{4,60})\*\*/g)) {
            const seg = norm(m[1].trim());
            if ((seg.match(/[a-z]/g)?.length ?? 0) < 4) continue;
            if (SEG_SAFE.test(seg)) continue;
            if (cliNombre && (cliNombre.includes(seg) || seg.includes(cliNombre))) {
              continue;
            }
            // n.includes(seg): el LLM acorta nombres largos (VERNO TALLA 35
            // sin el color) → válido. seg.includes(n): SOLO si el nombre del
            // catálogo cubre ≥70% del texto — el producto genérico "ZAPATILLAS"
            // validaba cualquier invento "ZAPATILLAS X" (CASUALES/BASQUET...).
            const enCatalogo = nombresCat.some(
              (n) =>
                n.includes(seg) ||
                (seg.includes(n) && n.length >= seg.length * 0.7),
            );
            if (!enCatalogo) {
              inventado = m[1].trim();
              break;
            }
          }
          if (inventado) break;
        }
        if (inventado) {
          this.logger.warn(
            `Agente mencionó producto fuera de catálogo "${inventado}" (empresa ${params.empresaId}) — corrigiendo`,
          );
          const pista = ctx.ultimaBusqueda?.hayMas
            ? ` Si el cliente pidió VER MÁS modelos, llama AHORA buscarProducto ` +
              `con query "${ctx.ultimaBusqueda.query}" y pagina ` +
              `${ctx.ultimaBusqueda.pagina + 1} y presenta ESE resultado.`
            : ' Presenta EXACTAMENTE los productos del último resultado de ' +
              'buscarProducto (todos, sin omitir ni agregar ninguno).';
          return (
            `[SISTEMA] "${inventado}" NO está en los resultados de tus ` +
            'herramientas: lo inventaste o lo recordaste de otra conversación. ' +
            'PROHIBIDO.' +
            pista +
            NOTA_INTERNA
          );
        }
        return null;
      };
    }

    const resultado = await agente.responder({
      system,
      mensajeCliente: params.mensaje,
      ctx,
      historialPrevio: params.historialPrevio,
      validarFinal,
    });

    // ÚLTIMA PALABRA DEL CÓDIGO: si tras agotar las correcciones el texto
    // final SIGUE negando disponibilidad sin UNA SOLA llamada real a
    // buscarProducto (Haiku fingió obedecer: "acabo de buscar y no hay" —
    // pasó con "peluches" habiendo 10), el código busca por él y, si HAY
    // resultados, arma la lista determinística. El cliente jamás recibe un
    // "no tenemos" falso.
    if (
      validarFinal &&
      resultado?.texto &&
      IaAgenteService.NIEGA_DISPONIBILIDAD.test(resultado.texto) &&
      !resultado.trazas?.some((t) =>
        t.tools.some((tl) => tl.nombre === 'buscarProducto'),
      )
    ) {
      const r = await ejecutor.ejecutar(
        'buscarProducto',
        { query: params.mensaje },
        ctx,
      );
      const prods = (r as any)?.productos;
      if (r?.ok && Array.isArray(prods) && prods.length > 0) {
        this.logger.warn(
          `Agente negó con productos EXISTENTES (empresa ${params.empresaId}, ` +
            `"${params.mensaje.slice(0, 40)}") — lista generada por código`,
        );
        const fmtPrecio = (p: any) =>
          typeof p === 'number'
            ? `S/ ${p.toFixed(2)}`
            : p?.desde != null
              ? `S/ ${Number(p.desde).toFixed(2)} a S/ ${Number(p.hasta).toFixed(2)}`
              : '';
        resultado.texto =
          'Sí tengo 😊:\n\n' +
          prods
            .map(
              (p: any, i: number) =>
                `${i + 1}. **${p.nombre}** — ${fmtPrecio(p.precio)}` +
                (p.stockDisponible != null
                  ? ` (${p.stockDisponible} disponibles)`
                  : ''),
            )
            .join('\n') +
          ((r as any).hayMas
            ? '\n\nHay más modelos — dime si quieres verlos.'
            : '') +
          '\n\n¿Cuál te interesa?';
      }
    }

    return {
      atendido: true,
      mensajeBienvenida: cfg.mensajeBienvenida,
      resultado,
      catalogo: ctx.catalogoReciente,
      busqueda: ctx.ultimaBusqueda,
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
      crearResolverClienteTool(this.prisma, this.consultas, this.clientes),
    );
    // El cliente puede pedir un humano: la tool marca la traza y el BOT
    // silencia la conversación (estado ASESOR) + avisa a la empresa.
    if (cfg.escalarAHumano) {
      ejecutor.registrar(crearEscalarAsesorTool());
    }
    if (cfg.modo === ModoAgenteIA.VENDE && cfg.puedeCobrarYape) {
      ejecutor.registrar(
        crearCrearVentaTool(this.prisma, this.venta),
        crearRegistrarEnvioTool(this.prisma, this.venta),
      );
    }
    return ejecutor;
  }

  /** Número Yape real de la empresa (WhatsApp.numeroPago → IntegracionYape). */
  private async resolverNumeroPago(empresaId: string): Promise<string | null> {
    const wpp = await this.prisma.integracionWhatsapp.findUnique({
      where: { empresaId },
      select: { numeroPago: true },
    });
    if (wpp?.numeroPago) return wpp.numeroPago;
    const iy = await this.prisma.integracionYape.findUnique({
      where: { empresaId },
      select: { celular: true },
    });
    return iy?.celular ?? null;
  }

  /** System prompt: Capa A fija + Capa B (personalidad de la empresa) + Capa C. */
  private async construirPrompt(
    ctx: ContextoTool,
    cfg: IntegracionAgenteIA,
    omitirSaludo?: boolean,
    sorteoActivo?: string | null,
    busquedaPrevia?: { query: string; pagina: number; hayMas: boolean } | null,
  ): Promise<string> {
    const [empresa, wpp] = await Promise.all([
      this.prisma.empresa.findUnique({
        where: { id: cfg.empresaId },
        select: { nombre: true },
      }),
      this.prisma.integracionWhatsapp.findUnique({
        where: { empresaId: cfg.empresaId },
        select: { agenciaEnvio: true },
      }),
    ]);

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
      agenciaEnvio: wpp?.agenciaEnvio?.trim() || null,
      saludoYaEnviado: omitirSaludo,
      modoVenta: cfg.modo === ModoAgenteIA.VENDE && cfg.puedeCobrarYape,
      sorteoActivo: sorteoActivo ?? null,
      busquedaPrevia,
    });
  }
}
