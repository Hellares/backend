/**
 * SIMULADOR DE CONVERSACIONES del bot de sorteos: BD fake en memoria +
 * Evolution fake que captura los mensajes. Cada test recorre una
 * conversación completa de punta a punta y valida el estado final; la
 * transcripción se imprime para revisión humana (pre-prod).
 */
import {
  EstadoParticipanteSorteo,
  EstadoPremioSorteo,
  EstadoSorteo,
  TipoSorteo,
} from '@prisma/client';
import { WhatsappBotService } from './whatsapp-bot.service';

// ── BD fake ────────────────────────────────────────────────────────────

type Row = Record<string, any>;

class FakeDb {
  seq = 0;
  empresas: Row[] = [];
  configuracionDocumentos: Row[] = [];
  integracionesWhatsapp: Row[] = [];
  integracionesYape: Row[] = [];
  sorteos: Row[] = [];
  participantes: Row[] = [];
  premios: Row[] = [];
  conversaciones: Row[] = [];
  personas: Row[] = [];
}

function coincide(row: Row, where: Row, db: FakeDb): boolean {
  for (const [k, cond] of Object.entries(where ?? {})) {
    if (k === 'sorteo') {
      const sorteo = db.sorteos.find((s) => s.id === row.sorteoId);
      if (!sorteo || !coincide(sorteo, cond as Row, db)) return false;
      continue;
    }
    if (k === 'empresaId_celular') {
      const c = cond as Row;
      if (row.empresaId !== c.empresaId || row.celular !== c.celular)
        return false;
      continue;
    }
    const v = row[k];
    if (cond === null) {
      if (v != null) return false;
    } else if (cond instanceof Date) {
      if (!(v instanceof Date) || v.getTime() !== cond.getTime()) return false;
    } else if (typeof cond === 'object') {
      const c = cond as Row;
      if ('contains' in c && !(v ?? '').includes(c.contains)) return false;
      if ('in' in c && !c.in.includes(v)) return false;
      if ('not' in c) {
        if (c.not === null) {
          if (v == null) return false;
        } else if (v === c.not) return false;
      }
      if ('gt' in c) {
        const a = v instanceof Date ? v.getTime() : v;
        const b = c.gt instanceof Date ? c.gt.getTime() : c.gt;
        if (!(a > b)) return false;
      }
    } else if (v !== cond) return false;
  }
  return true;
}

function ordenar(rows: Row[], orderBy: any): Row[] {
  if (!orderBy || Array.isArray(orderBy)) return rows;
  const [campo, dir] = Object.entries(orderBy)[0] as [string, string];
  return [...rows].sort((a, b) => {
    const x = a[campo] instanceof Date ? a[campo].getTime() : a[campo];
    const y = b[campo] instanceof Date ? b[campo].getTime() : b[campo];
    return dir === 'desc' ? (y > x ? 1 : -1) : x > y ? 1 : -1;
  });
}

function conInclude(row: Row | null, include: any, db: FakeDb): Row | null {
  if (!row || !include?.sorteo) return row;
  return { ...row, sorteo: db.sorteos.find((s) => s.id === row.sorteoId) };
}

function modelo(db: FakeDb, tabla: () => Row[], defaults: Row = {}) {
  const buscar = (where: any) => tabla().filter((r) => coincide(r, where, db));
  return {
    findUnique: async ({ where }: any) => buscar(where)[0] ?? null,
    findFirst: async ({ where, orderBy, include }: any) =>
      conInclude(ordenar(buscar(where), orderBy)[0] ?? null, include, db),
    findMany: async ({ where, orderBy, include }: any) =>
      ordenar(buscar(where), orderBy).map(
        (r) => conInclude(r, include, db) as Row,
      ),
    count: async ({ where }: any) => buscar(where).length,
    create: async ({ data }: any) => {
      const row = {
        id: `id_${++db.seq}`,
        creadoEn: new Date(),
        actualizadoEn: new Date(),
        ...defaults,
        ...data,
      };
      tabla().push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = buscar(where)[0];
      Object.assign(row, data, { actualizadoEn: new Date() });
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const rows = buscar(where);
      rows.forEach((r) => Object.assign(r, data, { actualizadoEn: new Date() }));
      return { count: rows.length };
    },
    upsert: async ({ where, create, update }: any) => {
      const row = buscar(where)[0];
      if (row) {
        Object.assign(row, update, { actualizadoEn: new Date() });
        return row;
      }
      const nuevo = {
        id: `id_${++db.seq}`,
        creadoEn: new Date(),
        actualizadoEn: new Date(),
        ...defaults,
        ...create,
      };
      tabla().push(nuevo);
      return nuevo;
    },
  };
}

// ── Mundo de prueba ────────────────────────────────────────────────────

const EMPRESA = 'emp1';
const INSTANCIA = 'beta_emp1';
const YAPE_EMPRESA = '987654321';

/** DNIs que "RENIEC" (Factiliza fake) sí resuelve. */
const RENIEC: Record<string, any> = {
  '44881122': {
    nombres: 'ROSA MARIA',
    apellidoPaterno: 'TORRES',
    apellidoMaterno: 'DIAZ',
  },
  '40556677': {
    nombres: 'JUAN CARLOS',
    apellidoPaterno: 'PEREZ',
    apellidoMaterno: 'RIOS',
  },
  '70112233': {
    nombres: 'LUCIA',
    apellidoPaterno: 'RAMOS',
    apellidoMaterno: 'VEGA',
  },
};

class Simulador {
  db = new FakeDb();
  enviados: { number: string; text: string }[] = [];
  transcript: string[] = [];
  bot: WhatsappBotService;

  constructor() {
    const prisma = {
      empresa: modelo(this.db, () => this.db.empresas),
      configuracionDocumentos: modelo(
        this.db,
        () => this.db.configuracionDocumentos,
      ),
      integracionWhatsapp: modelo(this.db, () => this.db.integracionesWhatsapp),
      integracionYape: modelo(this.db, () => this.db.integracionesYape),
      sorteo: modelo(this.db, () => this.db.sorteos),
      sorteoParticipante: modelo(this.db, () => this.db.participantes, {
        estado: EstadoParticipanteSorteo.PENDIENTE_PAGO,
        numeroTicket: null,
        recibeNombre: null,
        recibeDni: null,
        pagadorNombre: null,
        pagadorCelular: null,
        agenciaNombre: null,
        destinoDepartamento: null,
        destinoProvincia: null,
        agenciaDireccion: null,
      }),
      sorteoPremio: modelo(this.db, () => this.db.premios),
      conversacionWhatsapp: modelo(this.db, () => this.db.conversaciones, {
        estado: 'MENU',
        contexto: null,
      }),
      persona: modelo(this.db, () => this.db.personas),
    } as any;
    const evolution = {
      disponible: true,
      sendText: async (a: any) => {
        this.enviados.push(a);
      },
      sendImage: async () => undefined,
    } as any;
    const consultas = {
      consultarDni: async (dni: string) => {
        if (!RENIEC[dni]) throw new Error('DNI no encontrado');
        return RENIEC[dni];
      },
    } as any;
    const realtime = { notifySorteoCambiado: () => undefined } as any;
    this.bot = new WhatsappBotService(prisma, evolution, consultas, realtime);

    this.db.empresas.push({ id: EMPRESA, nombre: 'IMPORTACIONES PRUEBA SAC' });
    this.db.integracionesWhatsapp.push({
      id: 'iw1',
      empresaId: EMPRESA,
      instanceName: INSTANCIA,
      estado: 'CONECTADO',
      habilitado: true,
      numero: '51999888777',
      numeroPago: null,
      agenciaEnvio: 'SHALOM',
      plantillaPremio: null,
      plantillaPagoSorteo: null,
      plantillaPagoDinamica: null,
      plantillaConfirmacionSorteo: null,
      plantillaConfirmacionDinamica: null,
    });
    this.db.integracionesYape.push({
      id: 'iy1',
      empresaId: EMPRESA,
      celular: YAPE_EMPRESA,
    });
  }

  crearSorteo(over: Row = {}): Row {
    const s = {
      id: `sorteo_${++this.db.seq}`,
      empresaId: EMPRESA,
      titulo: 'CANASTAZO',
      tipo: TipoSorteo.DINAMICA,
      estado: EstadoSorteo.ABIERTO,
      reabierto: false,
      precioParticipacion: 20,
      creadoEn: new Date(),
      actualizadoEn: new Date(),
      ...over,
    };
    this.db.sorteos.push(s);
    return s;
  }

  /** Envía un mensaje del cliente y registra la transcripción. */
  async cliente(celular: string, texto: string): Promise<string[]> {
    this.transcript.push(`  👤 ${texto}`);
    const antes = this.enviados.length;
    await this.bot.procesarMensaje(INSTANCIA, celular, texto);
    const nuevos = this.enviados.slice(antes).map((m) => m.text);
    if (nuevos.length === 0) this.transcript.push('  🤖 (silencio)');
    for (const n of nuevos) {
      this.transcript.push(
        '  🤖 ' + n.split('\n').join('\n     '),
      );
    }
    return nuevos;
  }

  /** La empresa VALIDA el pago (como cambiarEstadoParticipante). */
  async validar(participanteId: string): Promise<string[]> {
    const p = this.db.participantes.find((x) => x.id === participanteId)!;
    p.estado = EstadoParticipanteSorteo.ACTIVO;
    p.numeroTicket =
      this.db.participantes.filter(
        (x) =>
          x.sorteoId === p.sorteoId &&
          x.estado === EstadoParticipanteSorteo.ACTIVO,
      ).length;
    this.transcript.push('  🏪 [la empresa VALIDA el pago]');
    const antes = this.enviados.length;
    await this.bot.notificarActivacionParticipante(EMPRESA, participanteId);
    const nuevos = this.enviados.slice(antes).map((m) => m.text);
    for (const n of nuevos) {
      this.transcript.push('  🤖 ' + n.split('\n').join('\n     '));
    }
    return nuevos;
  }

  imprimir(titulo: string) {
    // eslint-disable-next-line no-console
    console.log(`\n═══ ${titulo} ═══\n${this.transcript.join('\n')}`);
  }

  get ultimo(): string {
    return this.enviados[this.enviados.length - 1]?.text ?? '';
  }
}

// ── Escenarios ─────────────────────────────────────────────────────────

describe('Simulación E2E del bot de sorteos', () => {
  const CEL = '51900111222';

  it('1. registro nuevo en dinámica: DNI verificado → pago → yapea él mismo', async () => {
    const sim = new Simulador();
    sim.crearSorteo();

    let r = await sim.cliente(CEL, 'hola');
    expect(r[0]).toContain('¡Tenemos *CANASTAZO* activo!');
    expect(r[0]).toContain('*1* — Participar en el CANASTAZO');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('envíame tu *DNI*');

    r = await sim.cliente(CEL, '44881122');
    expect(r[0]).toContain('DNI verificado: *ROSA MARIA TORRES DIAZ*');
    expect(r[0]).toContain('Yapea *S/ 20.00* al *987654321*');
    expect(r[0]).toContain('¿Quién hará el *yape*?');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('Esperamos tu yape');
    expect(r[0]).toContain('te pediremos los datos de envío');

    const p = sim.db.participantes[0];
    expect(p.nombre).toBe('ROSA MARIA TORRES DIAZ');
    expect(p.pagadorNombre).toBeNull();
    sim.imprimir('1. Registro nuevo (yapea él mismo)');
  });

  it('2. yapea OTRA persona: número inválido → válido → nombre → guardado', async () => {
    const sim = new Simulador();
    sim.crearSorteo();
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122');

    let r = await sim.cliente(CEL, '2');
    expect(r[0]).toContain('¿Desde qué *número* harán el yape?');

    r = await sim.cliente(CEL, '123');
    expect(r[0]).toContain('9 dígitos');

    r = await sim.cliente(CEL, '912345678');
    expect(r[0]).toContain('a nombre de *quién*');

    r = await sim.cliente(CEL, 'Maria Fernanda Lopez');
    expect(r[0]).toContain('*MARIA FERNANDA LOPEZ* yapeará desde el *912345678*');

    const p = sim.db.participantes[0];
    expect(p.pagadorNombre).toBe('MARIA FERNANDA LOPEZ');
    expect(p.pagadorCelular).toBe('912345678');
    sim.imprimir('2. Yapea otra persona');
  });

  it('3. en la pregunta del yape, la captura/texto libre NO estorba', async () => {
    const sim = new Simulador();
    sim.crearSorteo();
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122');

    let r = await sim.cliente(CEL, 'ya le mando la captura ✋');
    expect(r).toHaveLength(0); // silencio

    r = await sim.cliente(CEL, '1'); // sigue activo
    expect(r[0]).toContain('Esperamos tu yape');
    sim.imprimir('3. Texto libre durante la pregunta del yape');
  });

  it('4. DNI que ni BD ni RENIEC resuelven → nombre manual, registrado con el DNI', async () => {
    const sim = new Simulador();
    sim.crearSorteo();
    await sim.cliente(CEL, '1');

    let r = await sim.cliente(CEL, '99999999');
    expect(r[0]).toContain('No pudimos validar tu DNI');

    r = await sim.cliente(CEL, 'Pedro Suarez Vertiz');
    expect(r[0]).toContain('Quedaste registrado');

    const p = sim.db.participantes[0];
    expect(p.dni).toBe('99999999');
    expect(p.nombre).toBe('PEDRO SUAREZ VERTIZ');
    sim.imprimir('4. DNI no resoluble → nombre manual');
  });

  it('5. re-participación: pago directo con dirección previa copiada en silencio', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo();
    sim.db.participantes.push({
      id: 'prev1',
      empresaId: EMPRESA,
      sorteoId: s.id,
      celular: CEL,
      dni: '44881122',
      nombre: 'ROSA MARIA TORRES DIAZ',
      estado: EstadoParticipanteSorteo.ACTIVO,
      numeroTicket: 1,
      agenciaNombre: 'SHALOM',
      destinoProvincia: 'TRUJILLO',
      destinoDepartamento: 'LA LIBERTAD',
      agenciaDireccion: 'AV ESPAÑA 123',
      recibeNombre: null,
      recibeDni: null,
      pagadorNombre: null,
      pagadorCelular: null,
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });

    let r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('Ya estás participando');
    expect(r[0]).toContain('(1 activa 🎟️)');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('¡Nueva participación registrada');
    expect(r[0]).toContain('¿Quién hará el *yape*?');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('confirmar tu dirección de envío');

    const nueva = sim.db.participantes[1];
    expect(nueva.agenciaNombre).toBe('SHALOM'); // copiada en silencio
    sim.imprimir('5. Re-participación');
  });

  it('6. validación SIN dirección previa → ciudad→dpto→sucursal → recoge él mismo', async () => {
    const sim = new Simulador();
    sim.crearSorteo();
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122');
    await sim.cliente(CEL, '1'); // yapea él mismo
    const p = sim.db.participantes[0];
    // dinámica: auto-premio al validar
    sim.db.premios.push({
      id: 'premio1',
      empresaId: EMPRESA,
      sorteoId: p.sorteoId,
      participanteId: p.id,
      estado: EstadoPremioSorteo.REGISTRADO,
      ganadorDni: p.dni,
      ganadorNombre: p.nombre,
      ganadorCelular: CEL,
      descripcion: 'CANASTA FAMILIAR',
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });

    let r = await sim.validar(p.id);
    expect(r[0]).toContain('¡Pago confirmado, ROSA!');
    expect(r[0]).toContain('¿A qué *ciudad* te lo enviaríamos?');

    r = await sim.cliente(CEL, 'Trujillo');
    expect(r[0]).toContain('¿En qué *departamento* está TRUJILLO?');

    r = await sim.cliente(CEL, 'La Libertad');
    expect(r[0]).toContain('en esa ciudad?');

    r = await sim.cliente(CEL, 'Av España 123');
    expect(r[0]).toContain('¿Quién *recogerá* el paquete');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('Tú recogerás el paquete con tu DNI');
    expect(r[0]).toContain('cuando tu premio esté en camino');
    expect(r[0]).not.toContain('¡Todo listo!'); // sin doble festejo

    expect(p.agenciaNombre).toBe('SHALOM');
    expect(p.destinoProvincia).toBe('TRUJILLO');
    // el premio auto-creado heredó la dirección
    expect(sim.db.premios[0].agenciaNombre).toBe('SHALOM');
    sim.imprimir('6. Validación sin dirección previa');
  });

  it('7. validación CON dirección previa → opción 1 (misma)', async () => {
    const sim = new Simulador();
    const { p } = await registrarConDireccion(sim);

    let r = await sim.validar(p.id);
    expect(r[0]).toContain('Tenemos esta dirección para tu envío');
    expect(r[0]).toContain('*4* — Es para OTRA persona en OTRA dirección');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('¡Perfecto, mismo envío!');
    sim.imprimir('7. Confirmación: opción 1 (misma dirección)');
  });

  it('8. opción 3: misma dirección, recoge OTRA persona (DNI RENIEC)', async () => {
    const sim = new Simulador();
    const { p } = await registrarConDireccion(sim);
    await sim.validar(p.id);

    let r = await sim.cliente(CEL, '3');
    expect(r[0]).toContain('Envíame el *DNI* de quien recogerá');

    r = await sim.cliente(CEL, '40556677');
    expect(r[0]).toContain('Recogerá: *JUAN CARLOS PEREZ RIOS* (DNI 40556677) ✅');

    expect(p.recibeNombre).toBe('JUAN CARLOS PEREZ RIOS');
    expect(p.agenciaDireccion).toBe('AV ESPAÑA 123'); // dirección intacta
    sim.imprimir('8. Opción 3: recoge otra persona');
  });

  it('9. opción 4: regalo a OTRA dirección — captura completa', async () => {
    const sim = new Simulador();
    const { p } = await registrarConDireccion(sim);
    await sim.validar(p.id);

    let r = await sim.cliente(CEL, '4');
    expect(r[0]).toContain('¡Buen detalle!');

    r = await sim.cliente(CEL, '70112233');
    expect(r[0]).toContain('Recogerá: *LUCIA RAMOS VEGA*');
    expect(r[0]).toContain('*1* — A la misma dirección');

    r = await sim.cliente(CEL, 'Lima');
    r = await sim.cliente(CEL, 'Lima');
    r = await sim.cliente(CEL, 'Suc Miraflores');
    expect(r[0]).toContain('El premio lo recibirá *LUCIA RAMOS VEGA*');

    expect(p.recibeNombre).toBe('LUCIA RAMOS VEGA');
    expect(p.destinoProvincia).toBe('LIMA');
    sim.imprimir('9. Opción 4: regalo con dirección nueva');
  });

  it('10. opción 4 con atajo "1 = misma dirección"', async () => {
    const sim = new Simulador();
    const { p } = await registrarConDireccion(sim);
    await sim.validar(p.id);
    await sim.cliente(CEL, '4');
    await sim.cliente(CEL, '70112233');

    const r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('lo recogerá *LUCIA RAMOS VEGA* en la misma dirección');

    expect(p.recibeNombre).toBe('LUCIA RAMOS VEGA');
    expect(p.destinoProvincia).toBe('TRUJILLO'); // no cambió
    sim.imprimir('10. Opción 4 con atajo misma dirección');
  });

  it('11. opción 4 y responde "-": NO se pierde quién recibe (fix)', async () => {
    const sim = new Simulador();
    const { p } = await registrarConDireccion(sim);
    await sim.validar(p.id);
    await sim.cliente(CEL, '4');
    await sim.cliente(CEL, '70112233');

    const r = await sim.cliente(CEL, '-');
    expect(r[0]).toContain('Quedó anotado que lo recibirá *LUCIA RAMOS VEGA*');
    expect(p.recibeNombre).toBe('LUCIA RAMOS VEGA');
    sim.imprimir('11. Opción 4 + "-" (recibe no se pierde)');
  });

  it('12. flujo GANADOR clásico (menú 2 con premio pendiente)', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo({ tipo: TipoSorteo.SORTEO, titulo: 'SORTEO 28' });
    sim.db.premios.push({
      id: 'premioG',
      empresaId: EMPRESA,
      sorteoId: s.id,
      participanteId: null,
      estado: EstadoPremioSorteo.REGISTRADO,
      ganadorDni: '44881122',
      ganadorNombre: 'ROSA MARIA TORRES DIAZ',
      ganadorCelular: CEL,
      descripcion: 'LICUADORA OSTER',
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });

    let r = await sim.cliente(CEL, '2');
    expect(r[0]).toContain('¡Felicidades ROSA!');
    expect(r[0]).toContain('*LICUADORA OSTER*');

    r = await sim.cliente(CEL, '1'); // recojo yo
    r = await sim.cliente(CEL, 'Tarapoto');
    r = await sim.cliente(CEL, 'San Martin');
    r = await sim.cliente(CEL, '-'); // no sé la sucursal
    expect(r[0]).toContain('Tu premio te llegará por *SHALOM* a *TARAPOTO, SAN MARTIN*');

    const premio = sim.db.premios[0];
    expect(premio.modalidad).toBe('ENVIO_AGENCIA');
    expect(premio.destinoProvincia).toBe('TARAPOTO');
    sim.imprimir('12. Flujo ganador clásico');
  });

  it('13. asesor: silencio a texto libre, opción numérica lo reactiva', async () => {
    const sim = new Simulador();
    sim.crearSorteo();

    let r = await sim.cliente(CEL, '3');
    expect(r[0]).toContain('un asesor te responderá');

    r = await sim.cliente(CEL, 'necesito otra cosa por favor');
    expect(r).toHaveLength(0); // el humano atiende

    r = await sim.cliente(CEL, '1'); // terminó con el asesor
    expect(r[0]).toContain('envíame tu *DNI*');
    sim.imprimir('13. Modo asesor');
  });

  it('14. sorteo REABIERTO: el bot lo ignora por completo', async () => {
    const sim = new Simulador();
    sim.crearSorteo({ reabierto: true });

    const r = await sim.cliente(CEL, 'hola');
    expect(r).toHaveLength(0);
    sim.imprimir('14. Sorteo reabierto (bot mudo)');
  });

  it('15. participante activo: texto libre calla; al CERRAR su sorteo el menú vuelve', async () => {
    const sim = new Simulador();
    // B más antigua → A sale PRIMERA en el menú (orden creadoEn desc).
    sim.crearSorteo({
      titulo: 'DINAMICA B',
      creadoEn: new Date(Date.now() - 60000),
    });
    const a = sim.crearSorteo({ titulo: 'DINAMICA A' });
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '1'); // elige A (lista)
    await sim.cliente(CEL, '44881122');
    await sim.cliente(CEL, '1'); // yapea él mismo

    let r = await sim.cliente(CEL, 'una consulta: ¿hasta cuándo juegan?');
    expect(r).toHaveLength(0); // participa en A abierta → humano

    // La empresa CIERRA la dinámica A:
    a.estado = EstadoSorteo.CERRADO;
    a.actualizadoEn = new Date(Date.now() + 1000);
    sim.transcript.push('  🏪 [la empresa CIERRA la dinámica A]');

    r = await sim.cliente(CEL, 'hola, ¿hay algo nuevo?');
    expect(r[0]).toContain('DINAMICA B'); // menú re-ofrecido de una
    sim.imprimir('15. Ciclo cerrado → menú vuelve solo');
  });

  it('16. paso a medias + sorteo cerrado: resetea al menú vigente', async () => {
    const sim = new Simulador();
    // B más antigua → A sale PRIMERA en el menú (orden creadoEn desc).
    sim.crearSorteo({
      titulo: 'DINAMICA B',
      creadoEn: new Date(Date.now() - 60000),
    });
    const a = sim.crearSorteo({ titulo: 'DINAMICA A' });
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '1'); // elige A → esperando DNI

    a.estado = EstadoSorteo.CERRADO;
    a.actualizadoEn = new Date(Date.now() + 1000);
    sim.transcript.push('  🏪 [la empresa CIERRA la dinámica A]');

    const r = await sim.cliente(CEL, '44881122'); // iba a mandar su DNI
    expect(r[0]).toContain('DINAMICA B'); // no lo registra en la cerrada
    expect(sim.db.participantes).toHaveLength(0);
    sim.imprimir('16. Paso a medias con sorteo cerrado');
  });

  it('17. varias participaciones: elige CUÁL actualizar y solo esa cambia', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo();
    const base = {
      empresaId: EMPRESA,
      sorteoId: s.id,
      celular: CEL,
      dni: '44881122',
      nombre: 'ROSA MARIA TORRES DIAZ',
      estado: EstadoParticipanteSorteo.ACTIVO,
      agenciaNombre: 'SHALOM',
      destinoProvincia: 'TRUJILLO',
      destinoDepartamento: 'LA LIBERTAD',
      agenciaDireccion: 'AV ESPAÑA 123',
      recibeNombre: null,
      recibeDni: null,
      pagadorNombre: null,
      pagadorCelular: null,
      actualizadoEn: new Date(),
    };
    sim.db.participantes.push(
      { ...base, id: 'j1', numeroTicket: 1, creadoEn: new Date(Date.now() - 2000) },
      { ...base, id: 'j2', numeroTicket: 2, creadoEn: new Date(Date.now() - 1000) },
    );
    // auto-premio de la jugada 2 (dinámica): debe heredar el cambio.
    sim.db.premios.push({
      id: 'pj2',
      empresaId: EMPRESA,
      sorteoId: s.id,
      participanteId: 'j2',
      estado: EstadoPremioSorteo.REGISTRADO,
      ganadorDni: '44881122',
      ganadorNombre: 'ROSA MARIA TORRES DIAZ',
      ganadorCelular: CEL,
      descripcion: 'CANASTA',
      agenciaNombre: 'SHALOM',
      destinoProvincia: 'TRUJILLO',
      destinoDepartamento: 'LA LIBERTAD',
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });

    let r = await sim.cliente(CEL, '2');
    expect(r[0]).toContain('Tienes *2* envíos conmigo');
    // Dinámica: NO se habla de "ticket", son participaciones.
    expect(r[0]).toContain('*1* — 🎟️ Participación #1');
    expect(r[0]).toContain('*2* — 🎟️ Participación #2');
    expect(r[0]).not.toContain('Ticket');
    expect(r[0]).not.toContain('🏆'); // premio ligado a j2 NO se duplica

    r = await sim.cliente(CEL, '2'); // elige la participación #2
    expect(r[0]).toContain('actualicemos el envío de tu participación *#2*');

    r = await sim.cliente(CEL, '1'); // recojo yo
    r = await sim.cliente(CEL, 'Lima');
    r = await sim.cliente(CEL, 'Lima');
    r = await sim.cliente(CEL, 'Suc Miraflores');
    expect(r[0]).toContain('¡Datos de envío guardados!');

    const j1 = sim.db.participantes.find((x) => x.id === 'j1')!;
    const j2 = sim.db.participantes.find((x) => x.id === 'j2')!;
    expect(j1.destinoProvincia).toBe('TRUJILLO'); // intacta
    expect(j2.destinoProvincia).toBe('LIMA'); // solo esta cambió
    expect(sim.db.premios[0].destinoProvincia).toBe('LIMA'); // heredó
    sim.imprimir('17. Elegir participación específica');
  });

  it('18. cambiar solo QUIÉN RECOGE de una jugada (atajo misma dirección)', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo();
    sim.db.participantes.push({
      id: 'j1',
      empresaId: EMPRESA,
      sorteoId: s.id,
      celular: CEL,
      dni: '44881122',
      nombre: 'ROSA MARIA TORRES DIAZ',
      estado: EstadoParticipanteSorteo.ACTIVO,
      numeroTicket: 1,
      agenciaNombre: 'SHALOM',
      destinoProvincia: 'TRUJILLO',
      destinoDepartamento: 'LA LIBERTAD',
      agenciaDireccion: 'AV ESPAÑA 123',
      recibeNombre: null,
      recibeDni: null,
      pagadorNombre: null,
      pagadorCelular: null,
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });

    let r = await sim.cliente(CEL, '2'); // un solo ítem → directo
    expect(r[0]).toContain('actualicemos el envío de tu participación *#1*');

    r = await sim.cliente(CEL, '2'); // recogerá otra persona
    r = await sim.cliente(CEL, '70112233');
    expect(r[0]).toContain('*1* — A la misma dirección');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('lo recogerá *LUCIA RAMOS VEGA* en la misma dirección');

    const j1 = sim.db.participantes[0];
    expect(j1.recibeNombre).toBe('LUCIA RAMOS VEGA');
    expect(j1.agenciaDireccion).toBe('AV ESPAÑA 123'); // no se retipeó
    sim.imprimir('18. Cambiar quién recoge con atajo');
  });

  it('19. dinámica CERRADA: sus participaciones y auto-premios NO son editables', async () => {
    const sim = new Simulador();
    const abierta = sim.crearSorteo({ titulo: 'DINAMICA NUEVA' });
    const cerrada = sim.crearSorteo({
      titulo: 'DINAMICA VIEJA',
      estado: EstadoSorteo.CERRADO,
    });
    sim.db.participantes.push({
      id: 'jc1',
      empresaId: EMPRESA,
      sorteoId: cerrada.id,
      celular: CEL,
      dni: '44881122',
      nombre: 'ROSA MARIA TORRES DIAZ',
      estado: EstadoParticipanteSorteo.ACTIVO,
      numeroTicket: 1,
      agenciaNombre: 'SHALOM',
      destinoProvincia: 'TRUJILLO',
      destinoDepartamento: 'LA LIBERTAD',
      agenciaDireccion: null,
      recibeNombre: null,
      recibeDni: null,
      pagadorNombre: null,
      pagadorCelular: null,
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });
    // auto-premio de la jugada cerrada: tampoco debe listarse.
    sim.db.premios.push({
      id: 'pjc1',
      empresaId: EMPRESA,
      sorteoId: cerrada.id,
      participanteId: 'jc1',
      estado: EstadoPremioSorteo.REGISTRADO,
      ganadorDni: '44881122',
      ganadorNombre: 'ROSA MARIA TORRES DIAZ',
      ganadorCelular: CEL,
      descripcion: 'CANASTA VIEJA',
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });
    // premio MANUAL (sin participanteId) de la dinámica cerrada: la
    // dinámica cerrada no es editable — tampoco debe listarse.
    sim.db.premios.push({
      id: 'pmc1',
      empresaId: EMPRESA,
      sorteoId: cerrada.id,
      participanteId: null,
      estado: EstadoPremioSorteo.PREPARANDO,
      ganadorDni: '44881122',
      ganadorNombre: 'ROSA MARIA TORRES DIAZ',
      ganadorCelular: CEL,
      descripcion: 'PREMIO MANUAL VIEJO',
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });
    // participación en la ABIERTA: la única editable.
    sim.db.participantes.push({
      id: 'ja1',
      empresaId: EMPRESA,
      sorteoId: abierta.id,
      celular: CEL,
      dni: '44881122',
      nombre: 'ROSA MARIA TORRES DIAZ',
      estado: EstadoParticipanteSorteo.ACTIVO,
      numeroTicket: 1,
      agenciaNombre: null,
      destinoDepartamento: null,
      destinoProvincia: null,
      agenciaDireccion: null,
      recibeNombre: null,
      recibeDni: null,
      pagadorNombre: null,
      pagadorCelular: null,
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });

    const r = await sim.cliente(CEL, '2');
    // Un solo ítem (el de la abierta) → directo, sin lista ni rastro
    // de la dinámica cerrada (ni jugadas, ni auto-premios, ni manuales).
    expect(r[0]).toContain('registremos el envío de tu participación *#1*');
    expect(r[0]).toContain('DINAMICA NUEVA');
    expect(r[0]).not.toContain('VIEJA');
    expect(r[0]).not.toContain('VIEJO');
    sim.imprimir('19. Cerrada no editable');
  });

  it('20. "0" vuelve al menú desde cualquier paso', async () => {
    const sim = new Simulador();
    sim.crearSorteo();
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122');
    // Está en la pregunta del yape → 0 = menú.
    const r = await sim.cliente(CEL, '0');
    expect(r[0]).toContain('¡Tenemos *CANASTAZO* activo!');
    sim.imprimir('20. "0" desde un paso');
  });

  // Helper: registra a ROSA con dirección previa copiada (recurrente).
  async function registrarConDireccion(sim: Simulador) {
    const s = sim.db.sorteos[0] ?? sim.crearSorteo();
    sim.db.participantes.push({
      id: 'ant1',
      empresaId: EMPRESA,
      sorteoId: s.id,
      celular: '51900999888', // otra jugada vieja del mismo DNI
      dni: '44881122',
      nombre: 'ROSA MARIA TORRES DIAZ',
      estado: EstadoParticipanteSorteo.ACTIVO,
      numeroTicket: 1,
      agenciaNombre: 'SHALOM',
      destinoProvincia: 'TRUJILLO',
      destinoDepartamento: 'LA LIBERTAD',
      agenciaDireccion: 'AV ESPAÑA 123',
      recibeNombre: null,
      recibeDni: null,
      pagadorNombre: null,
      pagadorCelular: null,
      creadoEn: new Date(Date.now() - 86400000),
      actualizadoEn: new Date(Date.now() - 86400000),
    });
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122'); // mismo DNI → re-participación
    await sim.cliente(CEL, '1'); // sí, otra vez
    await sim.cliente(CEL, '1'); // yapea él mismo
    const p = sim.db.participantes.find(
      (x) => x.celular === CEL && x.id !== 'ant1',
    )!;
    return { p };
  }
});
