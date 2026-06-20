import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MetodoPagoVenta } from '@prisma/client';

/** Métodos digitales que se recaudan en una cuenta bancaria (EFECTIVO va a la bóveda). */
export const METODOS_RECAUDABLES: MetodoPagoVenta[] = [
  MetodoPagoVenta.YAPE,
  MetodoPagoVenta.PLIN,
  MetodoPagoVenta.TARJETA,
  MetodoPagoVenta.TRANSFERENCIA,
];

@Injectable()
export class CuentasRecaudacionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mapeo método→cuenta de recaudación de la empresa. Devuelve una fila por
   * cada método digital recaudable; `banco` es null si aún no se configuró.
   */
  async listar(empresaId: string) {
    const mapeos = await this.prisma.cuentaRecaudacion.findMany({
      where: { empresaId },
      include: {
        banco: {
          select: { id: true, nombreBanco: true, numeroCuenta: true, moneda: true, isActive: true },
        },
      },
    });
    const porMetodo = new Map(mapeos.map((m) => [m.metodoPago, m]));

    return METODOS_RECAUDABLES.map((metodoPago) => {
      const m = porMetodo.get(metodoPago);
      return {
        metodoPago,
        bancoId: m?.bancoId ?? null,
        banco: m?.banco ?? null,
      };
    });
  }

  private assertMetodoRecaudable(metodoPago: string): MetodoPagoVenta {
    if (!METODOS_RECAUDABLES.includes(metodoPago as MetodoPagoVenta)) {
      throw new BadRequestException(
        `Método ${metodoPago} no se recauda en banco (solo ${METODOS_RECAUDABLES.join(', ')})`,
      );
    }
    return metodoPago as MetodoPagoVenta;
  }

  /** Asigna (upsert) la cuenta bancaria donde se recauda un método. */
  async set(empresaId: string, metodoPagoRaw: string, bancoId: string) {
    const metodoPago = this.assertMetodoRecaudable(metodoPagoRaw);

    const banco = await this.prisma.empresaBanco.findFirst({
      where: { id: bancoId, empresaId, isActive: true },
      select: { id: true },
    });
    if (!banco) throw new BadRequestException('Cuenta bancaria no encontrada o inactiva');

    return this.prisma.cuentaRecaudacion.upsert({
      where: { empresaId_metodoPago: { empresaId, metodoPago } },
      create: { empresaId, metodoPago, bancoId },
      update: { bancoId },
    });
  }

  /** Quita el mapeo de un método (vuelve a "sin configurar"). */
  async remove(empresaId: string, metodoPagoRaw: string) {
    const metodoPago = this.assertMetodoRecaudable(metodoPagoRaw);
    const existente = await this.prisma.cuentaRecaudacion.findUnique({
      where: { empresaId_metodoPago: { empresaId, metodoPago } },
      select: { id: true },
    });
    if (!existente) throw new NotFoundException('No hay cuenta configurada para ese método');
    await this.prisma.cuentaRecaudacion.delete({ where: { id: existente.id } });
    return { ok: true };
  }
}
