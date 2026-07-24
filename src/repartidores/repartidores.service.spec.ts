import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { EstadoRepartidorSyncronize, Rol } from '@prisma/client';
import { RepartidoresService } from './repartidores.service';

/**
 * Registro freelance R1 — lo inquebrantable:
 *  - sin RENIEC no hay registro (el nombre es el oficial, no autodeclarado),
 *  - un DNI = un repartidor (re-registro → 409),
 *  - si el usuario ya existía se REUSA (no se pisa su password),
 *  - OTP vence y no verifica con código malo,
 *  - solo el super admin aprueba/suspende.
 */
describe('RepartidoresService', () => {
  let prisma: any;
  let tx: any;
  let consultas: any;
  let evolution: any;
  let service: RepartidoresService;

  const dtoBase = {
    dni: '70490492',
    celular: '904773029',
    password: 'clave12345',
    zonas: ['Chiclayo', ' José Leonardo Ortiz '],
  };

  beforeEach(() => {
    tx = {
      persona: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'p1', ...data }),
          ),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'u1', ...data }),
          ),
      },
      authProvider: { create: jest.fn().mockResolvedValue({}) },
      repartidorSyncronize: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
      repartidorSyncronize: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 'r1', celular: '904773029', ...data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
      usuario: { findUnique: jest.fn().mockResolvedValue(null) },
      empresaUsuarioRol: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    consultas = {
      consultarDni: jest.fn().mockResolvedValue({
        nombres: 'RAYZA',
        apellidoPaterno: 'PEREZ',
        apellidoMaterno: 'QUISPE',
      }),
    };
    evolution = { sendText: jest.fn().mockResolvedValue(undefined) };
    service = new RepartidoresService(prisma, consultas, evolution);
  });

  describe('registrar', () => {
    it('DNI que RENIEC no resuelve → BadRequest, no crea nada', async () => {
      consultas.consultarDni.mockRejectedValue(new Error('no encontrado'));
      await expect(service.registrar(dtoBase)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('crea Persona + Usuario login-DNI + AuthProvider + perfil PENDIENTE con nombre OFICIAL', async () => {
      const r = await service.registrar(dtoBase);
      expect(r.estado).toBe(EstadoRepartidorSyncronize.PENDIENTE);
      expect(r.nombreCompleto).toBe('RAYZA PEREZ QUISPE');

      const usuarioData = tx.usuario.create.mock.calls[0][0].data;
      expect(usuarioData.metodoPrincipalLogin).toBe('DNI');
      expect(usuarioData.passwordHash).toBeTruthy();
      // Sin email no hay nada que verificar — sin este flag el login lo
      // rebota con "verifica tu email" (pasó con el repartidor de prueba).
      expect(usuarioData.emailVerificado).toBe(true);
      // El login exige AuthProvider PASSWORD (gotcha real del test manual).
      expect(tx.authProvider.create.mock.calls[0][0].data.provider).toBe(
        'PASSWORD',
      );
      const repData = tx.repartidorSyncronize.create.mock.calls[0][0].data;
      expect(repData.zonas).toEqual(['Chiclayo', 'José Leonardo Ortiz']);
    });

    it('DNI ya registrado como repartidor → Conflict', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue({
        id: 'rX',
        estado: EstadoRepartidorSyncronize.PENDIENTE,
      });
      await expect(service.registrar(dtoBase)).rejects.toThrow(
        ConflictException,
      );
    });

    it('usuario existente (ya era cliente) se REUSA sin tocar su password', async () => {
      tx.persona.findUnique.mockResolvedValue({ id: 'p9' });
      tx.usuario.findUnique.mockResolvedValue({ id: 'u9' });
      await service.registrar(dtoBase);
      expect(tx.usuario.create).not.toHaveBeenCalled();
      expect(tx.authProvider.create).not.toHaveBeenCalled();
      expect(
        tx.repartidorSyncronize.create.mock.calls[0][0].data.usuarioId,
      ).toBe('u9');
    });
  });

  describe('OTP', () => {
    it('código correcto y vigente → verifica y limpia el OTP', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue({
        id: 'r1',
        celularVerificado: false,
        otpCodigo: '123456',
        otpExpiraEn: new Date(Date.now() + 60_000),
      });
      const r = await service.verificarOtp('u1', '123456');
      expect(r.ok).toBe(true);
      const data = prisma.repartidorSyncronize.update.mock.calls[0][0].data;
      expect(data.celularVerificado).toBe(true);
      expect(data.otpCodigo).toBeNull();
    });

    it('código vencido → BadRequest', async () => {
      prisma.repartidorSyncronize.findUnique.mockResolvedValue({
        id: 'r1',
        celularVerificado: false,
        otpCodigo: '123456',
        otpExpiraEn: new Date(Date.now() - 1000),
      });
      await expect(service.verificarOtp('u1', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('aprobación (solo super admin)', () => {
    it('usuario sin rol super admin → Forbidden', async () => {
      await expect(service.aprobar('user-comun', 'r1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('super admin por rolGlobal aprueba → APROBADO con auditoría', async () => {
      prisma.usuario.findUnique.mockResolvedValue({
        rolGlobal: Rol.SUPER_ADMIN,
      });
      await service.aprobar('admin1', 'r1');
      const data = prisma.repartidorSyncronize.update.mock.calls[0][0].data;
      expect(data.estado).toBe(EstadoRepartidorSyncronize.APROBADO);
      expect(data.aprobadoPor).toBe('admin1');
    });
  });
});
