import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { EstadoPrestamo, MetodoPagoVenta } from '@prisma/client';

@Injectable()
export class PrestamoService {
  private readonly logger = new Logger(PrestamoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cajaService: CajaService,
  ) {}

  async listar(empresaId: string, estado?: EstadoPrestamo) {
    return this.prisma.prestamo.findMany({
      where: { empresaId, ...(estado && { estado }) },
      include: { pagos: { orderBy: { fechaPago: 'desc' } } },
      orderBy: { creadoEn: 'desc' },
    });
  }

  async crear(empresaId: string, data: any) {
    return this.prisma.prestamo.create({
      data: {
        empresaId,
        tipo: data.tipo,
        entidadPrestamo: data.entidadPrestamo,
        descripcion: data.descripcion,
        montoOriginal: data.montoOriginal,
        saldoPendiente: data.montoOriginal,
        tasaInteres: data.tasaInteres,
        moneda: data.moneda ?? 'PEN',
        cantidadCuotas: data.cantidadCuotas,
        montoCuota: data.montoCuota,
        fechaDesembolso: new Date(data.fechaDesembolso),
        fechaVencimiento: data.fechaVencimiento ? new Date(data.fechaVencimiento) : null,
        observaciones: data.observaciones,
      },
    });
  }

  async registrarPago(empresaId: string, prestamoId: string, usuarioId: string, data: {
    metodoPago: MetodoPagoVenta; monto: number; referencia?: string;
  }) {
    const prestamo = await this.prisma.prestamo.findFirst({
      where: { id: prestamoId, empresaId, estado: { not: EstadoPrestamo.CANCELADO } },
    });
    if (!prestamo) throw new NotFoundException('Préstamo no encontrado');

    if (data.monto > Number(prestamo.saldoPendiente)) {
      throw new BadRequestException(`Monto excede saldo pendiente (${prestamo.saldoPendiente})`);
    }

    const nuevoSaldo = Number(prestamo.saldoPendiente) - data.monto;
    const nuevoPagado = Number(prestamo.totalPagado) + data.monto;

    await this.prisma.$transaction(async (tx) => {
      await tx.pagoPrestamo.create({
        data: { prestamoId, metodoPago: data.metodoPago, monto: data.monto, referencia: data.referencia },
      });

      await tx.prestamo.update({
        where: { id: prestamoId },
        data: {
          totalPagado: nuevoPagado,
          saldoPendiente: nuevoSaldo,
          estado: nuevoSaldo <= 0 ? EstadoPrestamo.PAGADO : prestamo.estado,
        },
      });
    });

    // Registrar egreso en caja
    try {
      const sede = await this.prisma.sede.findFirst({ where: { empresaId, isActive: true } });
      if (sede) {
        await this.cajaService.registrarMovimientoSiHayCaja(empresaId, sede.id, usuarioId, {
          tipo: 'EGRESO', categoria: 'PAGO_PROVEEDOR', metodoPago: data.metodoPago,
          monto: data.monto, descripcion: `Pago préstamo - ${prestamo.entidadPrestamo}`,
        });
      }
    } catch (e) {
      this.logger.warn(`Error registrando egreso caja para préstamo ${prestamo.entidadPrestamo}: ${e?.message ?? e}`);
    }

    return { message: 'Pago registrado', saldoPendiente: nuevoSaldo };
  }

  async getResumen(empresaId: string) {
    const prestamos = await this.prisma.prestamo.findMany({
      where: { empresaId, estado: { in: [EstadoPrestamo.ACTIVO, EstadoPrestamo.VENCIDO] } },
    });

    const totalDeuda = prestamos.reduce((s, p) => s + Number(p.saldoPendiente), 0);
    const totalOriginal = prestamos.reduce((s, p) => s + Number(p.montoOriginal), 0);
    const totalPagado = prestamos.reduce((s, p) => s + Number(p.totalPagado), 0);

    return {
      cantidadActivos: prestamos.length,
      totalDeuda: Math.round(totalDeuda * 100) / 100,
      totalOriginal: Math.round(totalOriginal * 100) / 100,
      totalPagado: Math.round(totalPagado * 100) / 100,
      porcentajePagado: totalOriginal > 0 ? Math.round((totalPagado / totalOriginal) * 100) : 0,
    };
  }
}
