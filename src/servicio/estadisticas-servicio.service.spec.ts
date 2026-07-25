import { EstadisticasServicioService } from './estadisticas-servicio.service';

/**
 * Tests del dashboard consolidado de órdenes de servicio: criterios de
 * dinero (ingreso cerradas / adelantos / por cobrar), calidad
 * (reingresos, vencidas) y agrupados.
 */

const dec = (n: number) => n as unknown as never; // el servicio usa Number()

const mkService = (prisma: unknown) =>
  new EstadisticasServicioService(prisma as never);

const base = {
  prioridad: 'NORMAL',
  creadoEn: new Date('2026-07-01T15:00:00Z'),
  actualizadoEn: new Date('2026-07-03T15:00:00Z'), // 48h después
  cantidadReingresos: 0,
  tipoEquipo: null,
  marcaEquipo: null,
  tecnicoId: null,
  tecnico: null,
  fechaEntrega: null,
};

describe('EstadisticasServicioService.getDashboard', () => {
  it('separa dinero cerrado, adelantos y por cobrar; detecta vencidas y reingresos', async () => {
    const ordenes = [
      // ENTREGADO: ingresa S/200, cerró en 48h
      {
        ...base,
        estado: 'ENTREGADO',
        tipoServicio: 'REPARACION',
        costoTotal: dec(200),
        adelanto: dec(50),
        tecnicoId: 't1',
        tecnico: { persona: { nombres: 'Luis', apellidos: 'Rojas' } },
        tipoEquipo: 'Laptop',
        marcaEquipo: 'HP',
      },
      // Activa EN_REPARACION con costo 300 y adelanto 100 → por cobrar 200,
      // fechaEntrega vencida y con reingreso
      {
        ...base,
        estado: 'EN_REPARACION',
        tipoServicio: 'REPARACION',
        costoTotal: dec(300),
        adelanto: dec(100),
        cantidadReingresos: 1,
        fechaEntrega: new Date('2026-07-10T00:00:00Z'), // pasado
        tecnicoId: 't1',
        tecnico: { persona: { nombres: 'Luis', apellidos: 'Rojas' } },
        tipoEquipo: 'Laptop',
        marcaEquipo: 'HP',
      },
      // CANCELADO: no suma ingreso ni cuenta como entregada
      {
        ...base,
        estado: 'CANCELADO',
        tipoServicio: 'MANTENIMIENTO',
        costoTotal: dec(80),
        adelanto: null,
      },
    ];
    const service = mkService({
      ordenServicio: { findMany: jest.fn().mockResolvedValue(ordenes) },
      tercerizacionServicio: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.getDashboard('emp1', {} as never);

    expect(result.resumen).toMatchObject({
      totalOrdenes: 3,
      enTaller: 1,
      entregadas: 1,
      canceladas: 1,
      vencidas: 1,
      ingresoTotal: 200, // solo la ENTREGADO
      adelantosCobrados: 150, // 50 + 100
      porCobrar: 200, // 300 - 100 de la activa
      reingresos: 1,
      tiempoPromedioResolucionHoras: 48,
    });

    // Embudo en orden de flujo con solo los estados presentes
    expect(result.porEstado.map((e) => e.estado)).toEqual([
      'EN_REPARACION',
      'ENTREGADO',
      'CANCELADO',
    ]);

    // Técnico acumula sus órdenes; ingreso solo de las cerradas
    expect(result.topTecnicos).toEqual([
      {
        tecnicoId: 't1',
        nombre: 'Luis Rojas',
        ordenes: 2,
        cerradas: 1,
        ingreso: 200,
      },
    ]);

    // Equipos: "marca tipo"
    expect(result.topEquipos).toEqual([{ equipo: 'HP Laptop', cantidad: 2 }]);

    // Tipos con ingreso solo de cerradas
    expect(result.porTipo[0]).toMatchObject({
      tipo: 'REPARACION',
      cantidad: 2,
      ingreso: 200,
    });
  });

  it('sin órdenes responde el shape vacío sin dividir por cero', async () => {
    const service = mkService({
      ordenServicio: { findMany: jest.fn().mockResolvedValue([]) },
      tercerizacionServicio: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.getDashboard('emp1', {} as never);

    expect(result.resumen.totalOrdenes).toBe(0);
    expect(result.resumen.reingresosPct).toBe(0);
    expect(result.resumen.tiempoPromedioResolucionHoras).toBeNull();
    expect(result.porEstado).toEqual([]);
    expect(result.tercerizaciones.enviadas.total).toBe(0);
    expect(result.tercerizaciones.recibidas.total).toBe(0);
  });

  it('tercerizaciones: separa enviadas/recibidas, dinero B2B y partners', async () => {
    const enviadas = [
      // Completada: pagué 100, cobré 250 al cliente → ganancia 150; ya pagada
      {
        estado: 'COMPLETADO',
        precioB2B: dec(100),
        pagadoB2B: true,
        empresaDestino: { nombre: 'Taller Sur' },
        ordenOrigen: { costoTotal: dec(250) },
      },
      // En proceso sin pagar → porPagar 80
      {
        estado: 'EN_PROCESO',
        precioB2B: dec(80),
        pagadoB2B: false,
        empresaDestino: { nombre: 'Taller Sur' },
        ordenOrigen: { costoTotal: null },
      },
      // Rechazada: fuera del dinero, cuenta solo en estados
      {
        estado: 'RECHAZADO',
        precioB2B: dec(999),
        pagadoB2B: false,
        empresaDestino: { nombre: 'Taller Norte' },
        ordenOrigen: { costoTotal: dec(999) },
      },
    ];
    const recibidas = [
      {
        estado: 'COMPLETADO',
        precioB2B: dec(120),
        pagadoB2B: false,
        empresaOrigen: { nombre: 'Taller Norte' },
      },
    ];
    const tercerizacionFindMany = jest
      .fn()
      .mockResolvedValueOnce(enviadas)
      .mockResolvedValueOnce(recibidas);
    const service = mkService({
      ordenServicio: { findMany: jest.fn().mockResolvedValue([]) },
      tercerizacionServicio: { findMany: tercerizacionFindMany },
    });

    const result = await service.getDashboard('emp1', {} as never);

    expect(result.tercerizaciones.enviadas).toMatchObject({
      total: 3,
      costoB2B: 180, // 100 + 80 (la rechazada no cuenta)
      gananciaEstimada: 150, // 250 - 100
      porPagarB2B: 80,
    });
    expect(result.tercerizaciones.recibidas).toMatchObject({
      total: 1,
      ingresoB2B: 120,
      porCobrarB2B: 120,
    });
    // Partners consolidados en ambas direcciones
    expect(result.tercerizaciones.partners).toEqual([
      { nombre: 'Taller Sur', enviadas: 2, recibidas: 0 },
      { nombre: 'Taller Norte', enviadas: 1, recibidas: 1 },
    ]);
  });
});
