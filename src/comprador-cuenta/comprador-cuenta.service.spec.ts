import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { CompradorCuentaService } from './comprador-cuenta.service';

/** Redis en memoria: lo justo que usa el servicio. */
function redisFake() {
  const m = new Map<string, string>();
  return {
    m,
    get: jest.fn(async (k: string) => m.get(k) ?? null),
    setex: jest.fn(async (k: string, _t: number, v: string) => { m.set(k, v); return true; }),
    del: jest.fn(async (k: string) => (m.delete(k) ? 1 : 0)),
    exists: jest.fn(async (k: string) => m.has(k)),
    ttl: jest.fn(async () => 300),
  };
}

const hash = (dni: string, codigo: string) => createHash('sha256').update(`${dni}:${codigo}`).digest('hex');

function armar(persona: any = null) {
  const prisma: any = {
    persona: { findUnique: jest.fn(async () => persona), create: jest.fn(async ({ data }) => ({ id: 'p-new', ...data })), update: jest.fn() },
    usuario: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }) => ({ id: 'u-new', ...data })),
      update: jest.fn(),
    },
    authProvider: { findFirst: jest.fn(async () => ({ id: 'ap', isActive: true })), create: jest.fn(), update: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const redis = redisFake();
  const evolution: any = { disponible: true, sendText: jest.fn(async () => ({})) };
  const consultas: any = {
    consultarDni: jest.fn(async () => ({ nombres: 'ANA', apellidoPaterno: 'PEREZ', apellidoMaterno: 'LOPEZ' })),
  };
  const auth: any = { emitirSesionComprador: jest.fn(async (id: string) => ({ user: { id }, accessToken: 't' })) };
  const service = new CompradorCuentaService(prisma, redis as any, evolution, consultas, auth);
  return { service, prisma, redis, evolution, consultas, auth };
}

describe('CompradorCuentaService', () => {
  const OLD = process.env.SYNCRONIZE_WA_INSTANCE;
  beforeAll(() => { process.env.SYNCRONIZE_WA_INSTANCE = 'plataforma'; });
  afterAll(() => { process.env.SYNCRONIZE_WA_INSTANCE = OLD; });

  describe('estado', () => {
    it('DNI desconocido → NUEVO con el nombre de RENIEC', async () => {
      const { service } = armar(null);
      await expect(service.estado('12345678')).resolves.toEqual({
        estado: 'NUEVO', nombres: 'ANA', apellidos: 'PEREZ LOPEZ',
      });
    });

    it('cuenta en uso → ACTIVA', async () => {
      const { service } = armar({ id: 'p', nombres: 'ANA', usuario: { requiereCambioPassword: false, isActive: true, deletedAt: null } });
      await expect(service.estado('12345678')).resolves.toMatchObject({ estado: 'ACTIVA' });
    });

    it('cuenta creada por una tienda → POR_ACTIVAR con el celular enmascarado', async () => {
      const { service } = armar({ id: 'p', nombres: 'ANA', telefono: null, usuario: { requiereCambioPassword: true, telefono: '987654321' } });
      await expect(service.estado('12345678')).resolves.toEqual({
        estado: 'POR_ACTIVAR', nombres: 'ANA', celularEnmascarado: '9•• ••• 321',
      });
    });

    it('persona sin cuenta ni celular → SIN_CONTACTO', async () => {
      const { service } = armar({ id: 'p', nombres: 'ANA', telefono: '044123456', usuario: null });
      await expect(service.estado('12345678')).resolves.toMatchObject({ estado: 'SIN_CONTACTO' });
    });
  });

  describe('enviarCodigo', () => {
    it('cuenta existente: va al celular REGISTRADO aunque el cliente escriba otro', async () => {
      const { service, evolution } = armar({ id: 'p', telefono: '987654321', usuario: null });
      await service.enviarCodigo('12345678', '911111111');
      expect(evolution.sendText).toHaveBeenCalledWith(expect.objectContaining({ number: '51987654321' }));
    });

    it('DNI nuevo con un celular que ya es de otra cuenta → 409', async () => {
      const { service, prisma } = armar(null);
      prisma.usuario.findUnique.mockResolvedValueOnce({ id: 'otro' });
      await expect(service.enviarCodigo('12345678', '987654321')).rejects.toBeInstanceOf(ConflictException);
    });

    it('sin celular registrado → no manda nada', async () => {
      const { service, evolution } = armar({ id: 'p', telefono: null, usuario: null });
      await expect(service.enviarCodigo('12345678')).rejects.toBeInstanceOf(BadRequestException);
      expect(evolution.sendText).not.toHaveBeenCalled();
    });

    it('no deja pedir otro código antes del minuto', async () => {
      const { service } = armar({ id: 'p', telefono: '987654321', usuario: null });
      await service.enviarCodigo('12345678');
      await expect(service.enviarCodigo('12345678')).rejects.toThrow('Espera un minuto');
    });

    it('si WhatsApp falla, borra el código y avisa', async () => {
      const { service, evolution, redis } = armar({ id: 'p', telefono: '987654321', usuario: null });
      evolution.sendText.mockRejectedValueOnce(new Error('instancia cerrada'));
      await expect(service.enviarCodigo('12345678')).rejects.toThrow('No pudimos enviar');
      expect(redis.m.has('comprador:otp:12345678')).toBe(false);
    });
  });

  describe('confirmar', () => {
    const base = { dni: '12345678', codigo: '123456', password: 'Secreta123!' };

    function conOtp(ctx: ReturnType<typeof armar>, extra: object = {}) {
      ctx.redis.m.set('comprador:otp:12345678', JSON.stringify({ hash: hash('12345678', '123456'), celular: '987654321', intentos: 0, ...extra }));
    }

    it('código incorrecto → error y suma el intento', async () => {
      const ctx = armar(null);
      conOtp(ctx);
      await expect(ctx.service.confirmar({ ...base, codigo: '000000' })).rejects.toThrow('Código incorrecto');
      expect(JSON.parse(ctx.redis.m.get('comprador:otp:12345678')!).intentos).toBe(1);
    });

    it('al 5º intento fallido el código se invalida', async () => {
      const ctx = armar(null);
      conOtp(ctx, { intentos: 5 });
      await expect(ctx.service.confirmar(base)).rejects.toThrow('Demasiados intentos');
      expect(ctx.redis.m.has('comprador:otp:12345678')).toBe(false);
    });

    it('DNI nuevo: crea persona con el nombre de RENIEC (no el que manda el cliente) y abre sesión', async () => {
      const ctx = armar(null);
      conOtp(ctx, { nombres: 'ANA', apellidos: 'PEREZ LOPEZ' });
      await ctx.service.confirmar({ ...base, nombres: 'OTRO', apellidos: 'NOMBRE' });
      expect(ctx.prisma.persona.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ dni: '12345678', nombres: 'ANA', apellidos: 'PEREZ LOPEZ', telefono: '987654321' }),
      });
      expect(ctx.prisma.usuario.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ telefonoVerificado: true, metodoPrincipalLogin: 'DNI', requiereCambioPassword: false }),
      });
      expect(ctx.auth.emitirSesionComprador).toHaveBeenCalledWith('u-new', undefined);
      expect(ctx.redis.m.has('comprador:otp:12345678')).toBe(false);
    });

    it('persona cargada por una tienda sin cuenta: crea el usuario SOBRE esa persona, sin duplicarla', async () => {
      const ctx = armar({ id: 'p-vieja', dni: '12345678', email: null, telefono: '987654321', usuario: null });
      conOtp(ctx);
      await ctx.service.confirmar(base);
      expect(ctx.prisma.persona.create).not.toHaveBeenCalled();
      expect(ctx.prisma.usuario.create).toHaveBeenCalledWith({ data: expect.objectContaining({ personaId: 'p-vieja' }) });
    });

    it('cuenta creada por una tienda: cambia la contraseña, quita el "cambiar contraseña" y pasa a login por DNI', async () => {
      const ctx = armar({
        id: 'p', dni: '12345678',
        usuario: { id: 'u-vieja', email: 'a@b.com', emailVerificado: false, metodoPrincipalLogin: 'EMAIL', requiereCambioPassword: true },
      });
      conOtp(ctx);
      await ctx.service.confirmar(base);
      const data = ctx.prisma.usuario.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ requiereCambioPassword: false, telefonoVerificado: true, metodoPrincipalLogin: 'DNI' });
      expect(data.passwordHash).toBeDefined();
      expect(ctx.auth.emitirSesionComprador).toHaveBeenCalledWith('u-vieja', undefined);
    });

    it('sin código pedido antes → error', async () => {
      const ctx = armar(null);
      await expect(ctx.service.confirmar(base)).rejects.toThrow('venció');
    });
  });
});
