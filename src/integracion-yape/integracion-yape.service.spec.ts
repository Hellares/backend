import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { IntegracionYapeService } from './integracion-yape.service';

/**
 * Tests de `verificarWebhook` — la barrera de seguridad del webhook de api-yape.
 * Es lo que impide que cualquiera marque ventas como pagadas: solo pasa si la
 * firma HMAC-SHA256 del body crudo coincide con el webhookSecret de la cuenta.
 *
 * Sin DB: mockeamos `prisma.integracionYape.findUnique`.
 */
describe('IntegracionYapeService.verificarWebhook', () => {
  const SECRET = 'whsec_test_123';
  const cfg = {
    empresaId: 'emp-1',
    accountId: 'acc-1',
    webhookSecret: SECRET,
    habilitado: true,
  };

  let prisma: any;
  let service: IntegracionYapeService;

  const firmar = (raw: Buffer, secret = SECRET) =>
    createHmac('sha256', secret).update(raw).digest('hex');

  const body = (obj: any) => Buffer.from(JSON.stringify(obj), 'utf8');

  beforeEach(() => {
    prisma = { integracionYape: { findUnique: jest.fn() } };
    service = new IntegracionYapeService(prisma);
  });

  it('acepta una firma válida (con prefijo sha256=) y devuelve empresa + payload', async () => {
    prisma.integracionYape.findUnique.mockResolvedValue(cfg);
    const raw = body({ account: { id: 'acc-1' }, event: 'payment.confirmed' });
    const res = await service.verificarWebhook(raw, `sha256=${firmar(raw)}`);

    expect(res).toEqual({
      empresaId: 'emp-1',
      payload: { account: { id: 'acc-1' }, event: 'payment.confirmed' },
    });
    expect(prisma.integracionYape.findUnique).toHaveBeenCalledWith({
      where: { accountId: 'acc-1' },
    });
  });

  it('acepta una firma válida SIN el prefijo sha256=', async () => {
    prisma.integracionYape.findUnique.mockResolvedValue(cfg);
    const raw = body({ account: { id: 'acc-1' }, event: 'payment.confirmed' });
    const res = await service.verificarWebhook(raw, firmar(raw));
    expect(res).not.toBeNull();
    expect(res!.empresaId).toBe('emp-1');
  });

  it('rechaza una firma inválida con UnauthorizedException', async () => {
    prisma.integracionYape.findUnique.mockResolvedValue(cfg);
    const raw = body({ account: { id: 'acc-1' }, event: 'payment.confirmed' });
    await expect(
      service.verificarWebhook(raw, `sha256=${firmar(raw, 'otro-secret')}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza si el body fue alterado tras firmar (la firma ya no cuadra)', async () => {
    prisma.integracionYape.findUnique.mockResolvedValue(cfg);
    const original = body({ account: { id: 'acc-1' }, monto: 1 });
    const firma = `sha256=${firmar(original)}`;
    const alterado = body({ account: { id: 'acc-1' }, monto: 9999 });
    await expect(
      service.verificarWebhook(alterado, firma),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('devuelve null si la cuenta no está mapeada (findUnique → null)', async () => {
    prisma.integracionYape.findUnique.mockResolvedValue(null);
    const raw = body({ account: { id: 'desconocida' }, event: 'payment.confirmed' });
    const res = await service.verificarWebhook(raw, `sha256=${firmar(raw)}`);
    expect(res).toBeNull();
  });

  it('devuelve null si el payload no trae account.id (sin consultar DB)', async () => {
    const raw = body({ event: 'payment.confirmed' });
    const res = await service.verificarWebhook(raw, 'sha256=loquesea');
    expect(res).toBeNull();
    expect(prisma.integracionYape.findUnique).not.toHaveBeenCalled();
  });

  it('lanza UnauthorizedException si el body no es JSON válido', async () => {
    await expect(
      service.verificarWebhook(Buffer.from('no-es-json', 'utf8'), 'x'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
