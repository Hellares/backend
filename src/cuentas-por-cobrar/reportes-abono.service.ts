import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EstadoReporteAbono, FuenteIngreso, MetodoPagoVenta } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';
import { DepositosClienteService } from './depositos-cliente.service';

/**
 * Pagos que los clientes reportan desde "Mis compras" de la tienda web. Un pago
 * puede cubrir VARIAS ventas (una transferencia grande que salda varias): cada
 * una es una línea con su monto.
 *
 * Aprobar = un abono por línea, por el MISMO camino que el panel
 * (`registrarAbono`: cuotas, ingreso a banco/caja, estado de la venta). Es todo
 * o nada: si una línea falla, se anulan los abonos ya registrados y el pago
 * vuelve a PENDIENTE. Rechazar no toca plata.
 *
 * Un pago SIN líneas es un depósito: el cliente dijo cuánto pagó pero no a
 * qué compras. Aprobarlo crea el `DepositoCliente` (la plata entra una vez) y
 * la tienda lo reparte después; lo que no reparta queda a favor del cliente.
 */
@Injectable()
export class ReportesAbonoService {
  private readonly logger = new Logger(ReportesAbonoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cxc: CuentasPorCobrarService,
    private readonly depositos: DepositosClienteService,
  ) {}

  async listar(empresaId: string, estado: EstadoReporteAbono = 'PENDIENTE') {
    const filas = await this.prisma.reporteAbono.findMany({
      where: { empresaId, estado },
      orderBy: { creadoEn: estado === 'PENDIENTE' ? 'asc' : 'desc' },
      take: 100,
      include: {
        lineas: {
          orderBy: { venta: { fechaVenta: 'asc' } },
          include: { venta: { select: { codigo: true, nombreCliente: true, documentoCliente: true } } },
        },
      },
    });
    const bancoIds = [...new Set(filas.map((f) => f.empresaBancoId).filter((x): x is string => !!x))];
    const bancos = bancoIds.length
      ? await this.prisma.empresaBanco.findMany({
          where: { id: { in: bancoIds }, empresaId },
          select: { id: true, nombreBanco: true, numeroCuenta: true },
        })
      : [];
    const banco = new Map(bancos.map((b) => [b.id, b]));

    // Los depósitos (sin líneas) no tienen venta de dónde sacar el nombre.
    const sinLineas = filas.filter((f) => !f.lineas.length);
    const epIds = [...new Set(sinLineas.map((f) => f.clienteId).filter((x): x is string => !!x))];
    const ceIds = [...new Set(sinLineas.map((f) => f.clienteEmpresaId).filter((x): x is string => !!x))];
    const [eps, ces] = await Promise.all([
      epIds.length
        ? this.prisma.empresaPersona.findMany({
            where: { id: { in: epIds }, empresaId },
            select: { id: true, persona: { select: { nombres: true, apellidos: true, dni: true } } },
          })
        : [],
      ceIds.length
        ? this.prisma.clienteEmpresa.findMany({
            where: { id: { in: ceIds }, empresaId },
            select: { id: true, razonSocial: true, numeroDocumento: true },
          })
        : [],
    ]);
    const titular = new Map<string, { nombre: string; documento: string | null }>();
    for (const e of eps) {
      titular.set(e.id, {
        nombre: [e.persona?.nombres, e.persona?.apellidos].filter(Boolean).join(' ') || '—',
        documento: e.persona?.dni ?? null,
      });
    }
    for (const c of ces) titular.set(c.id, { nombre: c.razonSocial, documento: c.numeroDocumento });

    return filas.map((f) => {
      const primera = f.lineas[0]?.venta;
      const t = titular.get(f.clienteEmpresaId ?? f.clienteId ?? '');
      return {
        id: f.id,
        // Sin líneas = depósito: la tienda decide a qué ventas va.
        esDeposito: !f.lineas.length,
        clienteId: f.clienteId,
        clienteEmpresaId: f.clienteEmpresaId,
        // Todas las ventas de un pago son del mismo titular (se valida al reportar).
        cliente: primera?.nombreCliente ?? t?.nombre ?? '—',
        documento: primera?.documentoCliente ?? t?.documento ?? null,
        monto: Number(f.monto),
        metodoPago: f.metodoPago,
        numeroOperacion: f.numeroOperacion,
        comprobanteUrl: f.comprobanteUrl,
        // Las anteriores a varias capturas solo tienen `comprobanteUrl`.
        comprobantes: f.comprobantesUrls?.length ? f.comprobantesUrls : [f.comprobanteUrl],
        empresaBancoId: f.empresaBancoId,
        cuentaReportada: f.empresaBancoId ? banco.get(f.empresaBancoId) ?? null : null,
        lineas: f.lineas.map((l) => ({ ventaId: l.ventaId, ventaCodigo: l.venta.codigo, monto: Number(l.monto) })),
        estado: f.estado,
        motivoRechazo: f.motivoRechazo,
        creadoEn: f.creadoEn,
        revisadoEn: f.revisadoEn,
      };
    });
  }

  /** Cuántos pagos esperan revisión (para el aviso del panel). */
  async contarPendientes(empresaId: string) {
    return { pendientes: await this.prisma.reporteAbono.count({ where: { empresaId, estado: 'PENDIENTE' } }) };
  }

  async aprobar(
    empresaId: string,
    reporteId: string,
    usuarioId: string,
    destino: { fuente?: FuenteIngreso; bancoId?: string; sedeId?: string },
  ) {
    const reporte = await this.prisma.reporteAbono.findFirst({
      where: { id: reporteId, empresaId },
      include: { lineas: { orderBy: { venta: { fechaVenta: 'asc' } } } },
    });
    if (!reporte) throw new NotFoundException('Pago reportado no encontrado');
    if (reporte.estado !== 'PENDIENTE') throw new ConflictException('Este pago ya fue revisado');
    const esDeposito = !reporte.lineas.length;
    if (esDeposito && !reporte.clienteId && !reporte.clienteEmpresaId) {
      throw new BadRequestException('Este pago no tiene ventas asignadas');
    }

    const fuente = destino.fuente ?? FuenteIngreso.BANCO;
    const bancoId = fuente === FuenteIngreso.BANCO ? destino.bancoId ?? reporte.empresaBancoId ?? undefined : undefined;
    if (fuente === FuenteIngreso.BANCO && !bancoId) {
      throw new BadRequestException('Elige la cuenta bancaria a la que entró el pago');
    }

    // Se "toma" el pago antes de mover plata: dos admins aprobando a la vez no
    // registran dos veces (el segundo encuentra 0 filas en PENDIENTE).
    const tomado = await this.prisma.reporteAbono.updateMany({
      where: { id: reporteId, empresaId, estado: 'PENDIENTE' },
      data: { estado: 'APROBADO', revisadoPorId: usuarioId, revisadoEn: new Date() },
    });
    if (tomado.count === 0) throw new ConflictException('Este pago ya fue revisado');

    // Bancarización: los digitales llevan referencia (00000 si no la dio). La
    // misma en todas las líneas: fue UNA operación.
    const referencia = reporte.numeroOperacion?.trim() || '00000';
    const registrados: { lineaId: string; pagoId: string }[] = [];
    try {
      if (esDeposito) {
        const dep = await this.depositos.registrar(
          empresaId,
          usuarioId,
          {
            clienteId: reporte.clienteId,
            clienteEmpresaId: reporte.clienteEmpresaId,
            monto: Number(reporte.monto),
            metodoPago: reporte.metodoPago as MetodoPagoVenta,
            referencia,
            fuente,
            bancoId,
            sedeId: destino.sedeId,
          },
          { origen: 'TIENDA', reporteAbonoId: reporte.id },
        );
        // La tienda lo reparte a continuación (o lo deja a favor del cliente).
        return { ok: true, abonos: 0, pagos: [], depositoId: dep.depositoId };
      }
      for (const linea of reporte.lineas) {
        const abono = await this.cxc.registrarAbono(
          empresaId,
          linea.ventaId,
          { monto: Number(linea.monto), metodoPago: reporte.metodoPago as MetodoPagoVenta, referencia, fuente, bancoId },
          usuarioId,
        );
        registrados.push({ lineaId: linea.id, pagoId: abono.pagoId });
        await this.prisma.reporteAbonoVenta.update({ where: { id: linea.id }, data: { pagoVentaId: abono.pagoId } });
      }
      return { ok: true, abonos: registrados.length, pagos: registrados.map((r) => r.pagoId) };
    } catch (e) {
      // Todo o nada: se anulan los abonos que alcanzaron a registrarse (revierte
      // su ingreso y recomputa cuotas) y el pago vuelve a quedar para revisar.
      for (const r of registrados.reverse()) {
        try {
          await this.cxc.anularAbono(empresaId, r.pagoId, usuarioId, 'Aprobación de pago reportado incompleta: se revierte');
          await this.prisma.reporteAbonoVenta.update({ where: { id: r.lineaId }, data: { pagoVentaId: null } });
        } catch (err) {
          this.logger.error(`No se pudo revertir el abono ${r.pagoId} del reporte ${reporteId}: ${(err as Error).message}`);
        }
      }
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
