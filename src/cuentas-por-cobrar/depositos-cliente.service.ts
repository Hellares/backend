import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CategoriaMovimientoCaja, FuenteIngreso, MetodoPagoVenta, OrigenDepositoCliente, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CajaService } from '../caja/caja.service';
import { aplicarIngresoConFuente, revertirIngresoConFuente } from '../caja/aplicar-ingreso-fuente.util';
import { CuentasPorCobrarService } from './cuentas-por-cobrar.service';
import { moraVigenteCuota } from './imputar-abono-cuotas.util';

const r2 = (n: number) => Math.round(n * 100) / 100;

const CUOTA_ABIERTA = ['PENDIENTE', 'PAGADA_PARCIAL', 'VENCIDA'] as const;
const VENTA_CON_DEUDA = ['CONFIRMADA', 'PAGADA_PARCIAL'] as const;

/** El titular: la ficha de cliente (persona) O el cliente empresa. */
export interface TitularDeposito {
  clienteId?: string | null;
  clienteEmpresaId?: string | null;
}

export interface LineaReparto {
  ventaId: string;
  monto: number;
}

export interface RegistrarDepositoInput extends TitularDeposito {
  monto: number;
  metodoPago: MetodoPagoVenta;
  referencia?: string;
  fuente?: FuenteIngreso;
  bancoId?: string;
  sedeId?: string;
  nota?: string;
  /** Repartir en el mismo acto (opcional): sale de este depósito más el saldo a favor previo. */
  lineas?: LineaReparto[];
}

/**
 * Depósitos del cliente SIN repartir y su saldo a favor.
 *
 * El caso: el cliente debe S/ 5,000 en varias ventas y transfiere S/ 4,000 sin
 * decir qué paga. La plata entra UNA vez (acá) y después la tienda la reparte
 * entre las ventas. Lo que no alcanza para nada —o lo que sobra si pagó de
 * más— queda como saldo a favor = Σ (monto − montoAplicado) de sus depósitos.
 *
 * Repartir crea un abono normal por venta (`registrarAbonoEnTx`: cuotas,
 * estado), pero sin ingreso propio. Todo el reparto va en UNA transacción: o
 * entran todas las líneas o ninguna.
 */
@Injectable()
export class DepositosClienteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cajaService: CajaService,
    private readonly cxc: CuentasPorCobrarService,
  ) {}

  /** Valida que venga UN titular y que sea de la empresa. Devuelve su nombre. */
  private async titular(
    db: Prisma.TransactionClient | PrismaService,
    empresaId: string,
    t: TitularDeposito,
  ): Promise<{ clienteId: string | null; clienteEmpresaId: string | null; nombre: string }> {
    const clienteId = t.clienteId || null;
    const clienteEmpresaId = t.clienteEmpresaId || null;
    if (!!clienteId === !!clienteEmpresaId) {
      throw new BadRequestException('Indica el cliente (persona o empresa) del depósito');
    }
    if (clienteEmpresaId) {
      const ce = await db.clienteEmpresa.findFirst({
        where: { id: clienteEmpresaId, empresaId },
        select: { razonSocial: true },
      });
      if (!ce) throw new NotFoundException('Cliente no encontrado');
      return { clienteId: null, clienteEmpresaId, nombre: ce.razonSocial };
    }
    const ep = await db.empresaPersona.findFirst({
      where: { id: clienteId!, empresaId },
      select: { persona: { select: { nombres: true, apellidos: true } } },
    });
    if (!ep) throw new NotFoundException('Cliente no encontrado');
    return {
      clienteId,
      clienteEmpresaId: null,
      nombre: [ep.persona?.nombres, ep.persona?.apellidos].filter(Boolean).join(' ') || 'Cliente',
    };
  }

  private static whereTitular(t: { clienteId: string | null; clienteEmpresaId: string | null }) {
    return t.clienteEmpresaId ? { clienteEmpresaId: t.clienteEmpresaId } : { clienteId: t.clienteId };
  }

  /** La sede a cuya caja entra: la indicada, la de su última venta a crédito o la primera de la empresa. */
  private async sedeDelDeposito(
    db: Prisma.TransactionClient,
    empresaId: string,
    t: { clienteId: string | null; clienteEmpresaId: string | null },
    sedeId?: string,
  ): Promise<string> {
    if (sedeId) {
      const sede = await db.sede.findFirst({ where: { id: sedeId, empresaId }, select: { id: true } });
      if (!sede) throw new BadRequestException('Sede no encontrada');
      return sede.id;
    }
    const venta = await db.venta.findFirst({
      where: { empresaId, esCredito: true, sedeId: { not: null }, ...DepositosClienteService.whereTitular(t) },
      orderBy: { fechaVenta: 'desc' },
      select: { sedeId: true },
    });
    if (venta?.sedeId) return venta.sedeId;
    const sede = await db.sede.findFirst({ where: { empresaId }, select: { id: true } });
    if (!sede) throw new BadRequestException('La empresa no tiene una sede para registrar el depósito');
    return sede.id;
  }

  /**
   * Registra el depósito: ingresa la plata a banco/caja y, si vienen líneas,
   * lo reparte en el mismo acto.
   */
  async registrar(
    empresaId: string,
    usuarioId: string,
    input: RegistrarDepositoInput,
    extra?: { origen?: OrigenDepositoCliente; reporteAbonoId?: string },
  ) {
    const monto = r2(Number(input.monto));
    if (!(monto > 0)) throw new BadRequestException('El monto del depósito debe ser mayor a 0');

    return this.prisma.$transaction(
      async (tx) => {
        const t = await this.titular(tx, empresaId, input);
        const sedeId = await this.sedeDelDeposito(tx, empresaId, t, input.sedeId);
        const ingreso = await aplicarIngresoConFuente(tx, this.cajaService, {
          empresaId,
          sedeId,
          usuarioId,
          metodoPago: input.metodoPago,
          monto,
          moneda: 'PEN',
          fuente: input.fuente,
          bancoId: input.bancoId,
          categoria: CategoriaMovimientoCaja.VENTA,
          descripcion: `Depósito de cliente ${t.nombre}`,
        });
        const deposito = await tx.depositoCliente.create({
          data: {
            empresaId,
            sedeId,
            clienteId: t.clienteId,
            clienteEmpresaId: t.clienteEmpresaId,
            monto,
            metodoPago: input.metodoPago,
            referencia: input.referencia?.trim() || null,
            fuente: ingreso.fuente,
            bancoId: ingreso.bancoId,
            movimientoCajaId: ingreso.movimientoCajaId,
            origen: extra?.origen ?? OrigenDepositoCliente.PANEL,
            reporteAbonoId: extra?.reporteAbonoId ?? null,
            nota: input.nota?.trim().slice(0, 300) || null,
            registradoPorId: usuarioId,
          },
        });
        // El reparto sale del saldo a favor COMPLETO: este depósito más lo
        // que le hubiera quedado de los anteriores.
        const aplicado = input.lineas?.length
          ? await this.aplicarSaldoEnTx(tx, empresaId, t, usuarioId, input.lineas)
          : null;
        return {
          ok: true,
          depositoId: deposito.id,
          monto,
          aplicado: aplicado?.aplicado ?? 0,
          abonos: aplicado?.abonos ?? [],
        };
      },
      { timeout: 20000 },
    );
  }

  /**
   * Reparte el SALDO A FAVOR del cliente entre sus ventas. El saldo puede
   * estar en varios depósitos (los S/ 20 que sobraron del anterior + el de
   * hoy): se consumen del más viejo al más nuevo, así que una venta puede
   * recibir su monto en más de un abono.
   */
  async aplicarSaldo(empresaId: string, tIn: TitularDeposito, usuarioId: string, lineas: LineaReparto[]) {
    if (!lineas?.length) throw new BadRequestException('Elige a qué ventas va el saldo');
    return this.prisma.$transaction(
      async (tx) => {
        const t = await this.titular(tx, empresaId, tIn);
        const res = await this.aplicarSaldoEnTx(tx, empresaId, t, usuarioId, lineas);
        return { ok: true, aplicado: res.aplicado, saldoAFavor: res.saldoAFavor, abonos: res.abonos };
      },
      { timeout: 20000 },
    );
  }

  private async aplicarSaldoEnTx(
    tx: Prisma.TransactionClient,
    empresaId: string,
    t: { clienteId: string | null; clienteEmpresaId: string | null },
    usuarioId: string,
    lineasIn: LineaReparto[],
  ) {
    const lineas = lineasIn.map((l) => ({ ventaId: l.ventaId, monto: r2(Number(l.monto)) }));
    if (lineas.some((l) => !(l.monto > 0))) throw new BadRequestException('Cada monto debe ser mayor a 0');
    const ids = lineas.map((l) => l.ventaId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Una venta aparece dos veces');

    // Lock de los depósitos del cliente: dos repartos a la vez no gastan el
    // mismo saldo. El filtro por titular va después, ya con las filas tomadas.
    const candidatos = await tx.depositoCliente.findMany({
      where: { empresaId, anulado: false, ...DepositosClienteService.whereTitular(t) },
      select: { id: true },
    });
    if (candidatos.length) {
      await tx.$queryRaw`SELECT "id" FROM "DepositoCliente" WHERE "id" IN (${Prisma.join(candidatos.map((c) => c.id))}) FOR UPDATE`;
    }
    const depositos = (
      await tx.depositoCliente.findMany({
        where: { empresaId, anulado: false, ...DepositosClienteService.whereTitular(t) },
        orderBy: { creadoEn: 'asc' },
      })
    )
      .map((d) => ({ d, disponible: r2(Number(d.monto) - Number(d.montoAplicado)), usado: 0 }))
      .filter((x) => x.disponible > 0);

    const disponible = r2(depositos.reduce((s, x) => s + x.disponible, 0));
    const total = r2(lineas.reduce((s, l) => s + l.monto, 0));
    if (total > disponible + 0.001) {
      throw new BadRequestException(
        `El reparto (S/ ${total.toFixed(2)}) supera el saldo a favor del cliente (S/ ${disponible.toFixed(2)})`,
      );
    }

    const ventas = await tx.venta.findMany({
      where: { id: { in: ids }, empresaId },
      select: { id: true, codigo: true, moneda: true, clienteId: true, clienteEmpresaId: true },
    });
    if (ventas.length !== ids.length) throw new NotFoundException('Venta no encontrada');
    for (const v of ventas) {
      // La plata de un cliente no paga la deuda de otro (ni lo personal la de su empresa).
      const mismoTitular = t.clienteEmpresaId
        ? v.clienteEmpresaId === t.clienteEmpresaId
        : v.clienteId === t.clienteId && !v.clienteEmpresaId;
      if (!mismoTitular) throw new BadRequestException(`La venta ${v.codigo} no es de este cliente`);
      if ((v.moneda || 'PEN') !== 'PEN') {
        throw new BadRequestException(`La venta ${v.codigo} no es en soles: el saldo no se le puede aplicar`);
      }
    }

    const abonos: string[] = [];
    let i = 0;
    for (const l of lineas) {
      let falta = l.monto;
      while (falta > 0.001) {
        const x = depositos[i];
        const libre = r2(x.disponible - x.usado);
        if (libre <= 0.001) { i++; continue; }
        const trozo = r2(Math.min(falta, libre));
        const abono = await this.cxc.registrarAbonoEnTx(
          tx,
          empresaId,
          l.ventaId,
          { monto: trozo, metodoPago: x.d.metodoPago, referencia: x.d.referencia ?? undefined },
          usuarioId,
          { fuente: x.d.fuente, bancoId: x.d.bancoId },
        );
        await tx.aplicacionDeposito.create({
          data: { depositoId: x.d.id, ventaId: l.ventaId, monto: trozo, pagoVentaId: abono.pagoId, creadoPorId: usuarioId },
        });
        abonos.push(abono.pagoId);
        x.usado = r2(x.usado + trozo);
        falta = r2(falta - trozo);
      }
    }
    for (const x of depositos) {
      if (x.usado > 0) {
        await tx.depositoCliente.update({ where: { id: x.d.id }, data: { montoAplicado: { increment: x.usado } } });
      }
    }
    return { aplicado: total, saldoAFavor: r2(disponible - total), abonos };
  }

  /**
   * Anula un depósito: revierte su ingreso. Solo si no tiene nada repartido;
   * si lo tiene, primero se anulan esos abonos (vuelven al saldo a favor).
   */
  async anular(empresaId: string, depositoId: string, usuarioId: string, motivo?: string) {
    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "DepositoCliente" WHERE "id" = ${depositoId} AND "empresaId" = ${empresaId} FOR UPDATE`;
      if (!filas[0]) throw new NotFoundException('Depósito no encontrado');
      const dep = await tx.depositoCliente.findUnique({ where: { id: depositoId } });
      if (!dep) throw new NotFoundException('Depósito no encontrado');
      if (dep.anulado) throw new ConflictException('El depósito ya está anulado');
      if (Number(dep.montoAplicado) > 0) {
        throw new BadRequestException(
          'Este depósito ya se repartió a ventas. Anula primero esos abonos: vuelven al saldo a favor y recién ahí se puede anular.',
        );
      }
      await revertirIngresoConFuente(
        tx,
        { monto: dep.monto, fuente: dep.fuente, bancoId: dep.bancoId, movimientoCajaId: dep.movimientoCajaId },
        usuarioId,
        motivo?.trim() || 'Anulación de depósito de cliente',
      );
      await tx.depositoCliente.update({
        where: { id: depositoId },
        data: {
          anulado: true,
          motivoAnulacion: motivo?.trim().slice(0, 300) || null,
          anuladoPorId: usuarioId,
          fechaAnulacion: new Date(),
        },
      });
      return { ok: true, depositoId };
    });
  }

  /** Lo que el cliente tiene entregado y todavía no se aplicó a ninguna venta. */
  async saldoAFavor(empresaId: string, t: TitularDeposito): Promise<number> {
    if (!t.clienteId && !t.clienteEmpresaId) return 0;
    const agg = await this.prisma.depositoCliente.aggregate({
      where: {
        empresaId,
        anulado: false,
        ...(t.clienteEmpresaId ? { clienteEmpresaId: t.clienteEmpresaId } : { clienteId: t.clienteId }),
      },
      _sum: { monto: true, montoAplicado: true },
    });
    return Math.max(0, r2(Number(agg._sum.monto ?? 0) - Number(agg._sum.montoAplicado ?? 0)));
  }

  /** Los depósitos de un cliente, con a qué ventas fue cada uno. */
  async listar(empresaId: string, tIn: TitularDeposito) {
    const t = await this.titular(this.prisma, empresaId, tIn);
    const filas = await this.prisma.depositoCliente.findMany({
      where: { empresaId, ...DepositosClienteService.whereTitular(t) },
      orderBy: { creadoEn: 'desc' },
      take: 100,
      include: { aplicaciones: { orderBy: { creadoEn: 'asc' } } },
    });
    const ventaIds = [...new Set(filas.flatMap((f) => f.aplicaciones.map((a) => a.ventaId)))];
    const ventas = ventaIds.length
      ? await this.prisma.venta.findMany({ where: { id: { in: ventaIds } }, select: { id: true, codigo: true } })
      : [];
    const codigo = new Map(ventas.map((v) => [v.id, v.codigo]));
    const depositos = filas.map((f) => ({
      id: f.id,
      monto: Number(f.monto),
      aplicado: Number(f.montoAplicado),
      disponible: f.anulado ? 0 : r2(Number(f.monto) - Number(f.montoAplicado)),
      metodoPago: f.metodoPago,
      referencia: f.referencia,
      fuente: f.fuente,
      origen: f.origen,
      nota: f.nota,
      anulado: f.anulado,
      motivoAnulacion: f.motivoAnulacion,
      fecha: f.creadoEn,
      aplicaciones: f.aplicaciones.map((a) => ({
        ventaId: a.ventaId,
        ventaCodigo: codigo.get(a.ventaId) ?? null,
        monto: Number(a.monto),
        pagoId: a.pagoVentaId,
        fecha: a.creadoEn,
      })),
    }));
    return {
      cliente: { nombre: t.nombre, clienteId: t.clienteId, clienteEmpresaId: t.clienteEmpresaId },
      saldoAFavor: r2(depositos.reduce((s, d) => s + d.disponible, 0)),
      depositos,
    };
  }

  /**
   * Propone cómo repartir `monto` entre las ventas con deuda del cliente:
   * cuotas COMPLETAS, de la que vence primero a la que vence última. Una
   * cuota que no entra entera no se toca (y bloquea las siguientes de SU
   * venta, que se pagan en orden); lo que sobra queda a favor. La tienda puede
   * cambiar la propuesta antes de confirmar.
   */
  async sugerirReparto(empresaId: string, tIn: TitularDeposito, monto: number) {
    const t = await this.titular(this.prisma, empresaId, tIn);
    const ventas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        esCredito: true,
        estado: { in: [...VENTA_CON_DEUDA] },
        moneda: 'PEN',
        ...(t.clienteEmpresaId ? { clienteEmpresaId: t.clienteEmpresaId } : { clienteId: t.clienteId, clienteEmpresaId: null }),
      },
      orderBy: { fechaVenta: 'asc' },
      take: 200,
      select: {
        id: true, codigo: true, fechaVenta: true, total: true, totalConInteres: true, fechaVencimientoPago: true,
        pagos: { where: { anulado: false }, select: { monto: true } },
        cuotas: { where: { estado: { in: [...CUOTA_ABIERTA] } }, orderBy: { numero: 'asc' } },
      },
    });
    const configMora = ventas.some((v) => v.cuotas.length) ? await this.cxc._configMora(this.prisma as unknown as Prisma.TransactionClient, empresaId) : null;
    const ahora = new Date();

    // Por venta: la cola de lo que hay que pagar, en orden.
    const colas = ventas
      .map((v) => {
        const tramos = v.cuotas.length
          ? v.cuotas.map((c) => ({
              numero: c.numero as number | null,
              costo: r2(Number(c.saldoPendiente) + moraVigenteCuota(this.cxc._toImputable(c), configMora, ahora)),
              vence: c.fechaVencimiento,
            }))
          : [{
              numero: null as number | null,
              costo: r2(Number(v.totalConInteres ?? v.total) - v.pagos.reduce((s, p) => s + Number(p.monto), 0)),
              vence: v.fechaVencimientoPago ?? v.fechaVenta,
            }];
        const pendientes = tramos.filter((x) => x.costo > 0);
        return { v, tramos: pendientes, i: 0, sugerido: 0, cuotasCubiertas: 0 };
      })
      .filter((c) => c.tramos.length > 0);

    let resto = r2(Math.max(0, Number(monto) || 0));
    for (;;) {
      // La cuota que vence primero entre las cabezas de cola que TODAVÍA entran.
      let mejor: (typeof colas)[number] | null = null;
      for (const c of colas) {
        const cabeza = c.tramos[c.i];
        if (!cabeza || cabeza.costo > resto + 0.001) continue;
        if (!mejor || cabeza.vence.getTime() < mejor.tramos[mejor.i].vence.getTime()) mejor = c;
      }
      if (!mejor) break;
      const cabeza = mejor.tramos[mejor.i];
      mejor.sugerido = r2(mejor.sugerido + cabeza.costo);
      mejor.cuotasCubiertas++;
      mejor.i++;
      resto = r2(resto - cabeza.costo);
    }

    const filas = colas.map((c) => {
      const saldo = r2(c.tramos.reduce((s, x) => s + x.costo, 0));
      const proxima = c.tramos[0];
      return {
        ventaId: c.v.id,
        codigo: c.v.codigo,
        fechaVenta: c.v.fechaVenta,
        saldo,
        cuotasPendientes: c.v.cuotas.length || 1,
        proximaCuota: { numero: proxima.numero, monto: proxima.costo, fechaVencimiento: proxima.vence },
        sugerido: c.sugerido,
        cuotasCubiertas: c.cuotasCubiertas,
      };
    });
    filas.sort((a, b) => a.proximaCuota.fechaVencimiento.getTime() - b.proximaCuota.fechaVencimiento.getTime());

    return {
      // Lo que el cliente ya tenía a favor (se puede sumar a un depósito nuevo).
      saldoAFavor: await this.saldoAFavor(empresaId, t),
      monto: r2(Math.max(0, Number(monto) || 0)),
      deuda: r2(filas.reduce((s, f) => s + f.saldo, 0)),
      sugerido: r2(filas.reduce((s, f) => s + f.sugerido, 0)),
      // Lo que no alcanza para ninguna cuota entera: queda como saldo a favor.
      sobrante: resto,
      ventas: filas,
    };
  }
}
