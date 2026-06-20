import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CuentasRecaudacionService } from './cuentas-recaudacion.service';

/**
 * Tests del mapeo método→cuenta de recaudación (Fase 1). Sin DB: mockeamos
 * `prisma.cuentaRecaudacion.*` y `prisma.empresaBanco.findFirst`.
 */
describe('CuentasRecaudacionService', () => {
  const EMPRESA = 'emp-1';
  let prisma: any;
  let service: CuentasRecaudacionService;

  beforeEach(() => {
    prisma = {
      cuentaRecaudacion: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'cr-1', ...create })),
        delete: jest.fn().mockResolvedValue({}),
      },
      empresaBanco: {
        findFirst: jest.fn().mockResolvedValue({ id: 'banco-1' }),
      },
    };
    service = new CuentasRecaudacionService(prisma);
  });

  describe('listar', () => {
    it('devuelve una fila por cada método recaudable, con banco null si no está configurado', async () => {
      prisma.cuentaRecaudacion.findMany.mockResolvedValue([
        { metodoPago: 'YAPE', bancoId: 'banco-1', banco: { id: 'banco-1', nombreBanco: 'BCP' } },
      ]);
      const res = await service.listar(EMPRESA);
      expect(res.map((r) => r.metodoPago)).toEqual(['YAPE', 'PLIN', 'TARJETA', 'TRANSFERENCIA']);
      const yape = res.find((r) => r.metodoPago === 'YAPE');
      const plin = res.find((r) => r.metodoPago === 'PLIN');
      expect(yape).toMatchObject({ bancoId: 'banco-1', banco: { nombreBanco: 'BCP' } });
      expect(plin).toMatchObject({ bancoId: null, banco: null });
    });
  });

  describe('set', () => {
    it('hace upsert del método con la cuenta validando que el banco sea de la empresa', async () => {
      await service.set(EMPRESA, 'YAPE', 'banco-1');
      expect(prisma.empresaBanco.findFirst).toHaveBeenCalledWith({
        where: { id: 'banco-1', empresaId: EMPRESA, isActive: true },
        select: { id: true },
      });
      expect(prisma.cuentaRecaudacion.upsert).toHaveBeenCalledWith({
        where: { empresaId_metodoPago: { empresaId: EMPRESA, metodoPago: 'YAPE' } },
        create: { empresaId: EMPRESA, metodoPago: 'YAPE', bancoId: 'banco-1' },
        update: { bancoId: 'banco-1' },
      });
    });

    it('rechaza EFECTIVO (no se recauda en banco)', async () => {
      await expect(service.set(EMPRESA, 'EFECTIVO', 'banco-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.cuentaRecaudacion.upsert).not.toHaveBeenCalled();
    });

    it('rechaza un método inválido', async () => {
      await expect(service.set(EMPRESA, 'CRIPTO', 'banco-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rechaza si el banco no es de la empresa o está inactivo', async () => {
      prisma.empresaBanco.findFirst.mockResolvedValue(null);
      await expect(service.set(EMPRESA, 'PLIN', 'banco-x')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.cuentaRecaudacion.upsert).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('elimina el mapeo si existe', async () => {
      prisma.cuentaRecaudacion.findUnique.mockResolvedValue({ id: 'cr-1' });
      const res = await service.remove(EMPRESA, 'YAPE');
      expect(prisma.cuentaRecaudacion.delete).toHaveBeenCalledWith({ where: { id: 'cr-1' } });
      expect(res).toEqual({ ok: true });
    });

    it('lanza NotFound si no hay mapeo para ese método', async () => {
      prisma.cuentaRecaudacion.findUnique.mockResolvedValue(null);
      await expect(service.remove(EMPRESA, 'YAPE')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rechaza método no recaudable antes de tocar la DB', async () => {
      await expect(service.remove(EMPRESA, 'EFECTIVO')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.cuentaRecaudacion.findUnique).not.toHaveBeenCalled();
    });
  });
});
