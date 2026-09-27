import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
    };
  }
}
