import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { LibroContableService } from '../libro-contable/libro-contable.service';
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
}
