import { CaracteristicaEmpresaService } from './caracteristica-empresa.service';

/**
 * Tests del gate de características premium. El núcleo es `estaHabilitada`:
 * existe row + habilitado + (sin vencimiento o vencimiento futuro).
 */
describe('CaracteristicaEmpresaService', () => {
  let service: CaracteristicaEmpresaService;
  let prisma: any;

  const DIA = 86400000;

  beforeEach(() => {
    prisma = {
      empresaCaracteristica: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
    service = new CaracteristicaEmpresaService(prisma);
  });

  describe('estaHabilitada', () => {
    it('habilitado sin vencimiento → true', async () => {
      prisma.empresaCaracteristica.findUnique.mockResolvedValue({ habilitado: true, vigenteHasta: null });
      expect(await service.estaHabilitada('e1', 'YAPE_QR' as any)).toBe(true);
    });

    it('habilitado con vencimiento FUTURO → true', async () => {
      prisma.empresaCaracteristica.findUnique.mockResolvedValue({ habilitado: true, vigenteHasta: new Date(Date.now() + DIA) });
      expect(await service.estaHabilitada('e1', 'YAPE_QR' as any)).toBe(true);
    });

    it('habilitado con vencimiento PASADO → false (trial expirado)', async () => {
      prisma.empresaCaracteristica.findUnique.mockResolvedValue({ habilitado: true, vigenteHasta: new Date(Date.now() - DIA) });
      expect(await service.estaHabilitada('e1', 'YAPE_QR' as any)).toBe(false);
    });

    it('habilitado=false → false', async () => {
      prisma.empresaCaracteristica.findUnique.mockResolvedValue({ habilitado: false, vigenteHasta: null });
      expect(await service.estaHabilitada('e1', 'YAPE_QR' as any)).toBe(false);
    });

    it('sin row → false (no habilitada por defecto)', async () => {
      prisma.empresaCaracteristica.findUnique.mockResolvedValue(null);
      expect(await service.estaHabilitada('e1', 'YAPE_QR' as any)).toBe(false);
    });
  });

  describe('mapaHabilitadas', () => {
    it('YAPE_QR vigente → {YAPE_QR:true}; sin features conocidas faltantes en false', async () => {
      prisma.empresaCaracteristica.findMany.mockResolvedValue([
        { caracteristica: 'YAPE_QR', habilitado: true, vigenteHasta: null },
      ]);
      const m = await service.mapaHabilitadas('e1');
      expect(m.YAPE_QR).toBe(true);
    });

    it('YAPE_QR vencida → {YAPE_QR:false}', async () => {
      prisma.empresaCaracteristica.findMany.mockResolvedValue([
        { caracteristica: 'YAPE_QR', habilitado: true, vigenteHasta: new Date(Date.now() - DIA) },
      ]);
      const m = await service.mapaHabilitadas('e1');
      expect(m.YAPE_QR).toBe(false);
    });

    it('empresa sin filas → todas en false', async () => {
      prisma.empresaCaracteristica.findMany.mockResolvedValue([]);
      const m = await service.mapaHabilitadas('e1');
      expect(m.YAPE_QR).toBe(false);
    });
  });

  describe('upsert', () => {
    it('crea/actualiza con los datos dados', async () => {
      prisma.empresaCaracteristica.upsert.mockResolvedValue({ id: 'c1' });
      await service.upsert('e1', 'YAPE_QR' as any, { habilitado: true, vigenteHasta: null, origen: 'TRIAL' as any, otorgadoPorId: 'admin-1' });
      const arg = prisma.empresaCaracteristica.upsert.mock.calls[0][0];
      expect(arg.where).toEqual({ empresaId_caracteristica: { empresaId: 'e1', caracteristica: 'YAPE_QR' } });
      expect(arg.create).toEqual(expect.objectContaining({ empresaId: 'e1', caracteristica: 'YAPE_QR', habilitado: true, origen: 'TRIAL' }));
    });
  });
});
