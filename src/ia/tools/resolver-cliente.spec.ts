/**
 * resolverCliente — el punto donde el cliente NUEVO se REGISTRA (getOrCreateByDni,
 * mismo camino que el bot de sorteos). Motivación: la venta 721 (07-20) se perdió
 * porque la clienta nueva no existía como Persona → el snapshot del nombre lo
 * tipeó el LLM → el pago Yape no matcheó contra el nombre oficial.
 */
import { crearResolverClienteTool } from './resolver-cliente.tool';
import { ContextoTool } from './tool.types';

describe('resolverCliente', () => {
  const ctx: ContextoTool = {
    empresaId: 'emp-1',
    sedeId: 'sede-1',
    celular: '51922039941',
  };

  let prisma: any;
  let consultas: any;
  let clientes: any;

  beforeEach(() => {
    prisma = {
      persona: { findUnique: jest.fn().mockResolvedValue(null) },
      // envioPrevio: sin dirección previa en estos casos.
      ventaEnvio: { findFirst: jest.fn().mockResolvedValue(null) },
      sorteoParticipante: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    consultas = {
      consultarDni: jest.fn().mockResolvedValue({
        nombres: 'GEYDY',
        apellidoPaterno: 'SILVANA',
        apellidoMaterno: 'RAMOS',
      }),
      consultarCee: jest.fn(),
    };
    clientes = {
      getOrCreateByDni: jest.fn().mockResolvedValue({
        clienteEmpresaId: 'ep-9',
        personaId: 'per-9',
        nombreCompleto: 'GEYDY SILVANA RAMOS VEGA',
        origen: 'RENIEC',
      }),
    };
  });

  it('cliente YA registrado → lo devuelve de la base sin registrar de nuevo', async () => {
    prisma.persona.findUnique.mockResolvedValue({
      id: 'per-1',
      nombres: 'JAMES JOHEL',
      apellidos: 'TORRES LEDEZMA',
      empresasAsociadas: [{ id: 'ep-1' }],
    });
    const tool = crearResolverClienteTool(prisma, consultas, clientes);

    const r = await tool.ejecutar({ documento: '44885296' }, ctx);

    expect(r).toMatchObject({
      ok: true,
      registrado: true,
      clienteId: 'ep-1',
      nombreCompleto: 'JAMES JOHEL TORRES LEDEZMA',
    });
    expect(clientes.getOrCreateByDni).not.toHaveBeenCalled();
  });

  it('cliente NUEVO → lo REGISTRA (getOrCreateByDni) y devuelve el nombre oficial', async () => {
    const tool = crearResolverClienteTool(prisma, consultas, clientes);

    const r = await tool.ejecutar({ documento: '44510151' }, ctx);

    expect(clientes.getOrCreateByDni).toHaveBeenCalledWith('emp-1', '44510151');
    expect(r).toMatchObject({
      ok: true,
      registrado: true,
      registradoAhora: true,
      clienteId: 'ep-9',
      personaId: 'per-9',
      nombreCompleto: 'GEYDY SILVANA RAMOS VEGA',
      fuente: 'RENIEC',
    });
    // Ya no cae al camino de solo-consulta.
    expect(consultas.consultarDni).not.toHaveBeenCalled();
  });

  it('Factiliza no lo encuentra (getOrCreateByDni tira) → NO_ENCONTRADO', async () => {
    clientes.getOrCreateByDni.mockRejectedValue(new Error('DNI no encontrado'));
    const tool = crearResolverClienteTool(prisma, consultas, clientes);

    const r = await tool.ejecutar({ documento: '99999999' }, ctx);

    expect(r).toMatchObject({ ok: false, motivo: 'NO_ENCONTRADO' });
  });

  it('sin ClientesService (spike standalone) → solo consulta, registrado=false', async () => {
    const tool = crearResolverClienteTool(prisma, consultas);

    const r = await tool.ejecutar({ documento: '44510151' }, ctx);

    expect(r).toMatchObject({
      ok: true,
      registrado: false,
      nombreCompleto: 'GEYDY SILVANA RAMOS',
      fuente: 'RENIEC',
    });
  });

  it('documento genérico 00000000 → DOCUMENTO_INVALIDO (no llega a registrar)', async () => {
    const tool = crearResolverClienteTool(prisma, consultas, clientes);

    const r = await tool.ejecutar({ documento: '00000000' }, ctx);

    expect(r).toMatchObject({ ok: false, motivo: 'DOCUMENTO_INVALIDO' });
    expect(clientes.getOrCreateByDni).not.toHaveBeenCalled();
  });

  it('CE de 9 dígitos también se registra por getOrCreateByDni', async () => {
    clientes.getOrCreateByDni.mockResolvedValue({
      clienteEmpresaId: 'ep-2',
      personaId: 'per-2',
      nombreCompleto: 'LOANA MAITE FALCO SILVERA',
      origen: 'MIGRACIONES',
    });
    const tool = crearResolverClienteTool(prisma, consultas, clientes);

    const r = await tool.ejecutar({ documento: '001234567' }, ctx);

    expect(clientes.getOrCreateByDni).toHaveBeenCalledWith('emp-1', '001234567');
    expect(r).toMatchObject({ ok: true, registradoAhora: true, tipoDoc: 'CE' });
  });
});
