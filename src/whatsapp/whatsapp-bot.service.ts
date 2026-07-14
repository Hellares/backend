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

  /// Fallback si la empresa no configuró su agencia (IntegracionWhatsapp
  /// .agenciaEnvio): el bot la informa y no pregunta cuál.
  private static readonly AGENCIA_DEFAULT = 'SHALOM';

  /// Prompt compartido para pedir el DNI del que recoge (la agencia lo
  /// exige para entregar) — un solo texto para que no diverja.
  private static readonly MSG_DNI_RECOGE =
    '👤 Envíame el *DNI* de quien recogerá el paquete (8 dígitos) ' +
    '— sus nombres salen solos. La agencia pedirá ese DNI para ' +
    'entregar el paquete 🪪';

  /// Pregunta tras las instrucciones de pago: a veces el yape lo hace
  /// un tercero y la empresa necesita saberlo para cuadrar el pago.
  private static readonly MSG_QUIEN_YAPEA =
    '\n\n💳 ¿Quién hará el *yape*?\n' +
    '*1* — Yo mismo\n' +
    '*2* — Otra persona (desde otro número)';

  /// Qué sigue después del pago (según si ya hay dirección previa).
  private static avisoDireccion(confirma: boolean): string {
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
              estado: EstadoSorteo.CERRADO,
              actualizadoEn: { gt: conv.actualizadoEn },
            },
          },
          select: { id: true },
        });
        if (!cicloCerrado) return;
      }
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
            `¿En cuál quieres participar? Responde con el número:\n${lista}`,
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
          // PAGO-PRIMERO, igual que la primera vez: la dirección previa
          // se copia EN SILENCIO y al VALIDAR el pago el bot la pide o
          // confirma (ahí también se resuelve regalo/quién recoge).
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

      case 'PAGO_QUIEN': {
        if (!s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        if (msg === '1') {
          // Paga él mismo: nombre y número ya los tenemos.
          await responder(
            '✅ ¡Listo! Esperamos tu yape 🙌\n\n' +
              WhatsappBotService.avisoDireccion(s.ctx.confirmaDireccion),
          );
          return irA('MENU', {});
        }
        if (msg === '2') {
          await responder(
            '💳 ¿Desde qué *número* harán el yape? (9 dígitos)',
          );
          return irA('PAGO_NUMERO', s.ctx);
        }
        // Texto libre (la captura del yape, una consulta): no estorbar —
        // 1/2/menu siguen activos y el paso caduca solo.
        return;
      }

      case 'PAGO_NUMERO': {
        if (!s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        const cel = msg.replace(/\D/g, '');
        if (cel.length !== 9 || !cel.startsWith('9')) {
          await responder(
            'El número debe tener *9 dígitos* (ej. 987654321) — inténtalo de nuevo:',
          );
          return;
        }
        await responder('¿Y a nombre de *quién* está esa cuenta Yape?');
        return irA('PAGO_NOMBRE', { ...s.ctx, pagadorCelular: cel });
      }

      case 'PAGO_NOMBRE': {
        if (!s.ctx.participanteId || !s.ctx.pagadorCelular) {
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        if (msg.length < 3) {
          await responder('¿A nombre de *quién* está esa cuenta Yape?');
          return;
        }
        const pagadorNombre = msg.toUpperCase();
        await this.prisma.sorteoParticipante.updateMany({
          where: { id: s.ctx.participanteId, empresaId },
          data: { pagadorNombre, pagadorCelular: s.ctx.pagadorCelular },
        });
        if (s.ctx.sorteoId) {
          this.realtime.notifySorteoCambiado({
            empresaId,
            sorteoId: s.ctx.sorteoId,
          });
        }
        await responder(
          `✅ Anotado: *${pagadorNombre}* yapeará desde el ` +
            `*${s.ctx.pagadorCelular}*.\n\n` +
            WhatsappBotService.avisoDireccion(s.ctx.confirmaDireccion),
        );
        return irA('MENU', {});
      }

      case 'REGALO_DNI': {
        // Quien RECOGE se identifica por DNI: el nombre oficial sale de
        // la BD o RENIEC (Factiliza) — igual que el registro del jugador.
        // El DNI es OBLIGATORIO: la agencia lo pide para entregar.
        if (!s.ctx.participanteId && !s.ctx.premioId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        const dni = msg.replace(/\D/g, '');
        if (dni.length !== 8) {
          await responder(
            '🪪 Necesito el *DNI* de quien recogerá (8 dígitos) — la ' +
              'agencia lo pide para entregar el paquete, sin él no ' +
              'podríamos enviarlo a su nombre.',
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
          return this.mostrarMenu(s.sorteos, responder, irA);
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
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        // Recurrente: sus datos previos ya quedaron copiados al registro.
        if (msg === '1') {
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
            'pero recoge otra persona) o *4* (para otra persona en otra ' +
            'dirección) 🙂',
        );
        return;
      }

      case 'PART_CIUDAD': {
        if (!s.ctx.participanteId || !s.ctx.sorteoId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
        }
        // Atajo de la opción 4 (regalo/encargo): "1 = misma dirección" —
        // la dirección guardada se queda, solo se actualiza quién recibe.
        if (msg === '1' && s.ctx.regaloDireccion && s.ctx.recibeNombre) {
          await this.prisma.sorteoParticipante.updateMany({
            where: { id: s.ctx.participanteId, empresaId },
            data: {
              recibeNombre: s.ctx.recibeNombre ?? null,
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
              where: { id: s.ctx.participanteId, empresaId },
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
              'menú para registrarlos 📦)',
          );
          return irA('MENU', {});
        }
        if (msg.length < 3) {
          await responder(
            '¿A qué *ciudad* enviaríamos el paquete? (ej. TRUJILLO)' +
              (s.ctx.regaloDireccion && s.ctx.recibeNombre
                ? '\n*1* — A la misma dirección'
                : ' — o responde *-* para omitir'),
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
          `¿Cuál es la *dirección o sucursal* de ${s.ctx.agencia ?? WhatsappBotService.AGENCIA_DEFAULT} ` +
            'en esa ciudad? (ej. ATAHUALPA)\n' +
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
            // REGALO: quien recibe (null = el propio jugador).
            recibeNombre: s.ctx.recibeNombre ?? null,
            recibeDni: s.ctx.recibeDni ?? null,
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
            '👤 ¿Quién *recogerá* el paquete en la agencia?\n' +
            '*1* — Yo mismo\n' +
            '*2* — Otra persona (regalo o encargo) 🎁',
        );
        return irA('PART_RECOGE', { ...s.ctx, direccion });
      }

      case 'PART_RECOGE': {
        if (!s.ctx.participanteId || !s.ctx.sorteoId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
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
          'Responde *1* si lo recoges tú, o *2* si irá otra persona 🎁',
        );
        return;
      }

      case 'GANADOR_QUIEN': {
        if (!s.ctx.premioId && !s.ctx.participanteId) {
          return this.mostrarMenu(s.sorteos, responder, irA);
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
          return irA('REGALO_DNI', s.ctx);
        }
        await responder(
          'Responde *1* si lo recoges tú, o *2* si irá otra persona 🎁',
        );
        return;
      }

      case 'GANADOR_CIUDAD': {
        if (msg.length < 3) {
          await responder(
            '¿A qué *ciudad* lo enviamos? (ej. TRUJILLO)',
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
          `¿Cuál es la *dirección o sucursal* de ${s.ctx.agencia ?? WhatsappBotService.AGENCIA_DEFAULT} ` +
            'en esa ciudad? (ej. ATAHUALPA)\n' +
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
    sorteos: { titulo: string; tipo: TipoSorteo }[],
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    // Una dinámica no es un "sorteo" para el cliente: se saluda con su
    // propio nombre ("¡Tenemos *CANASTAZO* activo! 😄").
    const todasDinamicas = sorteos.every(
      (x) => x.tipo === TipoSorteo.DINAMICA,
    );
    let saludo: string;
    let opcion1: string;
    if (sorteos.length === 1 && todasDinamicas) {
      saludo = `¡Hola! ¡Tenemos *${sorteos[0].titulo}* activo! 😄`;
      opcion1 = `*1* — Participar en el ${sorteos[0].titulo}`;
    } else if (sorteos.length === 1) {
      saludo = `¡Hola! 👋 ¡Tenemos el sorteo *${sorteos[0].titulo}* activo! 🎉`;
      opcion1 = '*1* — Participar en el sorteo';
    } else if (todasDinamicas) {
      saludo = `¡Hola! ¡Tenemos ${sorteos.length} dinámicas activas! 😄`;
      opcion1 = '*1* — Participar en una dinámica';
    } else {
      saludo = `¡Hola! 👋 ¡Tenemos ${sorteos.length} sorteos activos! 🎉`;
      opcion1 = '*1* — Participar en un sorteo';
    }
    await responder(
      `${saludo}\n\n` +
        'Responde con el número:\n' +
        `${opcion1}\n` +
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
   * Cierre del flujo de envío: antes de validar el pago → instrucciones
   * de pago; después (postActivacion) → despedida.
   */
  private async cierreFlujo(empresaId: string, ctx: any): Promise<string> {
    if (ctx.postActivacion) {
      // Sin "¡Listo!" propio: cada caller ya abre celebrando.
      return 'Te avisaremos por aquí cuando tu premio esté en camino 🚚';
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
        sorteo: { select: { titulo: true, tipo: true, reabierto: true } },
      },
    });
    if (!p) return false;
    // Sorteo REABIERTO = regularización interna: el bot no escribe nada
    // (el participante ya fue atendido en su momento).
    if (p.sorteo.reabierto) return false;

    const agencia =
      cfg.agenciaEnvio?.trim() || WhatsappBotService.AGENCIA_DEFAULT;
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
        ticket: p.numeroTicket != null ? `#${p.numeroTicket}` : '',
        empresa: plantilla.includes('{empresa}')
          ? await this.nombreEmpresa(empresaId)
          : '',
      }) + '\n\n';
    const ctx = {
      participanteId: p.id,
      sorteoId: p.sorteoId,
      agencia,
      postActivacion: true,
    };

    let texto: string;
    let estado: string;
    if (p.agenciaNombre) {
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
        '*4* — Es para OTRA persona en OTRA dirección (regalo/encargo) 🎁';
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
    await this.guardarConversacion(empresaId, p.celular, estado, ctx);
    return true;
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
    const monto = sorteo?.precioParticipacion
      ? `S/ ${Number(sorteo.precioParticipacion).toFixed(2)}`
      : null;
    if (!monto) {
      // Sorteo sin precio: no hay monto que yapear — se coordina a mano.
      return (
        '💰 *Siguiente paso — el pago:*\n' +
        `Coordina el pago de tu participación por este chat${numeroPago ? ` (Yape: *${numeroPago}*)` : ''}.\n` +
        'Cuando lo validemos te confirmaremos tu *número de ticket* 🎟️'
      );
    }
    const esDinamica = sorteo?.tipo === TipoSorteo.DINAMICA;
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
    await responder(
      `¡Hola ${previo.nombre.split(' ')[0]}! Ya estás participando` +
        `${resumen ? ` (${resumen})` : ''}.\n\n` +
        '¿Quieres participar *otra vez*? 🎟️\n' +
        '*1* — Sí\n' +
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
          `📦 Los envíos se hacen por *${agencia}*.\n` +
          '¿Quién *recogerá* el paquete en la agencia?\n' +
          '*1* — Yo mismo\n' +
          '*2* — Otra persona (regalo o encargo) 🎁',
      );
      return irA('GANADOR_QUIEN', {
        premioId: premio.id,
        agencia,
      });
    }

    // Sin premio pendiente: ¿es participante de un sorteo abierto? Sus
    // datos quedan en su registro y el auto-premio los usa al validar.
    const participante = await this.prisma.sorteoParticipante.findFirst({
      where: {
        empresaId,
        celular: { contains: last9 },
        estado: { not: EstadoParticipanteSorteo.RECHAZADO },
        sorteo: { estado: EstadoSorteo.ABIERTO, reabierto: false },
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
        `por *${agencia}*.\n\n` +
        '¿Quién *recogerá* el paquete en la agencia?\n' +
        '*1* — Yo mismo\n' +
        '*2* — Otra persona (regalo o encargo) 🎁',
    );
    return irA('GANADOR_QUIEN', {
      participanteId: participante.id,
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
        where: { id: ctx.participanteId, empresaId },
        data: {
          recibeNombre: ctx.recibeNombre ?? null,
          recibeDni: ctx.recibeDni ?? null,
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
