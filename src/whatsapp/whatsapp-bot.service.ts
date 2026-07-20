import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  EstadoParticipanteSorteo,
  EstadoPremioSorteo,
  EstadoSorteo,
  Prisma,
  TipoSorteo,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConsultasExternasService } from '../consultas-externas/consultas-externas.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { IntegracionYapeService } from '../integracion-yape/integracion-yape.service';
import { nombresCoinciden } from '../sorteos/nombre-match.util';
import { IaAgenteService } from '../ia/ia.service';
import { MensajeAgente } from '../ia/provider/agente-ia.provider';
import { buscarEnvioPrevio } from '../ia/tools/resolver-cliente.tool';
import { VentaService } from '../venta/venta.service';
import { EvolutionApiService } from './evolution-api.service';
import { generarCartillasPdf } from './cartilla-pdf.util';
import { generarCartillaPng } from './cartilla-imagen.util';
import {
  PLANTILLA_CONFIRMACION_DINAMICA_DEFAULT,
  PLANTILLA_CONFIRMACION_SORTEO_DEFAULT,
  PLANTILLA_PAGO_DINAMICA_DEFAULT,
  PLANTILLA_PAGO_SORTEO_DEFAULT,
  renderPlantilla,
} from './plantilla.util';

/**
 * BOT conversacional del WhatsApp de la empresa (Fase A de sorteos):
 * registra participantes (nombre + DNI — el celular viene del remitente)
 * y captura la agencia del ganador. El pago se valida POR FUERA: la
 * empresa activa al participante desde el app y el bot le confirma su
 * número de ticket.
 *
 * Máquina de estados por (empresaId, celular) en ConversacionWhatsapp.
 * Reglas de convivencia con el uso humano del número:
 * - Solo responde si la empresa tiene ≥1 sorteo ABIERTO.
 * - Opción "asesor" silencia al bot 12 h para ese número.
 * - Conversaciones a medias caducan a los 30 min (vuelven al menú).
 */
@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);

  private static readonly TIMEOUT_PASO_MIN = 30;
  private static readonly SILENCIO_ASESOR_HORAS = 12;
  private static readonly THROTTLE_MENU_MIN = 60;

  /// Tope de tickets por compra en sorteos clásicos (anti "quiero 99999").
  private static readonly MAX_TICKETS_COMPRA = 100;

  /// Hasta cuántas cartillas de bingo se envían como IMAGEN inline
  /// (más de eso → un solo PDF, sin metralleta de mensajes).
  private static readonly MAX_CARTILLAS_IMAGEN = 5;

  /// Pasos del flujo de PREMIO de un ganador (ctx.premioId): son los
  /// únicos que el bot atiende SIN sorteos abiertos — el modo jugar
  /// opera con el sorteo cerrado.
  private static readonly ESTADOS_PREMIO = [
    'GANADOR_YAPE',
    'GANADOR_YAPE_NUMERO',
    'GANADOR_CONFIRMA',
    'GANADOR_QUIEN',
    'GANADOR_CIUDAD',
    'GANADOR_DEPARTAMENTO',
    'GANADOR_DIRECCION',
    'REGALO_DNI',
    'REGALO_NOMBRE',
  ];

  /// Pasos del flujo DETERMINÍSTICO de entrega de una venta PAGADA del
  /// agente IA (ctx.ventaEnvio.ventaId): la dirección se captura por
  /// pasos y va directo a VentaService.upsertEnvio — el LLM no participa
  /// (alucinaba "envío registrado" sin llamar la tool).
  private static readonly ESTADOS_VENTA_ENTREGA = [
    'VENTA_ENTREGA',
    'VENTA_ENVIO_CIUDAD',
    'VENTA_ENVIO_DEPARTAMENTO',
    'VENTA_ENVIO_DIRECCION',
    'VENTA_ENVIO_DESTINATARIO',
  ];

  /// Fallback si la empresa no configuró su agencia (IntegracionWhatsapp
  /// .agenciaEnvio): el bot la informa y no pregunta cuál.
  private static readonly AGENCIA_DEFAULT = 'SHALOM';

  /// Cambio de envío de un PREMIO vetado (regla 07-18, alineada con
  /// elegirAgenciaMiPremio del app): desde PREPARANDO la tienda ya arma
  /// el paquete (y pudo imprimir el rótulo) — solo se admite la PRIMERA
  /// captura (premio aún sin agencia), para no dejar mudo al ganador
  /// que responde tarde el "¡GANASTE!".
  private static premioNoAdmiteCambioEnvio(premio: {
    estado: EstadoPremioSorteo;
    agenciaNombre: string | null;
  }): boolean {
    return (
      premio.estado === EstadoPremioSorteo.PREPARANDO &&
      !!premio.agenciaNombre
    );
  }

  /// Respuesta de UNA frase corta (ciudad/departamento). La gente a
  /// veces pega su BLOQUE completo de datos (nombre + DNI + celular +
  /// dirección en varias líneas — pasó en prod: todo terminó guardado
  /// como "ciudad" y salió impreso en el rótulo). null = re-preguntar.
  private static campoCorto(msg: string, max = 40): string | null {
    const t = msg.trim();
    if (t.length < 3 || t.length > max || /[\r\n]/.test(t)) return null;
    return t.toUpperCase();
  }

  /// "-", "no", "no sé", "ninguna"… = NO tiene el dato. El bot pide "-"
  /// pero la gente responde "NO" (pasó en prod: la sucursal quedó "NO"
  /// y el rótulo decía "SHALOM - NO").
  private static sinDato(msg: string): boolean {
    return /^(-+|no|nose|no\s*se|no\s*sé|no\s*lo\s*se|no\s*lo\s*sé|ninguna?|nada|na)\s*[.!]*$/i.test(
      msg.trim(),
    );
  }

  /// Palabras que, solas o combinadas, forman un saludo SIN consulta real
  /// (para el agente IA: si el primer mensaje es solo un saludo, la bienvenida
  /// configurada basta y no se llama al LLM).
  private static readonly SALUDO_PALABRAS = new Set([
    'hola', 'holaa', 'holaaa', 'holi', 'holis', 'ola', 'buenas', 'buenos',
    'buen', 'dia', 'dias', 'día', 'días', 'tarde', 'tardes', 'noche', 'noches',
    'hey', 'ey', 'saludos', 'que', 'qué', 'tal', 'hello', 'hi', 'alo', 'aló',
  ]);

  private static esSaludoSimple(msg: string): boolean {
    const palabras = msg
      .trim()
      .toLowerCase()
      .replace(/[^a-záéíóúñ\s]/gi, '')
      .split(/\s+/)
      .filter(Boolean);
    if (palabras.length === 0 || palabras.length > 3) return false;
    return palabras.every((w) => WhatsappBotService.SALUDO_PALABRAS.has(w));
  }

  private static readonly MSG_PREMIO_EN_PREPARACION =
    '📦 Tu premio ya está siendo preparado con la dirección registrada ' +
    '— para cambiarla coordina con la tienda (opción *3*).';

  /// Nombre bonito de la plataforma del live ("TIKTOK" → "TikTok").
  private static readonly PLATAFORMA_LIVE: Record<string, string> = {
    FACEBOOK: 'Facebook',
    TIKTOK: 'TikTok',
    INSTAGRAM: 'Instagram',
    YOUTUBE: 'YouTube',
    KICK: 'Kick',
  };

  /// Bloque "🔴 EN VIVO" con los links que el creador pegó en el sorteo
  /// (Sorteo.liveLinks) — '' si no hay. El cliente entra directo sin
  /// buscar la transmisión.
  private static textoLive(
    sorteo: { liveLinks?: unknown } | null | undefined,
    intro = 'Míralo EN VIVO',
  ): string {
    const links = Array.isArray(sorteo?.liveLinks)
      ? (sorteo!.liveLinks as any[])
      : [];
    const filas = links
      .filter((l) => typeof l?.url === 'string' && l.url.trim())
      .map((l) => {
        const key = String(l.plataforma ?? '').trim().toUpperCase();
        const nombre =
          WhatsappBotService.PLATAFORMA_LIVE[key] ||
          (key ? key.charAt(0) + key.slice(1).toLowerCase() : 'Live');
        return `▶️ ${nombre}: ${l.url.trim()}`;
      });
    if (filas.length === 0) return '';
    return `\n\n🔴 *${intro}:*\n${filas.join('\n')}`;
  }

  /// Prompt compartido para pedir el DNI del que recoge (la agencia lo
  /// exige para entregar) — un solo texto para que no diverja.
  private static readonly MSG_DNI_RECOGE =
    '👤 Envíame el *DNI* (8 dígitos) o *CE* (9) de quien recogerá el ' +
    'paquete — sus nombres salen solos. La agencia pedirá ese ' +
    'documento para entregar el paquete 🪪';

  /// Pregunta tras las instrucciones de pago: a veces el yape lo hace
  /// un tercero (cuadrar el pago) o YA lo hizo viendo el live antes de
  /// registrarse ("yape en el aire" — validación manual del admin).
  private static readonly MSG_QUIEN_YAPEA =
    '\n\n💳 ¿Quién hará el *yape*?\n' +
    '*1* — Yo mismo\n' +
    '*2* — Otra persona (desde otro número)\n' +
    '*3* — Ya hice el yape antes de registrarme ✋\n' +
    '*0* — Volver al menú';

  /// Pregunta compartida de quién recoge el paquete en la agencia.
  private static readonly MSG_QUIEN_RECOGE =
    '¿Quién *recogerá* el paquete en la agencia?\n' +
    '*1* — Yo mismo\n' +
    '*2* — Otra persona (regalo o encargo) 🎁\n' +
    '*0* — Volver al menú';

  /// Qué sigue después del pago (según si ya hay dirección previa).
  private static avisoDireccion(confirma: boolean, tipo?: TipoSorteo): string {
    // SORTEO/BINGO: la dirección se pide SOLO SI GANA — aquí solo se
    // anuncia la confirmación de tickets/cartillas.
    if (tipo === TipoSorteo.SORTEO || tipo === TipoSorteo.BINGO) {
      return (
        '🎟️ Cuando validemos tu pago te confirmamos tus ' +
        (tipo === TipoSorteo.BINGO ? 'cartillas' : 'tickets') +
        ' por aquí.'
      );
    }
    return (
      '📦 Cuando validemos tu pago te pediremos ' +
      (confirma ? 'confirmar tu dirección de envío.' : 'los datos de envío.')
    );
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionApiService,
    private readonly consultasExternas: ConsultasExternasService,
    private readonly realtime: RealtimeInvalidationService,
    private readonly integracionYape: IntegracionYapeService,
    private readonly iaAgente: IaAgenteService,
    private readonly venta: VentaService,
  ) {}

  /** Punto de entrada desde el webhook MESSAGES_UPSERT. */
  async procesarMensaje(
    instanceName: string,
    celular: string,
    texto: string,
  ): Promise<void> {
    const cfg = await this.prisma.integracionWhatsapp.findUnique({
      where: { instanceName },
    });
    if (!cfg || !cfg.habilitado) return;
    const empresaId = cfg.empresaId;

    // Bot activo solo con sorteos abiertos (si no, el chat es 100% humano).
    // Los REABIERTOS no cuentan: son regularizaciones internas del app.
    const sorteos = await this.prisma.sorteo.findMany({
      where: { empresaId, estado: EstadoSorteo.ABIERTO, reabierto: false },
      orderBy: { creadoEn: 'desc' },
      select: {
        id: true,
        titulo: true,
        tipo: true,
        precioParticipacion: true,
        fechaSorteo: true,
        ventaHasta: true,
        liveLinks: true,
      },
    });
    const sinSorteos = sorteos.length === 0;

    // ── Flujo determinístico de ENTREGA post-pago (ventas del agente IA) ──
    // Tiene prioridad sobre sorteos Y sobre el agente: la dirección se
    // captura por pasos sin LLM. "menu"/"0"/caducidad lo sacan por el flujo
    // normal de abajo (reset a MENU).
    const convEntrega = await this.prisma.conversacionWhatsapp.findUnique({
      where: { empresaId_celular: { empresaId, celular } },
    });
    if (
      convEntrega &&
      WhatsappBotService.ESTADOS_VENTA_ENTREGA.includes(convEntrega.estado) &&
      !['menu', 'menú', 'cancelar', '0'].includes(
        texto.trim().toLowerCase(),
      ) &&
      (Date.now() - convEntrega.actualizadoEn.getTime()) / 60000 <=
        WhatsappBotService.TIMEOUT_PASO_MIN
    ) {
      await this.manejarEntregaVenta(
        instanceName,
        empresaId,
        celular,
        texto.trim(),
        convEntrega,
      );
      return;
    }

    if (sinSorteos) {
      // EXCEPCIÓN: un GANADOR a mitad del flujo de su premio (dirección
      // o número de Yape) se atiende aunque no haya sorteos abiertos —
      // se juega justamente con el sorteo CERRADO. Todo lo demás, humano.
      const convGanador = await this.prisma.conversacionWhatsapp.findUnique({
        where: { empresaId_celular: { empresaId, celular } },
      });
      const ctxGanador: any = convGanador?.contexto ?? {};
      if (
        !convGanador ||
        !ctxGanador.premioId ||
        !WhatsappBotService.ESTADOS_PREMIO.includes(convGanador.estado)
      ) {
        // Sin sorteos abiertos y no es flujo de premio: en vez de callar
        // (chat 100% humano), el AGENTE IA de ventas atiende SI la empresa
        // lo habilitó. atender() trae el gate (habilitado/modo/BYOK); si
        // devuelve atendido=false, el chat sigue siendo humano.
        await this.atenderConAgenteIa(
          instanceName,
          empresaId,
          celular,
          texto,
          convGanador,
        );
        return;
      }
    }

    // ¿La empresa tiene el agente IA de ventas activo? Con sorteos abiertos, el
    // texto libre de compra lo atiende el agente (convivencia) y el menú ofrece
    // la línea de productos. Una consulta barata; el bot de sorteos no cambia.
    const agenteHabilitado =
      (
        await this.prisma.integracionAgenteIA.findUnique({
          where: { empresaId },
          select: { habilitado: true },
        })
      )?.habilitado ?? false;

    // OJO: NO upsert con update:{} — bumpeaba actualizadoEn en cada
    // mensaje y los timeouts (asesor 12h, paso 30min, menú 1h) nunca
    // vencían. Solo se escribe en los cambios reales de estado.
    let conv = await this.prisma.conversacionWhatsapp.findUnique({
      where: { empresaId_celular: { empresaId, celular } },
    });
    const esNuevo = conv == null;
    conv ??= await this.prisma.conversacionWhatsapp.create({
      data: { empresaId, celular },
    });

    const msg = texto.trim();
    const msgLower = msg.toLowerCase();
    let estado = conv.estado;
    const ctx: any = conv.contexto ?? {};

    // "menu"/"cancelar" siempre reinician; pasos a medias caducan.
    const esComandoMenu = ['menu', 'menú', 'cancelar', '0'].includes(msgLower);
    const minutos = (Date.now() - conv.actualizadoEn.getTime()) / 60000;
    if (esComandoMenu) {
      estado = 'MENU';
    } else if (estado === 'ASESOR') {
      // Silencio: un humano está atendiendo este chat. PERO una opción
      // del menú reactiva al bot de inmediato — terminó de hablar con
      // el asesor y quiere participar/registrar envío/ver premios.
      if (['1', '2', '3', '4'].includes(msg)) {
        estado = 'MENU';
      } else if (minutos < WhatsappBotService.SILENCIO_ASESOR_HORAS * 60) {
        return;
      } else {
        estado = 'MENU';
      }
    } else if (estado === 'IA') {
      // Conversación con el agente IA de ventas EN CURSO: se mantiene pegajosa
      // para no romper flujos multi-turno (p.ej. la cantidad "1" de una compra
      // se iría al menú del sorteo). "menu"/"0"/"cancelar" ya la habrían sacado
      // a MENU arriba. Tras 30 min de inactividad, vuelve al menú.
      if (minutos > WhatsappBotService.TIMEOUT_PASO_MIN) estado = 'MENU';
    } else if (
      estado !== 'MENU' &&
      minutos > WhatsappBotService.TIMEOUT_PASO_MIN
    ) {
      estado = 'MENU';
    }

    // Paso a medias de un sorteo que YA CERRÓ (la empresa lo cerró con
    // la conversación abierta): resetear — si hay un sorteo nuevo, el
    // menú lo ofrece; los flujos de PREMIO (ctx.premioId, sin sorteoId)
    // no se tocan porque un premio pendiente se envía igual.
    let resetPorCierre = false;
    if (
      estado !== 'MENU' &&
      estado !== 'ASESOR' &&
      ctx?.sorteoId &&
      !sorteos.some((x) => x.id === ctx.sorteoId)
    ) {
      estado = 'MENU';
      // Estaba a MITAD de un flujo: su próximo mensaje merece el menú
      // de inmediato (sin throttle) — si no, respondería p.ej. su DNI
      // y recibiría silencio.
      resetPorCierre = true;
    }

    // Agente IA en curso (con sorteos abiertos): sigue el agente para NO romper
    // el flujo multi-turno — incluidas respuestas numéricas (cantidad, etc.).
    // Si el agente no atiende (deshabilitado), cae al menú de sorteos.
    if (estado === 'IA') {
      const sorteoRef =
        sorteos.length === 1 ? sorteos[0].titulo : `${sorteos.length} eventos`;
      if (
        await this.atenderConAgenteIa(
          instanceName,
          empresaId,
          celular,
          texto,
          conv,
          sorteoRef,
        )
      ) {
        return;
      }
      estado = 'MENU';
    }

    // Texto libre en MENU (no es comando ni opción): modo NO intrusivo.
    // - Quien YA participa está haciendo una consulta humana (captura
    //   de pago, pregunta) → el bot calla; 1/2/3/menu siguen activos.
    // - Número nuevo: el menú se muestra máx. 1 vez/hora para no
    //   estorbar una conversación con el asesor.
    if (
      estado === 'MENU' &&
      !esComandoMenu &&
      !['1', '2', '3', '4'].includes(msg)
    ) {
      const yaParticipa = await this.prisma.sorteoParticipante.findFirst({
        where: {
          empresaId,
          celular,
          sorteo: { estado: EstadoSorteo.ABIERTO },
        },
        select: { id: true },
      });
      if (yaParticipa) return;
      // CONVIVENCIA con el agente IA: texto libre que NO es saludo (parece una
      // consulta de producto) → lo atiende el agente de ventas, si está activo.
      // Los saludos y las opciones numéricas siguen yendo al menú de sorteos.
      if (agenteHabilitado && !WhatsappBotService.esSaludoSimple(msg)) {
        const sorteoRef =
          sorteos.length === 1
            ? sorteos[0].titulo
            : `${sorteos.length} eventos`;
        if (
          await this.atenderConAgenteIa(
            instanceName,
            empresaId,
            celular,
            texto,
            conv,
            sorteoRef,
          )
        ) {
          return;
        }
      }
      const menuMostradoHaceUnRato =
        !esNuevo &&
        conv.contexto != null &&
        minutos < WhatsappBotService.THROTTLE_MENU_MIN;
      if (menuMostradoHaceUnRato && !resetPorCierre) {
        // EXCEPCIÓN al throttle: si un sorteo donde participaba CERRÓ
        // después del último intercambio con el bot, su ciclo terminó —
        // el siguiente mensaje vuelve a ofrecer el menú con los sorteos
        // vigentes (una sola vez: al mostrarse se bumpea actualizadoEn
        // y el throttle normal retoma).
        const cicloCerrado = await this.prisma.sorteoParticipante.findFirst({
          where: {
            empresaId,
            celular,
            sorteo: {
              estado: {
                in: [EstadoSorteo.CERRADO, EstadoSorteo.FINALIZADO],
              },
              actualizadoEn: { gt: conv.actualizadoEn },
            },
          },
          select: { id: true },
        });
        if (!cicloCerrado) return;
      }
    }

    // Sin sorteos abiertos solo se atiende el flujo de premio: si el
    // paso cayó a MENU (comando 0/menu o caducó) no hay menú que
    // ofrecer — silencio, el chat vuelve a ser humano.
    if (sinSorteos && estado === 'MENU') return;

    try {
      await this.manejarPaso(cfg.instanceName, empresaId, celular, msg, {
        estado,
        ctx,
        sorteos,
        agencia:
          cfg.agenciaEnvio?.trim() || WhatsappBotService.AGENCIA_DEFAULT,
        agenteHabilitado,
      });
    } catch (e) {
      this.logger.warn(
        `Bot ${instanceName} (${celular}): ${(e as Error).message}`,
      );
    }
  }

  private async manejarPaso(
    instanceName: string,
    empresaId: string,
    celular: string,
    msg: string,
    s: {
      estado: string;
      ctx: any;
      sorteos: {
        id: string;
        titulo: string;
        tipo: TipoSorteo;
        precioParticipacion: Prisma.Decimal | null;
      }[];
      agencia: string;
      agenteHabilitado: boolean;
    },
  ) {
    const responder = (texto: string) =>
      this.evolution.sendText({ instanceName, number: celular, text: texto });
    const irA = (estado: string, ctx?: any) =>
      this.guardarConversacion(empresaId, celular, estado, ctx ?? s.ctx);

    switch (s.estado) {
      case 'MENU': {
        if (msg === '1') {
          // ¿El menú que VIO sigue vigente? Si la empresa cerró un
          // sorteo y abrió otro entre el menú y su "1", registrarlo
          // directo lo metería a un juego que NO eligió — avisar y
          // reofrecer el menú actualizado (pasó con dos dinámicas).
          const ofrecidos: string[] = Array.isArray(s.ctx?.ofrecidos)
            ? s.ctx.ofrecidos
            : [];
          const abiertos = s.sorteos.map((x) => x.id);
          const listaCambio =
            ofrecidos.length > 0 &&
            (abiertos.length !== ofrecidos.length ||
              abiertos.some((id) => !ofrecidos.includes(id)));
          if (listaCambio) {
            await responder(
              '🔄 ¡Ojo! Los sorteos activos cambiaron desde el último ' +
                'menú — este es el vigente:',
            );
            return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
          }
          if (s.sorteos.length === 1) {
            return this.iniciarRegistro(
              empresaId,
              celular,
              s.sorteos[0].id,
              s.agencia,
              responder,
              irA,
              s.sorteos[0].titulo,
            );
          }
          const lista = s.sorteos
            .map((x, i) => `*${i + 1}* — ${x.titulo}`)
            .join('\n');
          await responder(
            `¿En cuál quieres participar? Responde con el número:\n${lista}\n` +
              '*0* — Volver al menú',
          );
          return irA('ELIGIENDO_SORTEO', {
            sorteoIds: s.sorteos.map((x) => x.id),
          });
        }
        if (msg === '2') {
          return this.iniciarFlujoGanador(
            empresaId,
            celular,
            s.agencia,
            responder,
            irA,
          );
        }
        if (msg === '3') {
          await responder(
            '👌 Listo, un asesor te responderá por este chat en breve.\n' +
              '(escribe *menu* si quieres volver al menú del bot)',
          );
          return irA('ASESOR');
        }
        if (msg === '4') {
          return this.verPremios(
            instanceName,
            empresaId,
            celular,
            s.sorteos,
            responder,
            irA,
          );
        }
        return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
      }

      case 'ELIGIENDO_SORTEO': {
        const idx = parseInt(msg, 10) - 1;
        const ids: string[] = s.ctx.sorteoIds ?? [];
        if (isNaN(idx) || idx < 0 || idx >= ids.length) {
          await responder(
            'No entendí 🙈 responde solo con el número de la lista (o *0* para el menú).',
          );
          return;
        }
        return this.iniciarRegistro(
          empresaId,
          celular,
          ids[idx],
          s.agencia,
          responder,
          irA,
          s.sorteos.find((x) => x.id === ids[idx])?.titulo ?? null,
        );
      }

      case 'ELIGIENDO_ENVIO': {
        // Varios premios/participaciones: eligió cuál actualizar.
        const items: { premioId?: string; participanteId?: string }[] =
          s.ctx.items ?? [];
        if (items.length === 0) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        const idx = parseInt(msg, 10) - 1;
        if (isNaN(idx) || idx < 0 || idx >= items.length) {
          await responder(
            'No entendí 🙈 responde solo con el número de la lista (o *0* para el menú).',
          );
          return;
        }
        return this.arrancarActualizacionEnvio(
          empresaId,
          items[idx],
          s.ctx.agencia ?? s.agencia,
          responder,
          irA,
        );
      }

      case 'ESPERANDO_NOMBRE': {
        // Fallback: solo se llega aquí si BD y RENIEC no resolvieron
        // el nombre del DNI.
        // GUARD: ctx incompleto (conversación de una versión anterior)
        // → reset. OJO: Prisma IGNORA los undefined en where — sin esto
        // se registraría en un sorteo arbitrario.
        if (!s.ctx.sorteoId || !s.ctx.dni) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (msg.length < 5 || !msg.includes(' ')) {
          await responder(
            'Escríbeme tu *nombre completo* por favor (nombre y apellidos) 🙂',
          );
          return;
        }
        return this.registrarParticipante(
          empresaId,
          celular,
          { ...s.ctx, nombre: msg.toUpperCase() },
          s.ctx.dni,
          responder,
          irA,
        );
      }

      case 'ESPERANDO_DNI': {
        if (!s.ctx.sorteoId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        // DNI (8 dígitos) o CE de extranjería (9) — mismo flujo: la BD y
        // RENIEC/Migraciones resuelven el nombre; fallback manual.
        const dni = msg.replace(/\D/g, '');
        if (dni.length !== 8 && dni.length !== 9) {
          await responder(
            'Ese no parece un documento 🙈 envíame tu *DNI* (8 dígitos, ' +
              'ej. 44881122) o tu *Carné de Extranjería* (9 dígitos) ' +
              '— inténtalo de nuevo (o *0* para el menú):',
          );
          return;
        }
        // ¿Ya está en este sorteo? → ofrecer participar OTRA VEZ (comprar
        // varias participaciones es normal). Antes de gastar RENIEC.
        const previo = await this.prisma.sorteoParticipante.findFirst({
          where: { sorteoId: s.ctx.sorteoId, dni },
          orderBy: { creadoEn: 'desc' },
        });
        if (previo) {
          return this.ofrecerReparticipacion(
            s.ctx.sorteoId,
            previo,
            responder,
            irA,
          );
        }
        // Nombre OFICIAL: primero la BD (cliente existente), luego
        // RENIEC — nunca confiar en el nombre tipeado (llegó a registrar
        // nombres incorrectos para DNIs ya conocidos).
        const nombre = await this.resolverNombrePorDni(dni);
        if (nombre != null) {
          return this.registrarParticipante(
            empresaId,
            celular,
            { ...s.ctx, nombre, verificado: true },
            dni,
            responder,
            irA,
          );
        }
        await responder(
          'No pudimos validar tu DNI automáticamente 🙈 ' +
            'escríbeme tu *nombre completo* (nombre y apellidos):',
        );
        return irA('ESPERANDO_NOMBRE', { ...s.ctx, dni });
      }

      case 'REPARTICIPAR': {
        // GUARD: sin previoId, el findFirst con id undefined matchearía
        // una participación ARBITRARIA de la empresa (Prisma ignora
        // undefined en where).
        if (!s.ctx.previoId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (msg === '1') {
          const previo = await this.prisma.sorteoParticipante.findFirst({
            where: { id: s.ctx.previoId, empresaId },
          });
          if (!previo) return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
          // SORTEO/BINGO: comprar MÁS tickets/cartillas = preguntar cuántos.
          const sorteoPrevio = s.sorteos.find(
            (x) => x.id === previo.sorteoId,
          );
          if (sorteoPrevio && sorteoPrevio.tipo !== TipoSorteo.DINAMICA) {
            const precio = sorteoPrevio.precioParticipacion
              ? ` (S/ ${Number(sorteoPrevio.precioParticipacion).toFixed(2)} c/u)`
              : '';
            const unidadMas =
              sorteoPrevio.tipo === TipoSorteo.BINGO
                ? '🎱 ¿Cuántas cartillas más quieres'
                : '🎟️ ¿Cuántos tickets más quieres';
            await responder(
              `${unidadMas}${precio}?\n` +
                `Responde con un número del *1* al *${WhatsappBotService.MAX_TICKETS_COMPRA}*.`,
            );
            return irA('CANTIDAD_TICKETS', {
              sorteoId: previo.sorteoId,
              dni: previo.dni,
              nombre: previo.nombre,
            });
          }
          // DINÁMICA — PAGO-PRIMERO, igual que la primera vez: la
          // dirección previa se copia EN SILENCIO y al VALIDAR el pago
          // el bot la pide o confirma (regalo/quién recoge también ahí).
          const nuevo = await this.prisma.sorteoParticipante.create({
            data: {
              empresaId,
              sorteoId: previo.sorteoId,
              celular,
              nombre: previo.nombre,
              dni: previo.dni,
              agenciaNombre: previo.agenciaNombre,
              destinoDepartamento: previo.destinoDepartamento,
              destinoProvincia: previo.destinoProvincia,
              agenciaDireccion: previo.agenciaDireccion,
            },
          });
          this.realtime.notifySorteoCambiado({
            empresaId,
            sorteoId: nuevo.sorteoId,
          });
          await responder(
            `🎟️ ¡Nueva participación registrada, ${previo.nombre.split(' ')[0]}!\n\n` +
              (await this.instruccionesPago(empresaId, {
                sorteoId: nuevo.sorteoId,
              })) +
              WhatsappBotService.MSG_QUIEN_YAPEA,
          );
          return irA('PAGO_QUIEN', {
            participanteId: nuevo.id,
            sorteoId: nuevo.sorteoId,
            confirmaDireccion: !!previo.agenciaNombre,
          });
        }
        await responder(
          '👌 Listo, sigues con tus participaciones actuales. ' +
            'Escribe *menu* para ver las opciones.',
        );
        return irA('MENU', {});
      }

      case 'CANTIDAD_TICKETS': {
        // Compra de tickets (tipo SORTEO): cuántos quiere este DNI.
        if (!s.ctx.sorteoId || !s.ctx.dni) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        const n = parseInt(msg.replace(/\D/g, ''), 10);
        if (
          isNaN(n) ||
          n < 1 ||
          n > WhatsappBotService.MAX_TICKETS_COMPRA
        ) {
          await responder(
            '¿Cuántos tickets quieres? Responde con un número del *1* ' +
              `al *${WhatsappBotService.MAX_TICKETS_COMPRA}* (o *0* para el menú).`,
          );
          return;
        }
        return this.crearTickets(
          empresaId,
          celular,
          s.ctx,
          n,
          responder,
          irA,
        );
      }

      case 'PAGO_QUIEN': {
        if (!s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (msg === '1') {
          // Paga él mismo: nombre y número ya los tenemos.
          await responder(
            '✅ ¡Listo! Esperamos tu yape 🙌\n\n' +
              WhatsappBotService.avisoDireccion(
                s.ctx.confirmaDireccion,
                s.sorteos.find((x) => x.id === s.ctx.sorteoId)?.tipo,
              ),
          );
          return irA('MENU', {});
        }
        if (msg === '2') {
          await responder(
            '💳 ¿Desde qué *número* harán el yape? (9 dígitos)',
          );
          return irA('PAGO_NUMERO', s.ctx);
        }
        if (msg === '3') {
          // "Yape en el aire": yapeó viendo el live ANTES de registrarse.
          // Se marca la participación para que el chip del admin
          // considere pagos anteriores al registro — la validación es
          // SIEMPRE manual (nunca auto: cualquiera vio el monto en el
          // live y podría reclamarlo). Falta saber QUIÉN hizo ese yape
          // (si fue un tercero, sin su nombre el pago es invisible).
          await this.prisma.sorteoParticipante.updateMany({
            where: this.whereParticipacion(empresaId, s.ctx),
            data: { yapeAnticipadoEn: new Date() },
          });
          this.realtime.notifySorteoCambiado({
            empresaId,
            sorteoId: s.ctx.sorteoId,
          });
          await responder(
            '💳 ¿Quién hizo ese yape?\n' +
              '*1* — Yo mismo\n' +
              '*2* — Otra persona (desde otro número)',
          );
          return irA('PAGO_ANTICIPADO_QUIEN', s.ctx);
        }
        // Texto libre (la captura del yape, una consulta): no estorbar —
        // 1/2/menu siguen activos y el paso caduca solo.
        return;
      }

      case 'PAGO_NUMERO': {
        if (!s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        const cel = msg.replace(/\D/g, '');
        if (cel.length !== 9 || !cel.startsWith('9')) {
          await responder(
            'Ese no parece un celular 🙈 deben ser *9 dígitos* ' +
              '(ej. 987654321) — inténtalo de nuevo (o *0* para el menú):',
          );
          return;
        }
        await responder(
          '🪪 Envíame el *DNI* (8 dígitos) o *CE* (9) de quien hará el ' +
            'yape — sus nombres salen solos.\n' +
            'Si no lo sabes, escríbeme su *nombre completo*:',
        );
        return irA('PAGO_NOMBRE', { ...s.ctx, pagadorCelular: cel });
      }

      case 'PAGO_NOMBRE': {
        if (!s.ctx.participanteId || !s.ctx.pagadorCelular) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        // DNI/CE del pagador → nombre OFICIAL (BD → RENIEC/Migraciones):
        // mejora muchísimo el match automático del yape (el nombre
        // tipeado casi nunca calza letra a letra con el titular).
        let pagadorNombre: string;
        const digitos = msg.replace(/\D/g, '');
        const esSoloDigitos = /^[\d\s.\-]+$/.test(msg.trim());
        if (esSoloDigitos && (digitos.length === 8 || digitos.length === 9)) {
          const oficial = await this.resolverNombrePorDni(digitos);
          if (!oficial) {
            await responder(
              'No pudimos validar ese documento 🙈 escríbeme el ' +
                '*nombre completo* de quien hará el yape:',
            );
            return;
          }
          pagadorNombre = oficial;
        } else if (esSoloDigitos) {
          await responder(
            'Ese documento no parece válido 🙈 envíame el *DNI* ' +
              '(8 dígitos) o *CE* (9) de quien yapeará — o escríbeme ' +
              'su *nombre completo*:',
          );
          return;
        } else {
          // Nombre a mano (no sabe el DNI): una sola línea, sin blobs.
          const manual = msg.replace(/\s+/g, ' ').trim();
          if (manual.length < 3) {
            await responder(
              '¿A nombre de *quién* está esa cuenta Yape? ' +
                '(nombre completo — o envíame su DNI y sale solo)',
            );
            return;
          }
          pagadorNombre = manual.toUpperCase().slice(0, 60);
        }
        // Compra de tickets: el pagador aplica a TODAS las filas.
        await this.prisma.sorteoParticipante.updateMany({
          where: s.ctx.compraId
            ? { compraId: s.ctx.compraId, empresaId }
            : { id: s.ctx.participanteId, empresaId },
          data: { pagadorNombre, pagadorCelular: s.ctx.pagadorCelular },
        });
        if (s.ctx.sorteoId) {
          this.realtime.notifySorteoCambiado({
            empresaId,
            sorteoId: s.ctx.sorteoId,
          });
        }
        // Yape ANTICIPADO de un tercero: con el pagador ya guardado,
        // buscar el pago y dar feedback (validación manual del admin).
        if (s.ctx.anticipado) {
          await responder(
            `✅ Anotado: el yape lo hizo *${pagadorNombre}* desde el ` +
              `*${s.ctx.pagadorCelular}*.`,
          );
          return this.feedbackYapeAnticipado(
            empresaId,
            s.ctx,
            responder,
            irA,
          );
        }
        await responder(
          `✅ Anotado: *${pagadorNombre}* yapeará desde el ` +
            `*${s.ctx.pagadorCelular}*.\n\n` +
            WhatsappBotService.avisoDireccion(
              s.ctx.confirmaDireccion,
              s.sorteos.find((x) => x.id === s.ctx.sorteoId)?.tipo,
            ),
        );
        return irA('MENU', {});
      }

      // "Yape en el aire" (opción 3): ¿quién hizo ese yape ya realizado?
      case 'PAGO_ANTICIPADO_QUIEN': {
        if (!s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (msg === '1') {
          return this.feedbackYapeAnticipado(empresaId, s.ctx, responder, irA);
        }
        if (msg === '2') {
          await responder(
            '💳 ¿Desde qué *número* hicieron el yape? (9 dígitos)',
          );
          return irA('PAGO_NUMERO', { ...s.ctx, anticipado: true });
        }
        // Texto libre (lo más probable: la CAPTURA del yape que acaba de
        // mencionar): no estorbar — 1/2/menu siguen activos y la marca
        // de anticipado ya quedó puesta.
        return;
      }

      case 'REGALO_DNI': {
        // Quien RECOGE se identifica por DNI: el nombre oficial sale de
        // la BD o RENIEC (Factiliza) — igual que el registro del jugador.
        // El DNI es OBLIGATORIO: la agencia lo pide para entregar.
        if (!s.ctx.participanteId && !s.ctx.premioId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        const dni = msg.replace(/\D/g, '');
        if (dni.length !== 8 && dni.length !== 9) {
          await responder(
            '🪪 Necesito el *DNI* (8 dígitos, ej. 44881122) o *CE* (9) ' +
              'de quien recogerá — la agencia lo pide para entregar ' +
              'el paquete. Inténtalo de nuevo (o *0* para el menú):',
          );
          return;
        }
        const nombre = await this.resolverNombrePorDni(dni);
        if (nombre == null) {
          await responder(
            'No pudimos validar ese DNI automáticamente 🙈 ' +
              'escríbeme el *nombre completo* de quien recogerá ' +
              `(quedará registrado con el DNI ${dni}):`,
          );
          return irA('REGALO_NOMBRE', { ...s.ctx, recibeDni: dni });
        }
        return this.continuarConRecibe(
          empresaId,
          { ...s.ctx, recibeDni: dni, recibeNombre: nombre, recibeVerificado: true },
          responder,
          irA,
        );
      }

      case 'REGALO_NOMBRE': {
        // Fallback: solo cuando BD/RENIEC no resolvieron el DNI — que ya
        // es obligatorio y viene en ctx (el nombre se registra con él).
        if (!s.ctx.participanteId && !s.ctx.premioId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (!s.ctx.recibeDni) {
          // Conversación vieja sin DNI (o estado huérfano): pedirlo.
          await responder(
            '👤 Envíame el *DNI* de quien recogerá el paquete (8 dígitos):',
          );
          return irA('REGALO_DNI', s.ctx);
        }
        if (msg.length < 5 || !msg.includes(' ')) {
          await responder(
            '👤 Escríbeme el *nombre completo* de quien recogerá el paquete:',
          );
          return;
        }
        return this.continuarConRecibe(
          empresaId,
          { ...s.ctx, recibeNombre: msg.toUpperCase() },
          responder,
          irA,
        );
      }

      case 'CONFIRMAR_ENVIO': {
        if (!s.ctx.participanteId || !s.ctx.sorteoId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        // Recurrente: sus datos previos ya quedaron copiados al registro.
        if (msg === '1') {
          // Confirmó "es la misma" → sello para el chip "Dirección
          // confirmada" de la card (la copia silenciosa no lo lleva).
          await this.prisma.sorteoParticipante.updateMany({
            where: this.whereParticipacion(empresaId, s.ctx),
            data: { direccionConfirmadaEn: new Date() },
          });
          this.realtime.notifySorteoCambiado({
            empresaId,
            sorteoId: s.ctx.sorteoId,
          });
          await responder(
            '✅ ¡Perfecto, mismo envío!\n\n' +
              (await this.cierreFlujo(empresaId, s.ctx)),
          );
          return irA('MENU', {});
        }
        if (msg === '2') {
          await responder(
            '📍 ¿A qué *ciudad* te lo enviaríamos? (ej. TRUJILLO)',
          );
          return irA('PART_CIUDAD', s.ctx);
        }
        if (msg === '3') {
          await responder(
            WhatsappBotService.MSG_DNI_RECOGE,
          );
          return irA('REGALO_DNI', { ...s.ctx, soloRecoge: true });
        }
        if (msg === '4') {
          // Regalo/encargo COMPLETO: otra persona Y otra dirección
          // (puede ser otra ciudad). Tras el DNI se captura la dirección
          // con atajo "misma" — ver continuarConRecibe/PART_CIUDAD.
          await responder(
            '🎁 ¡Buen detalle!\n' + WhatsappBotService.MSG_DNI_RECOGE,
          );
          return irA('REGALO_DNI', { ...s.ctx, regaloDireccion: true });
        }
        await responder(
          'Responde *1* (misma dirección), *2* (cambiarla), *3* (la misma ' +
            'pero recoge otra persona), *4* (para otra persona en otra ' +
            'dirección) o *0* para el menú 🙂',
        );
        return;
      }

      case 'PART_CIUDAD': {
        if (!s.ctx.participanteId || !s.ctx.sorteoId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        // Atajo de la opción 4 (regalo/encargo): "1 = misma dirección" —
        // la dirección guardada se queda, solo se actualiza quién recibe.
        if (msg === '1' && s.ctx.regaloDireccion && s.ctx.recibeNombre) {
          await this.prisma.sorteoParticipante.updateMany({
            where: this.whereParticipacion(empresaId, s.ctx),
            data: {
              recibeNombre: s.ctx.recibeNombre ?? null,
              recibeDni: s.ctx.recibeDni ?? null,
              // "A la misma dirección" = la confirmó.
              direccionConfirmadaEn: new Date(),
            },
          });
          await this.sincronizarPremioDeParticipacion(
            empresaId,
            s.ctx.participanteId,
          );
          this.realtime.notifySorteoCambiado({
            empresaId,
            sorteoId: s.ctx.sorteoId,
          });
          await responder(
            `🎁 ¡Listo! El paquete lo recogerá *${s.ctx.recibeNombre}* ` +
              'en la misma dirección.\n\n' +
              (await this.cierreFlujo(empresaId, s.ctx)),
          );
          return irA('MENU', {});
        }
        if (msg === '-') {
          // Si venía definiendo un regalo/encargo, NO perder al que
          // recibe: queda anotado aunque la dirección se coordine luego.
          if (s.ctx.recibeNombre) {
            await this.prisma.sorteoParticipante.updateMany({
              where: this.whereParticipacion(empresaId, s.ctx),
              data: {
                recibeNombre: s.ctx.recibeNombre,
                recibeDni: s.ctx.recibeDni ?? null,
              },
            });
            await this.sincronizarPremioDeParticipacion(
              empresaId,
              s.ctx.participanteId,
            );
            this.realtime.notifySorteoCambiado({
              empresaId,
              sorteoId: s.ctx.sorteoId,
            });
          }
          await responder(
            '👌 De acuerdo. ' +
              (s.ctx.recibeNombre
                ? `Quedó anotado que lo recibirá *${s.ctx.recibeNombre}*. `
                : '') +
              (await this.cierreFlujo(empresaId, s.ctx)) +
              '\n\n(cuando tengas tus datos de envío, escribe *2* en el ' +
              'menú y los completamos 📦)',
          );
          return irA('MENU', {});
        }
        const ciudad = WhatsappBotService.campoCorto(msg);
        if (!ciudad) {
          await responder(
            '📍 Solo el nombre de la *ciudad* por favor (ej. TRUJILLO)' +
              (s.ctx.regaloDireccion && s.ctx.recibeNombre
                ? '\n*1* — A la misma dirección'
                : ' — o responde *-* para omitir'),
          );
          return;
        }
        await responder(
          `📍 ¿En qué *departamento* está ${ciudad}? (ej. LA LIBERTAD)`,
        );
        return irA('PART_DEPARTAMENTO', { ...s.ctx, provincia: ciudad });
      }

      case 'PART_DEPARTAMENTO': {
        const departamento = WhatsappBotService.campoCorto(msg);
        if (!departamento) {
          await responder(
            '📍 Solo el *departamento* por favor (ej. LA LIBERTAD)',
          );
          return;
        }
        await responder(
          `¿Cuál es la *dirección o sucursal* de ${s.ctx.agencia ?? WhatsappBotService.AGENCIA_DEFAULT} ` +
            'en esa ciudad? (ej. ATAHUALPA)\n' +
            'Responde *-* si no la sabes.',
        );
        return irA('PART_DIRECCION', {
          ...s.ctx,
          departamento,
        });
      }

      case 'PART_DIRECCION': {
        // GUARD CRÍTICO: sin participanteId, el updateMany quedaría solo
        // con {empresaId} y pisaría el envío de TODOS los participantes.
        if (!s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        const direccion = WhatsappBotService.sinDato(msg)
          ? null
          : msg.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 80);
        await this.prisma.sorteoParticipante.updateMany({
          where: this.whereParticipacion(empresaId, s.ctx),
          data: {
            agenciaNombre: s.ctx.agencia,
            destinoProvincia: s.ctx.provincia ?? null,
            destinoDepartamento: s.ctx.departamento ?? null,
            agenciaDireccion: direccion,
            // REGALO: quien recibe (null = el propio jugador).
            recibeNombre: s.ctx.recibeNombre ?? null,
            recibeDni: s.ctx.recibeDni ?? null,
            // La tipeó él mismo → confirmada.
            direccionConfirmadaEn: new Date(),
          },
        });
        // Dinámica post-activación: el premio ya existe → copiarle la
        // dirección recién capturada.
        await this.sincronizarPremioDeParticipacion(
          empresaId,
          s.ctx.participanteId,
        );
        // La card del participante muestra estos datos → refrescar YA.
        this.realtime.notifySorteoCambiado({
          empresaId,
          sorteoId: s.ctx.sorteoId,
        });
        const destinoTxt = [s.ctx.provincia, s.ctx.departamento]
          .filter(Boolean)
          .join(', ');
        if (s.ctx.recibeNombre) {
          // Regalo/encargo ya definido antes de la dirección.
          await responder(
            '📦 ¡Datos de envío guardados! ' +
              `🎁 El premio lo recibirá *${s.ctx.recibeNombre}* por ` +
              `*${s.ctx.agencia}*${destinoTxt ? ` a *${destinoTxt}*` : ''}` +
              `${direccion ? ` (sucursal ${direccion})` : ''}.\n\n` +
              (await this.cierreFlujo(empresaId, s.ctx)),
          );
          return irA('MENU', {});
        }
        // El registrado no siempre puede ir a la agencia: preguntar
        // SIEMPRE quién recogerá el paquete (encargo o regalo).
        await responder(
          '📦 ¡Dirección guardada! ' +
            `Envío por *${s.ctx.agencia}*${destinoTxt ? ` a *${destinoTxt}*` : ''}` +
            `${direccion ? ` (sucursal ${direccion})` : ''}.\n\n` +
            '👤 ' +
            WhatsappBotService.MSG_QUIEN_RECOGE,
        );
        return irA('PART_RECOGE', { ...s.ctx, direccion });
      }

      case 'PART_RECOGE': {
        if (!s.ctx.participanteId || !s.ctx.sorteoId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (msg === '1') {
          // Lo recoge el propio jugador (recibe* ya quedó null al
          // guardar la dirección).
          await responder(
            '✅ ¡Listo! Tú recogerás el paquete con tu DNI.\n\n' +
              (await this.cierreFlujo(empresaId, s.ctx)),
          );
          return irA('MENU', {});
        }
        if (msg === '2') {
          await responder(
            WhatsappBotService.MSG_DNI_RECOGE,
          );
          // soloRecoge: la dirección YA está guardada — al terminar solo
          // se actualiza quién recibe.
          return irA('REGALO_DNI', { ...s.ctx, soloRecoge: true });
        }
        await responder(
          'Responde *1* si lo recoges tú, *2* si irá otra persona 🎁 ' +
            'o *0* para el menú.',
        );
        return;
      }

      case 'GANADOR_QUIEN': {
        if (!s.ctx.premioId && !s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (msg === '1') {
          await responder(
            '📍 ¿A qué *ciudad* te lo enviamos? (ej. TRUJILLO)',
          );
          // Yo mismo: limpiar cualquier regalo previo.
          return irA('GANADOR_CIUDAD', {
            ...s.ctx,
            recibeNombre: null,
            recibeDni: null,
          });
        }
        if (msg === '2') {
          await responder(
            WhatsappBotService.MSG_DNI_RECOGE,
          );
          // regaloDireccion: si la participación ya tiene dirección, tras
          // el DNI se ofrece el atajo "1 = misma" (no re-tipearla).
          return irA('REGALO_DNI', { ...s.ctx, regaloDireccion: true });
        }
        await responder(
          'Responde *1* si lo recoges tú, *2* si irá otra persona 🎁 ' +
            'o *0* para el menú.',
        );
        return;
      }

      case 'GANADOR_CIUDAD': {
        const ciudad = WhatsappBotService.campoCorto(msg);
        if (!ciudad) {
          await responder(
            '📍 Solo el nombre de la *ciudad* por favor (ej. TRUJILLO)',
          );
          return;
        }
        await responder(
          `📍 ¿En qué *departamento* está ${ciudad}? (ej. LA LIBERTAD)`,
        );
        return irA('GANADOR_DEPARTAMENTO', { ...s.ctx, provincia: ciudad });
      }

      case 'GANADOR_DEPARTAMENTO': {
        const departamento = WhatsappBotService.campoCorto(msg);
        if (!departamento) {
          await responder(
            '📍 Solo el *departamento* por favor (ej. LA LIBERTAD)',
          );
          return;
        }
        await responder(
          `¿Cuál es la *dirección o sucursal* de ${s.ctx.agencia ?? WhatsappBotService.AGENCIA_DEFAULT} ` +
            'en esa ciudad? (ej. ATAHUALPA)\n' +
            'Responde *-* si no la sabes.',
        );
        return irA('GANADOR_DIRECCION', {
          ...s.ctx,
          departamento,
        });
      }

      case 'GANADOR_DIRECCION': {
        const direccion = WhatsappBotService.sinDato(msg)
          ? null
          : msg.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 80);
        return this.guardarAgenciaGanador(
          empresaId,
          celular,
          { ...s.ctx, direccion },
          responder,
          irA,
        );
      }

      // Ganador con dirección YA registrada (la dio antes con la opción
      // 2): confirmarla o cambiarla. Ctx solo premioId — sobrevive el
      // cierre del sorteo (el premio pendiente se gestiona igual).
      case 'GANADOR_CONFIRMA': {
        if (!s.ctx.premioId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (msg === '1') {
          // Confirmó la dirección de su premio → sello en su registro de
          // participante (chip "Dirección confirmada" en la card).
          const premio = await this.prisma.sorteoPremio.findFirst({
            where: { id: s.ctx.premioId, empresaId },
            select: { sorteoId: true, ganadorDni: true },
          });
          if (premio?.ganadorDni) {
            await this.prisma.sorteoParticipante.updateMany({
              where: { sorteoId: premio.sorteoId, dni: premio.ganadorDni },
              data: { direccionConfirmadaEn: new Date() },
            });
            this.realtime.notifySorteoCambiado({
              empresaId,
              sorteoId: premio.sorteoId,
            });
          }
          await responder(
            '📦 ¡Listo! Tu premio saldrá a la dirección registrada.\n' +
              'Te enviaremos el ticket de envío por aquí cuando lo despachemos 🚚',
          );
          return irA('MENU', {});
        }
        if (msg === '2') {
          // Desde PREPARANDO ya no se cambia — avisar AQUÍ, no después
          // de hacerle tipear ciudad y departamento.
          const premio = await this.prisma.sorteoPremio.findFirst({
            where: { id: s.ctx.premioId, empresaId },
          });
          if (
            premio &&
            WhatsappBotService.premioNoAdmiteCambioEnvio(premio)
          ) {
            await responder(WhatsappBotService.MSG_PREMIO_EN_PREPARACION);
            return irA('MENU', {});
          }
          await responder(WhatsappBotService.MSG_QUIEN_RECOGE);
          return irA('GANADOR_QUIEN', {
            premioId: s.ctx.premioId,
            agencia: s.ctx.agencia,
          });
        }
        await responder(
          'Responde *1* para usar esa dirección, *2* para cambiarla ' +
            'o *0* para el menú.',
        );
        return;
      }

      // Premio en EFECTIVO 💸: confirmar a qué número se le yapea.
      case 'GANADOR_YAPE': {
        if (!s.ctx.premioId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        if (msg === '1') {
          return this.guardarAbonoPremio(
            empresaId,
            celular.slice(-9),
            s.ctx,
            responder,
            irA,
          );
        }
        if (msg === '2') {
          await responder(
            '💳 ¿A qué *número* te yapeamos? (9 dígitos, ej. 987654321)',
          );
          return irA('GANADOR_YAPE_NUMERO', s.ctx);
        }
        // Atajo: mandó el número directo.
        const directo = msg.replace(/\D/g, '');
        if (directo.length === 9 && directo.startsWith('9')) {
          return this.guardarAbonoPremio(
            empresaId,
            directo,
            s.ctx,
            responder,
            irA,
          );
        }
        await responder(
          'Responde *1* para el abono a este número, *2* para indicar ' +
            'otro o *0* para el menú.',
        );
        return;
      }

      case 'GANADOR_YAPE_NUMERO': {
        if (!s.ctx.premioId) {
          return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
        }
        const num = msg.replace(/\D/g, '');
        if (num.length !== 9 || !num.startsWith('9')) {
          await responder(
            'Ese no parece un celular 🙈 deben ser *9 dígitos* ' +
              '(ej. 987654321) — inténtalo de nuevo (o *0* para el menú):',
          );
          return;
        }
        return this.guardarAbonoPremio(empresaId, num, s.ctx, responder, irA);
      }

      default:
        return this.mostrarMenu(s.sorteos, responder, irA, s.agenteHabilitado);
    }
  }

  // ── Pasos compuestos ─────────────────────────────────────────────────

  private async mostrarMenu(
    sorteos: { id: string; titulo: string; tipo: TipoSorteo }[],
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
    agenteHabilitado = false,
  ) {
    // Todo se saluda como EVENTO (sorteo/bingo/dinámica por igual —
    // pedido del user): "¡Tenemos el evento *CAJASOO* activo!"; con
    // varios, "¡Tenemos *2 eventos* activos!". El resto del flujo igual.
    let saludo: string;
    let opcion1: string;
    if (sorteos.length === 1) {
      const s0 = sorteos[0] as any;
      if (s0.tipo === TipoSorteo.DINAMICA) {
        saludo = `¡Hola! ¡Tenemos el evento *${s0.titulo}* activo! 😄`;
        opcion1 = `*1* — Participar en el ${s0.titulo}`;
      } else if (s0.tipo === TipoSorteo.BINGO) {
        saludo =
          `¡Hola! 🎱 ¡Tenemos el evento *${s0.titulo}* activo!` +
          this.infoFechasRifa(s0);
        opcion1 = '*1* — Comprar cartillas del bingo';
      } else {
        saludo =
          `¡Hola! 👋 ¡Tenemos el evento *${s0.titulo}* activo! 🎉` +
          this.infoFechasRifa(s0);
        opcion1 = '*1* — Participar en el sorteo';
      }
    } else {
      saludo =
        `¡Hola! 👋 ¡Tenemos *${sorteos.length} eventos* activos! 🎉`;
      opcion1 = '*1* — Participar en un evento';
    }
    // Links del LIVE: con un solo sorteo el bloque va directo; con
    // varios, cada bloque lleva el título para saber cuál es cuál.
    let live = '';
    if (sorteos.length === 1) {
      live = WhatsappBotService.textoLive(sorteos[0] as any);
    } else {
      for (const x of sorteos) {
        live += WhatsappBotService.textoLive(
          x as any,
          `${(x as any).titulo} EN VIVO`,
        );
      }
    }
    // "Ver los premios" solo si hay catálogo registrado (rifas).
    const hayPremios =
      (await this.prisma.sorteoPremioCatalogo.count({
        where: { sorteoId: { in: sorteos.map((x: any) => x.id) } },
      })) > 0;
    await responder(
      `${saludo}${live}\n\n` +
        'Responde con el número:\n' +
        `${opcion1}\n` +
        '*2* — Cambiar mis datos de envío 📦\n' +
        '*3* — Hablar con un asesor' +
        (hayPremios ? '\n*4* — Ver los premios 🎁' : '') +
        // Convivencia con el agente IA: invita a consultar el catálogo escribiendo.
        (agenteHabilitado
          ? '\n\n🛍️ ¿Buscas otra cosa? Escríbeme el producto (ej. "lapiceros") y te muestro.'
          : ''),
    );
    // Memoria de QUÉ se ofreció: si al responder "1" la lista ya cambió
    // (cerraron/abrieron sorteos), el bot reofrece en vez de registrar.
    return irA('MENU', { ofrecidos: sorteos.map((x) => x.id) });
  }

  /**
   * Opción 4: envía por WhatsApp los premios REGISTRADOS en el catálogo
   * de las rifas abiertas — primero el listado en texto y luego la FOTO
   * de cada premio que la tenga (subida por la empresa en el app).
   */
  private async verPremios(
    instanceName: string,
    empresaId: string,
    celular: string,
    sorteos: any[],
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    const items = await this.prisma.sorteoPremioCatalogo.findMany({
      where: { sorteoId: { in: sorteos.map((x) => x.id) } },
      orderBy: { creadoEn: 'asc' },
    });
    if (items.length === 0) {
      await responder(
        'Aún no publicamos los premios — muy pronto los anunciamos por aquí 🎁',
      );
      return irA('MENU', {});
    }
    // Listado en texto (agrupado por sorteo si hay varios).
    const porSorteo = new Map<string, typeof items>();
    for (const it of items) {
      if (!porSorteo.has(it.sorteoId)) porSorteo.set(it.sorteoId, [] as any);
      porSorteo.get(it.sorteoId)!.push(it);
    }
    const bloques = [...porSorteo.entries()].map(([sorteoId, lista]) => {
      const sorteo = sorteos.find((x) => x.id === sorteoId);
      const titulo = sorteo?.titulo ?? 'el sorteo';
      const lineas = lista
        .map(
          (it) =>
            `• ${it.cantidad > 1 ? `${it.cantidad}× ` : ''}${it.descripcion}`,
        )
        .join('\n');
      return (
        `🎁 *Premios de ${titulo}:*\n${lineas}` +
        (sorteo ? this.infoFechasRifa(sorteo) : '')
      );
    });
    await responder(
      `${bloques.join('\n\n')}\n\n` +
        'Mientras más tickets tengas, más chances de ganar 🍀 ' +
        'Escribe *1* para participar.',
    );
    // Fotos de los premios (solo las registradas en el catálogo).
    const imagenes = await this.prisma.archivo.findMany({
      where: {
        entidadTipo: 'SORTEO_PREMIO_CATALOGO',
        entidadId: { in: items.map((x) => x.id) },
      },
      orderBy: { creadoEn: 'desc' },
      select: { url: true, entidadId: true },
    });
    for (const it of items) {
      const img = imagenes.find((a) => a.entidadId === it.id);
      if (!img) continue;
      await this.evolution
        .sendImage({
          instanceName,
          number: celular,
          mediaUrl: img.url,
          caption: `${it.cantidad > 1 ? `${it.cantidad}× ` : ''}${it.descripcion}`,
        })
        .catch((e) =>
          this.logger.warn(
            `Foto de premio ${it.id} no se pudo enviar: ${(e as Error).message}`,
          ),
        );
    }
    return irA('MENU', {});
  }

  private async iniciarRegistro(
    empresaId: string,
    celular: string,
    sorteoId: string,
    agencia: string,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
    // Título del sorteo: SIEMPRE decirle a cuál está entrando (que
    // nunca se registre a ciegas — ver carrera del menú desactualizado).
    titulo?: string | null,
  ) {
    // ¿Este número ya está registrado en el sorteo? → ofrecer otra
    // participación (compra múltiple de tickets).
    const previo = await this.prisma.sorteoParticipante.findFirst({
      where: { sorteoId, celular },
      orderBy: { creadoEn: 'desc' },
    });
    if (previo) {
      return this.ofrecerReparticipacion(sorteoId, previo, responder, irA);
    }
    await responder(
      '¡Buenísimo! 🎉 ' +
        (titulo ? `Estás participando en *${titulo}*.\n` : '') +
        'Para registrarte envíame tu *DNI* (8 dígitos) — ' +
        'extranjeros: su *CE* (9 dígitos):',
    );
    return irA('ESPERANDO_DNI', { sorteoId, agencia });
  }

  private async registrarParticipante(
    empresaId: string,
    celular: string,
    ctx: any,
    dni: string,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    const sorteo = await this.prisma.sorteo.findFirst({
      where: {
        id: ctx.sorteoId,
        empresaId,
        estado: EstadoSorteo.ABIERTO,
        reabierto: false,
      },
    });
    if (!sorteo) {
      await responder('Ese sorteo ya se cerró 🙈 escribe *menu* para ver los activos.');
      return irA('MENU', {});
    }
    // SORTEO/BINGO = venta de TICKETS/CARTILLAS: se pregunta cuántos
    // (más unidades, más chances).
    if (sorteo.tipo !== TipoSorteo.DINAMICA) {
      const precio = sorteo.precioParticipacion
        ? ` (S/ ${Number(sorteo.precioParticipacion).toFixed(2)} c/u)`
        : '';
      const esBingo = sorteo.tipo === TipoSorteo.BINGO;
      await responder(
        (ctx.verificado == true
          ? `🪪 DNI verificado: *${ctx.nombre}*\n`
          : '') +
          (esBingo
            ? `🎱 ¿Cuántas cartillas quieres${precio}? Te enviaré cada ` +
              'cartilla B-I-N-G-O por aquí al validar tu pago — mientras ' +
              'más tengas, más chances.\n'
            : `🎟️ ¿Cuántos tickets quieres${precio}? Cada ticket lleva tu ` +
              'nombre al ánfora — mientras más tengas, más chances de ganar.\n') +
          `Responde con un número del *1* al *${WhatsappBotService.MAX_TICKETS_COMPRA}*.`,
      );
      return irA('CANTIDAD_TICKETS', { ...ctx, dni });
    }
    // El duplicado se maneja ANTES (ofrecerReparticipacion): un DNI
    // puede tener varias participaciones en el mismo sorteo.
    const creado = await this.prisma.sorteoParticipante.create({
      data: {
        empresaId,
        sorteoId: sorteo.id,
        celular,
        nombre: ctx.nombre ?? '',
        dni,
      },
    });
    const participanteId = creado.id;
    // La lista de participantes se refresca sola en los devices.
    this.realtime.notifySorteoCambiado({ empresaId, sorteoId: sorteo.id });

    // Registrado ✅ → el PAGO va de inmediato (los datos de envío se
    // piden recién cuando la empresa VALIDA el pago — ver
    // notificarActivacionParticipante).
    const cabecera =
      (ctx.verificado == true ? `🪪 DNI verificado: *${ctx.nombre}*\n` : '') +
      `✅ ¡Quedaste registrado en *${sorteo.titulo}*, ${(ctx.nombre ?? '').split(' ')[0]}!\n\n`;

    // Recurrente: sus datos de envío previos se copian YA (el auto-premio
    // los usa aunque no responda después) — se confirman tras el pago.
    const previos = await this.datosEnvioPrevios(empresaId, dni);
    if (previos) {
      await this.prisma.sorteoParticipante.update({
        where: { id: participanteId },
        data: previos,
      });
    }
    await responder(
      cabecera +
        (await this.instruccionesPago(empresaId, {
          ...ctx,
          sorteoId: sorteo.id,
        })) +
        WhatsappBotService.MSG_QUIEN_YAPEA,
    );
    return irA('PAGO_QUIEN', {
      participanteId,
      sorteoId: sorteo.id,
      agencia: ctx.agencia,
      confirmaDireccion: !!previos,
    });
  }

  /**
   * COMPRA de tickets (tipo SORTEO): crea N participaciones con el mismo
   * compraId — un solo pago (monto = N × precio), validación en bloque y
   * una sola confirmación. Copia la dirección previa del DNI a TODAS.
   */
  private async crearTickets(
    empresaId: string,
    celular: string,
    ctx: any,
    cantidad: number,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    const sorteo = await this.prisma.sorteo.findFirst({
      where: {
        id: ctx.sorteoId,
        empresaId,
        estado: EstadoSorteo.ABIERTO,
        reabierto: false,
      },
    });
    if (!sorteo) {
      await responder(
        'Ese sorteo ya se cerró 🙈 escribe *menu* para ver los activos.',
      );
      return irA('MENU', {});
    }
    const previos = await this.datosEnvioPrevios(empresaId, ctx.dni);
    const compraId = randomUUID();
    let primeraId = '';
    for (let i = 0; i < cantidad; i++) {
      const creado = await this.prisma.sorteoParticipante.create({
        data: {
          empresaId,
          sorteoId: sorteo.id,
          celular,
          nombre: ctx.nombre ?? '',
          dni: ctx.dni,
          compraId,
          ...(previos ?? {}),
        },
      });
      if (!primeraId) primeraId = creado.id;
    }
    this.realtime.notifySorteoCambiado({ empresaId, sorteoId: sorteo.id });

    const unidad =
      sorteo.tipo === TipoSorteo.BINGO
        ? `cartilla${cantidad === 1 ? '' : 's'} 🎱`
        : `ticket${cantidad === 1 ? '' : 's'} 🎟️`;
    const cabecera =
      (ctx.verificado == true ? `🪪 DNI verificado: *${ctx.nombre}*\n` : '') +
      `✅ ¡Listo, ${(ctx.nombre ?? '').split(' ')[0]}! Reservé tus ` +
      `*${cantidad}* ${unidad} para *${sorteo.titulo}*` +
      this.infoFechasRifa(sorteo) +
      '\n\n';
    await responder(
      cabecera +
        (await this.instruccionesPago(empresaId, {
          sorteoId: sorteo.id,
          cantidadTickets: cantidad,
        })) +
        WhatsappBotService.MSG_QUIEN_YAPEA,
    );
    return irA('PAGO_QUIEN', {
      participanteId: primeraId,
      compraId,
      sorteoId: sorteo.id,
      agencia: ctx.agencia ?? null,
      confirmaDireccion: !!previos,
    });
  }

  /**
   * Cierre del flujo de envío: antes de validar el pago → instrucciones
   * de pago; después (postActivacion) → despedida.
   */
  private async cierreFlujo(empresaId: string, ctx: any): Promise<string> {
    // Sin "¡Listo!" propio: cada caller ya abre celebrando.
    const despedida =
      'Te avisaremos por aquí cuando tu premio esté en camino 🚚';
    if (ctx.postActivacion) return despedida;
    // Editar el envío de una jugada YA VALIDADA (opción 2 del menú) no
    // debe volver a pedir el pago — se decide por el estado REAL.
    if (ctx.participanteId) {
      const p = await this.prisma.sorteoParticipante.findFirst({
        where: { id: ctx.participanteId, empresaId },
        include: { sorteo: { select: { tipo: true } } },
      });
      if (p?.estado === EstadoParticipanteSorteo.ACTIVO) {
        return (p as any).sorteo?.tipo === TipoSorteo.DINAMICA
          ? despedida
          : '¡Mucha suerte en el sorteo! 🍀';
      }
    }
    return this.instruccionesPago(empresaId, ctx);
  }

  /**
   * Dinámicas: si la participación ya tiene premio (auto-creado al
   * validar) y el cliente completa/cambia su envío DESPUÉS, el premio
   * hereda los datos — solo antes del despacho.
   */
  private async sincronizarPremioDeParticipacion(
    empresaId: string,
    participanteId: string | undefined,
  ): Promise<void> {
    if (!participanteId) return;
    const p = await this.prisma.sorteoParticipante.findFirst({
      where: { id: participanteId, empresaId },
    });
    if (!p?.agenciaNombre) return;
    const { count } = await this.prisma.sorteoPremio.updateMany({
      where: {
        participanteId,
        estado: {
          in: [EstadoPremioSorteo.REGISTRADO, EstadoPremioSorteo.PREPARANDO],
        },
      },
      data: {
        modalidad: 'ENVIO_AGENCIA',
        agenciaNombre: p.agenciaNombre,
        destinoDepartamento: p.destinoDepartamento,
        destinoProvincia: p.destinoProvincia,
        agenciaDireccion: p.agenciaDireccion,
        recibeNombre: p.recibeNombre,
        recibeDni: p.recibeDni,
      },
    });
    if (count > 0) {
      this.realtime.notifySorteoCambiado({ empresaId, sorteoId: p.sorteoId });
    }
  }

  /**
   * Tras VALIDAR el pago (llamado desde el backend al activar): confirma
   * el ticket y pide los datos de envío (o confirmar los ya copiados).
   * Deja la conversación en el paso correspondiente con postActivacion —
   * los cierres de flujo ya no piden pago.
   */
  async notificarActivacionParticipante(
    empresaId: string,
    participanteId: string,
  ): Promise<boolean> {
    if (!this.evolution.disponible) return false;
    const cfg = await this.prisma.integracionWhatsapp.findUnique({
      where: { empresaId },
    });
    if (!cfg || !cfg.habilitado || cfg.estado !== 'CONECTADO') return false;
    const p = await this.prisma.sorteoParticipante.findFirst({
      where: { id: participanteId, empresaId },
      include: {
        sorteo: {
          select: {
            titulo: true,
            tipo: true,
            reabierto: true,
            liveLinks: true,
          },
        },
      },
    });
    if (!p) return false;
    // Sorteo REABIERTO = regularización interna: el bot no escribe nada
    // (el participante ya fue atendido en su momento).
    if (p.sorteo.reabierto) return false;

    const agencia =
      cfg.agenciaEnvio?.trim() || WhatsappBotService.AGENCIA_DEFAULT;
    // COMPRA de tickets: la confirmación muestra el RANGO ("#12 al #31").
    let ticket = p.numeroTicket != null ? `#${p.numeroTicket}` : '';
    if (p.compraId) {
      const nums = (
        await this.prisma.sorteoParticipante.findMany({
          where: {
            compraId: p.compraId,
            empresaId,
            numeroTicket: { not: null },
          },
          select: { numeroTicket: true },
        })
      )
        .map((x) => x.numeroTicket as number)
        .sort((a, b) => a - b);
      if (nums.length > 1) {
        ticket = `#${nums[0]} al #${nums[nums.length - 1]}`;
      } else if (nums.length === 1) {
        ticket = `#${nums[0]}`;
      }
    }
    // Cabecera configurable por tipo (plantillaConfirmacion*); el cuerpo
    // (datos de envío) lo arma el bot según lo que ya tenga guardado.
    const plantilla =
      p.sorteo.tipo === TipoSorteo.DINAMICA
        ? cfg.plantillaConfirmacionDinamica?.trim() ||
          PLANTILLA_CONFIRMACION_DINAMICA_DEFAULT
        : cfg.plantillaConfirmacionSorteo?.trim() ||
          PLANTILLA_CONFIRMACION_SORTEO_DEFAULT;
    const base =
      renderPlantilla(plantilla, {
        nombre: p.nombre.split(' ')[0],
        titulo: p.sorteo.titulo,
        ticket,
        empresa: plantilla.includes('{empresa}')
          ? await this.nombreEmpresa(empresaId)
          : '',
      }) + '\n\n';
    const ctx = {
      participanteId: p.id,
      compraId: p.compraId ?? null,
      sorteoId: p.sorteoId,
      agencia,
      postActivacion: true,
    };

    let texto: string;
    let estado: string;
    if (p.sorteo.tipo !== TipoSorteo.DINAMICA) {
      // SORTEO y BINGO: la dirección se pide SOLO SI GANA (el bot le
      // escribe al adjudicarse el premio — notificarPremioGanado). La
      // compra queda corta: confirmación y suerte.
      texto =
        base +
        (p.sorteo.tipo === TipoSorteo.BINGO
          ? '¡Mucha suerte en el bingo! 🍀 Si ganas, te escribimos por aquí para coordinar tu premio 🎁'
          : '¡Mucha suerte en el sorteo! 🍀 Si ganas, te escribimos por aquí para coordinar tu premio 🎁') +
        WhatsappBotService.textoLive(p.sorteo, 'Síguelo EN VIVO');
      estado = 'MENU';
    } else if (p.agenciaNombre) {
      const destino = [p.destinoProvincia, p.destinoDepartamento]
        .filter(Boolean)
        .join(', ');
      texto =
        base +
        `📦 Tenemos esta dirección para tu envío: *${p.agenciaNombre}*` +
        `${destino ? ` a *${destino}*` : ''}` +
        `${p.agenciaDireccion ? ` (sucursal *${p.agenciaDireccion}*)` : ''}.\n` +
        '¿La usamos?\n' +
        '*1* — Sí, es la misma ✅\n' +
        '*2* — Cambiarla\n' +
        '*3* — La misma, pero el paquete lo recogerá OTRA persona 👤\n' +
        '*4* — Es para OTRA persona en OTRA dirección (regalo/encargo) 🎁\n' +
        '*0* — Volver al menú';
      estado = 'CONFIRMAR_ENVIO';
    } else {
      texto =
        base +
        `📦 Ahora tus datos de envío (van por *${agencia}*):\n` +
        '¿A qué *ciudad* te lo enviaríamos? (ej. TRUJILLO)\n' +
        'Responde *-* si prefieres coordinarlo después.';
      estado = 'PART_CIUDAD';
    }
    await this.evolution.sendText({
      instanceName: cfg.instanceName,
      number: p.celular,
      text: texto,
    });
    // BINGO: enviarle sus CARTILLAS como PDF (una por página — se ven,
    // se marcan o se imprimen). Fallback: texto monospace.
    if ((p.sorteo as any).tipo === TipoSorteo.BINGO) {
      const filasCartilla = await this.prisma.sorteoParticipante.findMany({
        where: p.compraId
          ? {
              compraId: p.compraId,
              empresaId,
              estado: EstadoParticipanteSorteo.ACTIVO,
            }
          : { id: p.id, empresaId },
        orderBy: { numeroTicket: 'asc' },
      });
      const cartillas = filasCartilla
        .filter((f) => Array.isArray(f.cartilla))
        .map((f) => ({
          numero: f.numeroTicket,
          nombre: f.nombre,
          grid: f.cartilla as number[][],
        }));
      if (cartillas.length > 0) {
        const empresaNombre = await this.nombreEmpresa(empresaId);
        // HÍBRIDO: pocas cartillas → IMÁGENES inline (mejor experiencia
        // en el live); compras grandes → un solo PDF (sin metralleta de
        // mensajes, imprimible). Fallback en cadena: imagen→PDF→texto.
        let enviado = false;
        if (
          cartillas.length <= WhatsappBotService.MAX_CARTILLAS_IMAGEN
        ) {
          enviado = await this.enviarCartillasImagen(
            cfg.instanceName,
            p.celular,
            p.sorteo.titulo,
            empresaNombre,
            cartillas,
          );
        }
        if (!enviado) {
          try {
            const base64 = await generarCartillasPdf({
              sorteoTitulo: p.sorteo.titulo,
              empresaNombre,
              cartillas,
            });
            await this.evolution.sendDocument({
              instanceName: cfg.instanceName,
              number: p.celular,
              base64,
              fileName: 'cartillas-bingo.pdf',
              caption:
                `🎱 Tus ${cartillas.length} cartilla${cartillas.length === 1 ? '' : 's'} ` +
                `de *${p.sorteo.titulo}* — ábrelas, márcalas o imprímelas. ¡Suerte! 🍀`,
            });
          } catch (e) {
            this.logger.warn(
              `PDF de cartillas falló (${(e as Error).message}) — fallback texto`,
            );
            const bloques = cartillas.map((c) =>
              this.textoCartilla(c.numero, c.grid),
            );
            for (let i = 0; i < bloques.length; i += 3) {
              await this.evolution
                .sendText({
                  instanceName: cfg.instanceName,
                  number: p.celular,
                  text: bloques.slice(i, i + 3).join('\n\n'),
                })
                .catch((err) =>
                  this.logger.warn(
                    `Cartillas bingo no enviadas: ${(err as Error).message}`,
                  ),
                );
            }
          }
        }
      }
    }
    await this.guardarConversacion(empresaId, p.celular, estado, ctx);
    return true;
  }

  /**
   * ¡GANASTE! — al adjudicarse un premio (modo JUGAR o registro manual
   * en SORTEO/BINGO) el bot le escribe al ganador y arranca el flujo:
   * EFECTIVO → confirmar el número de Yape del abono; físico → datos de
   * envío (confirmar la dirección que ya dio, o capturarla). El ctx va
   * SOLO con premioId (sin sorteoId): el flujo sobrevive el cierre del
   * sorteo — se juega justamente con el sorteo CERRADO.
   */
  async notificarPremioGanado(
    empresaId: string,
    premioId: string,
  ): Promise<boolean> {
    if (!this.evolution.disponible) return false;
    const cfg = await this.prisma.integracionWhatsapp.findUnique({
      where: { empresaId },
    });
    if (!cfg || !cfg.habilitado || cfg.estado !== 'CONECTADO') return false;
    const premio = await this.prisma.sorteoPremio.findFirst({
      where: { id: premioId, empresaId },
      include: {
        sorteo: { select: { titulo: true, tipo: true, reabierto: true } },
      },
    });
    if (!premio || premio.sorteo.reabierto) return false;

    // Celular: el de la participación ganadora (formato 51X…); premios
    // manuales sin participación usan el snapshot del registro.
    const part = premio.participanteId
      ? await this.prisma.sorteoParticipante.findFirst({
          where: { id: premio.participanteId, empresaId },
          select: { celular: true, numeroTicket: true },
        })
      : null;
    const soloDigitos = premio.ganadorCelular?.replace(/\D/g, '') ?? '';
    const celular =
      part?.celular ??
      (soloDigitos.length >= 9 ? `51${soloDigitos.slice(-9)}` : null);
    if (!celular) return false;

    const etiqueta =
      premio.sorteo.tipo === TipoSorteo.BINGO ? 'cartilla' : 'ticket';
    const conTicket =
      part?.numeroTicket != null
        ? ` con tu ${etiqueta} *#${part.numeroTicket}*`
        : '';
    const cabecera =
      `🎉 ¡FELICIDADES ${premio.ganadorNombre.split(' ')[0]}! 🎉\n` +
      `¡GANASTE${conTicket} en *${premio.sorteo.titulo}*!\n` +
      `🏆 Tu premio: *${premio.descripcion}*\n\n`;

    let texto: string;
    let estado: string;
    let ctx: any;
    if (premio.esEfectivo) {
      texto =
        cabecera +
        '💸 Es un premio en *EFECTIVO* — te lo yapeamos.\n' +
        `¿Te hacemos el abono al número desde el que escribes (*${celular.slice(-9)}*)?\n` +
        '*1* — Sí, a este número ✅\n' +
        '*2* — A otro número';
      estado = 'GANADOR_YAPE';
      ctx = { premioId: premio.id };
    } else {
      const agencia =
        cfg.agenciaEnvio?.trim() || WhatsappBotService.AGENCIA_DEFAULT;
      if (premio.agenciaNombre) {
        const destino = [premio.destinoProvincia, premio.destinoDepartamento]
          .filter(Boolean)
          .join(', ');
        texto =
          cabecera +
          `📦 Tenemos esta dirección para el envío: *${premio.agenciaNombre}*` +
          `${destino ? ` a *${destino}*` : ''}` +
          `${premio.agenciaDireccion ? ` (sucursal *${premio.agenciaDireccion}*)` : ''}.\n` +
          '¿La usamos?\n' +
          '*1* — Sí, es la misma ✅\n' +
          '*2* — Cambiarla\n' +
          '*0* — Volver al menú';
        estado = 'GANADOR_CONFIRMA';
      } else {
        texto =
          cabecera +
          `📦 Para enviártelo (va por *${agencia}*):\n` +
          WhatsappBotService.MSG_QUIEN_RECOGE;
        estado = 'GANADOR_QUIEN';
      }
      ctx = { premioId: premio.id, agencia };
    }
    await this.evolution.sendText({
      instanceName: cfg.instanceName,
      number: celular,
      text: texto,
    });
    await this.guardarConversacion(empresaId, celular, estado, ctx);
    return true;
  }

  /**
   * Cartillas como IMÁGENES inline (compras chicas): una por mensaje,
   * con su caption. true si TODAS salieron; false = usar el PDF.
   */
  private async enviarCartillasImagen(
    instanceName: string,
    celular: string,
    sorteoTitulo: string,
    empresaNombre: string,
    cartillas: { numero: number | null; nombre: string; grid: number[][] }[],
  ): Promise<boolean> {
    try {
      for (const c of cartillas) {
        const base64 = await generarCartillaPng({
          sorteoTitulo,
          empresaNombre,
          numero: c.numero,
          nombre: c.nombre,
          grid: c.grid,
        });
        await this.evolution.sendImage({
          instanceName,
          number: celular,
          base64,
          mimetype: 'image/png',
          fileName: `cartilla-${c.numero ?? 'bingo'}.png`,
          caption: `🎱 Cartilla *#${c.numero ?? '—'}* — ${sorteoTitulo}`,
        });
      }
      return true;
    } catch (e) {
      this.logger.warn(
        `Cartillas como imagen fallaron (${(e as Error).message}) — se usa PDF`,
      );
      return false;
    }
  }

  /** Cartilla 5×5 como texto monospace de WhatsApp (** = centro LIBRE). */
  private textoCartilla(numero: number | null, grid: number[][]): string {
    const cell = (n: number) =>
      n === 0 ? '**' : n.toString().padStart(2, ' ');
    const filas = grid.map((f) => f.map(cell).join('  ')).join('\n');
    return (
      `🎱 *CARTILLA #${numero ?? '—'}*\n` +
      '```\n B   I   N   G   O\n' +
      filas +
      '\n```'
    );
  }

  /**
   * Datos de envío previos del DNI (participante recurrente): última
   * participación con agencia, o su último premio enviado. null si es
   * la primera vez.
   */
  private async datosEnvioPrevios(
    empresaId: string,
    dni: string,
  ): Promise<{
    agenciaNombre: string;
    destinoDepartamento: string | null;
    destinoProvincia: string | null;
    agenciaDireccion: string | null;
  } | null> {
    const participante = await this.prisma.sorteoParticipante.findFirst({
      where: { empresaId, dni, agenciaNombre: { not: null } },
      orderBy: { creadoEn: 'desc' },
      select: {
        agenciaNombre: true,
        destinoDepartamento: true,
        destinoProvincia: true,
        agenciaDireccion: true,
      },
    });
    if (participante?.agenciaNombre) {
      return participante as any;
    }
    const premio = await this.prisma.sorteoPremio.findFirst({
      where: {
        empresaId,
        ganadorDni: dni,
        agenciaNombre: { not: null },
        estado: { not: EstadoPremioSorteo.ANULADO },
      },
      orderBy: { creadoEn: 'desc' },
      select: {
        agenciaNombre: true,
        destinoDepartamento: true,
        destinoProvincia: true,
        agenciaDireccion: true,
      },
    });
    return premio?.agenciaNombre ? (premio as any) : null;
  }

  /**
   * Instrucciones de pago: plantilla configurable por empresa Y por tipo
   * de sorteo (plantillaPagoSorteo | plantillaPagoDinamica, null =
   * default) con variables {monto} (precio de la participación),
   * {numero} (Yape de la empresa) y {empresa}. Cierra el flujo de
   * registro.
   */
  private async instruccionesPago(
    empresaId: string,
    ctx: any,
  ): Promise<string> {
    const [sorteo, yape, cfg] = await Promise.all([
      this.prisma.sorteo.findUnique({
        where: { id: ctx.sorteoId },
        select: { precioParticipacion: true, tipo: true },
      }),
      this.prisma.integracionYape.findUnique({
        where: { empresaId },
        select: { celular: true },
      }),
      this.prisma.integracionWhatsapp.findUnique({
        where: { empresaId },
        select: {
          plantillaPagoSorteo: true,
          plantillaPagoDinamica: true,
          numeroPago: true,
          numero: true,
        },
      }),
    ]);
    // Número para yapear: el configurado por la empresa; si no, el de la
    // integración Yape; último recurso el celular vinculado por WhatsApp.
    const numeroPago =
      cfg?.numeroPago?.trim() ||
      yape?.celular?.trim() ||
      this.celularLocal(cfg?.numero) ||
      null;
    // Compra de tickets: el monto es N × precio (una sola transferencia).
    const cantidad = ctx.cantidadTickets ?? 1;
    const monto = sorteo?.precioParticipacion
      ? `S/ ${(Number(sorteo.precioParticipacion) * cantidad).toFixed(2)}`
      : null;
    const esDinamica = sorteo?.tipo === TipoSorteo.DINAMICA;
    if (!monto) {
      // Sorteo sin precio: no hay monto que yapear — se coordina a mano.
      return (
        '💰 *Siguiente paso — el pago:*\n' +
        `Coordina el pago de tu participación por este chat${numeroPago ? ` (Yape: *${numeroPago}*)` : ''}.\n` +
        `Cuando lo validemos te confirmaremos tu ${esDinamica ? '*participación*' : '*número de ticket*'} 🎟️`
      );
    }
    const plantilla = esDinamica
      ? cfg?.plantillaPagoDinamica?.trim() || PLANTILLA_PAGO_DINAMICA_DEFAULT
      : cfg?.plantillaPagoSorteo?.trim() || PLANTILLA_PAGO_SORTEO_DEFAULT;
    return renderPlantilla(plantilla, {
      monto,
      numero: numeroPago || 'número de la empresa',
      empresa: plantilla.includes('{empresa}')
        ? await this.nombreEmpresa(empresaId)
        : '',
    });
  }

  /**
   * Celular local de 9 dígitos a partir del número vinculado por WhatsApp
   * (Evolution lo guarda como 51XXXXXXXXX). Null si no hay o no es peruano.
   */
  private celularLocal(numero?: string | null): string | null {
    const digits = (numero ?? '').replace(/\D/g, '');
    if (digits.length === 9 && digits.startsWith('9')) return digits;
    if (digits.length === 11 && digits.startsWith('519'))
      return digits.slice(2);
    return null;
  }

  /** Nombre COMERCIAL de la empresa (fallback a la razón social). */
  private async nombreEmpresa(empresaId: string): Promise<string> {
    const [empresa, configDocs] = await Promise.all([
      this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nombre: true },
      }),
      this.prisma.configuracionDocumentos.findUnique({
        where: { empresaId },
        select: { nombreComercial: true },
      }),
    ]);
    return configDocs?.nombreComercial?.trim() || empresa?.nombre || '';
  }

  /**
   * Ya participa en el sorteo: informa su estado y ofrece registrar
   * OTRA participación (compra múltiple de tickets — cada una con su
   * propio ticket y, en dinámicas, su propio premio al validar).
   */
  private async ofrecerReparticipacion(
    sorteoId: string,
    previo: {
      id: string;
      dni: string;
      nombre: string;
      estado: EstadoParticipanteSorteo;
      numeroTicket: number | null;
    },
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    const [activas, pendientes] = await Promise.all([
      this.prisma.sorteoParticipante.count({
        where: {
          sorteoId,
          dni: previo.dni,
          estado: EstadoParticipanteSorteo.ACTIVO,
        },
      }),
      this.prisma.sorteoParticipante.count({
        where: {
          sorteoId,
          dni: previo.dni,
          estado: EstadoParticipanteSorteo.PENDIENTE_PAGO,
        },
      }),
    ]);
    const resumen = [
      activas > 0 ? `${activas} activa${activas === 1 ? '' : 's'} 🎟️` : null,
      pendientes > 0
        ? `${pendientes} pendiente${pendientes === 1 ? '' : 's'} de pago`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const sorteo = await this.prisma.sorteo.findUnique({
      where: { id: sorteoId },
      select: { tipo: true },
    });
    const pregunta = sorteo?.tipo === TipoSorteo.SORTEO
        ? '¿Quieres comprar *más tickets*? 🎟️'
        : sorteo?.tipo === TipoSorteo.BINGO
            ? '¿Quieres comprar *más cartillas*? 🎱'
            : '¿Quieres participar *otra vez*? 🎟️';
    await responder(
      `¡Hola ${previo.nombre.split(' ')[0]}! Ya estás participando` +
        `${resumen ? ` (${resumen})` : ''}.\n\n` +
        `${pregunta}\n` +
        '*1* — Sí\n' +
        '*0* — No, volver al menú',
    );
    return irA('REPARTICIPAR', { sorteoId, previoId: previo.id });
  }

  /**
   * Where de la participación en edición: si el contexto viene de una
   * COMPRA de tickets, los datos (dirección/recibe/pagador) aplican a
   * TODAS sus filas — el ganador puede salir de cualquier ticket.
   */
  private whereParticipacion(empresaId: string, ctx: any) {
    return ctx.compraId
      ? { compraId: ctx.compraId as string, empresaId }
      : { id: ctx.participanteId as string, empresaId };
  }

  /** dd/mm/yyyy en hora de Lima (UTC-5). */
  private fechaLima(d?: Date | null): string | null {
    if (!d) return null;
    const l = new Date(d.getTime() - 5 * 3600000);
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(l.getUTCDate())}/${p(l.getUTCMonth() + 1)}/${l.getUTCFullYear()}`;
  }

  /**
   * Fechas de la RIFA para el cliente: venta de tickets hasta X y fecha
   * del juego. La fecha del sorteo solo se muestra si es HOY o futura
   * (los sorteos viejos tienen el default de creación — sería ruido).
   */
  private infoFechasRifa(s: {
    tipo: TipoSorteo;
    fechaSorteo?: Date | null;
    ventaHasta?: Date | null;
  }): string {
    if (s.tipo === TipoSorteo.DINAMICA) return '';
    const partes: string[] = [];
    const hasta = this.fechaLima(s.ventaHasta ?? null);
    if (hasta) {
      partes.push(
        s.tipo === TipoSorteo.BINGO
          ? `🎱 Cartillas a la venta hasta el *${hasta}*`
          : `🎟️ Tickets a la venta hasta el *${hasta}*`,
      );
    }
    if (s.fechaSorteo) {
      const hoyLima = new Date(Date.now() - 5 * 3600000);
      const inicioHoy = Date.UTC(
        hoyLima.getUTCFullYear(),
        hoyLima.getUTCMonth(),
        hoyLima.getUTCDate(),
      );
      if (s.fechaSorteo.getTime() - 5 * 3600000 >= inicioHoy) {
        partes.push(
          `📅 El sorteo se juega el *${this.fechaLima(s.fechaSorteo)}*`,
        );
      }
    }
    return partes.length ? `\n${partes.join('\n')}` : '';
  }

  /** "Ticket #N" / "Cartilla #N" (bingo) / "Participación #N" (dinámica). */
  private etiquetaJugada(
    numeroTicket: number | null,
    tipo: TipoSorteo,
  ): string {
    if (numeroTicket == null) return 'Pago por validar';
    if (tipo === TipoSorteo.DINAMICA) return `Participación #${numeroTicket}`;
    if (tipo === TipoSorteo.BINGO) return `Cartilla #${numeroTicket}`;
    return `Ticket #${numeroTicket}`;
  }

  /** Etiqueta de un grupo de tickets de la misma compra ("#12 al #31"). */
  private etiquetaGrupo(grupo: any[]): string {
    if (grupo.length === 1) {
      return this.etiquetaJugada(grupo[0].numeroTicket, grupo[0].sorteo.tipo);
    }
    const unidad =
      grupo[0].sorteo?.tipo === TipoSorteo.BINGO ? 'Cartilla' : 'Ticket';
    const nums = grupo
      .map((x) => x.numeroTicket)
      .filter((x: number | null): x is number => x != null)
      .sort((a, b) => a - b);
    if (nums.length === 0) return `Pago por validar (×${grupo.length})`;
    return nums.length === 1
      ? `${unidad} #${nums[0]}`
      : `${unidad}s #${nums[0]} al #${nums[nums.length - 1]}`;
  }

  /** "SHALOM → TRUJILLO, LA LIBERTAD · 🎁 recibe X" o "sin datos de envío". */
  private resumenEnvio(x: {
    agenciaNombre: string | null;
    destinoProvincia: string | null;
    destinoDepartamento: string | null;
    recibeNombre?: string | null;
  }): string {
    if (!x.agenciaNombre) return 'sin datos de envío';
    const destino = [x.destinoProvincia, x.destinoDepartamento]
      .filter(Boolean)
      .join(', ');
    return (
      `${x.agenciaNombre}${destino ? ` → ${destino}` : ''}` +
      (x.recibeNombre ? ` · 🎁 recibe ${x.recibeNombre.split(' ')[0]}` : '')
    );
  }

  /**
   * Opción 2 del menú: junta los PREMIOS pendientes sueltos y TODAS las
   * participaciones de sorteos abiertos. Con un solo ítem arranca
   * directo; con varios el cliente elige CUÁL registrar/actualizar
   * (jugadas distintas pueden ir a lugares o personas distintas).
   */
  private async iniciarFlujoGanador(
    empresaId: string,
    celular: string,
    agencia: string,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    // Se busca por los últimos 9 dígitos del remitente (los celulares
    // se guardan con o sin el 51).
    const last9 = celular.slice(-9);
    const [premios, participaciones] = await Promise.all([
      this.prisma.sorteoPremio.findMany({
        where: {
          empresaId,
          estado: {
            in: [EstadoPremioSorteo.REGISTRADO, EstadoPremioSorteo.PREPARANDO],
          },
          ganadorCelular: { contains: last9 },
        },
        orderBy: { creadoEn: 'asc' },
        include: { sorteo: { select: { estado: true, tipo: true } } },
      }),
      this.prisma.sorteoParticipante.findMany({
        where: {
          empresaId,
          celular: { contains: last9 },
          estado: { not: EstadoParticipanteSorteo.RECHAZADO },
          sorteo: { estado: EstadoSorteo.ABIERTO, reabierto: false },
        },
        orderBy: { creadoEn: 'asc' },
        include: { sorteo: { select: { titulo: true, tipo: true } } },
      }),
    ]);
    // Un premio ligado a una participación se gestiona SOLO por su
    // participación (sincronizarPremioDeParticipacion lo hereda): si la
    // dinámica cerró, la jugada ya no se lista y su premio TAMPOCO — lo
    // cerrado no es editable por el cliente. Quedan "sueltos" únicamente
    // los premios manuales de ganador: los de SORTEO clásico siempre que
    // estén pendientes (el ganador da su dirección aunque el sorteo ya
    // cerró); los de dinámicas solo con la dinámica ABIERTA.
    // COMPRA de tickets = UN solo ítem con su rango ("#12 al #31") —
    // comparten dirección/recibe, así que se editan juntas.
    const grupos = new Map<string, any[]>();
    for (const p of participaciones) {
      const key = (p as any).compraId ?? p.id;
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key)!.push(p);
    }
    const items: {
      premioId?: string;
      participanteId?: string;
      compraId?: string;
      etiqueta: string;
    }[] = [
      ...premios
        .filter((x) => !x.participanteId)
        .filter(
          (x: any) =>
            x.sorteo.tipo !== TipoSorteo.DINAMICA ||
            x.sorteo.estado === EstadoSorteo.ABIERTO,
        )
        .map((x) => ({
          premioId: x.id,
          etiqueta: `🏆 ${x.descripcion} · ${this.resumenEnvio(x)}`,
        })),
      ...[...grupos.values()].map((grupo) => ({
        participanteId: grupo[0].id,
        ...(grupo[0].compraId ? { compraId: grupo[0].compraId } : {}),
        etiqueta:
          `🎟️ ${this.etiquetaGrupo(grupo)}` +
          ` · ${grupo[0].sorteo.titulo} · ${this.resumenEnvio(grupo[0])}`,
      })),
    ];
    if (items.length === 0) {
      await responder(
        'No encontré un premio ni una participación asociada a este número 🤔\n' +
          'Elige la opción *3* para hablar con un asesor.',
      );
      return irA('MENU', {});
    }
    if (items.length > 1) {
      const lista = items
        .map((x, i) => `*${i + 1}* — ${x.etiqueta}`)
        .join('\n');
      await responder(
        `📦 Tienes *${items.length}* envíos conmigo. ¿Cuál quieres ` +
          `registrar o actualizar? Responde con el número:\n${lista}\n` +
          '*0* — Volver al menú',
      );
      return irA('ELIGIENDO_ENVIO', { items, agencia });
    }
    return this.arrancarActualizacionEnvio(
      empresaId,
      items[0],
      agencia,
      responder,
      irA,
    );
  }

  /** Arranca quién-recoge/dirección para un premio suelto o una participación. */
  private async arrancarActualizacionEnvio(
    empresaId: string,
    item: { premioId?: string; participanteId?: string; compraId?: string },
    agencia: string,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    if (item.premioId) {
      const premio = await this.prisma.sorteoPremio.findFirst({
        where: {
          id: item.premioId,
          empresaId,
          estado: {
            in: [EstadoPremioSorteo.REGISTRADO, EstadoPremioSorteo.PREPARANDO],
          },
        },
      });
      if (!premio) {
        await responder(
          'Tu premio ya fue despachado o no está disponible — coordina con la tienda (opción *3*).',
        );
        return irA('MENU', {});
      }
      if (WhatsappBotService.premioNoAdmiteCambioEnvio(premio)) {
        await responder(WhatsappBotService.MSG_PREMIO_EN_PREPARACION);
        return irA('MENU', {});
      }
      await responder(
        `🏆 ¡Felicidades ${premio.ganadorNombre.split(' ')[0]}! ` +
          `Tu premio: *${premio.descripcion}*.\n\n` +
          `📦 Los envíos se hacen por *${agencia}*.\n` +
          WhatsappBotService.MSG_QUIEN_RECOGE,
      );
      return irA('GANADOR_QUIEN', {
        premioId: premio.id,
        agencia,
      });
    }
    const participante = await this.prisma.sorteoParticipante.findFirst({
      where: { id: item.participanteId, empresaId },
      include: { sorteo: { select: { titulo: true, tipo: true } } },
    });
    if (!participante) {
      await responder(
        'Se perdió el contexto 🙈 escribe *menu* y volvemos a empezar.',
      );
      return irA('MENU', {});
    }
    const verbo = participante.agenciaNombre ? 'actualicemos' : 'registremos';
    const esDinamica =
      (participante as any).sorteo.tipo === TipoSorteo.DINAMICA;
    let cual =
      participante.numeroTicket != null
        ? `tu ${esDinamica ? 'participación' : 'ticket'} *#${participante.numeroTicket}*`
        : 'tu participación';
    if (item.compraId) {
      // Compra de tickets: hablar del RANGO — se editan todas juntas.
      const grupo = await this.prisma.sorteoParticipante.findMany({
        where: { compraId: item.compraId, empresaId },
        include: { sorteo: { select: { titulo: true, tipo: true } } },
      });
      if (grupo.length > 1) {
        cual = `tus *${this.etiquetaGrupo(grupo)}*`;
      }
    }
    await responder(
      `📦 ${participante.nombre.split(' ')[0]}, ${verbo} el envío de ` +
        `${cual} en *${(participante as any).sorteo.titulo}* — los envíos ` +
        `se hacen por *${agencia}*.\n\n` +
        WhatsappBotService.MSG_QUIEN_RECOGE,
    );
    return irA('GANADOR_QUIEN', {
      participanteId: participante.id,
      compraId: item.compraId ?? null,
      // sorteoId es requisito de los pasos PART_* (guard + reset por
      // cierre) — sin él, el flujo de regalo moría en el menú.
      sorteoId: participante.sorteoId,
      agencia,
    });
  }

  /**
   * Con quien-recoge resuelto (nombre + DNI): si la dirección ya está
   * guardada (encargo) actualiza solo recibe* y cierra con el pago; si
   * no, sigue el flujo de dirección (ciudad → departamento → sucursal).
   */
  private async continuarConRecibe(
    empresaId: string,
    ctx: any,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    const intro =
      `🪪 Recogerá: *${ctx.recibeNombre}*` +
      `${ctx.recibeDni ? ` (DNI ${ctx.recibeDni})` : ''}` +
      `${ctx.recibeVerificado ? ' ✅' : ''}`;
    if (ctx.soloRecoge && ctx.participanteId) {
      await this.prisma.sorteoParticipante.updateMany({
        where: this.whereParticipacion(empresaId, ctx),
        data: {
          recibeNombre: ctx.recibeNombre ?? null,
          recibeDni: ctx.recibeDni ?? null,
          // "La misma dirección, recoge otro" = dirección confirmada.
          direccionConfirmadaEn: new Date(),
        },
      });
      await this.sincronizarPremioDeParticipacion(
        empresaId,
        ctx.participanteId,
      );
      // Refrescar la card YA (ctx puede no traer sorteoId — p.ej. vía
      // opción 2 del menú — así que se resuelve del participante).
      const part = await this.prisma.sorteoParticipante.findFirst({
        where: { id: ctx.participanteId, empresaId },
        select: { sorteoId: true },
      });
      if (part) {
        this.realtime.notifySorteoCambiado({
          empresaId,
          sorteoId: part.sorteoId,
        });
      }
      await responder(
        `${intro}\n\n` + (await this.cierreFlujo(empresaId, ctx)),
      );
      return irA('MENU', {});
    }
    // Opción 4 de CONFIRMAR_ENVIO (regalo/encargo con otra dirección):
    // el participante YA tiene una dirección guardada — ofrecerla como
    // atajo por si al final es la misma.
    if (ctx.regaloDireccion && ctx.participanteId) {
      const p = await this.prisma.sorteoParticipante.findFirst({
        where: { id: ctx.participanteId, empresaId },
        select: {
          agenciaNombre: true,
          destinoProvincia: true,
          destinoDepartamento: true,
          agenciaDireccion: true,
        },
      });
      if (p?.agenciaNombre) {
        const destino = [p.destinoProvincia, p.destinoDepartamento]
          .filter(Boolean)
          .join(', ');
        await responder(
          `${intro}\n\n📍 ¿A qué *ciudad* se lo enviamos? (ej. TRUJILLO)\n` +
            `*1* — A la misma dirección (*${p.agenciaNombre}*` +
            `${destino ? ` a ${destino}` : ''}` +
            `${p.agenciaDireccion ? `, sucursal ${p.agenciaDireccion}` : ''})`,
        );
        return irA('PART_CIUDAD', ctx);
      }
    }
    await responder(
      `${intro}\n\n📍 ¿A qué *ciudad* se lo enviamos? (ej. TRUJILLO)`,
    );
    return ctx.premioId
        ? irA('GANADOR_CIUDAD', ctx)
        : irA('PART_CIUDAD', ctx);
  }

  private async guardarAgenciaGanador(
    empresaId: string,
    celular: string,
    ctx: any,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    // GUARD: sin ningún id, la rama del premio haría findFirst con id
    // undefined y actualizaría un premio ARBITRARIO de la empresa.
    if (!ctx.premioId && !ctx.participanteId) {
      await responder('Se perdió el contexto 🙈 escribe *menu* y volvemos a empezar.');
      return irA('MENU', {});
    }
    const datosEnvio = {
      agenciaNombre: ctx.agencia,
      destinoProvincia: ctx.provincia ?? null,
      destinoDepartamento: ctx.departamento ?? null,
      agenciaDireccion: ctx.direccion ?? null,
      // REGALO: quien recibe (null explícito = lo recibe el ganador,
      // limpia un regalo anterior).
      recibeNombre: ctx.recibeNombre ?? null,
      recibeDni: ctx.recibeDni ?? null,
    };
    const destino = [ctx.provincia, ctx.departamento]
      .filter(Boolean)
      .join(', ');

    // Caso participante SIN premio aún: los datos quedan en su registro
    // (el auto-premio los usa al validar el pago).
    if (!ctx.premioId && ctx.participanteId) {
      const p = await this.prisma.sorteoParticipante.findFirst({
        where: { id: ctx.participanteId, empresaId },
        select: { sorteoId: true },
      });
      const { count } = await this.prisma.sorteoParticipante.updateMany({
        where: { id: ctx.participanteId, empresaId },
        // La dio él mismo (opción 2 del menú) → confirmada.
        data: { ...datosEnvio, direccionConfirmadaEn: new Date() },
      });
      if (p && count > 0) {
        // El auto-premio de ESTA participación hereda el envío nuevo.
        await this.sincronizarPremioDeParticipacion(
          empresaId,
          ctx.participanteId,
        );
        this.realtime.notifySorteoCambiado({
          empresaId,
          sorteoId: p.sorteoId,
        });
      }
      await responder(
        count > 0
          ? `📦 ¡Datos de envío guardados! Si ganas, tu premio saldría por ` +
              `*${ctx.agencia}*${destino ? ` a *${destino}*` : ''} 🚚`
          : 'No pude actualizar tus datos — intenta de nuevo con *2* o habla con un asesor (*3*).',
      );
      return irA('MENU', {});
    }

    // Caso ganador con premio — alineado con elegirAgenciaMiPremio del
    // app: cambios solo en REGISTRADO; en PREPARANDO únicamente la
    // PRIMERA captura. Los entry-points ya avisan; esto es el cinturón
    // (el estado del premio pudo cambiar a mitad de la conversación).
    const premio = await this.prisma.sorteoPremio.findFirst({
      where: {
        id: ctx.premioId,
        empresaId,
        estado: {
          in: [EstadoPremioSorteo.REGISTRADO, EstadoPremioSorteo.PREPARANDO],
        },
      },
    });
    if (!premio) {
      await responder(
        'Tu premio ya fue despachado o no está disponible — coordina con la tienda (opción *3*).',
      );
      return irA('MENU', {});
    }
    if (WhatsappBotService.premioNoAdmiteCambioEnvio(premio)) {
      await responder(WhatsappBotService.MSG_PREMIO_EN_PREPARACION);
      return irA('MENU', {});
    }
    await this.prisma.sorteoPremio.update({
      where: { id: premio.id },
      data: { modalidad: 'ENVIO_AGENCIA', ...datosEnvio },
    });
    this.realtime.notifySorteoCambiado({
      empresaId,
      sorteoId: premio.sorteoId,
    });
    // Sincronizar también su registro de participante (prellenados
    // futuros usan estos datos).
    if (premio.ganadorDni) {
      await this.prisma.sorteoParticipante.updateMany({
        where: { sorteoId: premio.sorteoId, dni: premio.ganadorDni },
        data: { ...datosEnvio, direccionConfirmadaEn: new Date() },
      });
    }
    await responder(
      `📦 ¡Listo! Tu premio te llegará por *${ctx.agencia}*` +
        (destino ? ` a *${destino}*` : '') +
        '.\nTe enviaremos el ticket de envío por aquí cuando lo despachemos 🚚',
    );
    return irA('MENU', {});
  }

  /**
   * "Yape en el aire": busca un pago RECIBIDO (ventana 24h de api-yape)
   * que calce con el participante o su pagador — por nombre y monto
   * esperado — y da feedback honesto. NUNCA valida: eso lo hace la
   * empresa desde el app (chip "⚠️ previo al registro").
   */
  private async feedbackYapeAnticipado(
    empresaId: string,
    ctx: any,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    const part = await this.prisma.sorteoParticipante.findFirst({
      where: { id: ctx.participanteId, empresaId },
      include: { sorteo: { select: { precioParticipacion: true } } },
    });
    let visto: string | null = null;
    if (part) {
      const n = ctx.compraId
        ? await this.prisma.sorteoParticipante.count({
            where: { compraId: ctx.compraId, empresaId },
          })
        : 1;
      const esperado = part.sorteo.precioParticipacion
        ? Number(part.sorteo.precioParticipacion) * n
        : null;
      const pagos =
        await this.integracionYape.listarPagosRecientes(empresaId);
      const hallado = pagos.find(
        (pg) =>
          (nombresCoinciden(pg.senderName, part.nombre) ||
            nombresCoinciden(pg.senderName, part.pagadorNombre)) &&
          (esperado == null || Math.abs(pg.amount - esperado) < 0.005),
      );
      if (hallado) {
        visto = `S/ ${hallado.amount.toFixed(2)} a nombre de *${hallado.senderName}*`;
      }
    }
    await responder(
      visto
        ? `✅ ¡Encontré tu yape de ${visto}! La tienda lo verificará y ` +
            'te confirmamos por aquí 🙏'
        : '👌 Anotado — buscaré tu yape (si lo hicieron hace poco puede ' +
            'demorar unos minutos en llegar). La tienda lo verificará y ' +
            'te confirmamos por aquí 🙏',
    );
    return irA('MENU', {});
  }

  /**
   * Guarda el número de Yape confirmado para un premio en EFECTIVO
   * (abonoNumero) — solo mientras el premio esté pendiente.
   */
  private async guardarAbonoPremio(
    empresaId: string,
    numero: string,
    ctx: any,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    // GUARD anti Prisma-undefined: sin premioId el findFirst matchearía
    // un premio arbitrario de la empresa.
    if (!ctx.premioId) {
      await responder(
        'Se perdió el contexto 🙈 escribe *menu* y volvemos a empezar.',
      );
      return irA('MENU', {});
    }
    const premio = await this.prisma.sorteoPremio.findFirst({
      where: {
        id: ctx.premioId,
        empresaId,
        estado: {
          in: [EstadoPremioSorteo.REGISTRADO, EstadoPremioSorteo.PREPARANDO],
        },
      },
    });
    if (!premio) {
      await responder(
        'Tu premio ya fue gestionado o no está disponible — coordina con la tienda (opción *3*).',
      );
      return irA('MENU', {});
    }
    await this.prisma.sorteoPremio.update({
      where: { id: premio.id },
      data: { abonoNumero: numero },
    });
    this.realtime.notifySorteoCambiado({
      empresaId,
      sorteoId: premio.sorteoId,
    });
    await responder(
      `💸 ¡Listo! Te yapearemos *${premio.descripcion}* al *${numero}*.\n` +
        'Te confirmamos por aquí apenas hagamos el abono ✅',
    );
    return irA('MENU', {});
  }

  /**
   * Nombre oficial del documento: primero la BD (Persona de un cliente
   * ya registrado — el CE también vive en Persona.dni), luego RENIEC
   * (DNI de 8) o Migraciones (CE de 9). null si ninguna fuente responde
   * — el bot pide el nombre a mano como fallback.
   */
  private async resolverNombrePorDni(dni: string): Promise<string | null> {
    const persona = await this.prisma.persona.findUnique({
      where: { dni },
      select: { nombres: true, apellidos: true },
    });
    if (persona) {
      const full = `${persona.nombres} ${persona.apellidos}`.trim();
      if (full) return full.toUpperCase();
    }
    try {
      const datos =
        dni.length === 9
          ? await this.consultasExternas.consultarCee(dni)
          : await this.consultasExternas.consultarDni(dni);
      const full = [
        datos?.nombres,
        datos?.apellidoPaterno,
        datos?.apellidoMaterno,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      return full ? full.toUpperCase() : null;
    } catch {
      return null;
    }
  }

  /**
   * Enganche del AGENTE IA de ventas (F1). Se invoca cuando el bot de sorteos
   * no tiene nada que atender (sin sorteos abiertos y no es flujo de premio):
   * en vez de callar, el agente responde consultas de catálogo / ventas si la
   * empresa lo habilitó. `atender()` ya trae el gate (habilitado, modo, BYOK);
   * aquí solo resolvemos sede + historial y despachamos la respuesta.
   *
   * Convivencia: respeta el silencio de un asesor humano (estado ASESOR) y solo
   * responde si `atendido=true`; de lo contrario el chat sigue siendo humano.
   */
  private async atenderConAgenteIa(
    instanceName: string,
    empresaId: string,
    celular: string,
    texto: string,
    convPrevia: {
      estado: string;
      contexto: Prisma.JsonValue;
      actualizadoEn: Date;
    } | null,
    sorteoActivo?: string | null,
  ): Promise<boolean> {
    const msg = texto.trim();
    if (msg.length < 1) return false;

    // Gate barato ANTES de cualquier trabajo: sin agente configurado/habilitado
    // el chat es humano. Evita resolver sede/historial para el caso común.
    const cfgIa = await this.prisma.integracionAgenteIA.findUnique({
      where: { empresaId },
      select: { habilitado: true, mensajeBienvenida: true },
    });
    if (!cfgIa?.habilitado) return false;

    // Un asesor humano está atendiendo → silencio (mismo criterio que el bot).
    if (convPrevia?.estado === 'ASESOR') {
      const minutos =
        (Date.now() - convPrevia.actualizadoEn.getTime()) / 60000;
      if (minutos < WhatsappBotService.SILENCIO_ASESOR_HORAS * 60) return false;
    }

    // Sede desde la que vende el agente: la más antigua activa de la empresa.
    // TODO: hacerla configurable en IntegracionAgenteIA (multi-sede).
    const sede = await this.prisma.sede.findFirst({
      where: { empresaId, isActive: true, deletedAt: null },
      orderBy: { creadoEn: 'asc' },
      select: { id: true },
    });

    // Historial compacto de la conversación con el agente (solo texto).
    const ctxPrevio: any = convPrevia?.contexto ?? {};
    const histTexto: { rol: 'user' | 'assistant'; texto: string }[] =
      Array.isArray(ctxPrevio.historialIa) ? ctxPrevio.historialIa : [];
    const historialPrevio: MensajeAgente[] = histTexto.map((h) => ({
      rol: h.rol,
      bloques: [{ tipo: 'texto', texto: h.texto }],
    }));
    // Catálogo mostrado en turnos previos → crearVenta resuelve el id real.
    const catalogoPrevio = Array.isArray(ctxPrevio.catalogoIa)
      ? ctxPrevio.catalogoIa
      : [];
    // Última búsqueda → "muéstrame más" pagina en vez de inventar.
    const busquedaPrevia = ctxPrevio.busquedaIa ?? null;

    // Saludo de bienvenida: solo en el PRIMER turno (sin historial). Se envía
    // ANTES de la respuesta del agente y se le avisa al agente que no re-salude.
    const esPrimerTurno = histTexto.length === 0;
    const bienvenida = cfgIa.mensajeBienvenida?.trim() || '';
    if (esPrimerTurno && bienvenida) {
      await this.evolution.sendText({
        instanceName,
        number: celular,
        text: bienvenida,
      });
      // Si el cliente SOLO saludó, la bienvenida ya es la respuesta: no llamamos
      // al LLM (evita el doble saludo y ahorra tokens).
      if (WhatsappBotService.esSaludoSimple(msg)) {
        await this.guardarConversacion(empresaId, celular, 'IA', {
          ...ctxPrevio,
          historialIa: [
            ...histTexto,
            { rol: 'user' as const, texto: msg },
            { rol: 'assistant' as const, texto: bienvenida },
          ].slice(-12),
        });
        return true;
      }
    }

    let r;
    try {
      r = await this.iaAgente.atender({
        empresaId,
        sedeId: sede?.id ?? null,
        celular,
        mensaje: msg,
        historialPrevio,
        omitirSaludo: esPrimerTurno && !!bienvenida,
        sorteoActivo: sorteoActivo ?? null,
        catalogoPrevio,
        busquedaPrevia,
      });
    } catch (e) {
      this.logger.warn(`Agente IA (${celular}): ${(e as Error).message}`);
      return false; // ante un fallo del agente, el chat sigue humano (no rompe)
    }
    if (!r.atendido || !r.resultado) return false; // agente apagado → sigue humano

    // FOTO del producto: si el agente consultó verDetalle y el producto tiene
    // imagen, la envía el CÓDIGO (determinístico — el LLM no ve URLs ni puede
    // inventarlas). Se manda ANTES del texto; máx. 2 por turno.
    const fotos: { nombre: string; precio: any; url: string }[] = [];
    for (const t of r.resultado.trazas ?? []) {
      for (const tl of t.tools ?? []) {
        const prod = (tl.resultado as any)?.producto;
        if (
          tl.nombre === 'verDetalle' &&
          prod?.urlImagen &&
          !fotos.some((f) => f.url === prod.urlImagen)
        ) {
          fotos.push({
            nombre: prod.nombre,
            precio: prod.precio,
            url: prod.urlImagen,
          });
        }
      }
    }
    // También al MOSTRAR resultados: si buscarProducto devolvió UN solo
    // producto (aunque sean varias variantes), su foto va de una — sin
    // esperar a que el LLM decida llamar verDetalle.
    if (fotos.length === 0) {
      const ids = new Set<string>();
      let itemsUnico: any[] = [];
      for (const t of r.resultado.trazas ?? []) {
        for (const tl of t.tools ?? []) {
          if (tl.nombre !== 'buscarProducto') continue;
          const prods = (tl.resultado as any)?.productos;
          if (!Array.isArray(prods)) continue;
          for (const it of prods) ids.add(it.id);
          itemsUnico = prods;
        }
      }
      if (ids.size === 1) {
        const id = [...ids][0];
        const [img, prod] = await Promise.all([
          this.prisma.archivo.findFirst({
            where: {
              entidadTipo: 'PRODUCTO',
              entidadId: id,
              isActive: true,
              deletedAt: null,
            },
            orderBy: { orden: 'asc' },
            select: { url: true },
          }),
          this.prisma.producto.findFirst({
            where: { id, empresaId },
            select: { nombre: true },
          }),
        ]);
        if (img?.url && prod) {
          const solo = itemsUnico.length === 1 ? itemsUnico[0] : null;
          fotos.push({
            nombre: (solo?.nombre as string) ?? prod.nombre,
            precio: solo?.precio ?? null,
            url: img.url,
          });
        }
      }
    }

    for (const foto of fotos.slice(0, 2)) {
      const precioTxt =
        typeof foto.precio === 'number'
          ? `S/ ${foto.precio.toFixed(2)}`
          : foto.precio?.desde != null
            ? `S/ ${Number(foto.precio.desde).toFixed(2)} a S/ ${Number(
                foto.precio.hasta,
              ).toFixed(2)}`
            : '';
      // Best-effort: una imagen caída no debe romper la respuesta.
      await this.evolution
        .sendImage({
          instanceName,
          number: celular,
          mediaUrl: foto.url,
          caption: `${foto.nombre}${precioTxt ? ` — ${precioTxt}` : ''}`,
        })
        .catch((e) =>
          this.logger.warn(
            `Imagen de ${foto.nombre} (${celular}): ${(e as Error).message}`,
          ),
        );
    }

    await this.evolution.sendText({
      instanceName,
      number: celular,
      text: r.resultado.texto,
    });

    // Persistir el historial (últimos 12 turnos) bajo estado 'IA'.
    const nuevoHist = [
      ...histTexto,
      { rol: 'user' as const, texto: msg },
      { rol: 'assistant' as const, texto: r.resultado.texto },
    ].slice(-12);
    await this.guardarConversacion(empresaId, celular, 'IA', {
      ...ctxPrevio,
      historialIa: nuevoHist,
      catalogoIa: r.catalogo ?? catalogoPrevio,
      busquedaIa: r.busqueda ?? busquedaPrevia,
    });
    return true;
  }

  private async guardarConversacion(
    empresaId: string,
    celular: string,
    estado: string,
    contexto: any,
  ): Promise<void> {
    await this.prisma.conversacionWhatsapp.upsert({
      where: { empresaId_celular: { empresaId, celular } },
      create: { empresaId, celular, estado, contexto },
      update: { estado, contexto },
    });
  }

  /**
   * Flujo DETERMINÍSTICO de entrega de una venta PAGADA del agente IA:
   * recojo/envío + dirección por pasos (patrón PART_CIUDAD de sorteos) y
   * registro directo con VentaService.upsertEnvio — sin LLM (Haiku afirmaba
   * "envío registrado" sin llamar la tool). El intercambio se anexa a
   * historialIa para que el agente retome después con contexto.
   */
  private async manejarEntregaVenta(
    instanceName: string,
    empresaId: string,
    celular: string,
    msg: string,
    conv: { estado: string; contexto: Prisma.JsonValue; actualizadoEn: Date },
  ): Promise<void> {
    const ctx: any = conv.contexto ?? {};
    const ve: any = ctx.ventaEnvio ?? {};
    const responder = (texto: string) =>
      this.evolution.sendText({ instanceName, number: celular, text: texto });
    /** Responde + anexa el turno al historial del agente + persiste estado. */
    const decir = async (
      texto: string,
      estado: string,
      veNuevo: any | null,
    ) => {
      await responder(texto);
      const hist = Array.isArray(ctx.historialIa) ? ctx.historialIa : [];
      ctx.historialIa = [
        ...hist,
        { rol: 'user', texto: msg },
        { rol: 'assistant', texto },
      ].slice(-12);
      if (veNuevo === null) delete ctx.ventaEnvio;
      else ctx.ventaEnvio = veNuevo;
      return this.guardarConversacion(empresaId, celular, estado, ctx);
    };

    /** Registra el envío con los datos capturados y cierra el flujo. */
    const completar = async (datos: {
      ciudad?: string | null;
      departamento?: string | null;
      direccion?: string | null;
      agencia?: string | null;
      destNombre?: string;
      destDni?: string;
    }) => {
      const venta = await this.prisma.venta.findFirst({
        where: { id: ve.ventaId ?? '', empresaId },
        select: {
          id: true,
          codigo: true,
          nombreCliente: true,
          documentoCliente: true,
        },
      });
      if (!venta) {
        return decir(
          'No encontré tu compra reciente 😕 Un asesor coordinará tu ' +
            'envío por este chat.',
          'ASESOR',
          null,
        );
      }
      const nombre = datos.destNombre ?? venta.nombreCliente;
      const dni = datos.destDni ?? venta.documentoCliente ?? undefined;
      const agencia =
        datos.agencia?.trim() || WhatsappBotService.AGENCIA_DEFAULT;
      try {
        await this.venta.upsertEnvio(venta.id, empresaId, {
          destinatarioNombre: nombre,
          destinatarioDni: dni,
          destinatarioCelular: celular,
          agenciaNombre: agencia,
          destinoProvincia: datos.ciudad ?? undefined,
          destinoDepartamento: datos.departamento ?? undefined,
          agenciaDireccion: datos.direccion ?? undefined,
        } as any);
      } catch (e) {
        this.logger.warn(
          `upsertEnvio venta ${venta.codigo} falló: ${(e as Error).message}`,
        );
        return decir(
          'No pude registrar tu envío 😕 Un asesor lo coordinará ' +
            'contigo por este chat.',
          'ASESOR',
          null,
        );
      }
      const destino = [datos.ciudad, datos.departamento]
        .filter(Boolean)
        .join(', ');
      return decir(
        `📦 ¡Envío registrado! Tu compra *${venta.codigo}* va por ` +
          `*${agencia}*${destino ? ` a *${destino}*` : ''}` +
          `${datos.direccion ? ` (${datos.direccion})` : ''}.\n` +
          `La recoge *${nombre}*${dni ? ` (DNI ${dni})` : ''}.\n` +
          '¡Te avisamos cuando salga! 🙌',
        'IA',
        null,
      );
    };

    const norm = msg
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');

    switch (conv.estado) {
      case 'VENTA_ENTREGA': {
        if (/recoj|recog|tienda|local/.test(norm)) {
          return decir(
            '🏬 ¡Perfecto! Tu compra te espera en tienda. Cualquier ' +
              'consulta escríbeme por aquí 🙌',
            'IA',
            null,
          );
        }
        if (/envi|agencia|delivery|mandar|provincia/.test(norm)) {
          const venta = await this.prisma.venta.findFirst({
            where: { id: ve.ventaId ?? '', empresaId },
            select: { documentoCliente: true },
          });
          const previo = await buscarEnvioPrevio(
            this.prisma as any,
            empresaId,
            venta?.documentoCliente ?? '',
            celular,
          );
          if (previo?.ciudad) {
            const desc = [
              previo.ciudad,
              previo.departamento,
              previo.direccionAgencia,
            ]
              .filter(Boolean)
              .join(', ');
            return decir(
              `📦 Tengo una dirección tuya registrada: *${desc}*.\n` +
                '*1* — Enviar ahí mismo\n' +
                'O escribe la *ciudad* de destino (ej. TRUJILLO)',
              'VENTA_ENVIO_CIUDAD',
              { ...ve, previo },
            );
          }
          return decir(
            '📦 ¿A qué *ciudad* llega tu pedido? (ej. TRUJILLO)',
            'VENTA_ENVIO_CIUDAD',
            ve,
          );
        }
        // Ni recojo ni envío: 1 repregunta; después responde el agente
        // (puede ser una consulta libre) sin perder el estado de entrega.
        if (!ve.reintento) {
          return decir(
            '¿La *recoges en tienda* o te la *enviamos por agencia*? ' +
              'Escríbeme *recojo* o *envío* 🙂',
            'VENTA_ENTREGA',
            { ...ve, reintento: true },
          );
        }
        await this.atenderConAgenteIa(
          instanceName,
          empresaId,
          celular,
          msg,
          conv as any,
        );
        return;
      }

      case 'VENTA_ENVIO_CIUDAD': {
        if (msg === '1' && ve.previo?.ciudad) {
          return completar({
            ciudad: ve.previo.ciudad,
            departamento: ve.previo.departamento,
            direccion: ve.previo.direccionAgencia,
            agencia: ve.previo.agencia,
          });
        }
        // "a Piura" / "para Trujillo" → quedarse con la ciudad.
        const ciudad = WhatsappBotService.campoCorto(
          msg.replace(/^(a|para|hacia)\s+/i, ''),
        );
        if (!ciudad) {
          await responder(
            '📍 Solo el nombre de la *ciudad* por favor (ej. TRUJILLO)',
          );
          return;
        }
        return decir(
          `📍 ¿En qué *departamento* está ${ciudad}? (ej. LA LIBERTAD)`,
          'VENTA_ENVIO_DEPARTAMENTO',
          { ...ve, ciudad },
        );
      }

      case 'VENTA_ENVIO_DEPARTAMENTO': {
        const departamento = WhatsappBotService.campoCorto(msg);
        if (!departamento) {
          await responder(
            '📍 Solo el *departamento* por favor (ej. LA LIBERTAD)',
          );
          return;
        }
        const wpp = await this.prisma.integracionWhatsapp.findUnique({
          where: { empresaId },
          select: { agenciaEnvio: true },
        });
        const agencia =
          wpp?.agenciaEnvio?.trim() || WhatsappBotService.AGENCIA_DEFAULT;
        return decir(
          `¿Cuál es la *dirección o sucursal* de ${agencia} en ` +
            `${ve.ciudad ?? 'tu ciudad'}? (ej. ATAHUALPA)\n` +
            'Responde *-* si no la sabes.',
          'VENTA_ENVIO_DIRECCION',
          { ...ve, departamento, agencia },
        );
      }

      case 'VENTA_ENVIO_DIRECCION': {
        const direccion = WhatsappBotService.sinDato(msg)
          ? null
          : msg.replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 80);
        return decir(
          '¿Quién recogerá el pedido en la agencia?\n' +
            '*1* — Yo mismo\n' +
            'O escribe su *nombre y DNI* (ej. MARIA PEREZ 12345678)',
          'VENTA_ENVIO_DESTINATARIO',
          { ...ve, direccion },
        );
      }

      case 'VENTA_ENVIO_DESTINATARIO': {
        // "1", "yo", "yo mismo" = el comprador (pasó en beta: "yo mismo"
        // quedó registrado como destinatario literal "YO MISMO").
        if (/^(1|yo|yo\s+mism[oa])\s*[.!]*$/i.test(msg)) {
          return completar({
            ciudad: ve.ciudad,
            departamento: ve.departamento,
            direccion: ve.direccion,
            agencia: ve.agencia,
          });
        }
        const dni = msg.match(/\b\d{8,9}\b/)?.[0];
        const nombreTipeado = msg
          .replace(dni ?? '', ' ')
          .replace(/\b(dni|d\.n\.i\.?|ce|carnet de extranjeria)\b/gi, ' ')
          .replace(/[.,:;]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!dni && nombreTipeado.length < 3) {
          await responder(
            'No te entendí 🙈 *1* si lo recoges tú mismo, o el ' +
              '*nombre y DNI* de quien lo recogerá (ej. MARIA PEREZ 12345678)',
          );
          return;
        }
        let destNombre = nombreTipeado.toUpperCase();
        if (dni) {
          // Nombre oficial de la BD si la persona está registrada.
          const p = await this.prisma.persona.findUnique({
            where: { dni },
            select: { nombres: true, apellidos: true },
          });
          if (p) destNombre = `${p.nombres} ${p.apellidos ?? ''}`.trim();
        }
        if (!destNombre) {
          await responder(
            'Me falta el *nombre* de quien recogerá el pedido 🙏 ' +
              '(ej. MARIA PEREZ 12345678)',
          );
          return;
        }
        return completar({
          ciudad: ve.ciudad,
          departamento: ve.departamento,
          direccion: ve.direccion,
          agencia: ve.agencia,
          destNombre,
          destDni: dni,
        });
      }

      default:
        // Estado inesperado: que responda el agente (no dejar mudo el chat).
        await this.atenderConAgenteIa(
          instanceName,
          empresaId,
          celular,
          msg,
          conv as any,
        );
        return;
    }
  }
}
