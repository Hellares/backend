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

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionApiService,
    private readonly consultasExternas: ConsultasExternasService,
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

    const conv = await this.prisma.conversacionWhatsapp.upsert({
      where: { empresaId_celular: { empresaId, celular } },
      create: { empresaId, celular },
      update: {},
    });

    const msg = texto.trim();
    const msgLower = msg.toLowerCase();
    let estado = conv.estado;
    const ctx: any = conv.contexto ?? {};

    // "menu"/"cancelar" siempre reinician; pasos a medias caducan.
    const minutos = (Date.now() - conv.actualizadoEn.getTime()) / 60000;
    if (['menu', 'menú', 'cancelar', '0'].includes(msgLower)) {
      estado = 'MENU';
    } else if (estado === 'ASESOR') {
      // Silencio: un humano está atendiendo este chat.
      if (minutos < WhatsappBotService.SILENCIO_ASESOR_HORAS * 60) return;
      estado = 'MENU';
    } else if (
      estado !== 'MENU' &&
      minutos > WhatsappBotService.TIMEOUT_PASO_MIN
    ) {
      estado = 'MENU';
    }

    try {
      await this.manejarPaso(cfg.instanceName, empresaId, celular, msg, {
        estado,
        ctx,
        sorteos,
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
        return this.iniciarRegistro(empresaId, celular, ids[idx], responder, irA);
      }

      case 'ESPERANDO_NOMBRE': {
        // Fallback: solo se llega aquí si BD y RENIEC no resolvieron
        // el nombre del DNI.
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
        const dni = msg.replace(/\D/g, '');
        if (dni.length !== 8) {
          await responder('El DNI debe tener *8 dígitos* — inténtalo de nuevo:');
          return;
        }
        // ¿Ya está en este sorteo? (antes de gastar la consulta RENIEC)
        const previo = await this.prisma.sorteoParticipante.findUnique({
          where: { sorteoId_dni: { sorteoId: s.ctx.sorteoId, dni } },
        });
        if (previo) {
          await responder(this.textoEstadoParticipante(previo));
          return irA('MENU', {});
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

      case 'PART_AGENCIA': {
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
            '¿Por qué *agencia* te enviaríamos el premio? (ej. SHALOM / OLVA) — o responde *-* para omitir',
          );
          return;
        }
        await responder(
          '📍 ¿A qué *ciudad y departamento* llegaría?\n' +
            'Sepáralos con coma, ej: *TARAPOTO, SAN MARTÍN*',
        );
        return irA('PART_DESTINO', { ...s.ctx, agencia: msg.toUpperCase() });
      }

      case 'PART_DESTINO': {
        if (msg.length < 3) {
          await responder('Ej: *TARAPOTO, SAN MARTÍN* (ciudad, departamento)');
          return;
        }
        const [prov, dep] = msg.split(',').map((x) => x.trim().toUpperCase());
        await responder(
          '¿Conoces la *dirección de la agencia* en tu ciudad? ' +
            'Escríbela, o responde *-* para omitir.',
        );
        return irA('PART_DIRECCION', {
          ...s.ctx,
          provincia: prov,
          departamento: dep || null,
        });
      }

      case 'PART_DIRECCION': {
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
        await responder(
          '📦 ¡Datos de envío guardados! Si ganas, tu premio saldría por ' +
            `*${s.ctx.agencia}*.\n\n` +
            (await this.instruccionesPago(empresaId, s.ctx)),
        );
        return irA('MENU', {});
      }

      case 'GANADOR_AGENCIA': {
        if (msg.length < 3) {
          await responder(
            '¿Por qué *agencia* quieres recibirlo? (ej. SHALOM / OLVA / MARVISUR)',
          );
          return;
        }
        await responder(
          'Perfecto 📦 ¿a qué *ciudad y departamento* llega?\n' +
            'Sepáralos con coma, ej: *TARAPOTO, SAN MARTÍN*',
        );
        return irA('GANADOR_DESTINO', {
          ...s.ctx,
          agencia: msg.toUpperCase(),
        });
      }

      case 'GANADOR_DESTINO': {
        if (msg.length < 3) {
          await responder('Ej: *TARAPOTO, SAN MARTÍN* (ciudad, departamento)');
          return;
        }
        const [prov, dep] = msg.split(',').map((x) => x.trim().toUpperCase());
        await responder(
          '¿Conoces la *dirección de la agencia* en tu ciudad? ' +
            'Escríbela, o responde *-* para omitir.',
        );
        return irA('GANADOR_DIRECCION', {
          ...s.ctx,
          provincia: prov,
          departamento: dep || null,
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
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
    // ¿Este número ya está registrado en el sorteo?
    const previo = await this.prisma.sorteoParticipante.findFirst({
      where: { sorteoId, celular },
      orderBy: { creadoEn: 'desc' },
    });
    if (previo) {
      await responder(this.textoEstadoParticipante(previo));
      return irA('MENU', {});
    }
    await responder(
      '¡Buenísimo! 🎉 Para registrarte envíame tu *DNI* (8 dígitos):',
    );
    return irA('ESPERANDO_DNI', { sorteoId });
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
    let participanteId: string;
    try {
      const creado = await this.prisma.sorteoParticipante.create({
        data: {
          empresaId,
          sorteoId: sorteo.id,
          celular,
          nombre: ctx.nombre ?? '',
          dni,
        },
      });
      participanteId = creado.id;
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const previo = await this.prisma.sorteoParticipante.findUnique({
          where: { sorteoId_dni: { sorteoId: sorteo.id, dni } },
        });
        await responder(
          previo
            ? this.textoEstadoParticipante(previo)
            : 'Ese DNI ya está registrado en este sorteo 🙂',
        );
        return irA('MENU', {});
      }
      throw e;
    }

    // Registrado ✅ — ahora los datos de envío (opcionales): si gana,
    // la entrega ya queda lista y se muestran en el app.
    await responder(
      (ctx.verificado == true ? `🪪 DNI verificado: *${ctx.nombre}*\n` : '') +
        `✅ ¡Quedaste registrado en *${sorteo.titulo}*, ${(ctx.nombre ?? '').split(' ')[0]}!\n\n` +
        '📦 Para tener tu envío listo si ganas: ¿por qué *agencia* te ' +
        'enviaríamos el premio? (ej. SHALOM / OLVA / MARVISUR)\n' +
        'Responde *-* si prefieres omitirlo.',
    );
    return irA('PART_AGENCIA', {
      ...ctx,
      participanteId,
      sorteoId: sorteo.id,
    });
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

  private textoEstadoParticipante(p: {
    estado: EstadoParticipanteSorteo;
    numeroTicket: number | null;
    nombre: string;
  }): string {
    switch (p.estado) {
      case EstadoParticipanteSorteo.ACTIVO:
        return `🎟️ ¡Ya estás participando, ${p.nombre.split(' ')[0]}! Tu ticket es el *#${p.numeroTicket}*. ¡Suerte! 🍀`;
      case EstadoParticipanteSorteo.RECHAZADO:
        return 'Tu registro anterior fue rechazado 🙁 escríbenos por este chat (opción *3*) para revisarlo.';
      default:
        return '📝 Ya estás registrado — nos falta validar tu pago. Si ya pagaste, envía tu captura por este chat 🙂';
    }
  }

  private async iniciarFlujoGanador(
    empresaId: string,
    celular: string,
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
          '¿Por qué *agencia* quieres recibirlo? (ej. SHALOM / OLVA / MARVISUR)',
      );
      return irA('GANADOR_AGENCIA', { premioId: premio.id });
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
        `envío para *${participante.sorteo.titulo}*.\n\n` +
        '¿Por qué *agencia* te enviaríamos el premio? (ej. SHALOM / OLVA / MARVISUR)',
    );
    return irA('GANADOR_AGENCIA', { participanteId: participante.id });
  }

  private async guardarAgenciaGanador(
    empresaId: string,
    celular: string,
    ctx: any,
    responder: (t: string) => Promise<any>,
    irA: (e: string, c?: any) => Promise<void>,
  ) {
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
      const { count } = await this.prisma.sorteoParticipante.updateMany({
        where: { id: ctx.participanteId, empresaId },
        data: datosEnvio,
      });
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
