import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { LibroContableService } from '../libro-contable/libro-contable.service';
import { EstadoDevolucion, EstadoVenta, MotivoLiquidacion, Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { Response } from 'express';

const BATCH_SIZE = 2000;

const HEADER_STYLE: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } },
  alignment: { horizontal: 'center', vertical: 'middle' },
  border: {
    top: { style: 'thin' },
    bottom: { style: 'thin' },
    left: { style: 'thin' },
    right: { style: 'thin' },
  },
};

@Injectable()
export class ReportesFinancierosExportService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly libroContableService: LibroContableService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(ReportesFinancierosExportService.name);
  }

  /**
   * Exportar Libro Contable de un mes/año a Excel
   */
  async exportLibroContable(
    empresaId: string,
    mes: number,
    anio: number,
    res: Response,
  ): Promise<void> {
    this.logger.log(`Exportando libro contable ${mes}/${anio} para empresa ${empresaId}`);

    const libro = await this.libroContableService.getLibro(empresaId, mes, anio);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    // Sheet 1: Libro Contable
    const sheet = workbook.addWorksheet('Libro Contable');
    sheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 12 },
      { header: 'Categoría', key: 'categoria', width: 18 },
      { header: 'Descripción', key: 'descripcion', width: 40 },
      { header: 'Referencia', key: 'referencia', width: 20 },
      { header: 'Monto', key: 'monto', width: 16 },
      { header: 'Saldo Acumulado', key: 'saldoAcumulado', width: 18 },
    ];
    sheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    sheet.getRow(1).height = 25;

    for (const asiento of libro.asientos) {
      sheet.addRow({
        fecha: asiento.fecha.toISOString().split('T')[0],
        tipo: asiento.tipo,
        categoria: asiento.categoria,
        descripcion: asiento.descripcion,
        referencia: asiento.referencia ?? '',
        monto: asiento.monto,
        saldoAcumulado: asiento.saldoAcumulado,
      });
    }

    // Formato moneda para columnas Monto y Saldo Acumulado
    sheet.getColumn(6).numFmt = '#,##0.00';
    sheet.getColumn(7).numFmt = '#,##0.00';

    // Sheet 2: Resumen
    const resumenSheet = workbook.addWorksheet('Resumen');
    resumenSheet.columns = [
      { header: 'Concepto', key: 'concepto', width: 25 },
      { header: 'Monto', key: 'monto', width: 18 },
    ];
    resumenSheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    resumenSheet.getRow(1).height = 25;

    resumenSheet.addRow({ concepto: 'Periodo', monto: `${mes}/${anio}` });
    resumenSheet.addRow({ concepto: 'Total Movimientos', monto: libro.asientos.length });
    resumenSheet.addRow({});
    resumenSheet.addRow({ concepto: 'Total Ingresos', monto: libro.resumen.totalIngresos });
    resumenSheet.addRow({ concepto: 'Total Egresos', monto: libro.resumen.totalEgresos });
    resumenSheet.addRow({ concepto: 'Saldo Final', monto: libro.resumen.saldo });

    // Formato moneda para filas de montos
    for (let i = 4; i <= 6; i++) {
      resumenSheet.getRow(i + 1).getCell('monto').numFmt = '#,##0.00';
    }

    const mesStr = String(mes).padStart(2, '0');
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=libro_contable_${anio}_${mesStr}.xlsx`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Exportar Cuentas por Cobrar a Excel
   */
  async exportCuentasPorCobrar(
    empresaId: string,
    res: Response,
  ): Promise<void> {
    this.logger.log(`Exportando cuentas por cobrar para empresa ${empresaId}`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Cuentas por Cobrar');
    sheet.columns = [
      { header: 'Código', key: 'codigo', width: 18 },
      { header: 'Cliente', key: 'cliente', width: 25 },
      { header: 'Fecha Venta', key: 'fechaVenta', width: 14 },
      { header: 'Fecha Vencimiento', key: 'fechaVencimiento', width: 16 },
      { header: 'Total Venta', key: 'totalVenta', width: 16 },
      { header: 'Monto Pagado', key: 'montoPagado', width: 16 },
      { header: 'Saldo Pendiente', key: 'saldoPendiente', width: 16 },
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Días Vencimiento', key: 'diasVencimiento', width: 16 },
    ];
    sheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    sheet.getRow(1).height = 25;

    const now = new Date();
    let totalPendiente = 0;
    let totalVencido = 0;
    let cantidadPendientes = 0;
    let cantidadVencidas = 0;

    let cursor: string | undefined = undefined;

    while (true) {
      const batch = await this.prisma.venta.findMany({
        where: {
          empresaId,
          esCredito: true,
          estado: { not: 'ANULADA' },
        },
        select: {
          id: true,
          codigo: true,
          nombreCliente: true,
          fechaVenta: true,
          fechaVencimientoPago: true,
          total: true,
          pagos: { select: { monto: true } },
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;

      for (const v of batch) {
        const totalVenta = Number(v.total);
        const montoPagado = v.pagos.reduce((sum, p) => sum + Number(p.monto), 0);
        const saldoPendiente = Math.round((totalVenta - montoPagado) * 100) / 100;

        // Solo incluir las que tienen saldo pendiente
        if (saldoPendiente <= 0) continue;

        const estaVencida = v.fechaVencimientoPago ? v.fechaVencimientoPago < now : false;
        const diasVencimiento = v.fechaVencimientoPago
          ? Math.ceil((v.fechaVencimientoPago.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        const estado = estaVencida ? 'VENCIDA' : 'PENDIENTE';

        if (estaVencida) {
          totalVencido += saldoPendiente;
          cantidadVencidas++;
        } else {
          cantidadPendientes++;
        }
        totalPendiente += saldoPendiente;

        sheet.addRow({
          codigo: v.codigo,
          cliente: v.nombreCliente,
          fechaVenta: v.fechaVenta.toISOString().split('T')[0],
          fechaVencimiento: v.fechaVencimientoPago
            ? v.fechaVencimientoPago.toISOString().split('T')[0]
            : '',
          totalVenta,
          montoPagado: Math.round(montoPagado * 100) / 100,
          saldoPendiente,
          estado,
          diasVencimiento: diasVencimiento ?? '',
        });
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }

    // Formato moneda
    for (const colNum of [5, 6, 7]) {
      sheet.getColumn(colNum).numFmt = '#,##0.00';
    }

    // Sheet Resumen
    const resumenSheet = workbook.addWorksheet('Resumen');
    resumenSheet.columns = [
      { header: 'Concepto', key: 'concepto', width: 25 },
      { header: 'Valor', key: 'valor', width: 18 },
    ];
    resumenSheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    resumenSheet.getRow(1).height = 25;

    resumenSheet.addRow({ concepto: 'Total Pendiente', valor: Math.round(totalPendiente * 100) / 100 });
    resumenSheet.addRow({ concepto: 'Total Vencido', valor: Math.round(totalVencido * 100) / 100 });
    resumenSheet.addRow({ concepto: 'Cantidad Pendientes', valor: cantidadPendientes });
    resumenSheet.addRow({ concepto: 'Cantidad Vencidas', valor: cantidadVencidas });

    resumenSheet.getRow(2).getCell('valor').numFmt = '#,##0.00';
    resumenSheet.getRow(3).getCell('valor').numFmt = '#,##0.00';

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=cuentas_por_cobrar_${new Date().toISOString().split('T')[0]}.xlsx`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Exportar Cuentas por Pagar a Excel
   */
  async exportCuentasPorPagar(
    empresaId: string,
    res: Response,
  ): Promise<void> {
    this.logger.log(`Exportando cuentas por pagar para empresa ${empresaId}`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Cuentas por Pagar');
    sheet.columns = [
      { header: 'Código', key: 'codigo', width: 18 },
      { header: 'Proveedor', key: 'proveedor', width: 25 },
      { header: 'Fecha Compra', key: 'fechaCompra', width: 14 },
      { header: 'Fecha Vencimiento', key: 'fechaVencimiento', width: 16 },
      { header: 'Total Compra', key: 'totalCompra', width: 16 },
      { header: 'Monto Pagado', key: 'montoPagado', width: 16 },
      { header: 'Saldo Pendiente', key: 'saldoPendiente', width: 16 },
      { header: 'Estado', key: 'estado', width: 14 },
    ];
    sheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    sheet.getRow(1).height = 25;

    const now = new Date();
    let totalPendiente = 0;
    let totalVencido = 0;
    let cantidadPendientes = 0;
    let cantidadVencidas = 0;

    let cursor: string | undefined = undefined;

    while (true) {
      const batch = await this.prisma.compra.findMany({
        where: {
          empresaId,
          estado: 'CONFIRMADA',
          terminosPago: { not: 'CONTADO' },
        },
        select: {
          id: true,
          codigo: true,
          nombreProveedor: true,
          fechaRecepcion: true,
          fechaVencimientoPago: true,
          total: true,
          pagos: { select: { monto: true } },
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;

      for (const c of batch) {
        const totalCompra = Number(c.total);
        const montoPagado = c.pagos.reduce((sum, p) => sum + Number(p.monto), 0);
        const saldoPendiente = Math.round((totalCompra - montoPagado) * 100) / 100;

        // Solo incluir las que tienen saldo pendiente
        if (saldoPendiente <= 0) continue;

        const estaVencida = c.fechaVencimientoPago ? c.fechaVencimientoPago < now : false;
        const estado = estaVencida ? 'VENCIDA' : 'PENDIENTE';

        if (estaVencida) {
          totalVencido += saldoPendiente;
          cantidadVencidas++;
        } else {
          cantidadPendientes++;
        }
        totalPendiente += saldoPendiente;

        sheet.addRow({
          codigo: c.codigo,
          proveedor: c.nombreProveedor,
          fechaCompra: c.fechaRecepcion.toISOString().split('T')[0],
          fechaVencimiento: c.fechaVencimientoPago
            ? c.fechaVencimientoPago.toISOString().split('T')[0]
            : '',
          totalCompra,
          montoPagado: Math.round(montoPagado * 100) / 100,
          saldoPendiente,
          estado,
        });
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }

    // Formato moneda
    for (const colNum of [5, 6, 7]) {
      sheet.getColumn(colNum).numFmt = '#,##0.00';
    }

    // Sheet Resumen
    const resumenSheet = workbook.addWorksheet('Resumen');
    resumenSheet.columns = [
      { header: 'Concepto', key: 'concepto', width: 25 },
      { header: 'Valor', key: 'valor', width: 18 },
    ];
    resumenSheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    resumenSheet.getRow(1).height = 25;

    resumenSheet.addRow({ concepto: 'Total Pendiente', valor: Math.round(totalPendiente * 100) / 100 });
    resumenSheet.addRow({ concepto: 'Total Vencido', valor: Math.round(totalVencido * 100) / 100 });
    resumenSheet.addRow({ concepto: 'Cantidad Pendientes', valor: cantidadPendientes });
    resumenSheet.addRow({ concepto: 'Cantidad Vencidas', valor: cantidadVencidas });

    resumenSheet.getRow(2).getCell('valor').numFmt = '#,##0.00';
    resumenSheet.getRow(3).getCell('valor').numFmt = '#,##0.00';

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=cuentas_por_pagar_${new Date().toISOString().split('T')[0]}.xlsx`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }

  // =====================================================
  // REPORTE: Liquidaciones y pérdidas comerciales
  // =====================================================

  /**
   * Agrega ventas con líneas de margen negativo (motivoLiquidacionSnapshot
   * presente o autorización de venta bajo costo). Devuelve resumen + detalle.
   */
  async getReporteLiquidaciones(
    empresaId: string,
    filtros: {
      sedeId?: string;
      fechaInicio: Date;
      fechaFin: Date;
      motivo?: MotivoLiquidacion;
    },
  ): Promise<{
    resumen: {
      cantidadLineas: number;
      cantidadVentas: number;
      ingresoTotal: number; // sum (ingresoNetoLinea x cantidad)
      costoTotal: number; // sum (costoUnitario x cantidad)
      perdidaTotal: number; // ingreso - costo (negativo)
      promedioPerdidaPorLinea: number;
    };
    porMotivo: Array<{
      motivo: string; // MotivoLiquidacion o "SIN_LIQUIDACION_AUTORIZADA"
      cantidadLineas: number;
      ingreso: number;
      costo: number;
      perdida: number;
    }>;
    porProducto: Array<{
      productoId: string | null;
      varianteId: string | null;
      descripcion: string;
      cantidadVendida: number;
      ingreso: number;
      costo: number;
      perdida: number;
    }>;
    detalle: Array<{
      ventaId: string;
      ventaCodigo: string;
      fechaVenta: Date;
      sedeNombre: string;
      descripcion: string;
      cantidad: number;
      precioUnitario: number;
      descuento: number;
      precioCostoSnapshot: number;
      margenSnapshot: number;
      motivo: string | null;
      autorizadoPorNombre: string | null;
    }>;
  }> {
    const where: Prisma.VentaDetalleWhereInput = {
      venta: {
        empresaId,
        estado: { not: EstadoVenta.ANULADA },
        fechaVenta: { gte: filtros.fechaInicio, lte: filtros.fechaFin },
        ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      },
      precioCostoSnapshot: { gt: 0 },
      margenSnapshot: { lt: 0 },
      ...(filtros.motivo ? { motivoLiquidacionSnapshot: filtros.motivo } : {}),
    };

    const rows = await this.prisma.ventaDetalle.findMany({
      where,
      include: {
        venta: {
          select: {
            id: true,
            codigo: true,
            fechaVenta: true,
            sede: { select: { nombre: true } },
            ventaBajoCostoAutorizadaPor: {
              select: { persona: { select: { nombres: true, apellidos: true } } },
            },
          },
        },
        producto: { select: { id: true, nombre: true } },
        variante: { select: { id: true, nombre: true } },
      },
      orderBy: { venta: { fechaVenta: 'desc' } },
    });

    // Pre-cargar devoluciones PROCESADAS de las ventas afectadas para
    // descontar cantidades devueltas de la perdida (sino sobre-cuenta).
    // Dos mapas:
    //  - cantidadDevueltaPorDetalle: match exacto cuando DevolucionItem
    //    tiene ventaDetalleId (preciso aunque la venta tenga varios
    //    detalles del mismo producto).
    //  - cantidadDevueltaPorLinea: fallback agregado por
    //    (ventaId, productoId, varianteId) para devoluciones viejas o
    //    reversiones totales sin FK.
    const ventaIds = Array.from(new Set(rows.map((r) => r.venta.id)));
    const devolucionesProcesadas = ventaIds.length
      ? await this.prisma.devolucion.findMany({
          where: {
            ventaId: { in: ventaIds },
            estado: EstadoDevolucion.PROCESADA,
          },
          select: {
            ventaId: true,
            items: {
              select: {
                ventaDetalleId: true,
                productoId: true,
                varianteId: true,
                cantidad: true,
              },
            },
          },
        })
      : [];
    const cantidadDevueltaPorDetalle = new Map<string, number>();
    const cantidadDevueltaPorLinea = new Map<string, number>();
    for (const dev of devolucionesProcesadas) {
      if (!dev.ventaId) continue;
      for (const item of dev.items) {
        if (item.ventaDetalleId) {
          cantidadDevueltaPorDetalle.set(
            item.ventaDetalleId,
            (cantidadDevueltaPorDetalle.get(item.ventaDetalleId) ?? 0) + item.cantidad,
          );
        } else {
          // Devoluciones legacy sin FK — agregar al fallback por producto/variante.
          const key = `${dev.ventaId}|${item.productoId ?? ''}|${item.varianteId ?? ''}`;
          cantidadDevueltaPorLinea.set(
            key,
            (cantidadDevueltaPorLinea.get(key) ?? 0) + item.cantidad,
          );
        }
      }
    }

    // Resumen
    let ingresoTotal = 0;
    let costoTotal = 0;
    let cantidadLineasRealizadas = 0;
    const ventasSet = new Set<string>();
    const porMotivoMap = new Map<string, { cantidadLineas: number; ingreso: number; costo: number; perdida: number }>();
    const porProductoMap = new Map<
      string,
      { productoId: string | null; varianteId: string | null; descripcion: string; cantidadVendida: number; ingreso: number; costo: number; perdida: number }
    >();
    const detalle: Awaited<ReturnType<typeof this.getReporteLiquidaciones>>['detalle'] = [];

    for (const r of rows) {
      const cantidadVendida = Number(r.cantidad);
      const precioUnitario = Number(r.precioUnitario);
      const descuentoOriginal = Number(r.descuento);
      const precioCosto = Number(r.precioCostoSnapshot);
      const margenUnitario = Number(r.margenSnapshot);

      // Descontar cantidad devuelta procesada. Prefiero match exacto via
      // ventaDetalleId; sino fallback al agregado por (venta, producto,
      // variante) — en este ultimo caso, si la venta tiene 2 detalles del
      // mismo producto, el descuento se prorratea por orden de aparicion
      // marcando la cantidad consumida.
      const devueltaExacta = cantidadDevueltaPorDetalle.get(r.id) ?? 0;
      let devueltaParaLinea = Math.min(devueltaExacta, cantidadVendida);
      if (devueltaExacta === 0) {
        const key = `${r.venta.id}|${r.productoId ?? ''}|${r.varianteId ?? ''}`;
        const devueltaDisponible = cantidadDevueltaPorLinea.get(key) ?? 0;
        devueltaParaLinea = Math.min(devueltaDisponible, cantidadVendida);
        if (devueltaDisponible > 0) {
          cantidadDevueltaPorLinea.set(key, devueltaDisponible - devueltaParaLinea);
        }
      }
      const cantidadRealizada = cantidadVendida - devueltaParaLinea;

      // Si todo se devolvio, la perdida no se realizo: excluir del reporte.
      if (cantidadRealizada <= 0) continue;

      // Prorratear el descuento de la linea segun cantidad realizada.
      const descuento = cantidadVendida > 0
        ? descuentoOriginal * (cantidadRealizada / cantidadVendida)
        : 0;
      const ingresoLinea = precioUnitario * cantidadRealizada - descuento;
      const costoLinea = precioCosto * cantidadRealizada;
      const perdidaLinea = ingresoLinea - costoLinea;

      ingresoTotal += ingresoLinea;
      costoTotal += costoLinea;
      cantidadLineasRealizadas++;
      ventasSet.add(r.venta.id);

      const motivoKey = (r.motivoLiquidacionSnapshot as string) ?? 'SIN_LIQUIDACION_AUTORIZADA';
      const m = porMotivoMap.get(motivoKey) ?? { cantidadLineas: 0, ingreso: 0, costo: 0, perdida: 0 };
      m.cantidadLineas++;
      m.ingreso += ingresoLinea;
      m.costo += costoLinea;
      m.perdida += perdidaLinea;
      porMotivoMap.set(motivoKey, m);

      const productoKey = r.varianteId ?? r.productoId ?? r.descripcion;
      const p = porProductoMap.get(productoKey) ?? {
        productoId: r.productoId,
        varianteId: r.varianteId,
        descripcion: r.descripcion,
        cantidadVendida: 0,
        ingreso: 0,
        costo: 0,
        perdida: 0,
      };
      p.cantidadVendida += cantidadRealizada;
      p.ingreso += ingresoLinea;
      p.costo += costoLinea;
      p.perdida += perdidaLinea;
      porProductoMap.set(productoKey, p);

      const autorizadoNombre = r.venta.ventaBajoCostoAutorizadaPor?.persona
        ? `${r.venta.ventaBajoCostoAutorizadaPor.persona.nombres} ${r.venta.ventaBajoCostoAutorizadaPor.persona.apellidos}`.trim()
        : null;

      detalle.push({
        ventaId: r.venta.id,
        ventaCodigo: r.venta.codigo,
        fechaVenta: r.venta.fechaVenta,
        sedeNombre: r.venta.sede.nombre,
        descripcion: devueltaParaLinea > 0
          ? `${r.descripcion} (devuelto: ${devueltaParaLinea}/${cantidadVendida})`
          : r.descripcion,
        cantidad: cantidadRealizada,
        precioUnitario,
        descuento: Math.round(descuento * 100) / 100,
        precioCostoSnapshot: precioCosto,
        margenSnapshot: margenUnitario,
        motivo: r.motivoLiquidacionSnapshot,
        autorizadoPorNombre: autorizadoNombre,
      });
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return {
      resumen: {
        cantidadLineas: cantidadLineasRealizadas,
        cantidadVentas: ventasSet.size,
        ingresoTotal: round2(ingresoTotal),
        costoTotal: round2(costoTotal),
        perdidaTotal: round2(ingresoTotal - costoTotal),
        promedioPerdidaPorLinea: cantidadLineasRealizadas > 0
          ? round2((ingresoTotal - costoTotal) / cantidadLineasRealizadas)
          : 0,
      },
      porMotivo: Array.from(porMotivoMap.entries())
        .map(([motivo, v]) => ({
          motivo,
          cantidadLineas: v.cantidadLineas,
          ingreso: round2(v.ingreso),
          costo: round2(v.costo),
          perdida: round2(v.perdida),
        }))
        .sort((a, b) => a.perdida - b.perdida),
      porProducto: Array.from(porProductoMap.values())
        .map((v) => ({
          ...v,
          ingreso: round2(v.ingreso),
          costo: round2(v.costo),
          perdida: round2(v.perdida),
        }))
        .sort((a, b) => a.perdida - b.perdida),
      detalle,
    };
  }

  async exportLiquidaciones(
    empresaId: string,
    filtros: {
      sedeId?: string;
      fechaInicio: Date;
      fechaFin: Date;
      motivo?: MotivoLiquidacion;
    },
    res: Response,
  ): Promise<void> {
    const data = await this.getReporteLiquidaciones(empresaId, filtros);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    // Sheet 1: Resumen
    const resumenSheet = workbook.addWorksheet('Resumen');
    resumenSheet.columns = [
      { header: 'Concepto', key: 'concepto', width: 30 },
      { header: 'Valor', key: 'valor', width: 18 },
    ];
    resumenSheet.getRow(1).eachCell((c) => (c.style = HEADER_STYLE));
    resumenSheet.getRow(1).height = 25;
    resumenSheet.addRows([
      { concepto: 'Periodo', valor: `${filtros.fechaInicio.toISOString().slice(0, 10)} - ${filtros.fechaFin.toISOString().slice(0, 10)}` },
      { concepto: 'Líneas vendidas bajo costo', valor: data.resumen.cantidadLineas },
      { concepto: 'Ventas afectadas', valor: data.resumen.cantidadVentas },
      { concepto: 'Ingreso recuperado', valor: data.resumen.ingresoTotal },
      { concepto: 'Costo total', valor: data.resumen.costoTotal },
      { concepto: 'Pérdida total', valor: data.resumen.perdidaTotal },
      { concepto: 'Pérdida promedio por línea', valor: data.resumen.promedioPerdidaPorLinea },
    ]);
    for (let i = 5; i <= 8; i++) {
      resumenSheet.getRow(i).getCell('valor').numFmt = '#,##0.00';
    }

    // Sheet 2: Por motivo
    const motivoSheet = workbook.addWorksheet('Por motivo');
    motivoSheet.columns = [
      { header: 'Motivo', key: 'motivo', width: 25 },
      { header: 'Líneas', key: 'cantidadLineas', width: 10 },
      { header: 'Ingreso', key: 'ingreso', width: 14 },
      { header: 'Costo', key: 'costo', width: 14 },
      { header: 'Pérdida', key: 'perdida', width: 14 },
    ];
    motivoSheet.getRow(1).eachCell((c) => (c.style = HEADER_STYLE));
    motivoSheet.getRow(1).height = 25;
    data.porMotivo.forEach((m) => motivoSheet.addRow(m));
    [3, 4, 5].forEach((col) => (motivoSheet.getColumn(col).numFmt = '#,##0.00'));

    // Sheet 3: Por producto
    const productoSheet = workbook.addWorksheet('Por producto');
    productoSheet.columns = [
      { header: 'Producto', key: 'descripcion', width: 40 },
      { header: 'Cantidad', key: 'cantidadVendida', width: 12 },
      { header: 'Ingreso', key: 'ingreso', width: 14 },
      { header: 'Costo', key: 'costo', width: 14 },
      { header: 'Pérdida', key: 'perdida', width: 14 },
    ];
    productoSheet.getRow(1).eachCell((c) => (c.style = HEADER_STYLE));
    productoSheet.getRow(1).height = 25;
    data.porProducto.forEach((p) => productoSheet.addRow(p));
    [3, 4, 5].forEach((col) => (productoSheet.getColumn(col).numFmt = '#,##0.00'));

    // Sheet 4: Detalle
    const detalleSheet = workbook.addWorksheet('Detalle');
    detalleSheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Venta', key: 'ventaCodigo', width: 16 },
      { header: 'Sede', key: 'sedeNombre', width: 18 },
      { header: 'Producto', key: 'descripcion', width: 36 },
      { header: 'Cantidad', key: 'cantidad', width: 10 },
      { header: 'Precio venta', key: 'precioUnitario', width: 12 },
      { header: 'Descuento', key: 'descuento', width: 11 },
      { header: 'Costo unitario', key: 'precioCostoSnapshot', width: 14 },
      { header: 'Margen unitario', key: 'margenSnapshot', width: 14 },
      { header: 'Motivo', key: 'motivo', width: 22 },
      { header: 'Autorizado por', key: 'autorizadoPorNombre', width: 24 },
    ];
    detalleSheet.getRow(1).eachCell((c) => (c.style = HEADER_STYLE));
    detalleSheet.getRow(1).height = 25;
    data.detalle.forEach((d) =>
      detalleSheet.addRow({
        ...d,
        fecha: d.fechaVenta.toISOString().slice(0, 10),
        motivo: d.motivo ?? 'Autorización gerencial',
        autorizadoPorNombre: d.autorizadoPorNombre ?? '',
      }),
    );
    [6, 7, 8, 9].forEach((col) => (detalleSheet.getColumn(col).numFmt = '#,##0.00'));

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=liquidaciones_${filtros.fechaInicio.toISOString().slice(0, 10)}_${filtros.fechaFin.toISOString().slice(0, 10)}.xlsx`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }
}
