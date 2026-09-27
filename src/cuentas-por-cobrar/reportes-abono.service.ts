import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EstadoReporteAbono, FuenteIngreso, MetodoPagoVenta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';

/**
 * Pagos que los clientes reportan desde "Mis compras" de la tienda web.
 *
 * Aprobar = registrar el abono con el MISMO camino que el panel
 * (`registrarAbono`: cuotas, ingreso a banco/caja, estado de la venta) y
 * enlazarlo al reporte. Rechazar no toca plata.
 */
@Injectable()
export class ReportesAbonoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cxc: CuentasPorCobrarService,
  ) {}

  async listar(empresaId: string, estado: EstadoReporteAbono = 'PENDIENTE') {
    const filas = await this.prisma.reporteAbono.findMany({
      where: { empresaId, estado },
      orderBy: { creadoEn: estado === 'PENDIENTE' ? 'asc' : 'desc' },
      take: 100,
      include: { venta: { select: { codigo: true, nombreCliente: true, documentoCliente: true } } },
    });
    const bancoIds = [...new Set(filas.map((f) => f.empresaBancoId).filter((x): x is string => !!x))];
    const bancos = bancoIds.length
      ? await this.prisma.empresaBanco.findMany({
          where: { id: { in: bancoIds }, empresaId },
          select: { id: true, nombreBanco: true, numeroCuenta: true },
        })
      : [];
    const banco = new Map(bancos.map((b) => [b.id, b]));
    return filas.map((f) => ({
      id: f.id,
      ventaId: f.ventaId,
      ventaCodigo: f.venta.codigo,
      cliente: f.venta.nombreCliente,
      documento: f.venta.documentoCliente,
      monto: Number(f.monto),
      metodoPago: f.metodoPago,
      numeroOperacion: f.numeroOperacion,
      comprobanteUrl: f.comprobanteUrl,
      empresaBancoId: f.empresaBancoId,
      cuentaReportada: f.empresaBancoId ? banco.get(f.empresaBancoId) ?? null : null,
      estado: f.estado,
      motivoRechazo: f.motivoRechazo,
      creadoEn: f.creadoEn,
      revisadoEn: f.revisadoEn,
    }));
  }

  /** Cuántos pagos esperan revisión (para el aviso del panel). */
  async contarPendientes(empresaId: string) {
    return { pendientes: await this.prisma.reporteAbono.count({ where: { empresaId, estado: 'PENDIENTE' } }) };
  }

  async aprobar(
    empresaId: string,
    reporteId: string,
    usuarioId: string,
    destino: { fuente?: FuenteIngreso; bancoId?: string },
  ) {
    const reporte = await this.prisma.reporteAbono.findFirst({ where: { id: reporteId, empresaId } });
    if (!reporte) throw new NotFoundException('Pago reportado no encontrado');
    if (reporte.estado !== 'PENDIENTE') throw new ConflictException('Este pago ya fue revisado');

    const fuente = destino.fuente ?? FuenteIngreso.BANCO;
    const bancoId = fuente === FuenteIngreso.BANCO ? destino.bancoId ?? reporte.empresaBancoId ?? undefined : undefined;
    if (fuente === FuenteIngreso.BANCO && !bancoId) {
      throw new BadRequestException('Elige la cuenta bancaria a la que entró el pago');
    }

    // Se "toma" el reporte antes de mover plata: dos admins aprobando a la vez
    // no registran dos abonos (el segundo encuentra 0 filas en PENDIENTE).
    const tomado = await this.prisma.reporteAbono.updateMany({
      where: { id: reporteId, empresaId, estado: 'PENDIENTE' },
      data: { estado: 'APROBADO', revisadoPorId: usuarioId, revisadoEn: new Date() },
    });
    if (tomado.count === 0) throw new ConflictException('Este pago ya fue revisado');

    try {
      const abono = await this.cxc.registrarAbono(
        empresaId,
        reporte.ventaId,
        {
          monto: Number(reporte.monto),
          metodoPago: reporte.metodoPago as MetodoPagoVenta,
          // Bancarización: los digitales llevan referencia (00000 si no la dio).
          referencia: reporte.numeroOperacion?.trim() || '00000',
          fuente,
          bancoId,
        },
        usuarioId,
      );
      await this.prisma.reporteAbono.update({ where: { id: reporteId }, data: { pagoVentaId: abono.pagoId } });
      return { ok: true, pagoId: abono.pagoId, saldoPendiente: abono.saldoPendiente };
    } catch (e) {
      // No se registró el abono: el reporte vuelve a quedar para revisar.
      await this.prisma.reporteAbono.update({
        where: { id: reporteId },
        data: { estado: 'PENDIENTE', revisadoPorId: null, revisadoEn: null },
      });
      throw e;
    }
  }

  async rechazar(empresaId: string, reporteId: string, usuarioId: string, motivo: string) {
    const texto = motivo?.trim();
    if (!texto) throw new BadRequestException('Indica el motivo del rechazo: el cliente lo va a ver');
    const r = await this.prisma.reporteAbono.updateMany({
      where: { id: reporteId, empresaId, estado: 'PENDIENTE' },
      data: { estado: 'RECHAZADO', motivoRechazo: texto.slice(0, 300), revisadoPorId: usuarioId, revisadoEn: new Date() },
    });
    if (r.count === 0) {
      const existe = await this.prisma.reporteAbono.count({ where: { id: reporteId, empresaId } });
      if (!existe) throw new NotFoundException('Pago reportado no encontrado');
      throw new ConflictException('Este pago ya fue revisado');
    }
    return { ok: true };
  }
}
