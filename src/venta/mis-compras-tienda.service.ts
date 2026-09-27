import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, TipoNotificacion } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { ReportarAbonoDto } from './dto/reportar-abono.dto';

/** El día de calendario en Perú (yyyy-MM-dd) de un instante. */
const diaLima = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const r2 = (n: number) => Math.round(n * 100) / 100;

const CUOTA_ABIERTA = ['PENDIENTE', 'PAGADA_PARCIAL', 'VENCIDA'];

export type EstadoCompra = 'PAGADA' | 'CREDITO' | 'VENCIDA' | 'PENDIENTE';

const incluirCompra = {
  pagos: { where: { anulado: false }, select: { monto: true } },
  cuotas: {
    orderBy: { numero: 'asc' as const },
    select: { numero: true, monto: true, montoPagado: true, saldoPendiente: true, fechaVencimiento: true, estado: true, montoMora: true },
  },
  detalles: { select: { productoId: true } },
  clienteEmpresa: { select: { razonSocial: true, nombreComercial: true } },
} satisfies Prisma.VentaInclude;

type VentaCompra = Prisma.VentaGetPayload<{ include: typeof incluirCompra }>;

/**
 * "Mis compras" del comprador en la tienda web: sus ventas en ESA empresa
 * (POS, web, cotización), pagadas y a crédito, con lo que le falta pagar.
 *
 * Acceso (igual que "Mis servicios"): las ventas a su ficha de cliente
 * (`EmpresaPersona`), las de los clientes empresa donde es contacto por DNI,
 * y las que se hicieron con su DNI escrito sin ficha (público general).
 *
 * El saldo sale igual que en Cuentas por cobrar: con cuotas, la suma de sus
 * saldos (capital + interés, sin mora); sin cuotas, total − abonos.
 */
@Injectable()
export class MisComprasTiendaService {
  private readonly logger = new Logger(MisComprasTiendaService.name);

  /** Cuántos pagos en revisión puede tener una compra a la vez (anti spam). */
  static readonly MAX_REPORTES_PENDIENTES = 3;
  /** Capturas por pago: un abono grande puede ir en varios Yape (límite por operación). */
  static readonly MAX_CAPTURAS = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly notificaciones: NotificacionService,
  ) {}

  async empresaIdTienda(subdominio: string): Promise<string> {
    const empresa = await this.prisma.empresa.findFirst({
      where: { subdominio, isActive: true, deletedAt: null, visibleEnMarketplace: true },
      select: { id: true },
    });
    if (!empresa) throw new NotFoundException('Tienda no encontrada');
    return empresa.id;
  }

  /** El filtro de las ventas que ve el comprador, o null si no ve ninguna. */
  private async acceso(empresaId: string, personaId?: string): Promise<Prisma.VentaWhereInput | null> {
    if (!personaId) return null;
    const [ep, persona] = await Promise.all([
      this.prisma.empresaPersona.findFirst({ where: { personaId, empresaId, deletedAt: null }, select: { id: true } }),
      this.prisma.persona.findUnique({ where: { id: personaId }, select: { dni: true } }),
    ]);
    const dni = persona?.dni?.trim();
    const empresasCliente = dni
      ? await this.prisma.clienteEmpresa.findMany({
          where: { empresaId, isActive: true, deletedAt: null, contactos: { some: { dni } } },
          select: { id: true },
        })
      : [];
    const or: Prisma.VentaWhereInput[] = [];
    if (ep) or.push({ clienteId: ep.id });
    if (empresasCliente.length) or.push({ clienteEmpresaId: { in: empresasCliente.map((c) => c.id) } });
    // Venta al público con su DNI tipeado: es suya aunque no tenga ficha.
    if (dni && /^\d{8}$/.test(dni)) or.push({ clienteId: null, clienteEmpresaId: null, documentoCliente: dni });
    return or.length ? { OR: or } : null;
  }

  private where(empresaId: string, acceso: Prisma.VentaWhereInput): Prisma.VentaWhereInput {
    // BORRADOR = carrito que no se cerró; ANULADA = no existe para el cliente.
    return { empresaId, estado: { in: ['CONFIRMADA', 'PAGADA_PARCIAL', 'PAGADA_COMPLETA'] }, AND: [acceso] };
  }

  /** Montos y estado de una venta, con la misma regla de saldo que CxC. */
  private montos(v: VentaCompra, hoy: string) {
    const pagadoAbonos = v.pagos.reduce((s, p) => s + Number(p.monto), 0);
    if (!v.esCredito) {
      const total = Number(v.total);
      const pagada = v.estado === 'PAGADA_COMPLETA';
      const pagado = pagada ? total : Math.min(total, pagadoAbonos);
      return {
        total,
        pagado: r2(pagado),
        saldo: pagada ? 0 : r2(Math.max(0, total - pagado)),
        estado: (pagada || total - pagado <= 0 ? 'PAGADA' : 'PENDIENTE') as EstadoCompra,
        proxima: null as null | { numero: number; saldo: number; fechaVencimiento: Date },
        mora: 0,
      };
    }
    const total = Number(v.totalConInteres ?? v.total);
    const saldo = v.cuotas.length
      ? r2(v.cuotas.reduce((s, c) => s + Number(c.saldoPendiente), 0))
      : r2(total - pagadoAbonos);
    const abierta = v.cuotas.find((c) => CUOTA_ABIERTA.includes(c.estado));
    const vence = abierta?.fechaVencimiento ?? v.fechaVencimientoPago;
    // Un vencimiento es un DÍA: vencida recién desde el día siguiente en Lima.
    const vencida = saldo > 0 && !!vence && diaLima(vence) < hoy;
    return {
      total,
      pagado: r2(Math.max(0, total - Math.max(0, saldo))),
      saldo: Math.max(0, saldo),
      estado: (saldo <= 0 ? 'PAGADA' : vencida ? 'VENCIDA' : 'CREDITO') as EstadoCompra,
      proxima: saldo > 0 && vence
        ? { numero: abierta?.numero ?? 1, saldo: abierta ? r2(Number(abierta.saldoPendiente)) : saldo, fechaVencimiento: vence }
        : null,
      mora: r2(v.cuotas.reduce((s, c) => s + Number(c.montoMora ?? 0), 0)),
    };
  }

  /** Primera foto de cada producto (miniatura). */
  private async fotosProductos(productoIds: string[]) {
    const ids = [...new Set(productoIds)];
    if (!ids.length) return new Map<string, string>();
    const imagenes = await this.prisma.archivo.findMany({
      where: { entidadTipo: 'PRODUCTO', entidadId: { in: ids }, tipoArchivo: 'IMAGEN', isActive: true, deletedAt: null },
      select: { entidadId: true, urlThumbnail: true, url: true },
      orderBy: { orden: 'asc' },
    });
    const mapa = new Map<string, string>();
    for (const img of imagenes) {
      if (img.entidadId && !mapa.has(img.entidadId)) mapa.set(img.entidadId, img.urlThumbnail || img.url);
    }
    return mapa;
  }

  private static nombreEmpresa(ce?: { razonSocial: string; nombreComercial: string | null } | null) {
    return ce ? ce.nombreComercial || ce.razonSocial : null;
  }

  async listar(empresaId: string, personaId: string) {
    const vacio = {
      resumen: { deuda: 0, comprasConDeuda: 0, totalComprado: 0, totalPagado: 0, cantidad: 0, mora: 0, proximoPago: null },
      data: [],
    };
    const acceso = await this.acceso(empresaId, personaId);
    if (!acceso) return vacio;

    const ventas = await this.prisma.venta.findMany({
      where: this.where(empresaId, acceso),
      include: incluirCompra,
      orderBy: [{ fechaVenta: 'desc' }, { codigo: 'desc' }],
      take: 200,
    });
    const hoy = diaLima(new Date());
    const fotos = await this.fotosProductos(
      ventas.flatMap((v) => v.detalles.map((d) => d.productoId).filter((x): x is string => !!x)),
    );

    const data = ventas.map((v) => {
      const m = this.montos(v, hoy);
      return {
        id: v.id,
        codigo: v.codigo,
        fecha: v.fechaVenta,
        esCredito: v.esCredito,
        numeroCuotas: v.numeroCuotas,
        estado: m.estado,
        total: m.total,
        pagado: m.pagado,
        saldo: m.saldo,
        mora: m.mora,
        proximoPago: m.proxima,
        cantidadItems: v.detalles.length,
        fotos: [...new Set(v.detalles.map((d) => (d.productoId ? fotos.get(d.productoId) : undefined)).filter((x): x is string => !!x))].slice(0, 3),
        empresaCliente: MisComprasTiendaService.nombreEmpresa(v.clienteEmpresa),
        clienteEmpresaId: v.clienteEmpresaId,
      };
    });

    const conDeuda = data.filter((c) => c.saldo > 0 && c.esCredito);
    const proximas = conDeuda
      .map((c) => (c.proximoPago ? { ...c.proximoPago, codigo: c.codigo, ventaId: c.id, numeroCuotas: c.numeroCuotas } : null))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => a.fechaVencimiento.getTime() - b.fechaVencimiento.getTime());

    return {
      resumen: {
        deuda: r2(conDeuda.reduce((s, c) => s + c.saldo, 0)),
        comprasConDeuda: conDeuda.length,
        mora: r2(conDeuda.reduce((s, c) => s + c.mora, 0)),
        totalComprado: r2(data.reduce((s, c) => s + c.total, 0)),
        totalPagado: r2(data.reduce((s, c) => s + c.pagado, 0)),
        cantidad: data.length,
        proximoPago: proximas[0] ?? null,
      },
      data,
    };
  }

  async detalle(empresaId: string, personaId: string, ventaId: string) {
    const acceso = await this.acceso(empresaId, personaId);
    const v = acceso
      ? await this.prisma.venta.findFirst({
          where: { id: ventaId, ...this.where(empresaId, acceso) },
          include: {
            ...incluirCompra,
            detalles: {
              select: { productoId: true, descripcion: true, cantidad: true, precioUnitario: true, descuento: true, total: true },
            },
            sede: { select: { nombre: true } },
            comprobante: {
              select: { tipoComprobante: true, serie: true, correlativo: true, sunatPdfUrl: true, anulado: true },
            },
          },
        })
      : null;
    if (!v) throw new NotFoundException('Compra no encontrada');

    const reportes = await this.prisma.reporteAbono.findMany({
      where: { ventaId: v.id, estado: { in: ['PENDIENTE', 'RECHAZADO'] } },
      orderBy: { creadoEn: 'desc' },
      take: 10,
      select: { id: true, monto: true, metodoPago: true, estado: true, motivoRechazo: true, creadoEn: true },
    });
    const pagos = await this.prisma.pagoVenta.findMany({
      where: { ventaId: v.id, anulado: false },
      orderBy: { fechaPago: 'asc' },
      select: { monto: true, metodoPago: true, fechaPago: true, cuotaVenta: { select: { numero: true } } },
    });
    const hoy = diaLima(new Date());
    const m = this.montos(v, hoy);
    const fotos = await this.fotosProductos(v.detalles.map((d) => d.productoId).filter((x): x is string => !!x));
    const comp = v.comprobante && !v.comprobante.anulado ? v.comprobante : null;

    return {
      id: v.id,
      codigo: v.codigo,
      fecha: v.fechaVenta,
      sede: v.sede?.nombre ?? null,
      esCredito: v.esCredito,
      numeroCuotas: v.numeroCuotas,
      estado: m.estado,
      total: m.total,
      pagado: m.pagado,
      saldo: m.saldo,
      mora: m.mora,
      interes: v.esCredito && v.montoInteres ? Number(v.montoInteres) : 0,
      descuento: Number(v.descuento ?? 0),
      proximoPago: m.proxima,
      empresaCliente: MisComprasTiendaService.nombreEmpresa(v.clienteEmpresa),
      clienteEmpresaId: v.clienteEmpresaId,
      comprobante: comp
        ? {
            tipo: comp.tipoComprobante,
            numero: `${comp.serie}-${comp.correlativo}`,
            pdfUrl: comp.sunatPdfUrl,
          }
        : null,
      items: v.detalles.map((d) => ({
        descripcion: d.descripcion,
        cantidad: Number(d.cantidad),
        precioUnitario: r2(Number(d.precioUnitario)),
        descuento: Number(d.descuento ?? 0),
        subtotal: r2(Number(d.total)),
        imagen: d.productoId ? fotos.get(d.productoId) ?? null : null,
      })),
      cuotas: v.cuotas.map((c) => {
        const saldo = r2(Number(c.saldoPendiente));
        const vencida = saldo > 0 && diaLima(c.fechaVencimiento) < hoy;
        return {
          numero: c.numero,
          monto: r2(Number(c.monto)),
          pagado: r2(Number(c.montoPagado)),
          saldo,
          mora: r2(Number(c.montoMora ?? 0)),
          fechaVencimiento: c.fechaVencimiento,
          estado: saldo <= 0 ? 'PAGADA' : vencida ? 'VENCIDA' : Number(c.montoPagado) > 0 ? 'PARCIAL' : 'PENDIENTE',
        };
      }),
      pagos: pagos.map((p) => ({
        monto: r2(Number(p.monto)),
        metodo: p.metodoPago,
        fecha: p.fechaPago,
        cuota: p.cuotaVenta?.numero ?? null,
      })),
      // Lo que reportó y la tienda todavía no aprobó (o rechazó). No descuenta del saldo.
      reportes: reportes.map((r) => ({
        id: r.id,
        monto: r2(Number(r.monto)),
        metodo: r.metodoPago,
        estado: r.estado,
        motivoRechazo: r.motivoRechazo,
        fecha: r.creadoEn,
      })),
      enRevision: r2(reportes.filter((r) => r.estado === 'PENDIENTE').reduce((s, r) => s + Number(r.monto), 0)),
    };
  }

  /**
   * Estado de cuenta de las compras A CRÉDITO de un titular: las personales
   * (`clienteEmpresaId` null) o las de UNA empresa donde es contacto. Nunca
   * mezcla: la deuda de la empresa la paga la empresa. Sale con la forma del
   * estado de cuenta del panel (CxC), para que la web use el mismo PDF.
   */
  async estadoCuenta(empresaId: string, personaId: string, clienteEmpresaId: string | null) {
    const acceso = await this.acceso(empresaId, personaId);
    if (!acceso) throw new NotFoundException('Sin compras en esta tienda');

    const [empresa, persona, ce] = await Promise.all([
      this.prisma.empresa.findUnique({ where: { id: empresaId }, select: { nombre: true, ruc: true } }),
      this.prisma.persona.findUnique({ where: { id: personaId }, select: { nombres: true, apellidos: true, dni: true } }),
      clienteEmpresaId
        ? this.prisma.clienteEmpresa.findFirst({ where: { id: clienteEmpresaId, empresaId }, select: { razonSocial: true, numeroDocumento: true } })
        : Promise.resolve(null),
    ]);
    if (clienteEmpresaId && !ce) throw new NotFoundException('Empresa no encontrada');

    const ventas = await this.prisma.venta.findMany({
      where: {
        ...this.where(empresaId, acceso),
        esCredito: true,
        clienteEmpresaId: clienteEmpresaId ?? null,
      },
      include: {
        ...incluirCompra,
        detalles: { select: { productoId: true, descripcion: true, cantidad: true, precioUnitario: true, total: true } },
      },
      orderBy: [{ fechaVenta: 'desc' }, { codigo: 'desc' }],
      take: 200,
    });
    // Pedir la de una empresa donde NO es contacto da vacío por el acceso: 404.
    if (clienteEmpresaId && !ventas.length) throw new NotFoundException('Sin compras a crédito de esa empresa');

    const hoy = diaLima(new Date());
    const filas = ventas.map((v) => {
      const m = this.montos(v, hoy);
      return {
        ventaId: v.id,
        codigo: v.codigo,
        fechaVenta: v.fechaVenta,
        total: m.total,
        totalPagado: m.pagado,
        saldoPendiente: m.saldo,
        estado: m.estado === 'PAGADA' ? 'PAGADA' : m.estado === 'VENCIDA' ? 'VENCIDA' : 'PENDIENTE',
        fechaVencimiento: m.proxima?.fechaVencimiento ?? v.fechaVencimientoPago,
        diasVencimiento: null,
        numeroCuotas: v.numeroCuotas ?? undefined,
        totalMora: m.mora,
      };
    });
    const abonos = ventas.length
      ? await this.prisma.pagoVenta.findMany({
          where: { anulado: false, ventaId: { in: ventas.map((v) => v.id) } },
          orderBy: { fechaPago: 'desc' },
          take: 300,
          select: { id: true, monto: true, metodoPago: true, fechaPago: true, venta: { select: { codigo: true } } },
        })
      : [];
    const conSaldo = filas.filter((f) => f.saldoPendiente > 0);

    return {
      empresa: { nombre: empresa?.nombre ?? '', ruc: empresa?.ruc ?? null },
      estadoCuenta: {
        cliente: ce
          ? { id: clienteEmpresaId, tipo: 'EMPRESA', nombre: ce.razonSocial, documento: ce.numeroDocumento }
          : {
              id: null,
              tipo: 'PERSONA',
              nombre: [persona?.nombres, persona?.apellidos].filter(Boolean).join(' ') || null,
              documento: persona?.dni ?? null,
            },
        resumen: {
          saldoPendiente: r2(conSaldo.reduce((s, f) => s + f.saldoPendiente, 0)),
          totalVendido: r2(filas.reduce((s, f) => s + f.total, 0)),
          totalAbonado: r2(filas.reduce((s, f) => s + f.totalPagado, 0)),
          totalMora: r2(filas.reduce((s, f) => s + f.totalMora, 0)),
          cantidadVentas: filas.length,
          ventasConSaldo: conSaldo.length,
        },
        ventas: filas,
        abonos: abonos.map((a) => ({
          id: a.id,
          monto: r2(Number(a.monto)),
          metodoPago: a.metodoPago,
          // A dónde entró la plata (caja/banco) es interno de la tienda.
          fuente: null,
          fechaPago: a.fechaPago,
          ventaCodigo: a.venta?.codigo ?? null,
        })),
      },
      // Las líneas de cada venta, por ventaId (el PDF las cuelga de su fila).
      detalles: Object.fromEntries(
        ventas.map((v) => [
          v.id,
          v.detalles.map((d) => ({
            descripcion: d.descripcion,
            cantidad: Number(d.cantidad),
            precioUnitario: r2(Number(d.precioUnitario)),
            total: r2(Number(d.total)),
          })),
        ]),
      ),
    };
  }

  /** Cómo pagarle a la tienda: sus QR de Yape/Plin y sus cuentas activas en soles. */
  async mediosPago(empresaId: string) {
    const [cfg, cuentas] = await Promise.all([
      this.prisma.configuracionEmpresa.findUnique({ where: { empresaId }, select: { qrYapeUrl: true, qrPlinUrl: true } }),
      this.prisma.empresaBanco.findMany({
        where: { empresaId, isActive: true, moneda: 'PEN' },
        orderBy: [{ esPrincipal: 'desc' }, { creadoEn: 'asc' }],
        select: { id: true, nombreBanco: true, tipoCuenta: true, numeroCuenta: true, cci: true, titular: true },
      }),
    ]);
    return {
      qrYapeUrl: cfg?.qrYapeUrl ?? null,
      qrPlinUrl: cfg?.qrPlinUrl ?? null,
      cuentas: cuentas.map((c) => ({
        id: c.id,
        banco: c.nombreBanco,
        tipoCuenta: c.tipoCuenta,
        numero: c.numeroCuenta,
        cci: c.cci,
        titular: c.titular,
      })),
    };
  }

  /**
   * El cliente reporta que pagó (con la captura). Queda PENDIENTE: no toca el
   * saldo hasta que la tienda lo apruebe en Cuentas por cobrar.
   */
  async reportarAbono(
    empresaId: string,
    personaId: string,
    usuarioId: string,
    ventaId: string,
    dto: ReportarAbonoDto,
    files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Adjunta la captura de tu pago');
    if (files.length > MisComprasTiendaService.MAX_CAPTURAS) {
      throw new BadRequestException(`Puedes subir hasta ${MisComprasTiendaService.MAX_CAPTURAS} capturas por pago`);
    }
    const acceso = await this.acceso(empresaId, personaId);
    const v = acceso
      ? await this.prisma.venta.findFirst({ where: { id: ventaId, ...this.where(empresaId, acceso) }, include: incluirCompra })
      : null;
    if (!v) throw new NotFoundException('Compra no encontrada');
    if (!v.esCredito) throw new BadRequestException('Esta compra no es a crédito');

    const m = this.montos(v, diaLima(new Date()));
    const pendientes = await this.prisma.reporteAbono.findMany({
      where: { ventaId: v.id, estado: 'PENDIENTE' },
      select: { monto: true },
    });
    if (pendientes.length >= MisComprasTiendaService.MAX_REPORTES_PENDIENTES) {
      throw new BadRequestException('Ya tienes pagos en revisión para esta compra. Espera a que la tienda los confirme.');
    }
    const enRevision = pendientes.reduce((s, p) => s + Number(p.monto), 0);
    const disponible = r2(m.saldo - enRevision);
    if (disponible <= 0) {
      throw new BadRequestException(m.saldo <= 0 ? 'Esta compra ya está pagada' : 'Tu saldo ya está cubierto por pagos en revisión');
    }
    const monto = r2(dto.monto);
    if (monto > disponible) {
      throw new BadRequestException(`El monto no puede ser mayor a S/ ${disponible.toFixed(2)}`);
    }

    let empresaBancoId: string | null = null;
    if (dto.metodoPago === 'TRANSFERENCIA') {
      const cuenta = dto.empresaBancoId
        ? await this.prisma.empresaBanco.findFirst({
            where: { id: dto.empresaBancoId, empresaId, isActive: true },
            select: { id: true },
          })
        : null;
      if (!cuenta) throw new BadRequestException('Elige la cuenta a la que transferiste');
      empresaBancoId = cuenta.id;
    }

    // Las capturas se guardan ligadas al REPORTE, no a la venta: así no
    // aparecen en la galería de fotos de la venta (ni las de un pago rechazado).
    const id = randomUUID();
    const urls: string[] = [];
    for (const [i, file] of files.entries()) {
      const archivo = await this.storage.uploadArchivo({
        file,
        empresaId,
        entidadTipo: 'VENTA',
        entidadId: id,
        categoria: 'DOCUMENTO',
        orden: i,
        subidoPor: usuarioId,
      });
      urls.push(archivo.url);
    }

    const reporte = await this.prisma.reporteAbono.create({
      data: {
        id,
        empresaId,
        ventaId: v.id,
        personaId,
        usuarioId,
        monto,
        metodoPago: dto.metodoPago,
        numeroOperacion: dto.numeroOperacion?.trim() || null,
        comprobanteUrl: urls[0],
        comprobantesUrls: urls,
        empresaBancoId,
      },
      select: { id: true, monto: true, metodoPago: true, estado: true, creadoEn: true },
    });

    try {
      const admins = await this.prisma.empresaUsuarioRol.findMany({
        where: { empresaId, isActive: true, rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'CAJERO'] } },
        select: { usuarioId: true },
      });
      const ids = [...new Set(admins.map((a) => a.usuarioId))];
      if (ids.length) {
        await this.notificaciones.enviarAUsuarios(
          ids,
          'Pago reportado por un cliente',
          `${v.nombreCliente} reportó un abono de S/ ${monto.toFixed(2)} a la venta ${v.codigo}. Revísalo en Cuentas por cobrar.`,
          { tipo: TipoNotificacion.SISTEMA, empresaId, data: { reporteAbonoId: reporte.id, ventaId: v.id } },
        );
      }
    } catch (e) {
      this.logger.warn(`No se pudo avisar del reporte ${reporte.id}: ${(e as Error).message}`);
    }

    return { ...reporte, monto: Number(reporte.monto) };
  }
}
