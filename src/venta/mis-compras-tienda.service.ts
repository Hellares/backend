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
  /** Capturas por pago: Yape topa S/ 500 por operación y S/ 2,000 al día → hasta 4 Yape en un abono. */
  static readonly MAX_CAPTURAS = 4;

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

  /**
   * Los titulares por los que puede pagar: su ficha de cliente (lo personal)
   * y los clientes empresa donde es contacto. Un depósito va a UNO de ellos.
   */
  private async titulares(empresaId: string, personaId?: string) {
    if (!personaId) return { epId: null as string | null, empresas: [] as { id: string; nombre: string }[] };
    const [ep, persona] = await Promise.all([
      this.prisma.empresaPersona.findFirst({ where: { personaId, empresaId, deletedAt: null }, select: { id: true } }),
      this.prisma.persona.findUnique({ where: { id: personaId }, select: { dni: true } }),
    ]);
    const dni = persona?.dni?.trim();
    const empresas = dni
      ? await this.prisma.clienteEmpresa.findMany({
          where: { empresaId, isActive: true, deletedAt: null, contactos: { some: { dni } } },
          select: { id: true, razonSocial: true, nombreComercial: true },
        })
      : [];
    return {
      epId: ep?.id ?? null,
      empresas: empresas.map((e) => ({ id: e.id, nombre: e.nombreComercial || e.razonSocial })),
    };
  }

  /**
   * Saldo a favor y depósitos en revisión, por titular (`''` = lo personal).
   * A favor = lo depositado que la tienda todavía no aplicó a ninguna compra.
   */
  private async saldosAFavor(empresaId: string, personaId: string) {
    const t = await this.titulares(empresaId, personaId);
    const filtros: Prisma.DepositoClienteWhereInput[] = [];
    if (t.epId) filtros.push({ clienteId: t.epId });
    if (t.empresas.length) filtros.push({ clienteEmpresaId: { in: t.empresas.map((e) => e.id) } });
    const [depositos, enRevision] = await Promise.all([
      filtros.length
        ? this.prisma.depositoCliente.findMany({
            where: { empresaId, anulado: false, OR: filtros },
            select: { clienteEmpresaId: true, monto: true, montoAplicado: true },
          })
        : [],
      this.prisma.reporteAbono.findMany({
        where: { empresaId, personaId, estado: 'PENDIENTE', lineas: { none: {} } },
        select: { clienteEmpresaId: true, monto: true },
      }),
    ]);
    const mapa = new Map<string, { aFavor: number; enRevision: number }>();
    const de = (k: string) => {
      if (!mapa.has(k)) mapa.set(k, { aFavor: 0, enRevision: 0 });
      return mapa.get(k)!;
    };
    for (const d of depositos) {
      const x = de(d.clienteEmpresaId ?? '');
      x.aFavor = r2(x.aFavor + Number(d.monto) - Number(d.montoAplicado));
    }
    for (const r of enRevision) {
      const x = de(r.clienteEmpresaId ?? '');
      x.enRevision = r2(x.enRevision + Number(r.monto));
    }
    return { titulares: t, mapa };
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
      resumen: {
        deuda: 0, comprasConDeuda: 0, totalComprado: 0, totalPagado: 0, cantidad: 0, mora: 0, proximoPago: null,
        saldoAFavor: 0, depositosEnRevision: 0,
      },
      saldos: [],
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

    const revision = await this.enRevisionPorVenta(ventas.map((v) => v.id));

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
        // Lo que ya reportó y espera aprobación: no se puede volver a pagar.
        enRevision: revision.get(v.id)?.monto ?? 0,
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

    // Saldo a favor por titular (lo personal y cada empresa, sin mezclar),
    // junto a lo que ese titular todavía debe.
    const { titulares, mapa } = await this.saldosAFavor(empresaId, personaId);
    const deudaDe = (clienteEmpresaId: string | null) =>
      r2(conDeuda.filter((c) => (c.clienteEmpresaId ?? null) === clienteEmpresaId).reduce((s, c) => s + c.saldo, 0));
    const saldos = [
      { clienteEmpresaId: null as string | null, nombre: null as string | null },
      ...titulares.empresas.map((e) => ({ clienteEmpresaId: e.id as string | null, nombre: e.nombre as string | null })),
    ]
      .map((t) => {
        const s = mapa.get(t.clienteEmpresaId ?? '');
        return {
          ...t,
          saldoAFavor: Math.max(0, s?.aFavor ?? 0),
          enRevision: s?.enRevision ?? 0,
          deuda: deudaDe(t.clienteEmpresaId),
          // Lo personal solo admite depósito si tiene ficha de cliente.
          puedeDepositar: t.clienteEmpresaId ? true : !!titulares.epId,
        };
      })
      .filter((s) => s.saldoAFavor > 0 || s.enRevision > 0 || s.deuda > 0);

    return {
      saldos,
      resumen: {
        saldoAFavor: r2(saldos.reduce((s, x) => s + x.saldoAFavor, 0)),
        depositosEnRevision: r2(saldos.reduce((s, x) => s + x.enRevision, 0)),
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

    // Su parte de cada pago reportado (un pago puede cubrir varias compras).
    const lineasReporte = await this.prisma.reporteAbonoVenta.findMany({
      where: { ventaId: v.id, reporte: { estado: { in: ['PENDIENTE', 'RECHAZADO'] } } },
      orderBy: { reporte: { creadoEn: 'desc' } },
      take: 10,
      select: {
        monto: true,
        reporte: {
          select: {
            id: true, monto: true, metodoPago: true, estado: true, motivoRechazo: true, creadoEn: true,
            _count: { select: { lineas: true } },
          },
        },
      },
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
      reportes: lineasReporte.map((l) => ({
        id: l.reporte.id,
        // Lo que va a ESTA compra; el pago completo pudo cubrir otras.
        monto: r2(Number(l.monto)),
        pagoTotal: r2(Number(l.reporte.monto)),
        compras: l.reporte._count.lineas,
        metodo: l.reporte.metodoPago,
        estado: l.reporte.estado,
        motivoRechazo: l.reporte.motivoRechazo,
        fecha: l.reporte.creadoEn,
      })),
      enRevision: r2(
        lineasReporte.filter((l) => l.reporte.estado === 'PENDIENTE').reduce((s, l) => s + Number(l.monto), 0),
      ),
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

    // Sus depósitos sin repartir: lo que tiene a favor en ESTA cuenta.
    const tit = await this.titulares(empresaId, personaId);
    const depositos = clienteEmpresaId || tit.epId
      ? await this.prisma.depositoCliente.findMany({
          where: {
            empresaId,
            anulado: false,
            ...(clienteEmpresaId ? { clienteEmpresaId } : { clienteId: tit.epId }),
          },
          orderBy: { creadoEn: 'desc' },
          take: 100,
          select: { id: true, monto: true, montoAplicado: true, metodoPago: true, creadoEn: true },
        })
      : [];
    const saldoAFavor = Math.max(
      0,
      r2(depositos.reduce((s, d) => s + Number(d.monto) - Number(d.montoAplicado), 0)),
    );

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
          saldoAFavor,
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
        depositos: depositos.map((d) => ({
          id: d.id,
          monto: r2(Number(d.monto)),
          aplicado: r2(Number(d.montoAplicado)),
          disponible: r2(Number(d.monto) - Number(d.montoAplicado)),
          metodoPago: d.metodoPago,
          fecha: d.creadoEn,
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

  /** Por venta: cuánto hay en pagos reportados PENDIENTES y en cuántos. */
  private async enRevisionPorVenta(ventaIds: string[]) {
    const mapa = new Map<string, { monto: number; pagos: number }>();
    if (!ventaIds.length) return mapa;
    const lineas = await this.prisma.reporteAbonoVenta.findMany({
      where: { ventaId: { in: ventaIds }, reporte: { estado: 'PENDIENTE' } },
      select: { ventaId: true, monto: true },
    });
    for (const l of lineas) {
      const d = mapa.get(l.ventaId) ?? { monto: 0, pagos: 0 };
      mapa.set(l.ventaId, { monto: r2(d.monto + Number(l.monto)), pagos: d.pagos + 1 });
    }
    return mapa;
  }

  /** La cuenta de la tienda a la que dice haber transferido (solo TRANSFERENCIA). */
  private async cuentaTransferida(empresaId: string, dto: ReportarAbonoDto): Promise<string | null> {
    if (dto.metodoPago !== 'TRANSFERENCIA') return null;
    const cuenta = dto.empresaBancoId
      ? await this.prisma.empresaBanco.findFirst({
          where: { id: dto.empresaBancoId, empresaId, isActive: true },
          select: { id: true },
        })
      : null;
    if (!cuenta) throw new BadRequestException('Elige la cuenta a la que transferiste');
    return cuenta.id;
  }

  /**
   * Las capturas se guardan ligadas al REPORTE, no a la venta: así no aparecen
   * en la galería de fotos de la venta (ni las de un pago rechazado).
   */
  private async subirCapturas(empresaId: string, reporteId: string, usuarioId: string, files: Express.Multer.File[]) {
    const urls: string[] = [];
    for (const [i, file] of files.entries()) {
      const archivo = await this.storage.uploadArchivo({
        file,
        empresaId,
        entidadTipo: 'VENTA',
        entidadId: reporteId,
        categoria: 'DOCUMENTO',
        orden: i,
        subidoPor: usuarioId,
      });
      urls.push(archivo.url);
    }
    return urls;
  }

  private async avisarAdmins(empresaId: string, reporteId: string, texto: string) {
    try {
      const admins = await this.prisma.empresaUsuarioRol.findMany({
        where: { empresaId, isActive: true, rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'CAJERO'] } },
        select: { usuarioId: true },
      });
      const destinatarios = [...new Set(admins.map((a) => a.usuarioId))];
      if (destinatarios.length) {
        await this.notificaciones.enviarAUsuarios(destinatarios, 'Pago reportado por un cliente', texto, {
          tipo: TipoNotificacion.SISTEMA,
          empresaId,
          data: { reporteAbonoId: reporteId },
        });
      }
    } catch (e) {
      this.logger.warn(`No se pudo avisar del reporte ${reporteId}: ${(e as Error).message}`);
    }
  }

  /**
   * El cliente depositó SIN decir qué paga (transfirió S/ 4,000 contra una
   * deuda repartida en varias compras). Queda PENDIENTE con su titular; al
   * aprobarlo la tienda lo reparte y lo que sobre queda a su favor.
   */
  private async reportarDeposito(
    empresaId: string,
    personaId: string,
    usuarioId: string,
    dto: ReportarAbonoDto,
    files: Express.Multer.File[],
  ) {
    const monto = r2(Number(dto.monto));
    if (!(monto > 0)) throw new BadRequestException('Indica cuánto depositaste');

    const t = await this.titulares(empresaId, personaId);
    const clienteEmpresaId = dto.clienteEmpresaId?.trim() || null;
    const empresaCliente = clienteEmpresaId ? t.empresas.find((e) => e.id === clienteEmpresaId) : null;
    if (clienteEmpresaId && !empresaCliente) throw new NotFoundException('Empresa no encontrada');
    if (!clienteEmpresaId && !t.epId) {
      throw new BadRequestException('Elige a qué compras va tu pago: aún no tienes una cuenta de cliente en esta tienda');
    }

    const enRevision = await this.prisma.reporteAbono.count({
      where: { empresaId, personaId, estado: 'PENDIENTE', lineas: { none: {} } },
    });
    if (enRevision >= MisComprasTiendaService.MAX_REPORTES_PENDIENTES) {
      throw new BadRequestException('Ya tienes depósitos en revisión. Espera a que la tienda los confirme.');
    }

    const empresaBancoId = await this.cuentaTransferida(empresaId, dto);
    const id = randomUUID();
    const urls = await this.subirCapturas(empresaId, id, usuarioId, files);

    const reporte = await this.prisma.reporteAbono.create({
      data: {
        id,
        empresaId,
        personaId,
        usuarioId,
        monto,
        metodoPago: dto.metodoPago,
        numeroOperacion: dto.numeroOperacion?.trim() || null,
        comprobanteUrl: urls[0],
        comprobantesUrls: urls,
        empresaBancoId,
        clienteId: clienteEmpresaId ? null : t.epId,
        clienteEmpresaId,
      },
      select: { id: true, monto: true, metodoPago: true, estado: true, creadoEn: true },
    });

    const persona = await this.prisma.persona.findUnique({
      where: { id: personaId },
      select: { nombres: true, apellidos: true },
    });
    const quien = empresaCliente?.nombre || [persona?.nombres, persona?.apellidos].filter(Boolean).join(' ') || 'Un cliente';
    await this.avisarAdmins(
      empresaId,
      reporte.id,
      `${quien} reportó un depósito de S/ ${monto.toFixed(2)} sin indicar compras. Apruébalo y repártelo en Cuentas por cobrar.`,
    );

    return { ...reporte, monto: Number(reporte.monto), compras: 0, esDeposito: true };
  }

  /**
   * El cliente reporta que pagó (con las capturas) y a qué compras va: una o
   * varias del MISMO titular (personal, o una empresa), con cuánto a cada una.
   * Queda PENDIENTE: no toca saldos hasta que la tienda lo apruebe.
   */
  async reportarAbono(
    empresaId: string,
    personaId: string,
    usuarioId: string,
    dto: ReportarAbonoDto,
    files: Express.Multer.File[],
  ) {
    if (!files?.length) throw new BadRequestException('Adjunta la captura de tu pago');
    if (files.length > MisComprasTiendaService.MAX_CAPTURAS) {
      throw new BadRequestException(`Puedes subir hasta ${MisComprasTiendaService.MAX_CAPTURAS} capturas por pago`);
    }
    const lineas = dto.lineas ?? [];
    // Sin compras elegidas es un depósito: la tienda decide a qué va.
    if (!lineas.length) return this.reportarDeposito(empresaId, personaId, usuarioId, dto, files);
    const ids = lineas.map((l) => l.ventaId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Una compra aparece dos veces');

    const acceso = await this.acceso(empresaId, personaId);
    const ventas = acceso
      ? await this.prisma.venta.findMany({ where: { id: { in: ids }, ...this.where(empresaId, acceso) }, include: incluirCompra })
      : [];
    if (ventas.length !== ids.length) throw new NotFoundException('Compra no encontrada');
    if (ventas.some((v) => !v.esCredito)) throw new BadRequestException('Solo se abona a compras a crédito');
    // Personal y cada empresa se pagan por separado: la deuda de la empresa es de la empresa.
    if (new Set(ventas.map((v) => v.clienteEmpresaId ?? '')).size > 1) {
      throw new BadRequestException('No mezcles compras personales con las de una empresa en el mismo pago');
    }

    const hoy = diaLima(new Date());
    const revision = await this.enRevisionPorVenta(ids);
    const porId = new Map(ventas.map((v) => [v.id, v]));
    const aRegistrar = lineas.map((l) => {
      const v = porId.get(l.ventaId)!;
      const enRev = revision.get(v.id);
      if ((enRev?.pagos ?? 0) >= MisComprasTiendaService.MAX_REPORTES_PENDIENTES) {
        throw new BadRequestException(`${v.codigo} ya tiene pagos en revisión. Espera a que la tienda los confirme.`);
      }
      const disponible = r2(this.montos(v, hoy).saldo - (enRev?.monto ?? 0));
      const monto = r2(l.monto);
      if (disponible <= 0) throw new BadRequestException(`${v.codigo} ya está pagada o cubierta por pagos en revisión`);
      if (monto > disponible) {
        throw new BadRequestException(`A ${v.codigo} le puedes pagar hasta S/ ${disponible.toFixed(2)}`);
      }
      return { ventaId: v.id, codigo: v.codigo, monto };
    });
    const total = r2(aRegistrar.reduce((s, l) => s + l.monto, 0));

    const empresaBancoId = await this.cuentaTransferida(empresaId, dto);
    const id = randomUUID();
    const urls = await this.subirCapturas(empresaId, id, usuarioId, files);

    const reporte = await this.prisma.reporteAbono.create({
      data: {
        id,
        empresaId,
        personaId,
        usuarioId,
        monto: total,
        metodoPago: dto.metodoPago,
        numeroOperacion: dto.numeroOperacion?.trim() || null,
        comprobanteUrl: urls[0],
        comprobantesUrls: urls,
        empresaBancoId,
        lineas: { create: aRegistrar.map((l) => ({ ventaId: l.ventaId, monto: l.monto })) },
      },
      select: { id: true, monto: true, metodoPago: true, estado: true, creadoEn: true },
    });

    const a = aRegistrar.length === 1 ? `a la venta ${aRegistrar[0].codigo}` : `a ${aRegistrar.length} ventas`;
    await this.avisarAdmins(
      empresaId,
      reporte.id,
      `${ventas[0].nombreCliente} reportó un pago de S/ ${total.toFixed(2)} ${a}. Revísalo en Cuentas por cobrar.`,
    );

    return { ...reporte, monto: Number(reporte.monto), compras: aRegistrar.length };
  }
}
