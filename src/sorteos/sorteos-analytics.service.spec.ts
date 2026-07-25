import { SorteosAnalyticsService } from './sorteos-analytics.service';

/**
 * Tests del dashboard de sorteos: recaudación por tipo (tickets×precio vs
 * Σ premios en dinámica), embudo de pago, top jugadores y agrupados de
 * premios.
 */

const dec = (n: number) => n as unknown as never; // montos llegan como Decimal|number — el servicio usa Number()

const mkLogger = () =>
  ({
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as never;

const mkService = (prisma: unknown) =>
  new SorteosAnalyticsService(prisma as never, mkLogger());

describe('SorteosAnalyticsService.getDashboard', () => {
  it('sin sorteos en el periodo responde el shape vacío', async () => {
    const service = mkService({
      sorteo: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.getDashboard('emp1', {});

    expect(result.resumen.sorteos).toBe(0);
    expect(result.topSorteos).toEqual([]);
    expect(result.serieDiaria).toEqual([]);
  });

  it('recauda tickets×precio en SORTEO y Σ premios en DINÁMICA; arma resumen y tops', async () => {
    const sorteos = [
      {
        id: 's1',
        titulo: 'Rifa TV',
        tipo: 'SORTEO',
        canal: 'FACEBOOK',
        estado: 'ABIERTO',
        fechaSorteo: new Date('2026-07-20T00:00:00Z'),
        precioParticipacion: dec(10),
      },
      {
        id: 's2',
        titulo: 'Canasta',
        tipo: 'DINAMICA',
        canal: 'TIKTOK',
        estado: 'FINALIZADO',
        fechaSorteo: new Date('2026-07-21T00:00:00Z'),
        precioParticipacion: dec(5),
      },
    ];
    const base = {
      creadoEn: new Date('2026-07-20T10:00:00Z'),
      activadoEn: new Date('2026-07-20T12:00:00Z'),
    };
    const participantes = [
      // s1: 3 activos (30 recaudado) + 1 pendiente + 1 rechazado
      { id: 'p1', sorteoId: 's1', estado: 'ACTIVO', dni: '111', nombre: 'Ana', ...base },
      { id: 'p2', sorteoId: 's1', estado: 'ACTIVO', dni: '222', nombre: 'Beto', ...base },
      { id: 'p3', sorteoId: 's1', estado: 'ACTIVO', dni: '111', nombre: 'Ana', ...base },
      { id: 'p4', sorteoId: 's1', estado: 'PENDIENTE_PAGO', dni: '333', nombre: 'Caro', creadoEn: base.creadoEn, activadoEn: null },
      { id: 'p5', sorteoId: 's1', estado: 'RECHAZADO', dni: '444', nombre: 'Dani', creadoEn: base.creadoEn, activadoEn: null },
      // s2 (dinámica): 1 activo — recauda por su premio (12), no por precio (5)
      { id: 'p6', sorteoId: 's2', estado: 'ACTIVO', dni: '111', nombre: 'Ana', ...base },
    ];
    const premios = [
      {
        sorteoId: 's2',
        participanteId: 'p6',
        estado: 'ENTREGADO',
        modalidad: 'RETIRO_TIENDA',
        esEfectivo: false,
        montoParticipacion: dec(12),
        destinoDepartamento: 'La Libertad',
        destinoProvincia: 'Trujillo',
      },
      {
        sorteoId: 's1',
        participanteId: null,
        estado: 'ENVIADO',
        modalidad: 'ENVIO_AGENCIA',
        esEfectivo: true,
        montoParticipacion: null,
        destinoDepartamento: null,
        destinoProvincia: null,
      },
    ];
    const service = mkService({
      sorteo: { findMany: jest.fn().mockResolvedValue(sorteos) },
      sorteoParticipante: { findMany: jest.fn().mockResolvedValue(participantes) },
      sorteoPremio: { findMany: jest.fn().mockResolvedValue(premios) },
    });

    const result = await service.getDashboard('emp1', {});

    // Resumen: 30 (s1) + 12 (s2 por premios) = 42
    expect(result.resumen.recaudado).toBe(42);
    expect(result.resumen.sorteos).toBe(2);
    expect(result.resumen.abiertos).toBe(1);
    expect(result.resumen.participaciones).toBe(6);
    expect(result.resumen.participantesUnicos).toBe(4); // 111,222,333,444
    expect(result.resumen.conversionPagoPct).toBe(66.67); // 4 de 6
    expect(result.resumen.pendientesValidar).toBe(1);
    expect(result.resumen.premiosEntregados).toBe(1);
    expect(result.resumen.tiempoValidacionHoras).toBe(2);

    // Top sorteos por recaudado: s1 (30) sobre s2 (12)
    expect(result.topSorteos[0]).toMatchObject({ id: 's1', recaudado: 30 });
    expect(result.topSorteos[1]).toMatchObject({
      id: 's2',
      recaudado: 12,
      premiosEntregados: 1,
    });

    // Top jugadores: Ana (111) 3 participaciones activas en 2 sorteos,
    // gastó 2×10 (s1) + 12 (premio dinámica) = 32
    expect(result.topJugadores[0]).toMatchObject({
      dni: '111',
      participaciones: 3,
      sorteosDistintos: 2,
      gastado: 32,
    });

    // Premios: EFECTIVO se separa de la modalidad de envío
    expect(result.premiosPorModalidad).toEqual(
      expect.arrayContaining([
        { modalidad: 'EFECTIVO', cantidad: 1 },
        { modalidad: 'RETIRO_TIENDA', cantidad: 1 },
      ]),
    );
    expect(result.zonasPremios).toEqual([
      { zona: 'La Libertad / Trujillo', cantidad: 1 },
    ]);

    // Serie diaria: 30 buckets fijos
    expect(result.serieDiaria).toHaveLength(30);
  });
});
