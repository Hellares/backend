import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EmpresaBancoService } from './empresa-banco.service';

/**
 * Tests de conciliar/ajustar (F3b): el saldo lo maneja el sistema; toda edición
 * manual queda asentada en AjusteBanco con saldo antes/después. Sin DB: mock.
 */
describe('EmpresaBancoService ajustes/conciliación', () => {
  const EMPRESA = 'emp-1';
  const BANCO = 'banco-1';
  const USER = 'user-1';
  let prisma: any;
  let tx: any;
  let service: EmpresaBancoService;

  beforeEach(() => {
    tx = {
      empresaBanco: {
        findFirst: jest.fn().mockResolvedValue({ id: BANCO, saldoActual: 1000 }),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: BANCO, ...data })),
      },
      ajusteBanco: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn().mockImplementation((cb: any) => cb(tx)),
      ajusteBanco: { findMany: jest.fn().mockResolvedValue([]) },
      empresaBanco: { findFirst: jest.fn().mockResolvedValue({ id: BANCO }) },
    };
    service = new EmpresaBancoService(prisma);
  });

  describe('conciliar', () => {
    it('fija el saldo real y asienta el delta como ajuste CONCILIACION', async () => {
      // saldo 1000 → real 1200 → delta +200 (INGRESO)
      await service.conciliar(EMPRESA, BANCO, USER, 1200, 'Extracto junio');
      expect(tx.empresaBanco.update).toHaveBeenCalledWith({
        where: { id: BANCO },
        data: { saldoActual: 1200 },
      });
      expect(tx.ajusteBanco.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tipo: 'INGRESO',
          monto: 200,
          origen: 'CONCILIACION',
          saldoAnterior: 1000,
          saldoNuevo: 1200,
          motivo: 'Extracto junio',
          usuarioId: USER,
        }),
      });
    });

    it('un saldo real MENOR genera ajuste EGRESO', async () => {
      await service.conciliar(EMPRESA, BANCO, USER, 800);
      expect(tx.ajusteBanco.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tipo: 'EGRESO', monto: 200, origen: 'CONCILIACION' }),
      });
    });

    it('si no hay diferencia (delta 0) NO crea ajuste', async () => {
      await service.conciliar(EMPRESA, BANCO, USER, 1000);
      expect(tx.empresaBanco.update).toHaveBeenCalled();
      expect(tx.ajusteBanco.create).not.toHaveBeenCalled();
    });

    it('cuenta inexistente → NotFound', async () => {
      tx.empresaBanco.findFirst.mockResolvedValue(null);
      await expect(service.conciliar(EMPRESA, 'x', USER, 1200)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('ajustar', () => {
    it('INGRESO suma al saldo y registra AJUSTE_MANUAL', async () => {
      await service.ajustar(EMPRESA, BANCO, USER, { tipo: 'INGRESO', monto: 50, motivo: 'Interés' });
      expect(tx.empresaBanco.update).toHaveBeenCalledWith({
        where: { id: BANCO },
        data: { saldoActual: 1050 },
      });
      expect(tx.ajusteBanco.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tipo: 'INGRESO', monto: 50, origen: 'AJUSTE_MANUAL', saldoNuevo: 1050 }),
      });
    });

    it('EGRESO resta del saldo', async () => {
      await service.ajustar(EMPRESA, BANCO, USER, { tipo: 'EGRESO', monto: 30, motivo: 'Comisión' });
      expect(tx.empresaBanco.update).toHaveBeenCalledWith({
        where: { id: BANCO },
        data: { saldoActual: 970 },
      });
    });

    it('rechaza monto <= 0', async () => {
      await expect(
        service.ajustar(EMPRESA, BANCO, USER, { tipo: 'INGRESO', monto: 0, motivo: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza motivo vacío', async () => {
      await expect(
        service.ajustar(EMPRESA, BANCO, USER, { tipo: 'INGRESO', monto: 10, motivo: '  ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getAjustes', () => {
    it('lista los ajustes de la cuenta', async () => {
      prisma.ajusteBanco.findMany.mockResolvedValue([{ id: 'a1' }]);
      const res = await service.getAjustes(EMPRESA, BANCO);
      expect(res).toEqual([{ id: 'a1' }]);
      expect(prisma.ajusteBanco.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { empresaId: EMPRESA, bancoId: BANCO } }),
      );
    });

    it('cuenta inexistente → NotFound', async () => {
      prisma.empresaBanco.findFirst.mockResolvedValue(null);
      await expect(service.getAjustes(EMPRESA, 'x')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
