import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { StorageService } from '../storage/storage.service';
import {
  Prisma,
  MetodoPagoVenta,
  EntidadTipo,
  CategoriaArchivo,
  FuentePagoCompra,
} from '@prisma/client';
import { aplicarPagoCompra, revertirPagoCompra } from './aplicar-pago-compra.util';

@Injectable()
export class CuentasPorPagarService {
  private readonly logger = new Logger(CuentasPorPagarService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cajaService: CajaService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Sube un comprobante (voucher Yape/Plin/transferencia) a S3 SIN asociarlo
   * todavía a un pago. Devuelve la URL para mandarla en `registrarPago`
   * (flujo "subir al momento de pagar").
   */
  async subirComprobante(empresaId: string, usuarioId: string, file: any) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }
    const archivo = await this.storageService.uploadArchivo({
      empresaId,
      file,
      entidadTipo: EntidadTipo.PAGO_COMPRA,
      categoria: CategoriaArchivo.EVIDENCIA,
      subidoPor: usuarioId,
    });
    return { archivoId: archivo.id, url: archivo.url };
  }

  /**
   * Sube y ADJUNTA un comprobante a un pago YA registrado (flujo del ícono en
   * el historial). Valida que el pago pertenezca a una compra de la empresa.
   */
  async adjuntarComprobantePago(
    empresaId: string,
    pagoId: string,
    usuarioId: string,
    file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No se proporcionó ningún archivo');
    }
    const pago = await this.prisma.pagoCompra.findFirst({
      where: { id: pagoId, compra: { empresaId } },
      select: { id: true },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');

    const archivo = await this.storageService.uploadArchivo({
      empresaId,
      file,
      entidadTipo: EntidadTipo.PAGO_COMPRA,
      entidadId: pagoId,
      categoria: CategoriaArchivo.EVIDENCIA,
      subidoPor: usuarioId,
    });
    await this.prisma.pagoCompra.update({
      where: { id: pagoId },
      data: { comprobanteUrl: archivo.url },
    });
    return { archivoId: archivo.id, url: archivo.url };
  }

  /**
   * Listar cuentas por pagar (compras a crédito con saldo pendiente)
   */
  async listar(
    empresaId: string,
    filtros?: {
      estado?: 'PENDIENTE' | 'VENCIDA' | 'PAGADA';
      proveedorId?: string;
      sedeId?: string;
      search?: string;
    },
  ) {
    const where: Prisma.CompraWhereInput = {
      empresaId,
      estado: 'CONFIRMADA',
      // En CxP entran las compras que están en el flujo de pagos: crédito y
      // contado-no-pagado-al-confirmar (pagoPendiente=true). El contado pagado
      // al confirmar (pagoPendiente=false) NO aparece.
      pagoPendiente: true,
    };

    if (filtros?.proveedorId) where.proveedorId = filtros.proveedorId;
    // Multi-sede: filtra por la sede de la compra.
    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreProveedor: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const compras = await this.prisma.compra.findMany({
      where,
      include: {
        pagos: { where: { anulado: false } },
        proveedor: {
          include: {
            bancos: { where: { esPrincipal: true }, take: 1 },
          },
        },
        sede: true,
      },
      // La última compra primero.
      //
      // Antes ordenaba por `fechaVencimientoPago: 'asc'` --lo que vence antes,
      // arriba--, y tenía dos problemas: el CONTADO no tiene vencimiento, así
      // que TODAS esas filas caían al fondo con NULLS LAST y sin ningún orden
      // entre ellas; y quien abre esta pantalla casi siempre viene a ver lo que
      // acaba de cargar, no lo que vence primero.
      //
      // La urgencia sigue disponible: para eso está la pestaña "Vencidas".
      // `codigo` desempata porque dos compras del mismo día son del mismo
      // instante para `fechaRecepcion`, y al ser correlativo con ceros
      // (COMPRA-00090) el orden alfabético descendente ES el numérico.
      orderBy: [{ fechaRecepcion: 'desc' }, { codigo: 'desc' }],
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
        proveedorId: c.proveedorId,
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
        // monto a Number (Decimal serializa como string) — consistente con getDetalle.
        pagos: c.pagos.map((p) => ({ ...p, monto: Number(p.monto) })),
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
   * Detalle de una cuenta por pagar: cabecera de la compra + líneas (qué se
   * compró) + historial de pagos con fecha/hora. Para la vista de detalle del
   * app al tocar la card.
   */
  async getDetalle(empresaId: string, compraId: string) {
    const compra = await this.prisma.compra.findFirst({
      where: { id: compraId, empresaId },
      include: {
        detalles: { orderBy: { orden: 'asc' } },
        pagos: { where: { anulado: false }, orderBy: { fechaPago: 'asc' } },
        proveedor: {
          include: { bancos: { where: { esPrincipal: true }, take: 1 } },
        },
        sede: true,
      },
    });

    if (!compra) throw new NotFoundException('Compra no encontrada');

    const totalCompra = Number(compra.total);
    const totalPagado = compra.pagos.reduce((s, p) => s + Number(p.monto), 0);
    const saldoPendiente = Math.round((totalCompra - totalPagado) * 100) / 100;
    const now = new Date();
    const estaVencida = compra.fechaVencimientoPago
      ? compra.fechaVencimientoPago < now
      : false;
    const estaPagada = saldoPendiente <= 0;
    const diasVencimiento = compra.fechaVencimientoPago
      ? Math.ceil(
          (compra.fechaVencimientoPago.getTime() - now.getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : null;

    const bancoPrincipal = compra.proveedor?.bancos?.[0] ?? null;

    return {
      compraId: compra.id,
      codigo: compra.codigo,
      nombreProveedor: compra.nombreProveedor,
      documentoProveedor: compra.documentoProveedor,
      proveedorTelefono: compra.proveedor?.telefono,
      proveedorEmail: compra.proveedor?.email,
      sedeNombre: compra.sede?.nombre,
      moneda: compra.moneda,
      tipoDocumentoProveedor: compra.tipoDocumentoProveedor,
      serieDocumentoProveedor: compra.serieDocumentoProveedor,
      numeroDocumentoProveedor: compra.numeroDocumentoProveedor,
      observaciones: compra.observaciones,
      subtotal: Number(compra.subtotal),
      impuestos: Number(compra.impuestos),
      descuento: Number(compra.descuento),
      totalCompra,
      totalPagado: Math.round(totalPagado * 100) / 100,
      saldoPendiente,
      terminosPago: compra.terminosPago,
      diasCredito: compra.diasCredito,
      fechaCompra: compra.fechaRecepcion,
      fechaVencimiento: compra.fechaVencimientoPago,
      diasVencimiento,
      estado: estaPagada ? 'PAGADA' : estaVencida ? 'VENCIDA' : 'PENDIENTE',
      bancoPrincipal: bancoPrincipal
        ? {
            nombreBanco: bancoPrincipal.nombreBanco,
            tipoCuenta: bancoPrincipal.tipoCuenta,
            numeroCuenta: bancoPrincipal.numeroCuenta,
            cci: bancoPrincipal.cci,
          }
        : null,
      detalles: compra.detalles.map((d) => ({
        id: d.id,
        descripcion: d.descripcion,
        cantidad: d.cantidad,
        precioUnitario: Number(d.precioUnitario),
        subtotal: Number(d.subtotal),
        total: Number(d.total),
        usaUnidadCompra: d.usaUnidadCompra,
        cantidadOriginal:
          d.cantidadOriginal != null ? Number(d.cantidadOriginal) : null,
        unidadOriginalSimbolo: d.unidadOriginalSimbolo,
      })),
      pagos: compra.pagos.map((p) => ({
        id: p.id,
        metodoPago: p.metodoPago,
        monto: Number(p.monto),
        referencia: p.referencia,
        bancoDestino: p.bancoDestino,
        cuentaDestino: p.cuentaDestino,
        comprobanteUrl: p.comprobanteUrl,
        fuente: p.fuente,
        bancoId: p.bancoId,
        fechaPago: p.fechaPago,
      })),
    };
  }

  /**
   * Deuda agrupada por proveedor: una fila por proveedor con saldo pendiente,
   * con su total adeudado, lo vencido y el conteo de compras. Ordenado por
   * deuda descendente. Para la vista "Por proveedor" de CxP.
   */
  async getPorProveedor(empresaId: string) {
    const cuentas = await this.listar(empresaId);

    const map = new Map<
      string,
      {
        proveedorId: string;
        nombreProveedor: string;
        documentoProveedor: string | null;
        totalDeuda: number;
        totalVencido: number;
        cantidadCompras: number;
        cantidadVencidas: number;
        proximoVencimiento: Date | null;
        // Deuda separada por moneda (PEN/USD/...) para no sumar monedas distintas.
        deudaPorMoneda: Record<string, number>;
      }
    >();

    for (const c of cuentas) {
      if (c.estado === 'PAGADA') continue; // solo proveedores con saldo
      const key = c.proveedorId;
      if (!map.has(key)) {
        map.set(key, {
          proveedorId: key,
          nombreProveedor: c.nombreProveedor,
          documentoProveedor: c.documentoProveedor,
          totalDeuda: 0,
          totalVencido: 0,
          cantidadCompras: 0,
          cantidadVencidas: 0,
          proximoVencimiento: null,
          deudaPorMoneda: {},
        });
      }
      const d = map.get(key)!;
      d.totalDeuda += c.saldoPendiente;
      d.cantidadCompras++;
      const moneda = c.moneda || 'PEN';
      d.deudaPorMoneda[moneda] = (d.deudaPorMoneda[moneda] ?? 0) + c.saldoPendiente;
      if (c.estado === 'VENCIDA') {
        d.totalVencido += c.saldoPendiente;
        d.cantidadVencidas++;
      }
      // El vencimiento más próximo (pendiente, no vencido).
      if (
        c.fechaVencimiento &&
        c.estado === 'PENDIENTE' &&
        (!d.proximoVencimiento || c.fechaVencimiento < d.proximoVencimiento)
      ) {
        d.proximoVencimiento = c.fechaVencimiento;
      }
    }

    return Array.from(map.values())
      .map((d) => ({
        ...d,
        totalDeuda: Math.round(d.totalDeuda * 100) / 100,
        totalVencido: Math.round(d.totalVencido * 100) / 100,
        deudaPorMoneda: Object.fromEntries(
          Object.entries(d.deudaPorMoneda).map(([m, v]) => [
            m,
            Math.round(v * 100) / 100,
          ]),
        ),
      }))
      .sort((a, b) => b.totalDeuda - a.totalDeuda);
  }

  /**
   * Resumen de cuentas por pagar
   */
  async getResumen(empresaId: string) {
    const cuentas = await this.listar(empresaId);

    const pendientes = cuentas.filter((c) => c.estado === 'PENDIENTE');
    const vencidas = cuentas.filter((c) => c.estado === 'VENCIDA');

    // Deuda separada por moneda: NUNCA sumar PEN + USD en un mismo total (sería
    // engañoso). El total plano se mantiene para compatibilidad, pero el front
    // debe mostrar el desglose por moneda.
    const porMoneda = (items: typeof cuentas): Record<string, number> => {
      const m: Record<string, number> = {};
      for (const c of items) {
        const mon = c.moneda || 'PEN';
        m[mon] = Math.round(((m[mon] ?? 0) + c.saldoPendiente) * 100) / 100;
      }
      return m;
    };

    return {
      totalPendiente: Math.round(pendientes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100,
      totalVencido: Math.round(vencidas.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100,
      pendientePorMoneda: porMoneda(pendientes),
      vencidoPorMoneda: porMoneda(vencidas),
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
      comprobanteUrl?: string;
      fuente?: FuentePagoCompra;
      bancoId?: string;
    },
  ) {
    // Todo en una transacción: lock + recálculo del saldo + movimiento de la
    // fuente (caja/tesorería/banco) + creación del pago, para que sea atómico.
    return this.prisma.$transaction(async (tx) => {
      // Lock pesimista sobre la fila de la compra (FOR UPDATE).
      const filas = await tx.$queryRaw<
        {
          id: string;
          total: Prisma.Decimal;
          estado: string;
          pagoPendiente: boolean;
          sedeId: string;
          nombreProveedor: string;
          codigo: string;
          moneda: string;
        }[]
      >`SELECT "id", "total", "estado", "pagoPendiente", "sedeId", "nombreProveedor", "codigo", "moneda" FROM "Compra" WHERE "id" = ${compraId} AND "empresaId" = ${empresaId} FOR UPDATE`;

      const compra = filas[0];
      if (!compra) throw new NotFoundException('Compra no encontrada');

      if (compra.estado !== 'CONFIRMADA') {
        throw new BadRequestException(
          'Solo se pueden registrar pagos sobre compras confirmadas',
        );
      }
      if (!compra.pagoPendiente) {
        throw new BadRequestException(
          'Esta compra no está pendiente de pago (ya fue pagada al confirmar)',
        );
      }

      const pagosPrevios = await tx.pagoCompra.findMany({
        where: { compraId, anulado: false },
        select: { monto: true },
      });
      const totalPagado = pagosPrevios.reduce((s, p) => s + Number(p.monto), 0);
      const saldoPendiente = Number(compra.total) - totalPagado;

      if (data.monto > saldoPendiente + 0.001) {
        throw new BadRequestException(
          `El monto (${data.monto}) excede el saldo pendiente (${saldoPendiente.toFixed(2)})`,
        );
      }

      // Nota: NO se apaga `pagoPendiente` al saldar el total. La compra a crédito
      // pagada permanece en CxP como historial (estado PAGADA) — la app Flutter
      // tiene una pestaña "Pagadas" que lo muestra. Las pestañas Pendientes/
      // Vencidas filtran por estado y la excluyen correctamente.
      return aplicarPagoCompra(tx, this.cajaService, {
        empresaId,
        compraId,
        usuarioId,
        sedeId: compra.sedeId,
        nombreProveedor: compra.nombreProveedor,
        codigo: compra.codigo,
        moneda: compra.moneda,
        metodoPago: data.metodoPago,
        monto: data.monto,
        fuente: data.fuente,
        bancoId: data.bancoId,
        referencia: data.referencia,
        bancoDestino: data.bancoDestino,
        cuentaDestino: data.cuentaDestino,
        comprobanteUrl: data.comprobanteUrl,
      });
    });
  }

  /**
   * Anula un pago a proveedor: revierte el egreso (caja/tesorería: marca el
   * movimiento anulado; banco: devuelve el saldo) y marca el pago anulado. El
   * saldo de la compra vuelve a subir (reaparece como pendiente en CxP).
   */
  async anularPago(empresaId: string, pagoId: string, usuarioId: string, motivo?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Lock pesimista de la fila del pago: serializa anulaciones concurrentes
      // del mismo pagoId. Sin esto, dos anulaciones simultáneas leen ambas
      // anulado=false y reembolsan el banco dos veces. El segundo en entrar se
      // bloquea hasta el commit del primero y re-lee anulado=true (Read Committed
      // re-fetchea la última versión tras conceder el lock).
      const locked = await tx.$queryRaw<Array<{ id: string; anulado: boolean }>>`
        SELECT "id", "anulado" FROM "PagoCompra" WHERE "id" = ${pagoId} FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundException('Pago no encontrado');
      if (locked[0].anulado) throw new BadRequestException('Este pago ya fue anulado');

      // Validar tenancy + traer los campos para revertir (ya bajo el lock).
      const pago = await tx.pagoCompra.findFirst({
        where: { id: pagoId, compra: { empresaId } },
        select: {
          id: true,
          monto: true,
          fuente: true,
          bancoId: true,
          movimientoCajaId: true,
          anulado: true,
        },
      });
      if (!pago) throw new NotFoundException('Pago no encontrado');

      // No se toca `pagoPendiente`: la compra nunca sale de CxP por estar pagada
      // (ver registrarPago), así que al anular el saldo simplemente vuelve a subir
      // y reaparece como pendiente/vencida por su estado calculado.
      return revertirPagoCompra(
        tx,
        this.cajaService,
        pago,
        usuarioId,
        motivo?.trim() || 'Anulación de pago',
      );
    });
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
