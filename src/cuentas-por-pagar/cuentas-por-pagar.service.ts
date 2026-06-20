import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { Prisma, MetodoPagoVenta } from '@prisma/client';

@Injectable()
export class CuentasPorPagarService {
  private readonly logger = new Logger(CuentasPorPagarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cajaService: CajaService,
  ) {}

  /**
   * Listar cuentas por pagar (compras a crédito con saldo pendiente)
   */
  async listar(
    empresaId: string,
    filtros?: {
      estado?: 'PENDIENTE' | 'VENCIDA' | 'PAGADA';
      proveedorId?: string;
      search?: string;
    },
  ) {
    const where: Prisma.CompraWhereInput = {
      empresaId,
      estado: 'CONFIRMADA',
      terminosPago: { not: 'CONTADO' },
    };

    if (filtros?.proveedorId) where.proveedorId = filtros.proveedorId;
    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreProveedor: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const compras = await this.prisma.compra.findMany({
      where,
      include: {
        pagos: true,
        proveedor: {
          include: {
            bancos: { where: { esPrincipal: true }, take: 1 },
          },
        },
        sede: true,
      },
      orderBy: { fechaVencimientoPago: 'asc' },
    });

    const now = new Date();

    const cuentas = compras.map((c) => {
      const totalCompra = Number(c.total);
      const totalPagado = c.pagos.reduce((sum, p) => sum + Number(p.monto), 0);
      const saldoPendiente = Math.round((totalCompra - totalPagado) * 100) / 100;
      const estaVencida = c.fechaVencimientoPago ? c.fechaVencimientoPago < now : false;
      const estaPagada = saldoPendiente <= 0;
      const diasVencimiento = c.fechaVencimientoPago
        ? Math.ceil((c.fechaVencimientoPago.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      const bancoPrincipal = c.proveedor?.bancos?.[0] ?? null;

      return {
        compraId: c.id,
        codigo: c.codigo,
        nombreProveedor: c.nombreProveedor,
        documentoProveedor: c.documentoProveedor,
        proveedorTelefono: c.proveedor?.telefono,
        proveedorEmail: c.proveedor?.email,
        sedeNombre: c.sede?.nombre,
        moneda: c.moneda,
        totalCompra,
        totalPagado: Math.round(totalPagado * 100) / 100,
        saldoPendiente,
        terminosPago: c.terminosPago,
        diasCredito: c.diasCredito,
        fechaCompra: c.fechaRecepcion,
        fechaVencimiento: c.fechaVencimientoPago,
        diasVencimiento,
        estado: estaPagada ? 'PAGADA' : estaVencida ? 'VENCIDA' : 'PENDIENTE',
        bancoPrincipal: bancoPrincipal ? {
          nombreBanco: bancoPrincipal.nombreBanco,
          tipoCuenta: bancoPrincipal.tipoCuenta,
          numeroCuenta: bancoPrincipal.numeroCuenta,
          cci: bancoPrincipal.cci,
        } : null,
        pagos: c.pagos,
        tipoDocumentoProveedor: c.tipoDocumentoProveedor,
        serieDocumentoProveedor: c.serieDocumentoProveedor,
        numeroDocumentoProveedor: c.numeroDocumentoProveedor,
      };
    });

    if (filtros?.estado) {
      return cuentas.filter((c) => c.estado === filtros.estado);
    }

    return cuentas;
  }

  /**
   * Resumen de cuentas por pagar
   */
  async getResumen(empresaId: string) {
    const cuentas = await this.listar(empresaId);

    const pendientes = cuentas.filter((c) => c.estado === 'PENDIENTE');
    const vencidas = cuentas.filter((c) => c.estado === 'VENCIDA');

    return {
      totalPendiente: Math.round(pendientes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100,
      totalVencido: Math.round(vencidas.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100,
      cantidadPendientes: pendientes.length,
      cantidadVencidas: vencidas.length,
      totalCuentas: cuentas.length,
      topAcreedores: this._topAcreedores(cuentas),
      proximasVencer: cuentas
        .filter((c) => c.estado === 'PENDIENTE' && c.diasVencimiento !== null && c.diasVencimiento <= 7 && c.diasVencimiento >= 0)
        .slice(0, 5),
    };
  }

  /**
   * Registrar pago a proveedor
   */
  async registrarPago(
    empresaId: string,
    compraId: string,
    usuarioId: string,
    data: {
      metodoPago: MetodoPagoVenta;
      monto: number;
      referencia?: string;
      bancoDestino?: string;
      cuentaDestino?: string;
    },
  ) {
    // Transacción + recálculo del saldo bajo lock para evitar sobre-pago por
    // carrera (dos pagos concurrentes que pasen ambos la validación).
    const pago = await this.prisma.$transaction(async (tx) => {
      // Lock pesimista sobre la fila de la compra (FOR UPDATE).
      const filas = await tx.$queryRaw<
        { id: string; total: Prisma.Decimal; estado: string; terminosPago: string | null }[]
      >`SELECT "id", "total", "estado", "terminosPago" FROM "Compra" WHERE "id" = ${compraId} AND "empresaId" = ${empresaId} FOR UPDATE`;

      const compra = filas[0];
      if (!compra) throw new NotFoundException('Compra no encontrada');

      if (compra.estado !== 'CONFIRMADA') {
        throw new BadRequestException(
          'Solo se pueden registrar pagos sobre compras confirmadas',
        );
      }
      if (!compra.terminosPago || compra.terminosPago === 'CONTADO') {
        throw new BadRequestException(
          'Esta compra no es a crédito (no genera cuenta por pagar)',
        );
      }

      const pagosPrevios = await tx.pagoCompra.findMany({
        where: { compraId },
        select: { monto: true },
      });
      const totalPagado = pagosPrevios.reduce((s, p) => s + Number(p.monto), 0);
      const saldoPendiente = Number(compra.total) - totalPagado;

      if (data.monto > saldoPendiente + 0.001) {
        throw new BadRequestException(
          `El monto (${data.monto}) excede el saldo pendiente (${saldoPendiente.toFixed(2)})`,
        );
      }

      return tx.pagoCompra.create({
        data: {
          compraId,
          metodoPago: data.metodoPago,
          monto: data.monto,
          referencia: data.referencia,
          bancoDestino: data.bancoDestino,
          cuentaDestino: data.cuentaDestino,
        },
      });
    });

    // Recuperamos datos de la compra para el movimiento de caja (fuera del lock).
    const compra = await this.prisma.compra.findFirst({
      where: { id: compraId, empresaId },
      select: { sedeId: true, nombreProveedor: true, codigo: true },
    });

    // Registrar egreso en caja
    if (compra) {
      try {
        await this.cajaService.registrarMovimientoSiHayCaja(
          empresaId,
          compra.sedeId,
          usuarioId,
          {
            tipo: 'EGRESO',
            categoria: 'PAGO_PROVEEDOR',
            metodoPago: data.metodoPago,
            monto: data.monto,
            descripcion: `Pago proveedor - ${compra.nombreProveedor} (${compra.codigo})`,
            compraId,
          },
        );
      } catch (e) {
        this.logger.warn(`Error registrando egreso caja para pago proveedor ${compra.codigo}: ${e?.message ?? e}`);
      }
    }

    return pago;
  }

  private _topAcreedores(cuentas: any[]) {
    const deudaPorProveedor = new Map<string, { nombre: string; total: number; cantidad: number }>();

    for (const c of cuentas) {
      if (c.estado === 'PAGADA') continue;
      const key = c.nombreProveedor;
      if (!deudaPorProveedor.has(key)) {
        deudaPorProveedor.set(key, { nombre: key, total: 0, cantidad: 0 });
      }
      const d = deudaPorProveedor.get(key)!;
      d.total += c.saldoPendiente;
      d.cantidad++;
    }

    return Array.from(deudaPorProveedor.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((d) => ({ ...d, total: Math.round(d.total * 100) / 100 }));
  }
}
