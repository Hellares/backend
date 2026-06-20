import { NotFoundException } from '@nestjs/common';
import { ClienteEmpresaService } from './cliente-empresa.service';

/**
 * Tests de vincularDesdeProveedor: registrar/vincular un proveedor como cliente
 * (mismo tercero). Idempotente: ya-vinculado / vincular-existente / crear.
 */
describe('ClienteEmpresaService.vincularDesdeProveedor', () => {
  const EMP = 'emp-1';
  const PROV = 'prov-1';
  const USER = 'user-1';
  let prisma: any;
  let codigos: any;
  let realtime: any;
  let service: ClienteEmpresaService;

  const proveedor = {
    id: PROV,
    empresaId: EMP,
    nombre: 'ARCA SA',
    nombreComercial: 'ARCA',
    tipoDocumento: 'RUC',
    numeroDocumento: '20101024645',
    email: 'a@a.com',
    direccion: 'Av X',
    pais: 'PE',
  };

  beforeEach(() => {
    prisma = {
      proveedor: { findFirst: jest.fn().mockResolvedValue(proveedor) },
      clienteEmpresa: {
        findFirst: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ce-1', ...data })),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'ce-new', ...data })),
      },
    };
    codigos = { generarCodigoClienteEmpresa: jest.fn().mockResolvedValue({ codigoClienteEmpresa: 'CE-009' }) };
    realtime = { notifyClienteEmpresaCambiado: jest.fn() };
    service = new ClienteEmpresaService(prisma, codigos, {} as any, realtime);
  });

  it('proveedor inexistente → NotFound', async () => {
    prisma.proveedor.findFirst.mockResolvedValue(null);
    await expect(service.vincularDesdeProveedor(EMP, PROV, USER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ya vinculado → devuelve YA_VINCULADO sin crear', async () => {
    prisma.clienteEmpresa.findFirst.mockResolvedValueOnce({ id: 'ce-1', proveedorId: PROV });
    const r = await service.vincularDesdeProveedor(EMP, PROV, USER);
    expect(r.accion).toBe('YA_VINCULADO');
    expect(prisma.clienteEmpresa.create).not.toHaveBeenCalled();
    expect(prisma.clienteEmpresa.update).not.toHaveBeenCalled();
  });

  it('existe cliente con el mismo RUC → lo vincula (no duplica)', async () => {
    prisma.clienteEmpresa.findFirst
      .mockResolvedValueOnce(null) // no vinculado aún
      .mockResolvedValueOnce({ id: 'ce-1', numeroDocumento: proveedor.numeroDocumento }); // mismo RUC
    const r = await service.vincularDesdeProveedor(EMP, PROV, USER);
    expect(r.accion).toBe('VINCULADO_EXISTENTE');
    expect(prisma.clienteEmpresa.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ce-1' }, data: expect.objectContaining({ proveedorId: PROV }) }),
    );
    expect(prisma.clienteEmpresa.create).not.toHaveBeenCalled();
  });

  it('no existe → crea cliente copiando datos del proveedor + vínculo', async () => {
    prisma.clienteEmpresa.findFirst.mockResolvedValue(null);
    const r = await service.vincularDesdeProveedor(EMP, PROV, USER);
    expect(r.accion).toBe('CREADO');
    expect(prisma.clienteEmpresa.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          razonSocial: 'ARCA SA',
          numeroDocumento: '20101024645',
          proveedorId: PROV,
          codigo: 'CE-009',
          creadoPor: USER,
        }),
      }),
    );
  });
});
