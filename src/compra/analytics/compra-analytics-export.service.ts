import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLoggerService } from '../../common/logger/logger.service';
import { EstadoCompra } from '@prisma/client';
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

const GREEN_HEADER_STYLE: Partial<ExcelJS.Style> = {
  ...HEADER_STYLE,
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF388E3C' } },
};

@Injectable()
export class CompraAnalyticsExportService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CompraAnalyticsExportService.name);
  }

  /**
   * Exportar detalle por producto — streaming directo al response
   */
  async exportDetalladoPorProducto(
    empresaId: string,
    fechaInicio: string,
    fechaFin: string,
    sedeId: string | undefined,
    res: Response,
  ): Promise<void> {
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    fin.setHours(23, 59, 59, 999);

    const baseWhere = {
      compra: {
        empresaId,
        estado: EstadoCompra.CONFIRMADA,
        confirmadoEn: { gte: inicio, lte: fin },
        ...(sedeId ? { sedeId } : {}),
      },
    };

    // Contar total para log
    const totalCount = await this.prisma.compraDetalle.count({ where: baseWhere });
    this.logger.log(`Exportando ${totalCount} detalles de compra por producto`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Detalle por Producto');
    sheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Codigo Compra', key: 'codigoCompra', width: 18 },
      { header: 'Proveedor', key: 'proveedor', width: 25 },
      { header: 'Sede', key: 'sede', width: 18 },
      { header: 'Codigo Producto', key: 'codigoProducto', width: 18 },
      { header: 'Producto', key: 'producto', width: 30 },
      { header: 'Variante', key: 'variante', width: 20 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
      { header: 'Precio Unitario', key: 'precioUnitario', width: 16 },
      { header: 'Descuento', key: 'descuento', width: 14 },
      { header: 'IGV', key: 'igv', width: 14 },
      { header: 'Subtotal', key: 'subtotal', width: 16 },
      { header: 'Total', key: 'total', width: 16 },
    ];
    sheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    sheet.getRow(1).height = 25;

    // Resumen aggregation map
    const productoMap = new Map<string, {
      nombre: string;
      codigo: string;
      cantidad: number;
      costoTotal: number;
      compras: number;
    }>();

    let totalGeneral = 0;
    let cursor: string | undefined = undefined;

    // Paginación por cursor para no cargar todo en memoria
    while (true) {
      const batch = await this.prisma.compraDetalle.findMany({
        where: baseWhere,
        select: {
          id: true,
          cantidad: true,
          precioUnitario: true,
          descuento: true,
          igv: true,
          subtotal: true,
          total: true,
          descripcion: true,
          producto: { select: { nombre: true, codigoEmpresa: true } },
          variante: { select: { nombre: true, sku: true } },
          compra: {
            select: {
              codigo: true,
              confirmadoEn: true,
              nombreProveedor: true,
              sede: { select: { nombre: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;

      for (const d of batch) {
        const total = Number(d.total);
        totalGeneral += total;

        sheet.addRow({
          fecha: d.compra.confirmadoEn
            ? d.compra.confirmadoEn.toISOString().split('T')[0]
            : '',
          codigoCompra: d.compra.codigo,
          proveedor: d.compra.nombreProveedor,
          sede: d.compra.sede?.nombre ?? '',
          codigoProducto: d.producto?.codigoEmpresa ?? '',
          producto: d.producto?.nombre ?? d.descripcion,
          variante: d.variante
            ? `${d.variante.nombre}${d.variante.sku ? ` (${d.variante.sku})` : ''}`
            : '',
          cantidad: d.cantidad,
          precioUnitario: Number(d.precioUnitario),
          descuento: Number(d.descuento),
          igv: Number(d.igv),
          subtotal: Number(d.subtotal),
          total,
        });

        // Acumular resumen
        const key = d.producto?.nombre ?? d.descripcion;
        const current = productoMap.get(key) || {
          nombre: key,
          codigo: d.producto?.codigoEmpresa ?? '',
          cantidad: 0,
          costoTotal: 0,
          compras: 0,
        };
        current.cantidad += d.cantidad;
        current.costoTotal += total;
        current.compras += 1;
        productoMap.set(key, current);
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }

    // Formato moneda
    for (const colNum of [9, 10, 11, 12, 13]) {
      sheet.getColumn(colNum).numFmt = '#,##0.00';
    }

    // Fila total
    const totalRow = sheet.addRow({ producto: 'TOTAL GENERAL', total: totalGeneral });
    totalRow.font = { bold: true };
    totalRow.getCell('total').numFmt = '#,##0.00';

    // Hoja resumen
    this.addResumenProductos(workbook, productoMap, fechaInicio, fechaFin);

    // Stream directo al response
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=compras_por_producto_${fechaInicio}_${fechaFin}.xlsx`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }

  /**
   * Exportar detalle por proveedor — streaming directo al response
   */
  async exportDetalladoPorProveedor(
    empresaId: string,
    fechaInicio: string,
    fechaFin: string,
    sedeId: string | undefined,
    res: Response,
  ): Promise<void> {
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    fin.setHours(23, 59, 59, 999);

    const baseWhere = {
      empresaId,
      estado: EstadoCompra.CONFIRMADA,
      confirmadoEn: { gte: inicio, lte: fin },
      ...(sedeId ? { sedeId } : {}),
    };

    const totalCount = await this.prisma.compra.count({ where: baseWhere });
    this.logger.log(`Exportando ${totalCount} compras por proveedor`);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Syncronize';
    workbook.created = new Date();

    // Sheet 1: Resumen por proveedor (se llena después)
    const resumenSheet = workbook.addWorksheet('Resumen por Proveedor');
    resumenSheet.columns = [
      { header: 'Proveedor', key: 'proveedor', width: 30 },
      { header: 'Total Compras', key: 'totalCompras', width: 16 },
      { header: 'Total Productos', key: 'totalProductos', width: 16 },
      { header: 'Subtotal', key: 'subtotal', width: 16 },
      { header: 'Descuento', key: 'descuento', width: 14 },
      { header: 'Impuestos', key: 'impuestos', width: 14 },
      { header: 'Monto Total', key: 'montoTotal', width: 18 },
    ];
    resumenSheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    resumenSheet.getRow(1).height = 25;

    // Sheet 2: Detalle
    const detalleSheet = workbook.addWorksheet('Detalle de Compras');
    detalleSheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 14 },
      { header: 'Codigo', key: 'codigo', width: 18 },
      { header: 'Proveedor', key: 'proveedor', width: 25 },
      { header: 'Sede', key: 'sede', width: 18 },
      { header: 'Productos', key: 'productos', width: 12 },
      { header: 'Subtotal', key: 'subtotal', width: 16 },
      { header: 'Descuento', key: 'descuento', width: 14 },
      { header: 'Impuestos', key: 'impuestos', width: 14 },
      { header: 'Total', key: 'total', width: 16 },
      { header: 'Observaciones', key: 'observaciones', width: 30 },
    ];
    detalleSheet.getRow(1).eachCell((cell) => { cell.style = HEADER_STYLE; });
    detalleSheet.getRow(1).height = 25;

    const proveedorMap = new Map<string, {
      proveedor: string;
      totalCompras: number;
      totalProductos: number;
      subtotal: number;
      descuento: number;
      impuestos: number;
      montoTotal: number;
    }>();

    let cursor: string | undefined = undefined;

    while (true) {
      const batch = await this.prisma.compra.findMany({
        where: baseWhere,
        select: {
          id: true,
          codigo: true,
          confirmadoEn: true,
          nombreProveedor: true,
          subtotal: true,
          descuento: true,
          impuestos: true,
          total: true,
          observaciones: true,
          sede: { select: { nombre: true } },
          detalles: {
            select: { cantidad: true },
          },
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (batch.length === 0) break;

      for (const c of batch) {
        const cantidadProductos = c.detalles.reduce((sum, d) => sum + d.cantidad, 0);

        detalleSheet.addRow({
          fecha: c.confirmadoEn ? c.confirmadoEn.toISOString().split('T')[0] : '',
          codigo: c.codigo,
          proveedor: c.nombreProveedor,
          sede: c.sede?.nombre ?? '',
          productos: c.detalles.length,
          subtotal: Number(c.subtotal),
          descuento: Number(c.descuento),
          impuestos: Number(c.impuestos),
          total: Number(c.total),
          observaciones: c.observaciones ?? '',
        });

        // Acumular resumen
        const key = c.nombreProveedor || 'Sin proveedor';
        const current = proveedorMap.get(key) || {
          proveedor: key,
          totalCompras: 0,
          totalProductos: 0,
          subtotal: 0,
          descuento: 0,
          impuestos: 0,
          montoTotal: 0,
        };
        current.totalCompras += 1;
        current.totalProductos += cantidadProductos;
        current.subtotal += Number(c.subtotal);
        current.descuento += Number(c.descuento);
        current.impuestos += Number(c.impuestos);
        current.montoTotal += Number(c.total);
        proveedorMap.set(key, current);
      }

      cursor = batch[batch.length - 1].id;
      if (batch.length < BATCH_SIZE) break;
    }

    // Llenar hoja resumen
    let grandTotal = 0;
    let totalCompras = 0;
    for (const p of Array.from(proveedorMap.values()).sort((a, b) => b.montoTotal - a.montoTotal)) {
      grandTotal += p.montoTotal;
      totalCompras += p.totalCompras;
      resumenSheet.addRow(p);
    }
    const totalResumenRow = resumenSheet.addRow({
      proveedor: 'TOTAL GENERAL',
      totalCompras,
      montoTotal: Math.round(grandTotal * 100) / 100,
    });
    totalResumenRow.font = { bold: true };
    for (const col of [4, 5, 6, 7]) {
      resumenSheet.getColumn(col).numFmt = '#,##0.00';
    }
    for (const col of [6, 7, 8, 9]) {
      detalleSheet.getColumn(col).numFmt = '#,##0.00';
    }

    // Stream directo al response
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename=compras_por_proveedor_${fechaInicio}_${fechaFin}.xlsx`,
    });
    await workbook.xlsx.write(res);
    res.end();
  }

  private addResumenProductos(
    workbook: ExcelJS.Workbook,
    productoMap: Map<string, {
      nombre: string;
      codigo: string;
      cantidad: number;
      costoTotal: number;
      compras: number;
    }>,
    fechaInicio: string,
    fechaFin: string,
  ) {
    const sheet = workbook.addWorksheet('Resumen por Producto');

    sheet.addRow([`Periodo: ${fechaInicio} al ${fechaFin}`]);
    sheet.getRow(1).font = { bold: true, size: 12 };
    sheet.addRow([]);

    sheet.addRow(['Producto', 'Codigo', 'Cantidad Total', 'Costo Total', 'Precio Promedio', 'N Compras']);
    sheet.getRow(3).eachCell((cell) => { cell.style = GREEN_HEADER_STYLE; });
    sheet.getRow(3).height = 25;

    sheet.getColumn(1).width = 30;
    sheet.getColumn(2).width = 18;
    sheet.getColumn(3).width = 16;
    sheet.getColumn(4).width = 16;
    sheet.getColumn(5).width = 18;
    sheet.getColumn(6).width = 14;

    const sorted = Array.from(productoMap.values()).sort((a, b) => b.costoTotal - a.costoTotal);
    for (const p of sorted) {
      sheet.addRow([
        p.nombre,
        p.codigo,
        p.cantidad,
        Math.round(p.costoTotal * 100) / 100,
        p.cantidad > 0 ? Math.round((p.costoTotal / p.cantidad) * 100) / 100 : 0,
        p.compras,
      ]);
    }

    sheet.getColumn(4).numFmt = '#,##0.00';
    sheet.getColumn(5).numFmt = '#,##0.00';
  }
}
