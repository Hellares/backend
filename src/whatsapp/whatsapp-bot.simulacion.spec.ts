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
  catalogoPremios: Row[] = [];
  archivos: Row[] = [];
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

/** Como Prisma: con select solo vuelven los campos pedidos (escalares). */
function aplicarSelect(row: Row | null, select: any): Row | null {
  if (!row || !select) return row;
  const out: Row = {};
  for (const k of Object.keys(select)) {
    if (select[k]) out[k] = row[k];
  }
  return out;
}

function modelo(db: FakeDb, tabla: () => Row[], defaults: Row = {}) {
  const buscar = (where: any) => tabla().filter((r) => coincide(r, where, db));
  return {
    findUnique: async ({ where, select }: any) =>
      aplicarSelect(buscar(where)[0] ?? null, select),
    findFirst: async ({ where, orderBy, include, select }: any) =>
      aplicarSelect(
        conInclude(ordenar(buscar(where), orderBy)[0] ?? null, include, db),
        select,
      ),
    findMany: async ({ where, orderBy, include, select }: any) =>
      ordenar(buscar(where), orderBy).map(
        (r) => aplicarSelect(conInclude(r, include, db), select) as Row,
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
      sorteoPremioCatalogo: modelo(this.db, () => this.db.catalogoPremios),
      archivo: modelo(this.db, () => this.db.archivos),
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
      sendImage: async (a: any) => {
        this.enviados.push({ ...a, text: `📷 [imagen] ${a.caption ?? ''}` });
      },
      sendDocument: async (a: any) => {
        this.enviados.push({
          ...a,
          text: `📄 [PDF ${a.fileName}] ${a.caption ?? ''}`,
        });
      },
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

  /** La empresa VALIDA el pago (como cambiarEstadoParticipante, con
   *  soporte de COMPRA: activa todas las filas con tickets consecutivos). */
  async validar(participanteId: string): Promise<string[]> {
    const p = this.db.participantes.find((x) => x.id === participanteId)!;
    const filas = p.compraId
      ? this.db.participantes.filter(
          (x) =>
            x.compraId === p.compraId &&
            x.estado === EstadoParticipanteSorteo.PENDIENTE_PAGO,
        )
      : [p];
    let siguiente =
      Math.max(
        0,
        ...this.db.participantes
          .filter((x) => x.sorteoId === p.sorteoId && x.numeroTicket != null)
          .map((x) => x.numeroTicket as number),
      ) + 1;
    const sorteoDeP = this.db.sorteos.find((s) => s.id === p.sorteoId);
    for (const f of filas) {
      f.estado = EstadoParticipanteSorteo.ACTIVO;
      if (f.numeroTicket == null) f.numeroTicket = siguiente++;
      // BINGO: cartilla determinística (como generarCartilla del backend).
      if (sorteoDeP?.tipo === TipoSorteo.BINGO && f.cartilla == null) {
        const grid = [0, 1, 2, 3, 4].map((r) => [
          1 + r,
          16 + r,
          31 + r,
          46 + r,
          61 + r,
        ]);
        grid[2][2] = 0;
        f.cartilla = grid;
      }
    }
    this.transcript.push('  🏪 [la empresa VALIDA el pago]');
    const antes = this.enviados.length;
    await this.bot.notificarActivacionParticipante(EMPRESA, participanteId);
    const nuevos = this.enviados.slice(antes).map((m) => m.text);
    for (const n of nuevos) {
      this.transcript.push('  🤖 ' + n.split('\n').join('\n     '));
    }
    return nuevos;
  }

  /** La empresa JUEGA: el ticket/cartilla #N gana un premio (como
   *  jugarTicket del backend) y el bot le escribe al ganador. */
  async jugar(
    sorteoId: string,
    numeroTicket: number,
    over: Row = {},
  ): Promise<string[]> {
    const t = this.db.participantes.find(
      (x) => x.sorteoId === sorteoId && x.numeroTicket === numeroTicket,
    )!;
    const esEfectivo = over.esEfectivo ?? false;
    // Como jugarTicket: en EFECTIVO no se arrastran datos de agencia.
    const conAgencia = !esEfectivo && !!t.agenciaNombre;
    const premio: Row = {
      id: `premio_${++this.db.seq}`,
      empresaId: EMPRESA,
      sorteoId,
      participanteId: t.id,
      ganadorNombre: t.nombre,
      ganadorDni: t.dni,
      ganadorCelular: t.celular.slice(-9),
      descripcion: 'PREMIO',
      esEfectivo,
      abonoNumero: null,
      estado: EstadoPremioSorteo.REGISTRADO,
      agenciaNombre: conAgencia ? t.agenciaNombre : null,
      destinoDepartamento: conAgencia ? t.destinoDepartamento : null,
      destinoProvincia: conAgencia ? t.destinoProvincia : null,
      agenciaDireccion: conAgencia ? t.agenciaDireccion : null,
      creadoEn: new Date(),
      actualizadoEn: new Date(),
      ...over,
    };
    this.db.premios.push(premio);
    this.transcript.push(
      `  🏪 [la empresa JUEGA: #${numeroTicket} gana "${premio.descripcion}"]`,
    );
    const antes = this.enviados.length;
    await this.bot.notificarPremioGanado(EMPRESA, premio.id);
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

  it('21. editar una jugada YA VALIDADA no vuelve a pedir el pago', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo();
    sim.db.participantes.push({
      id: 'jv1',
      empresaId: EMPRESA,
      sorteoId: s.id,
      celular: CEL,
      dni: '44881122',
      nombre: 'ROSA MARIA TORRES DIAZ',
      estado: EstadoParticipanteSorteo.ACTIVO, // pago YA validado
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

    await sim.cliente(CEL, '2'); // cambiar datos → directo (único ítem)
    await sim.cliente(CEL, '2'); // recogerá otra persona
    await sim.cliente(CEL, '70112233');
    const r = await sim.cliente(CEL, '1'); // misma dirección
    expect(r[0]).toContain('lo recogerá *LUCIA RAMOS VEGA*');
    expect(r[0]).not.toContain('Yapea'); // NO re-pide el pago
    expect(r[0]).not.toContain('pago');
    expect(r[0]).toContain('premio esté en camino'); // dinámica ACTIVO
    sim.imprimir('21. Editar jugada validada (sin re-pago)');
  });

  it('22. SORTEO clásico: compra de 20 tickets en un solo pago', async () => {
    const sim = new Simulador();
    sim.crearSorteo({
      tipo: TipoSorteo.SORTEO,
      titulo: 'GRAN RIFA',
      precioParticipacion: 1,
    });

    let r = await sim.cliente(CEL, '1');
    r = await sim.cliente(CEL, '44881122');
    expect(r[0]).toContain('¿Cuántos tickets quieres (S/ 1.00 c/u)?');

    r = await sim.cliente(CEL, '500'); // pasa el tope
    expect(r[0]).toContain('del *1* al *100*');

    r = await sim.cliente(CEL, '20');
    expect(r[0]).toContain('Reservé tus *20* tickets');
    expect(r[0]).toContain('Yapea *S/ 20.00*'); // monto TOTAL
    expect(r[0]).toContain('¿Quién hará el *yape*?');

    r = await sim.cliente(CEL, '1'); // yapeo yo
    expect(r[0]).toContain('Esperamos tu yape');

    expect(sim.db.participantes).toHaveLength(20);
    const compraId = sim.db.participantes[0].compraId;
    expect(compraId).toBeTruthy();
    expect(
      sim.db.participantes.every((x) => x.compraId === compraId),
    ).toBe(true);

    // La empresa valida UNA fila cualquiera → se activan las 20 con
    // tickets consecutivos y UNA sola confirmación con el rango.
    r = await sim.validar(sim.db.participantes[5].id);
    expect(r[0]).toContain('*#1 al #20*');
    const nums = sim.db.participantes
      .map((x) => x.numeroTicket)
      .sort((a, b) => a - b);
    expect(nums[0]).toBe(1);
    expect(nums[19]).toBe(20);
    sim.imprimir('22. Compra de 20 tickets');
  });

  it('23. comprar MÁS tickets: re-participación en sorteo pregunta cuántos', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo({
      tipo: TipoSorteo.SORTEO,
      titulo: 'GRAN RIFA',
      precioParticipacion: 1,
    });
    sim.db.participantes.push({
      id: 'prev1',
      empresaId: EMPRESA,
      sorteoId: s.id,
      celular: CEL,
      dni: '44881122',
      nombre: 'ROSA MARIA TORRES DIAZ',
      estado: EstadoParticipanteSorteo.ACTIVO,
      numeroTicket: 1,
      compraId: 'compra_vieja',
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

    let r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('¿Quieres comprar *más tickets*?');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('¿Cuántos tickets más quieres');

    r = await sim.cliente(CEL, '5');
    expect(r[0]).toContain('Reservé tus *5* tickets');
    expect(r[0]).toContain('Yapea *S/ 5.00*');

    // 5 filas nuevas con la dirección previa copiada en silencio.
    const nuevas = sim.db.participantes.filter((x) => x.id !== 'prev1');
    expect(nuevas).toHaveLength(5);
    expect(nuevas.every((x) => x.agenciaNombre === 'SHALOM')).toBe(true);
    sim.imprimir('23. Comprar más tickets');
  });

  it('24. opción 4 "Ver los premios": listado + fotos del catálogo', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo({
      tipo: TipoSorteo.SORTEO,
      titulo: 'GRAN RIFA',
      precioParticipacion: 1,
    });
    sim.db.catalogoPremios.push(
      {
        id: 'cat1',
        empresaId: EMPRESA,
        sorteoId: s.id,
        descripcion: 'S/ 500 EN EFECTIVO',
        cantidad: 3,
        creadoEn: new Date(Date.now() - 2000),
        actualizadoEn: new Date(),
      },
      {
        id: 'cat2',
        empresaId: EMPRESA,
        sorteoId: s.id,
        descripcion: 'CELULAR SAMSUNG A15',
        cantidad: 1,
        creadoEn: new Date(Date.now() - 1000),
        actualizadoEn: new Date(),
      },
    );
    // Solo el celular tiene foto registrada.
    sim.db.archivos.push({
      id: 'img1',
      entidadTipo: 'SORTEO_PREMIO_CATALOGO',
      entidadId: 'cat2',
      url: 'https://cdn.test/celular.jpg',
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    });

    let r = await sim.cliente(CEL, 'hola');
    expect(r[0]).toContain('*4* — Ver los premios 🎁');

    r = await sim.cliente(CEL, '4');
    expect(r[0]).toContain('🎁 *Premios de GRAN RIFA:*');
    expect(r[0]).toContain('• 3× S/ 500 EN EFECTIVO');
    expect(r[0]).toContain('• CELULAR SAMSUNG A15');
    // La foto llega como imagen aparte, con su descripción de caption.
    expect(r[1]).toContain('📷 [imagen] CELULAR SAMSUNG A15');
    expect(r).toHaveLength(2); // el premio sin foto NO manda imagen

    // Sin catálogo registrado (dinámica), el menú NO ofrece la opción 4.
    const sim2 = new Simulador();
    sim2.crearSorteo();
    const r2 = await sim2.cliente(CEL, 'hola');
    expect(r2[0]).not.toContain('Ver los premios');
    sim.imprimir('24. Ver los premios (listado + foto)');
  });

  it('25. DINÁMICA + RIFA activas a la vez: el bot guía cuál elegir', async () => {
    const sim = new Simulador();
    sim.crearSorteo({
      titulo: 'CANASTAZO',
      creadoEn: new Date(Date.now() - 60000),
    }); // dinámica
    sim.crearSorteo({
      tipo: TipoSorteo.SORTEO,
      titulo: 'GRAN RIFA',
      precioParticipacion: 1,
    });

    let r = await sim.cliente(CEL, 'hola');
    expect(r[0]).toContain('¡Tenemos 2 sorteos activos!');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('¿En cuál quieres participar?');
    expect(r[0]).toContain('GRAN RIFA');
    expect(r[0]).toContain('CANASTAZO');

    // Elige la RIFA (primera por creadoEn desc) → pregunta CUÁNTOS.
    r = await sim.cliente(CEL, '1');
    r = await sim.cliente(CEL, '44881122');
    expect(r[0]).toContain('¿Cuántos tickets quieres (S/ 1.00 c/u)?');

    // Otro cliente elige la DINÁMICA → registro directo (sin cantidad).
    const CEL2 = '51900333444';
    await sim.cliente(CEL2, '1');
    r = await sim.cliente(CEL2, '2'); // CANASTAZO
    expect(r[0]).toContain('envíame tu *DNI*');
    r = await sim.cliente(CEL2, '40556677');
    expect(r[0]).toContain('¡Quedaste registrado en *CANASTAZO*');
    expect(r[0]).not.toContain('Cuántos tickets');
    sim.imprimir('25. Dinámica + rifa a la vez');
  });

  it('26. BINGO: compra de cartillas y el bot las envía al validar', async () => {
    const sim = new Simulador();
    sim.crearSorteo({
      tipo: TipoSorteo.BINGO,
      titulo: 'GRAN BINGO',
      precioParticipacion: 5,
    });

    let r = await sim.cliente(CEL, 'hola');
    expect(r[0]).toContain('¡Tenemos el bingo *GRAN BINGO* activo!');
    expect(r[0]).toContain('*1* — Comprar cartillas del bingo');

    r = await sim.cliente(CEL, '1');
    r = await sim.cliente(CEL, '44881122');
    expect(r[0]).toContain('¿Cuántas cartillas quieres (S/ 5.00 c/u)?');

    r = await sim.cliente(CEL, '2');
    expect(r[0]).toContain('Reservé tus *2* cartillas 🎱');
    expect(r[0]).toContain('Yapea *S/ 10.00*');

    r = await sim.cliente(CEL, '1'); // yapeo yo

    // La empresa valida → confirmación con rango + 2 IMÁGENES inline
    // (compra chica ≤5: mejor experiencia que el PDF).
    r = await sim.validar(sim.db.participantes[0].id);
    expect(r[0]).toContain('*#1 al #2*');
    expect(r.some((m) => m.includes('📷 [imagen] 🎱 Cartilla *#1*'))).toBe(
      true,
    );
    expect(r.some((m) => m.includes('📷 [imagen] 🎱 Cartilla *#2*'))).toBe(
      true,
    );

    // Compra GRANDE (>5): un solo PDF, sin metralleta de imágenes.
    const CEL2 = '51900333444';
    await sim.cliente(CEL2, '1');
    await sim.cliente(CEL2, '40556677');
    await sim.cliente(CEL2, '8');
    await sim.cliente(CEL2, '1');
    const r2 = await sim.validar(
      sim.db.participantes.find((x) => x.celular === CEL2)!.id,
    );
    const pdf = r2.find((m) => m.includes('[PDF cartillas-bingo.pdf]'));
    expect(pdf).toBeDefined();
    expect(pdf).toContain('Tus 8 cartillas de *GRAN BINGO*');
    expect(r2.some((m) => m.includes('📷 [imagen]'))).toBe(false);
    sim.imprimir('26. Bingo: cartillas como imagen (≤5) o PDF (>5)');
  });

  it('27. rifa: al comprar NO se pide dirección; al GANAR premio físico sí', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo({
      tipo: TipoSorteo.SORTEO,
      titulo: 'GRAN RIFA',
      precioParticipacion: 1,
    });

    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122');
    await sim.cliente(CEL, '3'); // 3 tickets
    let r = await sim.cliente(CEL, '1'); // yapeo yo
    // Ya no promete pedir la dirección: solo la confirmación de tickets.
    expect(r[0]).toContain('te confirmamos tus tickets');
    expect(r[0]).not.toContain('datos de envío');

    // Al validar: suerte y NADA de dirección (se pide solo si gana).
    r = await sim.validar(sim.db.participantes[0].id);
    expect(r[0]).toContain('*#1 al #3*');
    expect(r[0]).toContain('¡Mucha suerte en el sorteo!');
    expect(r[0]).not.toContain('ciudad');
    expect(r[0]).not.toContain('dirección para tu envío');

    // Se cierra la venta y SE JUEGA: el ticket #2 gana un premio FÍSICO.
    s.estado = EstadoSorteo.CERRADO;
    r = await sim.jugar(s.id, 2, { descripcion: 'CELULAR SAMSUNG A15' });
    expect(r[0]).toContain('¡FELICIDADES ROSA!');
    expect(r[0]).toContain('con tu ticket *#2*');
    expect(r[0]).toContain('CELULAR SAMSUNG A15');
    expect(r[0]).toContain('¿Quién *recogerá* el paquete');

    // Flujo de envío del ganador (sobrevive el sorteo CERRADO).
    r = await sim.cliente(CEL, '1'); // recojo yo
    expect(r[0]).toContain('¿A qué *ciudad*');
    r = await sim.cliente(CEL, 'TRUJILLO');
    r = await sim.cliente(CEL, 'LA LIBERTAD');
    r = await sim.cliente(CEL, 'AV ESPAÑA 123');
    expect(r[0]).toContain('Tu premio te llegará por *SHALOM*');

    const premio = sim.db.premios[0];
    expect(premio.agenciaNombre).toBe('SHALOM');
    expect(premio.destinoProvincia).toBe('TRUJILLO');
    expect(premio.destinoDepartamento).toBe('LA LIBERTAD');
    sim.imprimir('27. Rifa: dirección SOLO al ganar (premio físico)');
  });

  it('28. premio en EFECTIVO: confirma el número de Yape (mismo u otro)', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo({
      tipo: TipoSorteo.SORTEO,
      titulo: 'GRAN RIFA',
      precioParticipacion: 1,
    });
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122');
    await sim.cliente(CEL, '2');
    await sim.cliente(CEL, '1');
    await sim.validar(sim.db.participantes[0].id);
    s.estado = EstadoSorteo.CERRADO;

    // Ticket #1 gana EFECTIVO → el bot pide confirmar el número.
    let r = await sim.jugar(s.id, 1, {
      descripcion: 'S/ 500 EN EFECTIVO',
      esEfectivo: true,
    });
    expect(r[0]).toContain('EFECTIVO');
    expect(r[0]).toContain(`(*${CEL.slice(-9)}*)`);
    expect(r[0]).toContain('*2* — A otro número');
    expect(r[0]).not.toContain('ciudad');

    // "1" = a este mismo número.
    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain(`al *${CEL.slice(-9)}*`);
    expect(sim.db.premios[0].abonoNumero).toBe(CEL.slice(-9));

    // Ticket #2 gana otro EFECTIVO → "2" = otro número (con retry).
    r = await sim.jugar(s.id, 2, {
      descripcion: 'S/ 200 EN EFECTIVO',
      esEfectivo: true,
    });
    r = await sim.cliente(CEL, '2');
    expect(r[0]).toContain('¿A qué *número* te yapeamos?');
    r = await sim.cliente(CEL, '123'); // inválido
    expect(r[0]).toContain('9 dígitos');
    r = await sim.cliente(CEL, '944556677');
    expect(r[0]).toContain('al *944556677*');
    expect(sim.db.premios[1].abonoNumero).toBe('944556677');
    sim.imprimir('28. Premio en efectivo: confirmación del Yape');
  });

  it('29. ganador con dirección YA dada: confirmarla; bingo habla de cartillas', async () => {
    const sim = new Simulador();
    const s = sim.crearSorteo({
      tipo: TipoSorteo.BINGO,
      titulo: 'GRAN BINGO',
      precioParticipacion: 5,
    });
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122');
    await sim.cliente(CEL, '1'); // 1 cartilla
    let r = await sim.cliente(CEL, '1'); // yapeo yo
    expect(r[0]).toContain('te confirmamos tus cartillas');
    await sim.validar(sim.db.participantes[0].id);

    // El jugador dejó su dirección por la opción 2 antes del cierre.
    Object.assign(sim.db.participantes[0], {
      agenciaNombre: 'SHALOM',
      destinoProvincia: 'TARAPOTO',
      destinoDepartamento: 'SAN MARTIN',
      agenciaDireccion: null,
    });
    s.estado = EstadoSorteo.CERRADO;

    r = await sim.jugar(s.id, 1, { descripcion: 'CANASTA GIGANTE' });
    expect(r[0]).toContain('con tu cartilla *#1*');
    expect(r[0]).toContain('*SHALOM* a *TARAPOTO, SAN MARTIN*');
    expect(r[0]).toContain('*1* — Sí, es la misma');

    r = await sim.cliente(CEL, '1');
    expect(r[0]).toContain('a la dirección registrada');
    sim.imprimir('29. Ganador confirma dirección ya registrada (bingo)');
  });

  it('30. premio PREPARANDO: con dirección ya NO se cambia; sin dirección aún se captura', async () => {
    const premioBase = {
      empresaId: EMPRESA,
      participanteId: null,
      estado: EstadoPremioSorteo.PREPARANDO,
      ganadorDni: '44881122',
      ganadorNombre: 'ROSA MARIA TORRES DIAZ',
      ganadorCelular: CEL,
      descripcion: 'LICUADORA OSTER',
      creadoEn: new Date(),
      actualizadoEn: new Date(),
    };

    // A) PREPARANDO con dirección registrada → cambio bloqueado (la
    // tienda ya arma el paquete; el rótulo pudo salir impreso).
    const sim = new Simulador();
    const s = sim.crearSorteo({ tipo: TipoSorteo.SORTEO, titulo: 'SORTEO 29' });
    sim.db.premios.push({
      ...premioBase,
      id: 'premioPrep',
      sorteoId: s.id,
      modalidad: 'ENVIO_AGENCIA',
      agenciaNombre: 'SHALOM',
      destinoProvincia: 'TARAPOTO',
      destinoDepartamento: 'SAN MARTIN',
      agenciaDireccion: null,
    });
    let r = await sim.cliente(CEL, '2');
    expect(r[0]).toContain('ya está siendo preparado');
    expect(sim.db.premios[0].destinoProvincia).toBe('TARAPOTO'); // intacto

    // B) PREPARANDO pero SIN dirección (ganador respondió tarde el
    // "¡GANASTE!") → la PRIMERA captura sigue permitida.
    const sim2 = new Simulador();
    const s2 = sim2.crearSorteo({
      tipo: TipoSorteo.SORTEO,
      titulo: 'SORTEO 30',
    });
    sim2.db.premios.push({
      ...premioBase,
      id: 'premioPrepSinDir',
      sorteoId: s2.id,
      agenciaNombre: null,
    });
    r = await sim2.cliente(CEL, '2');
    expect(r[0]).toContain('¡Felicidades ROSA!');
    r = await sim2.cliente(CEL, '1'); // recojo yo
    r = await sim2.cliente(CEL, 'Tarapoto');
    r = await sim2.cliente(CEL, 'San Martin');
    r = await sim2.cliente(CEL, '-');
    expect(r[0]).toContain('Tu premio te llegará por *SHALOM*');
    expect(sim2.db.premios[0].agenciaNombre).toBe('SHALOM');
    sim.imprimir('30A. Premio PREPARANDO con dirección: bloqueado');
    sim2.imprimir('30B. Premio PREPARANDO sin dirección: primera captura');
  });

  it('31. LIVE: el bot comparte los links del sorteo (menú y confirmación)', async () => {
    const sim = new Simulador();
    sim.crearSorteo({
      tipo: TipoSorteo.SORTEO,
      titulo: 'GRAN RIFA',
      liveLinks: [
        { plataforma: 'FACEBOOK', url: 'https://fb.watch/rifa123' },
        { plataforma: 'TIKTOK', url: 'https://tiktok.com/@tienda/live' },
      ],
    });

    // Menú: el saludo trae el bloque EN VIVO con ambos links.
    let r = await sim.cliente(CEL, 'hola');
    expect(r[0]).toContain('EN VIVO');
    expect(r[0]).toContain('▶️ Facebook: https://fb.watch/rifa123');
    expect(r[0]).toContain('▶️ TikTok: https://tiktok.com/@tienda/live');

    // Compra normal → al VALIDAR el pago la confirmación invita al live.
    await sim.cliente(CEL, '1');
    await sim.cliente(CEL, '44881122');
    await sim.cliente(CEL, '2'); // 2 tickets
    r = await sim.cliente(CEL, '1'); // yapeo yo mismo
    const msgs = await sim.validar(sim.db.participantes[0].id);
    expect(msgs.join('\n')).toContain('Síguelo EN VIVO');
    expect(msgs.join('\n')).toContain('https://fb.watch/rifa123');

    // Sorteo SIN links: el menú no muestra el bloque.
    const sim2 = new Simulador();
    sim2.crearSorteo({ tipo: TipoSorteo.SORTEO, titulo: 'SIN LIVE' });
    r = await sim2.cliente(CEL, 'hola');
    expect(r[0]).not.toContain('EN VIVO');
    sim.imprimir('31. Links del LIVE');
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
