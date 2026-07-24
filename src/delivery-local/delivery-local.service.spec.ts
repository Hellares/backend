import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  EstadoDeliveryLocal,
  EstadoRepartidorSyncronize,
  EstadoVenta,
  Rol,
} from '@prisma/client';
import { DeliveryLocalService } from './delivery-local.service';

/**
 * Delivery local F1 — las reglas que no pueden romperse:
 *  - gate de plata: sin venta PAGADA_COMPLETA no hay delivery,
 *  - la toma es ATÓMICA (dos repartidores → uno gana, el otro 409),
 *  - las transiciones solo las hace el repartidor ASIGNADO,
 *  - el tracking público no filtra datos ajenos al cliente.
 */
describe('DeliveryLocalService', () => {
  const EMPRESA = 'emp1';
  const VENDEDOR = 'user-vendedor';
  const REPARTIDOR = 'user-repartidor';

  let prisma: any;
  let notificaciones: any;
  let evolution: any;
  let service: DeliveryLocalService;

  const tick = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    prisma = {
      empresaUsuarioRol: { findMany: jest.fn().mockResolvedValue([]) },
      venta: { findFirst: jest.fn() },
      sede: { findUnique: jest.fn().mockResolvedValue(null) },
      deliveryLocal: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      integracionWhatsapp: { findUnique: jest.fn().mockResolvedValue(null) },
      repartidorSyncronize: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      empresa: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    notificaciones = { enviarAUsuarios: jest.fn().mockResolvedValue(undefined) };
    evolution = { sendText: jest.fn().mockResolvedValue(undefined) };
    service = new DeliveryLocalService(prisma, notificaciones, evolution);
  });

  const conRol = (rol: Rol) =>
    prisma.empresaUsuarioRol.findMany.mockResolvedValue([{ rol }]);

  const ventaPagada = (over: Record<string, unknown> = {}) => ({
    id: 'v1',
    codigo: 'VTA-SED-00000800',
    sedeId: 'sede1',
    estado: EstadoVenta.PAGADA_COMPLETA,
    nombreCliente: 'RAYZA PRUEBA',
    telefonoCliente: '51904773029',
    deliveryLocal: null,
    ...over,
  });

  const dtoBase = {
    empresaId: EMPRESA,
    ventaId: 'v1',
    direccion: 'Av. Los Olivos 123',
    distrito: 'Tarapoto',
  };

  describe('solicitar (gate de plata)', () => {
    it('venta NO pagada al 100% → BadRequest, no crea nada', async () => {
      conRol(Rol.VENDEDOR);
      prisma.venta.findFirst.mockResolvedValue(
        ventaPagada({ estado: EstadoVenta.PAGADA_PARCIAL }),
      );
      await expect(service.solicitar(VENDEDOR, dtoBase)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.deliveryLocal.create).not.toHaveBeenCalled();
    });

    it('venta pagada → crea SOLICITADO con tarifa de la sede y avisa a repartidores', async () => {
      conRol(Rol.VENDEDOR);
      prisma.venta.findFirst.mockResolvedValue(ventaPagada());
      prisma.sede.findUnique.mockResolvedValue({ tarifaDeliveryLocal: 5 });
      prisma.deliveryLocal.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'd1', ...data }),
      );
      // El aviso busca repartidores de la empresa.
      prisma.empresaUsuarioRol.findMany
        .mockResolvedValueOnce([{ rol: Rol.VENDEDOR }]) // guard staff
        .mockResolvedValueOnce([{ usuarioId: REPARTIDOR }]); // push

      const d = await service.solicitar(VENDEDOR, dtoBase);
      await tick();

      expect(d.costoDelivery).toBe(5);
      expect(d.sedeId).toBe('sede1');
      expect(d.destinatarioNombre).toBe('RAYZA PRUEBA'); // default de la venta
      expect(notificaciones.enviarAUsuarios).toHaveBeenCalledWith(
        [REPARTIDOR],
        expect.stringContaining('delivery disponible'),
        expect.stringContaining('VTA-SED-00000800'),
        expect.anything(),
      );
    });

    it('venta con delivery previo → Conflict (única por venta)', async () => {
      conRol(Rol.VENDEDOR);
      prisma.venta.findFirst.mockResolvedValue(
        ventaPagada({ deliveryLocal: { id: 'dX' } }),
      );
      await expect(service.solicitar(VENDEDOR, dtoBase)).rejects.toThrow(
        ConflictException,
      );
    });

    it('usuario sin rol staff (repartidor) NO puede solicitar', async () => {
      conRol(Rol.REPARTIDOR);
      await expect(service.solicitar(REPARTIDOR, dtoBase)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('tomar (atómico)', () => {
    it('gana la toma → TOMADO con repartidor y avisa al cliente por WhatsApp', async () => {
      conRol(Rol.REPARTIDOR);
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 1 });
      prisma.deliveryLocal.findUniqueOrThrow.mockResolvedValue({
        id: 'd1',
        empresaId: EMPRESA,
        destinatarioCelular: '51904773029',
        costoDelivery: 5,
        venta: { codigo: 'VTA-SED-00000800' },
      });
      prisma.integracionWhatsapp.findUnique.mockResolvedValue({
        instanceName: 'inst1',
        estado: 'CONECTADO',
        habilitado: true,
      });

      await service.tomar(EMPRESA, 'd1', REPARTIDOR);
      await tick();

      const where = prisma.deliveryLocal.updateMany.mock.calls[0][0].where;
      expect(where.estado).toBe(EstadoDeliveryLocal.SOLICITADO);
      expect(where.repartidorId).toBeNull(); // condición atómica
      expect(evolution.sendText).toHaveBeenCalledWith(
        expect.objectContaining({ number: '51904773029' }),
      );
    });

    it('otro lo tomó primero (count=0) → Conflict', async () => {
      conRol(Rol.REPARTIDOR);
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.tomar(EMPRESA, 'd1', REPARTIDOR)).rejects.toThrow(
        ConflictException,
      );
    });

    it('usuario sin rol repartidor/admin no puede tomar', async () => {
      conRol(Rol.VENDEDOR);
      await expect(service.tomar(EMPRESA, 'd1', VENDEDOR)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('transiciones del repartidor asignado', () => {
    it('en-camino exige TOMADO + repartidor dueño en el where', async () => {
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 1 });
      prisma.deliveryLocal.findUniqueOrThrow.mockResolvedValue({
        id: 'd1',
        empresaId: EMPRESA,
        destinatarioCelular: null, // sin celular → no intenta WhatsApp
        costoDelivery: 5,
        venta: { codigo: 'VTA-1' },
      });

      await service.marcarEnCamino(EMPRESA, 'd1', REPARTIDOR);
      const where = prisma.deliveryLocal.updateMany.mock.calls[0][0].where;
      expect(where.repartidorId).toBe(REPARTIDOR);
      expect(where.estado).toEqual({ in: [EstadoDeliveryLocal.TOMADO] });
    });

    it('transición de un delivery ajeno (count=0) → Conflict', async () => {
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.marcarEntregado(EMPRESA, 'd1', 'otro-user'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('tracking público', () => {
    it('token desconocido → NotFound', async () => {
      prisma.deliveryLocal.findUnique.mockResolvedValue(null);
      await expect(service.tracking('nope')).rejects.toThrow(NotFoundException);
    });

    it('devuelve SOLO estados/tarifa/código — sin dirección ni celular', async () => {
      prisma.deliveryLocal.findUnique.mockResolvedValue({
        estado: EstadoDeliveryLocal.EN_CAMINO,
        costoDelivery: 5,
        creadoEn: new Date('2026-07-23T10:00:00Z'),
        tomadoEn: new Date('2026-07-23T10:05:00Z'),
        enCaminoEn: new Date('2026-07-23T10:10:00Z'),
        entregadoEn: null,
        canceladoEn: null,
        direccion: 'Av. Secreta 999',
        destinatarioCelular: '51904773029',
        venta: { codigo: 'VTA-1' },
      });
      const t = await service.tracking('tok1');
      expect(t.estado).toBe(EstadoDeliveryLocal.EN_CAMINO);
      expect(t.codigo).toBe('VTA-1');
      expect((t as any).direccion).toBeUndefined();
      expect((t as any).destinatarioCelular).toBeUndefined();
    });
  });

  describe('GPS en vivo', () => {
    it('reportarPosicion escribe SOLO si es el dueño y va EN_CAMINO', async () => {
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 1 });
      const r = await service.reportarPosicion(
        EMPRESA,
        'd1',
        REPARTIDOR,
        -6.7714,
        -79.8409,
      );
      expect(r.ok).toBe(true);
      const call = prisma.deliveryLocal.updateMany.mock.calls[0][0];
      expect(call.where.repartidorId).toBe(REPARTIDOR);
      expect(call.where.estado).toBe(EstadoDeliveryLocal.EN_CAMINO);
      expect(call.data.ultimaPosicion).toEqual({ lat: -6.7714, lon: -79.8409 });
    });

    it('reporte tardío (ya entregado / otro dueño) → ok:false SIN error', async () => {
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 0 });
      const r = await service.reportarPosicion(EMPRESA, 'd1', 'otro', 0, 0);
      expect(r.ok).toBe(false);
    });

    it('tracking expone posición SOLO en EN_CAMINO', async () => {
      const base = {
        estado: EstadoDeliveryLocal.EN_CAMINO,
        costoDelivery: 5,
        creadoEn: new Date(),
        tomadoEn: new Date(),
        enCaminoEn: new Date(),
        entregadoEn: null,
        canceladoEn: null,
        ultimaPosicion: { lat: -6.77, lon: -79.84 },
        posicionEn: new Date('2026-07-23T20:00:00Z'),
        coordenadas: null,
        venta: { codigo: 'VTA-1' },
      };
      prisma.deliveryLocal.findUnique.mockResolvedValue(base);
      const t1 = await service.tracking('tok');
      expect(t1.posicion).toMatchObject({ lat: -6.77, lon: -79.84 });

      // Entregado → la posición desaparece del tracking (privacidad).
      prisma.deliveryLocal.findUnique.mockResolvedValue({
        ...base,
        estado: EstadoDeliveryLocal.ENTREGADO,
        entregadoEn: new Date(),
      });
      const t2 = await service.tracking('tok');
      expect(t2.posicion).toBeNull();
    });
  });

  describe('pool EXTERNO (freelance)', () => {
    const FREELANCE = 'user-freelance';
    const repAprobado = (over: Record<string, unknown> = {}) => ({
      id: 'rep1',
      usuarioId: FREELANCE,
      estado: EstadoRepartidorSyncronize.APROBADO,
      celularVerificado: true,
      nombreCompleto: 'RAYZA PEREZ QUISPE',
      zonas: ['Chiclayo'],
      entregasCompletadas: 0,
      ...over,
    });

    it('no aprobado → Forbidden (PENDIENTE no ve nada)', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue(
        repAprobado({ estado: EstadoRepartidorSyncronize.PENDIENTE }),
      );
      await expect(service.poolExterno(FREELANCE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('APROBADO pero SIN celular verificado → Forbidden (candado en el server, no solo en la UI)', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue(
        repAprobado({ celularVerificado: false }),
      );
      await expect(service.poolExterno(FREELANCE)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.tomarExterno('d1', FREELANCE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('pool filtra por opt-in + zona + tope de la empresa', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue(repAprobado());
      prisma.empresa.findMany.mockResolvedValue([
        { id: 'empA', nombre: 'TIENDA A', montoMaxDeliveryExterno: 100 },
      ]);
      prisma.deliveryLocal.findMany.mockResolvedValue([
        // zona ok, monto ok → pasa
        {
          id: 'd1',
          empresaId: 'empA',
          distrito: 'chiclayo', // case/tilde-insensible
          venta: { codigo: 'VTA-1', total: '80' },
        },
        // fuera de zona → fuera
        {
          id: 'd2',
          empresaId: 'empA',
          distrito: 'Lima',
          venta: { codigo: 'VTA-2', total: '10' },
        },
        // supera el tope de mercadería → fuera
        {
          id: 'd3',
          empresaId: 'empA',
          distrito: 'Chiclayo',
          venta: { codigo: 'VTA-3', total: '500' },
        },
      ]);
      const pool = await service.poolExterno(FREELANCE);
      expect(pool.map((d: any) => d.id)).toEqual(['d1']);
      expect((pool[0] as any).empresaNombre).toBe('TIENDA A');
      // el where del query solo pide empresas con opt-in
      expect(prisma.empresa.findMany.mock.calls[0][0].where).toMatchObject({
        aceptaRepartidoresExternos: true,
      });
    });

    it('tomarExterno: empresa sin opt-in → Forbidden', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue(repAprobado());
      prisma.deliveryLocal.findUnique.mockResolvedValue({
        id: 'd1',
        empresaId: 'empA',
        distrito: 'Chiclayo',
        venta: { total: '50' },
      });
      prisma.empresa.findUnique.mockResolvedValue({
        aceptaRepartidoresExternos: false,
      });
      await expect(service.tomarExterno('d1', FREELANCE)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('tomarExterno: nuevo (<10 entregas) con 1 activa → Conflict (límite)', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue(repAprobado());
      prisma.deliveryLocal.findUnique.mockResolvedValue({
        id: 'd1',
        empresaId: 'empA',
        distrito: 'Chiclayo',
        venta: { total: '50' },
      });
      prisma.empresa.findUnique.mockResolvedValue({
        aceptaRepartidoresExternos: true,
        montoMaxDeliveryExterno: null,
      });
      prisma.deliveryLocal.count = jest.fn().mockResolvedValue(1);
      await expect(service.tomarExterno('d1', FREELANCE)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.deliveryLocal.updateMany).not.toHaveBeenCalled();
    });

    it('tomarExterno ok → toma atómica y aviso al cliente con su nombre', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue(repAprobado());
      prisma.deliveryLocal.findUnique.mockResolvedValue({
        id: 'd1',
        empresaId: 'empA',
        distrito: 'Chiclayo',
        venta: { total: '50' },
      });
      prisma.empresa.findUnique.mockResolvedValue({
        aceptaRepartidoresExternos: true,
        montoMaxDeliveryExterno: 100,
      });
      prisma.deliveryLocal.count = jest.fn().mockResolvedValue(0);
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 1 });
      prisma.deliveryLocal.findUniqueOrThrow.mockResolvedValue({
        id: 'd1',
        empresaId: 'empA',
        destinatarioCelular: '51904773029',
        trackingToken: 'tok1',
        venta: { codigo: 'VTA-1' },
      });
      prisma.integracionWhatsapp.findUnique.mockResolvedValue({
        instanceName: 'inst1',
        estado: 'CONECTADO',
        habilitado: true,
      });

      await service.tomarExterno('d1', FREELANCE);
      await new Promise((r) => setImmediate(r));

      const where = prisma.deliveryLocal.updateMany.mock.calls[0][0].where;
      expect(where.repartidorId).toBeNull(); // atómico igual que el interno
      expect(evolution.sendText).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('RAYZA'),
        }),
      );
    });
  });

  describe('cancelar', () => {
    it('staff cancela y se avisa al repartidor asignado', async () => {
      conRol(Rol.EMPRESA_ADMIN);
      prisma.deliveryLocal.findFirst.mockResolvedValue({
        repartidorId: REPARTIDOR,
      });
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 1 });
      prisma.deliveryLocal.findUniqueOrThrow.mockResolvedValue({
        id: 'd1',
        estado: EstadoDeliveryLocal.CANCELADO,
        venta: null,
      });

      await service.cancelar(VENDEDOR, 'd1', {
        empresaId: EMPRESA,
        motivo: 'cliente desistió',
      });
      await tick();
      expect(notificaciones.enviarAUsuarios).toHaveBeenCalledWith(
        [REPARTIDOR],
        expect.stringContaining('cancelado'),
        'cliente desistió',
        expect.anything(),
      );
    });

    it('delivery ya ENTREGADO no se cancela (count=0) → Conflict', async () => {
      conRol(Rol.EMPRESA_ADMIN);
      prisma.deliveryLocal.findFirst.mockResolvedValue({ repartidorId: null });
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        service.cancelar(VENDEDOR, 'd1', { empresaId: EMPRESA }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
