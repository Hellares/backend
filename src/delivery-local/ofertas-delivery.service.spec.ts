import { ConflictException } from '@nestjs/common';
import {
  EstadoDeliveryLocal,
  EstadoRepartidorSyncronize,
  Rol,
} from '@prisma/client';
import { DeliveryLocalService } from './delivery-local.service';

/**
 * Subasta de ofertas (estilo inDrive). Lo que no puede romperse:
 *  - un pedido en subasta NO se toma directo — si no, el primero que acepta
 *    el precio base gana siempre y la subasta nunca ocurre;
 *  - una oferta VENCIDA no se puede aceptar (no hay job que las marque: el
 *    vencimiento se deriva de `expiraEn`, así que hay que revalidarlo);
 *  - aceptar asigna de forma atómica, fija el costo ACORDADO y cierra;
 *  - solo se oferta dentro de las propias zonas.
 */
describe('DeliveryLocalService — subasta de ofertas', () => {
  const EMPRESA = 'emp1';
  const FREELANCE = 'user-freelance';
  const STAFF = 'user-vendedor';

  let prisma: any;
  let service: DeliveryLocalService;

  beforeEach(() => {
    prisma = {
      empresaUsuarioRol: { findMany: jest.fn().mockResolvedValue([]) },
      deliveryLocal: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      repartidorSyncronize: { findUnique: jest.fn() },
      empresa: { findUnique: jest.fn() },
      ofertaDelivery: {
        upsert: jest.fn().mockResolvedValue({ id: 'of1' }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      integracionWhatsapp: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    service = new DeliveryLocalService(
      prisma,
      { enviarAUsuarios: jest.fn().mockResolvedValue(undefined) } as any,
      {
        sendText: jest.fn().mockResolvedValue(undefined),
        sendLocation: jest.fn().mockResolvedValue(undefined),
      } as any,
      // El catálogo de ubigeo no interviene en la subasta.
      {} as any,
    );
  });

  const freelanceOk = (over: Record<string, unknown> = {}) =>
    prisma.repartidorSyncronize.findUnique.mockResolvedValue({
      id: 'rep1',
      usuarioId: FREELANCE,
      estado: EstadoRepartidorSyncronize.APROBADO,
      celularVerificado: true,
      nombreCompleto: 'RAYZA PEREZ',
      zonas: ['Salaverry'],
      entregasCompletadas: 3,
      ...over,
    });

  const comoStaff = () =>
    prisma.empresaUsuarioRol.findMany.mockResolvedValue([
      { rol: Rol.EMPRESA_ADMIN },
    ]);

  const enSubasta = (over: Record<string, unknown> = {}) => ({
    id: 'd1',
    empresaId: EMPRESA,
    estado: EstadoDeliveryLocal.SOLICITADO,
    modoOferta: true,
    esInterno: false,
    distrito: 'MIRAMAR',
    direccion: 'MIRAMAR, SALAVERRY',
    ...over,
  });

  const ofertaViva = (over: Record<string, unknown> = {}) => ({
    id: 'of1',
    deliveryId: 'd1',
    repartidorId: FREELANCE,
    monto: 8,
    estado: 'PENDIENTE',
    expiraEn: new Date(Date.now() + 5 * 60_000),
    delivery: { id: 'd1', empresaId: EMPRESA },
    ...over,
  });

  describe('ofertar', () => {
    it('guarda el monto y vence a los 10 minutos', async () => {
      freelanceOk();
      prisma.deliveryLocal.findUnique.mockResolvedValue(enSubasta());
      prisma.empresa.findUnique.mockResolvedValue({
        aceptaRepartidoresExternos: true,
      });

      const antes = Date.now();
      await service.ofertar(FREELANCE, 'd1', 8, 'son 20 min de ida');

      const args = prisma.ofertaDelivery.upsert.mock.calls[0][0];
      expect(args.create.monto).toBe(8);
      expect(args.create.comentario).toBe('son 20 min de ida');
      const minutos = (args.create.expiraEn.getTime() - antes) / 60_000;
      expect(minutos).toBeGreaterThan(9.5);
      expect(minutos).toBeLessThan(10.5);
    });

    it('re-ofertar pisa la anterior y revive una resuelta', async () => {
      freelanceOk();
      prisma.deliveryLocal.findUnique.mockResolvedValue(enSubasta());
      prisma.empresa.findUnique.mockResolvedValue({
        aceptaRepartidoresExternos: true,
      });

      await service.ofertar(FREELANCE, 'd1', 12);

      const args = prisma.ofertaDelivery.upsert.mock.calls[0][0];
      expect(args.where.deliveryId_repartidorId).toEqual({
        deliveryId: 'd1',
        repartidorId: FREELANCE,
      });
      expect(args.update.estado).toBe('PENDIENTE');
      expect(args.update.resueltoEn).toBeNull();
    });

    it('fuera de las propias zonas → no oferta', async () => {
      freelanceOk();
      prisma.deliveryLocal.findUnique.mockResolvedValue(
        enSubasta({ distrito: 'MIRAFLORES', direccion: 'MIRAFLORES, LIMA' }),
      );
      prisma.empresa.findUnique.mockResolvedValue({
        aceptaRepartidoresExternos: true,
      });

      await expect(service.ofertar(FREELANCE, 'd1', 8)).rejects.toThrow(
        /fuera de tus zonas/i,
      );
      expect(prisma.ofertaDelivery.upsert).not.toHaveBeenCalled();
    });

    it('un pedido con tarifa fija rechaza ofertas', async () => {
      freelanceOk();
      prisma.deliveryLocal.findUnique.mockResolvedValue(
        enSubasta({ modoOferta: false }),
      );
      await expect(service.ofertar(FREELANCE, 'd1', 8)).rejects.toThrow(
        /tarifa fija/i,
      );
    });

    it('monto 0 o negativo → rechazado', async () => {
      await expect(service.ofertar(FREELANCE, 'd1', 0)).rejects.toThrow(
        /mayor a 0/i,
      );
    });
  });

  describe('tomar directo', () => {
    it('un pedido en subasta NO se puede tomar directo', async () => {
      freelanceOk();
      prisma.deliveryLocal.findUnique.mockResolvedValue({
        ...enSubasta(),
        venta: { total: '15' },
      });

      await expect(service.tomarExterno('d1', FREELANCE)).rejects.toThrow(
        /propón tu precio/i,
      );
      expect(prisma.deliveryLocal.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('aceptar (staff)', () => {
    it('asigna con el monto ACORDADO, cierra la subasta y resuelve el resto', async () => {
      comoStaff();
      prisma.ofertaDelivery.findUnique.mockResolvedValue(ofertaViva());
      prisma.deliveryLocal.findUniqueOrThrow.mockResolvedValue({
        id: 'd1',
        empresaId: EMPRESA,
        direccion: 'MIRAMAR, SALAVERRY',
        trackingToken: 'tok1',
        venta: { codigo: 'VTA-1' },
      });

      await service.aceptarOferta(EMPRESA, STAFF, 'of1');

      const upd = prisma.deliveryLocal.updateMany.mock.calls[0][0];
      expect(upd.where.estado).toBe(EstadoDeliveryLocal.SOLICITADO);
      expect(upd.where.repartidorId).toBeNull(); // asignación atómica
      expect(upd.data.costoDelivery).toBe(8); // el precio acordado manda
      expect(upd.data.repartidorId).toBe(FREELANCE);
      expect(upd.data.modoOferta).toBe(false); // la subasta se cierra
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('una oferta VENCIDA no se puede aceptar y no asigna nada', async () => {
      comoStaff();
      prisma.ofertaDelivery.findUnique.mockResolvedValue(
        ofertaViva({ expiraEn: new Date(Date.now() - 60_000) }),
      );

      await expect(
        service.aceptarOferta(EMPRESA, STAFF, 'of1'),
      ).rejects.toThrow(/venció/i);
      expect(prisma.deliveryLocal.updateMany).not.toHaveBeenCalled();
    });

    it('si alguien se quedó con el pedido en el medio → Conflict', async () => {
      comoStaff();
      prisma.ofertaDelivery.findUnique.mockResolvedValue(ofertaViva());
      prisma.deliveryLocal.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.aceptarOferta(EMPRESA, STAFF, 'of1'),
      ).rejects.toThrow(ConflictException);
    });

    it('una oferta de OTRA empresa no se puede aceptar', async () => {
      comoStaff();
      prisma.ofertaDelivery.findUnique.mockResolvedValue(
        ofertaViva({ delivery: { id: 'd1', empresaId: 'otra-empresa' } }),
      );

      await expect(
        service.aceptarOferta(EMPRESA, STAFF, 'of1'),
      ).rejects.toThrow(/no encontrada/i);
    });
  });

  describe('listar para el staff', () => {
    it('excluye las vencidas y ordena de la más barata', async () => {
      comoStaff();
      await service.ofertasDe(EMPRESA, STAFF, 'd1');

      const args = prisma.ofertaDelivery.findMany.mock.calls[0][0];
      expect(args.where.estado).toBe('PENDIENTE');
      expect(args.where.expiraEn.gt).toBeInstanceOf(Date);
      expect(args.orderBy).toEqual({ monto: 'asc' });
    });
  });
});
