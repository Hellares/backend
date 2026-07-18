/**
 * STRESS TEST del match Yape → participantes (auto-validación):
 * 10 empresas corriendo eventos a la vez, 100 participantes en total,
 * con toda la casuística real:
 *   - sender estilo Yape (nombres + INICIAL del apellido)
 *   - sender estilo Plin (nombre completo, a veces con palabras de más
 *     que el registro → match bidireccional)
 *   - pagador TERCERO (nombre oficial por DNI)
 *   - compras multi-ticket (monto = n × precio)
 *   - HOMÓNIMOS ambiguos → NO se auto-valida (queda para la empresa)
 *   - montos equivocados y pagos ANTERIORES al registro → ignorados
 *   - aislamiento por empresa (mismo nombre en otra empresa no cruza)
 *
 * La decisión de match es lo que se prueba: cambiarEstadoParticipante
 * se mockea (su plomería ya la cubren otros tests) y aquí solo marca
 * el estado en la BD fake.
 */
import { SorteosService } from './sorteos.service';

type Pend = {
  id: string;
  empresaId: string;
  nombre: string;
  pagadorNombre: string | null;
  compraId: string | null;
  estado: string;
  creadoEn: Date;
  sorteo: { precioParticipacion: number };
};

const NOMBRES = [
  'JUAN CARLOS', 'MARIA FERNANDA', 'LUIS ALBERTO', 'ROSA ELENA', 'PEDRO PABLO',
  'ANA LUCIA', 'JORGE LUIS', 'CARMEN JULIA', 'VICTOR RAUL', 'SOFIA ALEJANDRA',
];
const APELLIDOS = [
  'RAMOS VEGA', 'TORRES DIAZ', 'QUISPE MAMANI', 'FLORES ROJAS', 'DIAZ CRUZ',
  'CACERES VALENZUELA', 'GARCIA LUNA', 'HUAMAN PAREDES', 'SALAS RIOS', 'VILCA PUMA',
];

/** "JUAN CARLOS RAMOS VEGA" → "Juan Carlos R." (formato notificación Yape). */
function senderYape(nombreCompleto: string): string {
  const partes = nombreCompleto.split(' ');
  const apellidoIdx = partes.length - 2; // apellidos = últimas 2 palabras
  const nombres = partes.slice(0, apellidoIdx).join(' ');
  return `${nombres} ${partes[apellidoIdx][0]}.`;
}

describe('Stress: auto-validación Yape con 10 empresas / 100 participantes', () => {
  const T0 = new Date('2026-07-18T20:00:00Z').getTime();
  const pendientes: Pend[] = [];
  const validados: { empresaId: string; participanteId: string }[] = [];

  // ── BD fake mínima (solo lo que usan los métodos bajo prueba) ──
  const prisma = {
    sorteoParticipante: {
      findMany: async ({ where }: any) =>
        pendientes.filter(
          (p) => p.empresaId === where.empresaId && p.estado === 'PENDIENTE_PAGO',
        ),
    },
    empresaUsuarioRol: {
      findFirst: async () => ({ usuarioId: 'admin-1' }),
    },
  } as any;

  const service = new SorteosService(
    prisma,
    {} as any, // notificaciones
    { notifySorteoCambiado: () => undefined } as any, // realtime
    {} as any, // storage
    {} as any, // whatsapp
    {} as any, // clientes
    {} as any, // consultasExternas
    { listarPagosRecientes: async () => [] } as any, // integracionYape
  );

  // La plomería de la validación (tickets, WhatsApp, auto-premio) ya
  // está cubierta — aquí solo registra QUIÉN se validó y marca la fila
  // (y sus hermanas de compra) como ACTIVO en la BD fake.
  jest
    .spyOn(service as any, 'cambiarEstadoParticipante')
    .mockImplementation(async (...args: any[]) => {
      const [empresaId, _usuarioId, participanteId] = args as [
        string,
        string,
        string,
      ];
      validados.push({ empresaId, participanteId });
      const fila = pendientes.find((p) => p.id === participanteId)!;
      for (const p of pendientes) {
        if (
          p.id === participanteId ||
          (fila.compraId && p.compraId === fila.compraId)
        ) {
          p.estado = 'ACTIVO';
        }
      }
      return {} as any;
    });

  // ── Generación del mundo: 10 empresas × 10 participantes ──
  type PagoEsperado = {
    empresaId: string;
    pago: { senderName: string; amount: number; receivedAt: string };
    esperaValidar: string | null; // participanteId esperado (null = NO debe validar)
  };
  const eventos: PagoEsperado[] = [];
  const esperadosPorEmpresa = new Map<string, Set<string>>();

  for (let e = 0; e < 10; e++) {
    const empresaId = `emp-${e}`;
    const precio = 5 + e * 5; // precios distintos por empresa (5,10,...50)
    const esperados = new Set<string>();
    esperadosPorEmpresa.set(empresaId, esperados);
    const nombreDe = (i: number) =>
      `${NOMBRES[(e + i) % 10]} ${APELLIDOS[(e * 3 + i) % 10]}`;
    const reg = (min: number) => new Date(T0 + min * 60_000);

    // 6 jugadores normales (índices 0..5): pagan ellos mismos.
    for (let i = 0; i < 6; i++) {
      const id = `p-${e}-${i}`;
      const nombre = nombreDe(i);
      pendientes.push({
        id, empresaId, nombre, pagadorNombre: null, compraId: null,
        estado: 'PENDIENTE_PAGO', creadoEn: reg(i),
        sorteo: { precioParticipacion: precio },
      });
      // Los pares pagan estilo Yape (inicial); los impares estilo Plin
      // (nombre completo con un segundo nombre EXTRA → bidireccional).
      const sender =
        i % 2 === 0 ? senderYape(nombre) : nombre.replace(' ', ' JOSE ');
      eventos.push({
        empresaId,
        pago: {
          senderName: sender,
          amount: precio,
          receivedAt: new Date(T0 + (30 + i) * 60_000).toISOString(),
        },
        esperaValidar: id,
      });
      esperados.add(id);
    }

    // 1 con PAGADOR TERCERO (índice 6): registrado con nombre oficial
    // corto; el titular de la cuenta Yape trae una palabra de más.
    {
      const id = `p-${e}-6`;
      const pagadorOficial = `PEDRO ${APELLIDOS[(e + 4) % 10]}`;
      pendientes.push({
        id, empresaId, nombre: nombreDe(6), pagadorNombre: pagadorOficial,
        compraId: null, estado: 'PENDIENTE_PAGO', creadoEn: reg(6),
        sorteo: { precioParticipacion: precio },
      });
      eventos.push({
        empresaId,
        pago: {
          senderName: `Pedro Pablo ${APELLIDOS[(e + 4) % 10].toLowerCase()}`,
          amount: precio,
          receivedAt: new Date(T0 + 40 * 60_000).toISOString(),
        },
        esperaValidar: id,
      });
      esperados.add(id);
    }

    // 1 COMPRA de 3 tickets (índice 7): tres filas, un pago 3×precio.
    {
      const id = `p-${e}-7`;
      const nombre = nombreDe(7);
      for (let t = 0; t < 3; t++) {
        pendientes.push({
          id: t === 0 ? id : `${id}-t${t}`,
          empresaId, nombre, pagadorNombre: null, compraId: `compra-${e}`,
          estado: 'PENDIENTE_PAGO', creadoEn: reg(7),
          sorteo: { precioParticipacion: precio },
        });
      }
      eventos.push({
        empresaId,
        pago: {
          senderName: senderYape(nombre),
          amount: precio * 3,
          receivedAt: new Date(T0 + 45 * 60_000).toISOString(),
        },
        esperaValidar: id,
      });
      esperados.add(id);
    }

    // 2 HOMÓNIMOS (índices 8-9): mismo nombre de pila + mismo primer
    // apellido → el sender "X L." calza con ambos → AMBIGUO, no valida.
    {
      const base = NOMBRES[(e + 8) % 10];
      pendientes.push({
        id: `p-${e}-8`, empresaId, nombre: `${base} LOPEZ GARCIA`,
        pagadorNombre: null, compraId: null, estado: 'PENDIENTE_PAGO',
        creadoEn: reg(8), sorteo: { precioParticipacion: precio },
      });
      pendientes.push({
        id: `p-${e}-9`, empresaId, nombre: `${base} LOPEZ TORRES`,
        pagadorNombre: null, compraId: null, estado: 'PENDIENTE_PAGO',
        creadoEn: reg(9), sorteo: { precioParticipacion: precio },
      });
      eventos.push({
        empresaId,
        pago: {
          senderName: `${base} L.`,
          amount: precio,
          receivedAt: new Date(T0 + 50 * 60_000).toISOString(),
        },
        esperaValidar: null, // ambiguo: NUNCA auto-validar
      });
    }

    // RUIDO: monto equivocado, pago ANTERIOR al registro, y nombre de
    // OTRA empresa (mismo pool de nombres, precio distinto).
    eventos.push({
      empresaId,
      pago: {
        senderName: senderYape(nombreDe(0)),
        amount: precio + 1.5, // monto que no calza
        receivedAt: new Date(T0 + 55 * 60_000).toISOString(),
      },
      esperaValidar: null,
    });
    eventos.push({
      empresaId,
      pago: {
        senderName: senderYape(nombreDe(3)),
        amount: precio,
        receivedAt: new Date(T0 - 60 * 60_000).toISOString(), // ANTES del registro
      },
      esperaValidar: null,
    });
  }

  it('valida exactamente a los 80 correctos y deja 20 pendientes (ambiguos)', async () => {
    expect(pendientes.length).toBe(120); // 100 participaciones lógicas (compras = 3 filas)

    // Los pagos llegan intercalados entre empresas (orden por hora).
    const ordenados = [...eventos].sort(
      (a, b) =>
        new Date(a.pago.receivedAt).getTime() -
        new Date(b.pago.receivedAt).getTime(),
    );
    const resultados: string[] = [];
    for (const ev of ordenados) {
      const r = await service.autoValidarPorPagoYape(ev.empresaId, ev.pago);
      resultados.push(r.accion);
      if (ev.esperaValidar) {
        expect(r).toMatchObject({
          accion: 'participante-auto-validado',
          participanteId: ev.esperaValidar,
        });
      } else {
        expect(r.accion).not.toBe('participante-auto-validado');
      }
    }

    // 8 validaciones por empresa × 10 empresas = 80.
    expect(validados.length).toBe(80);
    // Cada validación fue del participante CORRECTO de la empresa CORRECTA.
    for (const v of validados) {
      expect(esperadosPorEmpresa.get(v.empresaId)!.has(v.participanteId)).toBe(true);
    }
    // Los homónimos quedaron PENDIENTES en las 10 empresas (2×10 = 20).
    const quedan = pendientes.filter((p) => p.estado === 'PENDIENTE_PAGO');
    expect(quedan.length).toBe(20);
    expect(quedan.every((p) => p.id.endsWith('-8') || p.id.endsWith('-9'))).toBe(true);

    const stats = resultados.reduce<Record<string, number>>((acc, a) => {
      acc[a] = (acc[a] ?? 0) + 1;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.log('\n📊 STRESS 10 empresas / 100 participantes / '
      + `${eventos.length} pagos → ${JSON.stringify(stats)}\n`
      + '   80 auto-validados ✓ · 20 ambiguos a validación manual ✓ · 0 cruces ✓');
  });

  it('los ambiguos SÍ aparecen como sugerencia (chip) para la validación manual', async () => {
    const empresaId = 'emp-0';
    const base = NOMBRES[8 % 10];
    (service as any).integracionYape = {
      listarPagosRecientes: async () => [
        {
          id: 'pay-x',
          senderName: `${base} L.`,
          amount: 5,
          provider: 'yape',
          receivedAt: new Date(T0 + 50 * 60_000).toISOString(),
        },
      ],
    };
    const { sugerencias } = await service.sugerirPagosYape(empresaId);
    const ids = sugerencias.map((s: any) => s.participanteId).sort();
    expect(ids).toEqual(['p-0-8', 'p-0-9']); // ambos homónimos con chip
    expect(sugerencias.every((s: any) => s.montoCoincide)).toBe(true);
  });
});
