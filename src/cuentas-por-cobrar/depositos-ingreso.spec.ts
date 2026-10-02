import { depositosEnBanco, sinAbonosDeDeposito } from './depositos-ingreso.util';

/**
 * En tesorería el ingreso es el DEPÓSITO entero, no los abonos en que se
 * repartió: si no, S/ 450 que entraron al banco se veían como S/ 150 + S/ 51.
 */
describe('Depósitos del cliente en los listados de tesorería', () => {
  it('saca de los abonos los que salieron de un depósito', async () => {
    const prisma: any = {
      aplicacionDeposito: { findMany: jest.fn().mockResolvedValue([{ pagoVentaId: 'p2' }]) },
    };
    const res = await sinAbonosDeDeposito(prisma, [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }]);
    expect(res.map((p) => p.id)).toEqual(['p1', 'p3']);
  });

  it('el depósito sale entero, con lo que queda a favor del cliente', async () => {
    const prisma: any = {
      depositoCliente: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'd1', bancoId: 'b1', monto: 300, montoAplicado: 51, metodoPago: 'TRANSFERENCIA', creadoEn: new Date(), clienteId: 'ep1', clienteEmpresaId: null },
        ]),
      },
      empresaPersona: { findMany: jest.fn().mockResolvedValue([{ id: 'ep1', persona: { nombres: 'Ashly', apellidos: 'Ruiz' } }]) },
    };
    const [d] = await depositosEnBanco(prisma, { empresaId: 'e1', bancoId: 'b1' });
    expect(d).toMatchObject({ monto: 300, aFavor: 249, cliente: 'Ashly Ruiz', bancoId: 'b1' });
    expect(prisma.depositoCliente.findMany.mock.calls[0][0].where).toMatchObject({ anulado: false, fuente: 'BANCO', bancoId: 'b1' });
  });
});
