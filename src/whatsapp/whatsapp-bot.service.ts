import { Injectable, Logger } from '@nestjs/common';
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
import { EvolutionApiService } from './evolution-api.service';

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

  /// Fallback si la empresa no configuró su agencia (IntegracionWhatsapp
  /// .agenciaEnvio): el bot la informa y no pregunta cuál.
  private static readonly AGENCIA_DEFAULT = 'SHALOM';

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionApiService,
    private readonly consultasExternas: ConsultasExternasService,
    private readonly realtime: RealtimeInvalidationService,
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
    const sorteos = await this.prisma.sorteo.findMany({
      where: { empresaId, estado: EstadoSorteo.ABIERTO },
      orderBy: { creadoEn: 'desc' },
      select: { id: true, titulo: true, tipo: true, precioParticipacion: true },
    });
    if (sorteos.length === 0) return;

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
      // del menú ('1'/'2'/'3') reactiva al bot de inmediato — terminó
      // de hablar con el asesor y quiere participar/registrar envío.
      if (['1', '2', '3'].includes(msg)) {
        estado = 'MENU';
      } else if (minutos < WhatsappBotService.SILENCIO_ASESOR_HORAS * 60) {
        return;
      } else {
        estado = 'MENU';
      }
    } else if (
      estado !== 'MENU' &&
      minutos > WhatsappBotService.TIMEOUT_PASO_MIN
    ) {
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
      !['1', '2', '3'].includes(msg)
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
      const menuMostradoHaceUnRato =
        !esNuevo &&
        conv.contexto != null &&
        minutos < WhatsappBotService.THROTTLE_MENU_MIN;
      if (menuMostradoHaceUnRato) return;
    }

    try {
      await this.manejarPaso(cfg.instanceName, empresaId, celular, msg, {
        estado,
        ctx,
        sorteos,
        agencia:
          cfg.agenciaEnvio?.trim() || WhatsappBotService.AGENCIA_DEFAULT,
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
    },
  ) {
    const responder = (texto: string) =>
      this.evolution.sendText({ instanceName, number: celular, text: texto });
    const irA = (estado: string, ctx?: any) =>
      this.guardarConversacion(empresaId, celular, estado, ctx ?? s.ctx);

    switch (s.estado) {
      case 'MENU': {
        if (msg === '1') {
          if (s.sorteos.length === 1) {
            return this.iniciarRegistro(
              empresaId,
              celular,
              s.sorteos[0].id,
              s.agencia,
              responder,
              irA,
            );
          }
          const lista = s.sorteos
            .map((x, i) => `*${i + 1}* — ${x.titulo}`)
            .join('\n');
          await responder(
            `¿En cuál sorteo quieres participar? Responde con el número:\n${lista}`,
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
        return this.mostrarMenu(s.sorteos, responder, irA);
      }

      case 'ELIGIENDO_SORTEO': {
        const idx = parseInt(msg, 10) - 1;
        const ids: string[] = s.ctx.sorteoIds ?? [];
        if (isNaN(idx) || idx < 0 || idx >= ids.length) {
          await responder(
            'No entendí 🙈 responde solo con el número del sorteo (o *menu*).',
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
        );
      }

      case 'ESPERANDO_NOMBRE': {
        // Fallback: solo se llega aquí si BD y RENIEC no resolvieron
        // el nombre del DNI.
        // GUARD: ctx incompleto (conversación de una versión anterior)
        // → reset. OJO: Prisma IGNORA los undefined en where — sin esto
        // se registraría en un sorteo arbitrario.
        if (!s.ctx.sorteoId || !s.ctx.dni) {
          return this.mostrarMenu(s.sorteos, responder, irA);
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
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        const dni = msg.replace(/\D/g, '');
        if (dni.length !== 8) {
          await responder('El DNI debe tener *8 dígitos* — inténtalo de nuevo:');
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
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        if (msg === '1') {
          const previo = await this.prisma.sorteoParticipante.findFirst({
            where: { id: s.ctx.previoId, empresaId },
          });
          if (!previo) return this.mostrarMenu(s.sorteos, responder, irA);
          const nuevo = await this.prisma.sorteoParticipante.create({
            data: {
              empresaId,
              sorteoId: previo.sorteoId,
              celular,
              nombre: previo.nombre,
              dni: previo.dni,
              // Misma dirección de envío de su participación anterior.
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
          const conEnvio = previo.agenciaNombre
            ? ` Usaremos tu misma dirección de envío (*${previo.agenciaNombre}*).`
            : '';
          await responder(
            `🎟️ ¡Nueva participación registrada, ${previo.nombre.split(' ')[0]}!${conEnvio}\n\n` +
              (await this.instruccionesPago(empresaId, {
                sorteoId: nuevo.sorteoId,
              })),
          );
          return irA('MENU', {});
        }
        await responder(
          '👌 Listo, sigues con tus participaciones actuales. ' +
            'Escribe *menu* para ver las opciones.',
        );
        return irA('MENU', {});
      }

      case 'CONFIRMAR_ENVIO': {
        if (!s.ctx.participanteId || !s.ctx.sorteoId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        // Recurrente: sus datos previos ya quedaron copiados al registro.
        if (msg === '1') {
          await responder(
            '✅ ¡Perfecto, mismo envío!\n\n' +
              (await this.instruccionesPago(empresaId, s.ctx)),
          );
          return irA('MENU', {});
        }
        if (msg === '2') {
          await responder(
            '📍 ¿A qué *ciudad* te lo enviaríamos? (ej. TRUJILLO)',
          );
          return irA('PART_CIUDAD', s.ctx);
        }
        await responder(
          'Responde *1* si tu dirección es la misma, o *2* para cambiarla 🙂',
        );
        return;
      }

      case 'PART_CIUDAD': {
        if (!s.ctx.participanteId || !s.ctx.sorteoId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        if (msg === '-') {
          await responder(
            (await this.instruccionesPago(empresaId, s.ctx)) +
              '\n\n(cuando tengas tus datos de envío, escribe *2* en el ' +
              'menú para registrarlos 📦)',
          );
          return irA('MENU', {});
        }
        if (msg.length < 3) {
          await responder(
            '¿A qué *ciudad* te enviaríamos el premio? (ej. TRUJILLO) — o responde *-* para omitir',
          );
          return;
        }
        const ciudad = msg.toUpperCase();
        await responder(
          `📍 ¿En qué *departamento* está ${ciudad}? (ej. LA LIBERTAD)`,
        );
        return irA('PART_DEPARTAMENTO', { ...s.ctx, provincia: ciudad });
      }

      case 'PART_DEPARTAMENTO': {
        if (msg.length < 3) {
          await responder('¿En qué *departamento*? (ej. LA LIBERTAD)');
          return;
        }
        await responder(
          `¿Cuál es la *dirección o sucursal* de ${WhatsappBotService.AGENCIA_DEFAULT} ` +
            'en tu ciudad? (ej. ATAHUALPA)\n' +
            'Responde *-* si no la sabes.',
        );
        return irA('PART_DIRECCION', {
          ...s.ctx,
          departamento: msg.toUpperCase(),
        });
      }

      case 'PART_DIRECCION': {
        // GUARD CRÍTICO: sin participanteId, el updateMany quedaría solo
        // con {empresaId} y pisaría el envío de TODOS los participantes.
        if (!s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        const direccion = msg === '-' ? null : msg.toUpperCase();
        await this.prisma.sorteoParticipante.updateMany({
          where: { id: s.ctx.participanteId, empresaId },
          data: {
            agenciaNombre: s.ctx.agencia,
            destinoProvincia: s.ctx.provincia ?? null,
            destinoDepartamento: s.ctx.departamento ?? null,
            agenciaDireccion: direccion,
          },
        });
        const destinoTxt = [s.ctx.provincia, s.ctx.departamento]
          .filter(Boolean)
          .join(', ');
        await responder(
          '📦 ¡Datos de envío guardados! Si ganas, tu premio saldría por ' +
            `*${s.ctx.agencia}*${destinoTxt ? ` a *${destinoTxt}*` : ''}` +
            `${direccion ? ` (sucursal ${direccion})` : ''}.\n\n` +
            (await this.instruccionesPago(empresaId, s.ctx)),
        );
        return irA('MENU', {});
      }

      case 'GANADOR_CIUDAD': {
        if (msg.length < 3) {
          await responder(
            '¿A qué *ciudad* te lo enviamos? (ej. TRUJILLO)',
          );
          return;
        }
        const ciudad = msg.toUpperCase();
        await responder(
          `📍 ¿En qué *departamento* está ${ciudad}? (ej. LA LIBERTAD)`,
        );
        return irA('GANADOR_DEPARTAMENTO', { ...s.ctx, provincia: ciudad });
      }

      case 'GANADOR_DEPARTAMENTO': {
        if (msg.length < 3) {
          await responder('¿En qué *departamento*? (ej. LA LIBERTAD)');
          return;
        }
        await responder(
          `¿Cuál es la *dirección o sucursal* de ${WhatsappBotService.AGENCIA_DEFAULT} ` +
            'en tu ciudad? (ej. ATAHUALPA)\n' +
            'Responde *-* si no la sabes.',
        );
        return irA('GANADOR_DIRECCION', {
          ...s.ctx,
          departamento: msg.toUpperCase(),
        });
      }

      case 'GANADOR_DIRECCION': {
        const direccion = msg === '-' ? null : msg.toUpperCase();
        return this.guardarAgenciaGanador(
          empresaId,
          celular,
          { ...s.ctx, direccion },
          responder,
          irA,
        );
      }

      default:
        return this.mostrarMenu(s.sorteos, responder, irA);
    }
  }

  // ── Pasos compuestos ─────────────────────────────────────────────────

  private async mostrarMenu(
    sorteos: { titulo: string }[],
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    const titulos =
      sorteos.length === 1
        ? `¡Tenemos el sorteo *${sorteos[0].titulo}* activo! 🎉`
        : `¡Tenemos ${sorteos.length} sorteos activos! 🎉`;
    await responder(
      `¡Hola! 👋 ${titulos}\n\n` +
        'Responde con el número:\n' +
        '*1* — Participar en el sorteo\n' +
        '*2* — Registrar/cambiar mis datos de envío 📦\n' +
        '*3* — Hablar con un asesor',
    );
    return irA('MENU', {});
  }

  private async iniciarRegistro(
    empresaId: string,
    celular: string,
    sorteoId: string,
    agencia: string,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
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
      '¡Buenísimo! 🎉 Para registrarte envíame tu *DNI* (8 dígitos):',
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
      where: { id: ctx.sorteoId, empresaId, estado: EstadoSorteo.ABIERTO },
    });
    if (!sorteo) {
      await responder('Ese sorteo ya se cerró 🙈 escribe *menu* para ver los activos.');
      return irA('MENU', {});
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

    // Registrado ✅ — ahora los datos de envío (opcionales): si gana,
    // la entrega ya queda lista y se muestran en el app.
    const cabecera =
      (ctx.verificado == true ? `🪪 DNI verificado: *${ctx.nombre}*\n` : '') +
      `✅ ¡Quedaste registrado en *${sorteo.titulo}*, ${(ctx.nombre ?? '').split(' ')[0]}!\n\n`;
    const agencia = ctx.agencia ?? WhatsappBotService.AGENCIA_DEFAULT;

    // Participante RECURRENTE: si ya dejó datos de envío antes (otra
    // participación o un premio), se copian a este registro y solo se
    // le pide confirmar o cambiarlos — cero fricción.
    const previos = await this.datosEnvioPrevios(empresaId, dni);
    if (previos) {
      await this.prisma.sorteoParticipante.update({
        where: { id: participanteId },
        data: previos,
      });
      const destino = [previos.destinoProvincia, previos.destinoDepartamento]
        .filter(Boolean)
        .join(', ');
      await responder(
        cabecera +
          `📦 Ya tienes una dirección de envío registrada con *${previos.agenciaNombre}*:` +
          `${destino ? `\n📍 *${destino}*` : ''}` +
          `${previos.agenciaDireccion ? ` (sucursal *${previos.agenciaDireccion}*)` : ''}\n\n` +
          '¿La usamos para este envío?\n' +
          '*1* — Sí, es la misma ✅\n' +
          '*2* — Cambiarla',
      );
      return irA('CONFIRMAR_ENVIO', {
        ...ctx,
        participanteId,
        sorteoId: sorteo.id,
        agencia,
      });
    }

    // Primera vez: la agencia es fija (se informa, no se pregunta).
    await responder(
      cabecera +
        `📦 Los envíos se hacen por *${agencia}*. ` +
        'Para dejar tu envío listo si ganas:\n' +
        '¿A qué *ciudad* te lo enviaríamos? (ej. TRUJILLO)\n' +
        'Responde *-* si prefieres omitirlo.',
    );
    return irA('PART_CIUDAD', {
      ...ctx,
      participanteId,
      sorteoId: sorteo.id,
      agencia,
    });
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
   * Instrucciones de pago: monto del sorteo + Yape de la empresa si está
   * configurado en la integración Yape. Cierra el flujo de registro.
   */
  private async instruccionesPago(
    empresaId: string,
    ctx: any,
  ): Promise<string> {
    const [sorteo, yape] = await Promise.all([
      this.prisma.sorteo.findUnique({
        where: { id: ctx.sorteoId },
        select: { precioParticipacion: true },
      }),
      this.prisma.integracionYape.findUnique({
        where: { empresaId },
        select: { celular: true },
      }),
    ]);
    const monto = sorteo?.precioParticipacion
      ? `S/ ${Number(sorteo.precioParticipacion).toFixed(2)}`
      : null;
    return [
      '💰 *Último paso — el pago:*',
      monto
        ? `Yapea *${monto}*${yape?.celular ? ` al *${yape.celular}*` : ' al número de la empresa'} y envía tu captura por este chat.`
        : `Coordina el pago de tu participación por este chat${yape?.celular ? ` (Yape: *${yape.celular}*)` : ''}.`,
      'Cuando lo validemos te confirmaremos tu *número de ticket* 🎟️',
    ].join('\n');
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
    await responder(
      `¡Hola ${previo.nombre.split(' ')[0]}! Ya estás participando` +
        `${resumen ? ` (${resumen})` : ''}.\n\n` +
        '¿Quieres participar *otra vez*? 🎟️\n' +
        '*1* — Sí, registrar otra participación\n' +
        '*0* — No, volver al menú',
    );
    return irA('REPARTICIPAR', { sorteoId, previoId: previo.id });
  }

  private async iniciarFlujoGanador(
    empresaId: string,
    celular: string,
    agencia: string,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    // El premio se busca por los últimos 9 dígitos del remitente (los
    // celulares se guardan con o sin el 51).
    const last9 = celular.slice(-9);
    const premio = await this.prisma.sorteoPremio.findFirst({
      where: {
        empresaId,
        estado: {
          in: [EstadoPremioSorteo.REGISTRADO, EstadoPremioSorteo.PREPARANDO],
        },
        ganadorCelular: { contains: last9 },
      },
      orderBy: { creadoEn: 'desc' },
    });
    if (premio) {
      await responder(
        `🏆 ¡Felicidades ${premio.ganadorNombre.split(' ')[0]}! ` +
          `Tu premio: *${premio.descripcion}*.\n\n` +
          `📦 Los envíos se hacen por *${WhatsappBotService.AGENCIA_DEFAULT}*.\n` +
          '¿A qué *ciudad* te lo enviamos? (ej. TRUJILLO)',
      );
      return irA('GANADOR_CIUDAD', {
        premioId: premio.id,
        agencia: WhatsappBotService.AGENCIA_DEFAULT,
      });
    }

    // Sin premio pendiente: ¿es participante de un sorteo abierto? Sus
    // datos quedan en su registro y el auto-premio los usa al validar.
    const participante = await this.prisma.sorteoParticipante.findFirst({
      where: {
        empresaId,
        celular: { contains: last9 },
        estado: { not: EstadoParticipanteSorteo.RECHAZADO },
        sorteo: { estado: EstadoSorteo.ABIERTO },
      },
      orderBy: { creadoEn: 'desc' },
      include: { sorteo: { select: { titulo: true } } },
    });
    if (!participante) {
      await responder(
        'No encontré un premio ni una participación asociada a este número 🤔\n' +
          'Elige la opción *3* para hablar con un asesor.',
      );
      return irA('MENU', {});
    }
    await responder(
      `📦 ${participante.nombre.split(' ')[0]}, registremos tus datos de ` +
        `envío para *${participante.sorteo.titulo}* — los envíos se hacen ` +
        `por *${WhatsappBotService.AGENCIA_DEFAULT}*.\n\n` +
        '¿A qué *ciudad* te enviaríamos el premio? (ej. TRUJILLO)',
    );
    return irA('GANADOR_CIUDAD', {
      participanteId: participante.id,
      agencia: WhatsappBotService.AGENCIA_DEFAULT,
    });
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
        data: datosEnvio,
      });
      if (p && count > 0) {
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

    // Caso ganador con premio: mismo guard que elegirAgenciaMiPremio
    // (solo antes del despacho).
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
        data: datosEnvio,
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
   * Nombre oficial del DNI: primero la BD (Persona de un cliente ya
   * registrado), luego RENIEC (consultas-externas). null si ninguna
   * fuente responde — el bot pide el nombre a mano como fallback.
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
      const reniec = await this.consultasExternas.consultarDni(dni);
      const full = [
        reniec?.nombres,
        reniec?.apellidoPaterno,
        reniec?.apellidoMaterno,
      ]
        .filter(Boolean)
        .join(' ')
        .trim();
      return full ? full.toUpperCase() : null;
    } catch {
      return null;
    }
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
}
