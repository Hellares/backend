import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Prisma,
  MetodoPagoVenta,
  FuenteIngreso,
  CategoriaMovimientoCaja,
} from '@prisma/client';
import { CajaService } from '../caja/caja.service';
import {
  aplicarIngresoConFuente,
  revertirIngresoConFuente,
} from '../caja/aplicar-ingreso-fuente.util';
import {
  imputarEnCuotas,
  moraVigenteCuota,
  CuotaImputable,
  ConfigMoraImputacion,
} from './imputar-abono-cuotas.util';
import { UpdateConfiguracionMoraDto } from './dto/update-configuracion-mora.dto';

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class CuentasPorCobrarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cajaService: CajaService,
  ) {}

  /**
   * Listar cuentas por cobrar (ventas a crédito con saldo pendiente)
   */
  async listar(
    empresaId: string,
    filtros?: {
      estado?: 'PENDIENTE' | 'VENCIDA' | 'PAGADA';
      clienteId?: string;
      clienteEmpresaId?: string;
      sedeId?: string;
      search?: string;
    },
  ) {
    const where: Prisma.VentaWhereInput = {
      empresaId,
      esCredito: true,
      estado: { not: 'ANULADA' },
    };

    if (filtros?.clienteId) where.clienteId = filtros.clienteId;
    if (filtros?.clienteEmpresaId) where.clienteEmpresaId = filtros.clienteEmpresaId;
    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreCliente: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const ventas = await this.prisma.venta.findMany({
      where,
      include: {
        pagos: { select: { id: true, monto: true, metodoPago: true, fechaPago: true } },
        cuotas: {
          orderBy: { numero: 'asc' },
          select: {
            id: true, numero: true, monto: true, montoPagado: true,
            saldoPendiente: true, fechaVencimiento: true, estado: true,
            montoMora: true, diasVencido: true,
            montoInteres: true, montoPrincipal: true,
            montoPagadoPrincipal: true, montoPagadoInteres: true, montoPagadoMora: true,
          },
        },
        sede: { select: { id: true, nombre: true } },
        cliente: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true, telefono: true } },
          },
        },
      },
      orderBy: { fechaVencimientoPago: 'asc' },
    });

    const now = new Date();

    const cuentas = ventas.map((v) => {
      const totalVenta = Number(v.total);
      const totalPagado = v.pagos.reduce((sum, p) => sum + Number(p.monto), 0);
      const saldoPendiente = Math.round((totalVenta - totalPagado) * 100) / 100;
      const proximaCuota = v.cuotas?.find((c: any) =>
        c.estado === 'PENDIENTE' || c.estado === 'PAGADA_PARCIAL' || c.estado === 'VENCIDA'
      );
      const fechaVencimientoEfectiva = proximaCuota?.fechaVencimiento ?? v.fechaVencimientoPago;
      const estaVencida = fechaVencimientoEfectiva ? fechaVencimientoEfectiva < now : false;
      const estaPagada = saldoPendiente <= 0;

      const diasVencimiento = fechaVencimientoEfectiva
        ? Math.ceil((fechaVencimientoEfectiva.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      return {
        ventaId: v.id,
        codigo: v.codigo,
        clienteId: v.clienteId,
        clienteEmpresaId: v.clienteEmpresaId,
        nombreCliente: v.nombreCliente,
        documentoCliente: v.documentoCliente,
        telefonoCliente: v.telefonoCliente ?? v.cliente?.persona?.telefono,
        sedeNombre: v.sede?.nombre,
        moneda: v.moneda,
        totalVenta,
        totalPagado: Math.round(totalPagado * 100) / 100,
        saldoPendiente,
        plazoCredito: v.plazoCredito,
        fechaVenta: v.fechaVenta,
        fechaVencimiento: fechaVencimientoEfectiva,
        diasVencimiento,
        estado: estaPagada ? 'PAGADA' : estaVencida ? 'VENCIDA' : 'PENDIENTE',
        pagos: v.pagos,
        numeroCuotas: v.numeroCuotas,
        totalMora: Math.round((v.cuotas?.reduce((sum, c) => sum + Number(c.montoMora ?? 0), 0) ?? 0) * 100) / 100,
        cuotas: v.cuotas?.map(c => ({
          ...c,
          monto: Number(c.monto),
          montoPagado: Number(c.montoPagado),
          saldoPendiente: Number(c.saldoPendiente),
          montoMora: Number(c.montoMora ?? 0),
          montoPrincipal: Number(c.montoPrincipal ?? 0),
          montoInteres: Number(c.montoInteres ?? 0),
          montoPagadoPrincipal: Number(c.montoPagadoPrincipal ?? 0),
          montoPagadoInteres: Number(c.montoPagadoInteres ?? 0),
          montoPagadoMora: Number(c.montoPagadoMora ?? 0),
        })),
        proximaCuota: (() => {
          const proxima = v.cuotas?.find((c: any) =>
            c.estado === 'PENDIENTE' || c.estado === 'PAGADA_PARCIAL' || c.estado === 'VENCIDA'
          );
          return proxima ? {
            id: proxima.id,
            numero: proxima.numero,
            monto: Number(proxima.monto),
            saldoPendiente: Number(proxima.saldoPendiente),
            fechaVencimiento: proxima.fechaVencimiento,
            estado: proxima.estado,
          } : null;
        })(),
      };
    });

    // Filtrar por estado si se especificó
    if (filtros?.estado) {
      return cuentas.filter((c) => c.estado === filtros.estado);
    }

    return cuentas;
  }

  /**
   * Resumen de cuentas por cobrar
   */
  async getResumen(empresaId: string) {
    const cuentas = await this.listar(empresaId);

    const pendientes = cuentas.filter((c) => c.estado === 'PENDIENTE');
    const vencidas = cuentas.filter((c) => c.estado === 'VENCIDA');
    const pagadas = cuentas.filter((c) => c.estado === 'PAGADA');

    const noPagadas = cuentas.filter((c) => c.estado !== 'PAGADA');
    const totalMora = Math.round(noPagadas.reduce((s, c) => s + (c.totalMora ?? 0), 0) * 100) / 100;
    const totalInteres = Math.round(
      noPagadas.reduce((s, c) => s + (c.cuotas?.reduce((si, cu) => si + (cu.montoInteres ?? 0), 0) ?? 0), 0) * 100,
    ) / 100;

    return {
      totalPendiente: Math.round(pendientes.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100,
      totalVencido: Math.round(vencidas.reduce((s, c) => s + c.saldoPendiente, 0) * 100) / 100,
      totalMora,
      totalInteres,
      cantidadPendientes: pendientes.length,
      cantidadVencidas: vencidas.length,
      cantidadPagadas: pagadas.length,
      totalCuentas: cuentas.length,
      // Top 5 clientes con más deuda
      topDeudores: this._topDeudores(cuentas),
      // Próximas a vencer (7 días)
      proximasVencer: cuentas
        .filter((c) => c.estado === 'PENDIENTE' && c.diasVencimiento !== null && c.diasVencimiento <= 7 && c.diasVencimiento >= 0)
        .slice(0, 5),
    };
  }

  /**
   * Detalle de una cuenta (venta + pagos)
   */
  async getDetalle(empresaId: string, ventaId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { id: ventaId, empresaId, esCredito: true },
      include: {
        pagos: { orderBy: { fechaPago: 'desc' } },
        cuotas: {
          orderBy: { numero: 'asc' },
          select: {
            id: true, numero: true, monto: true, montoPagado: true,
            saldoPendiente: true, fechaVencimiento: true, estado: true,
            montoMora: true, diasVencido: true, fechaCalculoMora: true,
            montoInteres: true, montoPrincipal: true,
            montoPagadoPrincipal: true, montoPagadoInteres: true, montoPagadoMora: true,
          },
        },
        detalles: {
          select: {
            id: true,
            descripcion: true,
            cantidad: true,
            precioUnitario: true,
            total: true,
          },
        },
        sede: { select: { nombre: true } },
        cliente: {
          select: {
            persona: { select: { nombres: true, apellidos: true, telefono: true, dni: true } },
          },
        },
      },
    });

    if (!venta) return null;

    const totalPagado = venta.pagos.reduce((sum, p) => sum + Number(p.monto), 0);
    const totalMora = Math.round(
      (venta.cuotas?.reduce((sum, c) => sum + Number(c.montoMora ?? 0), 0) ?? 0) * 100,
    ) / 100;

    return {
      ...venta,
      total: Number(venta.total),
      subtotal: Number(venta.subtotal),
      totalPagado: Math.round(totalPagado * 100) / 100,
      saldoPendiente: Math.round((Number(venta.total) - totalPagado) * 100) / 100,
      totalMora,
      cuotas: venta.cuotas?.map(c => ({
        ...c,
        monto: Number(c.monto),
        montoPagado: Number(c.montoPagado),
        saldoPendiente: Number(c.saldoPendiente),
        montoMora: Number(c.montoMora ?? 0),
        montoPrincipal: Number(c.montoPrincipal ?? 0),
        montoInteres: Number(c.montoInteres ?? 0),
        montoPagadoPrincipal: Number(c.montoPagadoPrincipal ?? 0),
        montoPagadoInteres: Number(c.montoPagadoInteres ?? 0),
        montoPagadoMora: Number(c.montoPagadoMora ?? 0),
      })),
    };
  }

  /**
   * Obtener configuración de mora de la empresa
   */
  async getConfiguracionMora(empresaId: string) {
    const config = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId },
      select: {
        moraHabilitada: true,
        porcentajeMoraDiario: true,
        moraMaximaPorcentaje: true,
        diasGraciaMora: true,
      },
    });

    if (!config) throw new NotFoundException('Configuración de empresa no encontrada');

    return {
      moraHabilitada: config.moraHabilitada,
      porcentajeMoraDiario: Number(config.porcentajeMoraDiario ?? 0.05),
      moraMaximaPorcentaje: Number(config.moraMaximaPorcentaje ?? 30),
      diasGraciaMora: config.diasGraciaMora ?? 0,
    };
  }

  /**
   * Actualizar configuración de mora de la empresa
   */
  async updateConfiguracionMora(empresaId: string, dto: UpdateConfiguracionMoraDto) {
    const config = await this.prisma.configuracionEmpresa.findUnique({
      where: { empresaId },
    });

    if (!config) throw new NotFoundException('Configuración de empresa no encontrada');

    const updated = await this.prisma.configuracionEmpresa.update({
      where: { empresaId },
      data: {
        ...(dto.moraHabilitada !== undefined && { moraHabilitada: dto.moraHabilitada }),
        ...(dto.porcentajeMoraDiario !== undefined && { porcentajeMoraDiario: dto.porcentajeMoraDiario }),
        ...(dto.moraMaximaPorcentaje !== undefined && { moraMaximaPorcentaje: dto.moraMaximaPorcentaje }),
        ...(dto.diasGraciaMora !== undefined && { diasGraciaMora: dto.diasGraciaMora }),
      },
      select: {
        moraHabilitada: true,
        porcentajeMoraDiario: true,
        moraMaximaPorcentaje: true,
        diasGraciaMora: true,
      },
    });

    return {
      moraHabilitada: updated.moraHabilitada,
      porcentajeMoraDiario: Number(updated.porcentajeMoraDiario ?? 0.05),
      moraMaximaPorcentaje: Number(updated.moraMaximaPorcentaje ?? 30),
      diasGraciaMora: updated.diasGraciaMora ?? 0,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ABONOS (simétrico a CxP: registrar / anular / por-cliente)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Registra un abono a una venta a crédito: valida saldo (rechaza sobre-pago),
   * rutea el INGRESO a la fuente (Tesorería/Caja/Banco) e imputa a cuotas
   * (cascada mora → interés → principal). Espejo de CxP.registrarPago.
   */
  async registrarAbono(
    empresaId: string,
    ventaId: string,
    data: {
      monto: number;
      metodoPago: MetodoPagoVenta;
      referencia?: string;
      fuente?: FuenteIngreso;
      bancoId?: string;
      banco?: string;
    },
    usuarioId: string,
  ) {
    if (!(data.monto > 0)) {
      throw new BadRequestException('El monto del abono debe ser mayor a 0');
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock pesimista de la venta (evita carreras de saldo)
      const filas = await tx.$queryRaw<
        Array<{
          id: string;
          estado: string;
          total: any;
          totalConInteres: any;
          moneda: string;
          esCredito: boolean;
          sedeId: string | null;
          codigo: string;
        }>
      >`SELECT "id", "estado", "total", "totalConInteres", "moneda", "esCredito", "sedeId", "codigo"
        FROM "Venta" WHERE "id" = ${ventaId} AND "empresaId" = ${empresaId} FOR UPDATE`;
      const venta = filas[0];
      if (!venta) throw new NotFoundException('Venta no encontrada');
      if (!venta.esCredito) throw new BadRequestException('La venta no es a crédito');
      if (venta.estado === 'ANULADA') throw new BadRequestException('La venta está anulada');
      if (venta.estado === 'PAGADA_COMPLETA') {
        throw new BadRequestException('La venta ya está pagada por completo');
      }
      if (venta.estado === 'BORRADOR') {
        throw new BadRequestException('La venta debe estar confirmada antes de abonar');
      }
      if (!venta.sedeId) {
        throw new BadRequestException('La venta no tiene sede asociada');
      }

      // Saldo pendiente (excluye pagos anulados)
      const pagosPrevios = await tx.pagoVenta.findMany({
        where: { ventaId, anulado: false },
        select: { monto: true },
      });
      const totalPagado = pagosPrevios.reduce((s, p) => s + Number(p.monto), 0);
      const target = venta.totalConInteres
        ? Number(venta.totalConInteres)
        : Number(venta.total);

      // Cuotas pendientes + config de mora — se cargan ANTES del guard para que
      // el tope del abono incluya la MORA vigente (no solo capital+interés).
      const cuotasDb = await tx.cuotaVenta.findMany({
        where: { ventaId, estado: { in: ['PENDIENTE', 'PAGADA_PARCIAL', 'VENCIDA'] } },
        orderBy: { numero: 'asc' },
      });
      const configMora =
        cuotasDb.length > 0 ? await this._configMora(tx, empresaId) : null;
      const ahora = new Date();

      // Saldo real a cobrar = Σ saldo de cuotas + Σ mora vigente. Sin cuotas,
      // cae al total de la venta menos lo pagado.
      let saldo: number;
      let moraVigente = 0;
      if (cuotasDb.length > 0) {
        let saldoCuotas = 0;
        for (const c of cuotasDb) {
          saldoCuotas += Number(c.saldoPendiente);
          moraVigente += moraVigenteCuota(this._toImputable(c), configMora, ahora);
        }
        saldo = round2(saldoCuotas + moraVigente);
      } else {
        saldo = round2(target - totalPagado);
      }

      // Guard de sobre-pago (rechaza, como CxP) — el tope incluye la mora vigente.
      if (data.monto > saldo + 0.001) {
        throw new BadRequestException(
          `El abono (${data.monto.toFixed(2)}) excede el saldo pendiente (${saldo.toFixed(2)}` +
            `${moraVigente > 0 ? `, incl. mora ${moraVigente.toFixed(2)}` : ''}).`,
        );
      }

      // Rutear el INGRESO a la fuente (Tesorería/Caja/Banco)
      const ingreso = await aplicarIngresoConFuente(tx, this.cajaService, {
        empresaId,
        sedeId: venta.sedeId,
        usuarioId,
        metodoPago: data.metodoPago,
        monto: data.monto,
        moneda: venta.moneda || 'PEN',
        fuente: data.fuente,
        bancoId: data.bancoId,
        categoria: CategoriaMovimientoCaja.VENTA,
        descripcion: `Abono crédito venta ${venta.codigo}`,
      });

      // Crear el PagoVenta con la fuente ruteada
      const pago = await tx.pagoVenta.create({
        data: {
          ventaId,
          metodoPago: data.metodoPago,
          monto: data.monto,
          referencia: data.referencia ?? null,
          banco: data.banco ?? null,
          fuente: ingreso.fuente,
          bancoId: ingreso.bancoId,
          movimientoCajaId: ingreso.movimientoCajaId,
        },
      });

      // Imputar a cuotas (mora → interés → principal) — reusa cuotasDb/configMora
      // ya cargados para el guard.
      if (cuotasDb.length > 0) {
        const cuotasMem = cuotasDb.map(this._toImputable);
        const res = imputarEnCuotas(cuotasMem, data.monto, configMora, ahora);
        for (const u of res.updates) {
          await tx.cuotaVenta.update({
            where: { id: u.id },
            data: {
              montoPagado: u.montoPagado,
              montoPagadoPrincipal: u.montoPagadoPrincipal,
              montoPagadoInteres: u.montoPagadoInteres,
              montoPagadoMora: u.montoPagadoMora,
              saldoPendiente: u.saldoPendiente,
              estado: u.estado as any,
              montoMora: u.montoMora,
              ...(u.pagada && { diasVencido: 0, fechaCalculoMora: null }),
            },
          });
        }
        await tx.pagoVenta.update({
          where: { id: pago.id },
          data: {
            cuotaVentaId: res.updates[0]?.id ?? null,
            montoPrincipal: res.breakdown.principal,
            montoInteres: res.breakdown.interes,
            montoMora: res.breakdown.mora,
          },
        });
      }

      // Recomputar estado de la venta
      const nuevoTotalPagado = round2(totalPagado + data.monto);
      const nuevoEstado =
        nuevoTotalPagado >= target ? 'PAGADA_COMPLETA' : 'PAGADA_PARCIAL';
      await tx.venta.update({
        where: { id: ventaId },
        data: {
          estado: nuevoEstado as any,
          montoRecibido: nuevoTotalPagado,
          metodoPago: data.metodoPago,
        },
      });

      return {
        ok: true,
        pagoId: pago.id,
        fuente: ingreso.fuente,
        estado: nuevoEstado,
        saldoPendiente: round2(target - nuevoTotalPagado),
      };
    });
  }

  /**
   * Anula un abono individual: revierte el INGRESO (caja/banco) y recomputa las
   * cuotas desde cero reaplicando los abonos NO anulados. Espejo de CxP.anularPago.
   */
  async anularAbono(
    empresaId: string,
    pagoId: string,
    usuarioId: string,
    motivo?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const pago = await tx.pagoVenta.findFirst({
        where: { id: pagoId, venta: { empresaId, esCredito: true } },
        select: {
          id: true,
          ventaId: true,
          monto: true,
          fuente: true,
          bancoId: true,
          movimientoCajaId: true,
          anulado: true,
        },
      });
      if (!pago) throw new NotFoundException('Abono no encontrado');
      if (pago.anulado) throw new BadRequestException('El abono ya está anulado');

      // Lock de la venta
      await tx.$queryRaw`SELECT "id" FROM "Venta" WHERE "id" = ${pago.ventaId} FOR UPDATE`;

      // Revertir el ingreso (caja: marca movimiento anulado; banco: decrementa saldo)
      await revertirIngresoConFuente(
        tx,
        {
          monto: pago.monto,
          fuente: pago.fuente,
          bancoId: pago.bancoId,
          movimientoCajaId: pago.movimientoCajaId,
        },
        usuarioId,
        motivo || 'Anulación de abono',
      );

      // Marcar el abono anulado (soft-delete)
      await tx.pagoVenta.update({
        where: { id: pago.id },
        data: {
          anulado: true,
          motivoAnulacion: motivo ?? null,
          anuladoPorId: usuarioId,
          fechaAnulacion: new Date(),
        },
      });

      // Recomputar cuotas + estado de la venta desde cero
      await this._recomputarCuotas(tx, empresaId, pago.ventaId);

      return { ok: true, pagoId: pago.id, ventaId: pago.ventaId };
    });
  }

  /**
   * Deuda por cobrar agrupada por cliente (espejo de CxP.getPorProveedor).
   * Separa la deuda por moneda (no mezcla PEN+USD).
   */
  async getPorCliente(empresaId: string) {
    const cuentas = await this.listar(empresaId);
    const map = new Map<
      string,
      {
        nombre: string;
        documento: string | null;
        deudaPorMoneda: Record<string, number>;
        cantidad: number;
        cantidadVencidas: number;
      }
    >();

    for (const c of cuentas) {
      if (c.estado === 'PAGADA' || c.saldoPendiente <= 0) continue;
      const key = c.documentoCliente || c.nombreCliente || 'SIN_CLIENTE';
      if (!map.has(key)) {
        map.set(key, {
          nombre: c.nombreCliente ?? key,
          documento: c.documentoCliente ?? null,
          deudaPorMoneda: {},
          cantidad: 0,
          cantidadVencidas: 0,
        });
      }
      const d = map.get(key)!;
      const mon = c.moneda || 'PEN';
      d.deudaPorMoneda[mon] = round2((d.deudaPorMoneda[mon] ?? 0) + c.saldoPendiente);
      d.cantidad++;
      if (c.estado === 'VENCIDA') d.cantidadVencidas++;
    }

    return Array.from(map.values()).sort((a, b) => {
      const ta = Object.values(a.deudaPorMoneda).reduce((s, v) => s + v, 0);
      const tb = Object.values(b.deudaPorMoneda).reduce((s, v) => s + v, 0);
      return tb - ta;
    });
  }

  /**
   * Estado de cuenta de un cliente: sus ventas a crédito + historial de abonos
   * + saldo total. Acepta `clienteId` (persona) o `clienteEmpresaId` (B2B).
   */
  async getEstadoCuentaCliente(
    empresaId: string,
    filtro: { clienteId?: string; clienteEmpresaId?: string },
  ) {
    if (!filtro.clienteId && !filtro.clienteEmpresaId) {
      throw new BadRequestException('Indique clienteId o clienteEmpresaId');
    }

    const cuentas = await this.listar(empresaId, {
      clienteId: filtro.clienteId,
      clienteEmpresaId: filtro.clienteEmpresaId,
    });

    // Identidad del cliente: del snapshot de las ventas; si no hay ventas y es
    // empresa (B2B), se resuelve de la tabla.
    let nombre: string | null = cuentas[0]?.nombreCliente ?? null;
    let documento: string | null = cuentas[0]?.documentoCliente ?? null;
    if (!nombre && filtro.clienteEmpresaId) {
      const ce = await this.prisma.clienteEmpresa.findFirst({
        where: { id: filtro.clienteEmpresaId, empresaId },
        select: { razonSocial: true, numeroDocumento: true },
      });
      nombre = ce?.razonSocial ?? null;
      documento = ce?.numeroDocumento ?? null;
    }

    const conSaldo = cuentas.filter((c) => c.saldoPendiente > 0);
    const saldoPendiente = round2(conSaldo.reduce((s, c) => s + c.saldoPendiente, 0));
    const totalVendido = round2(cuentas.reduce((s, c) => s + c.totalVenta, 0));
    const totalAbonado = round2(cuentas.reduce((s, c) => s + c.totalPagado, 0));
    const totalMora = round2(cuentas.reduce((s, c) => s + (c.totalMora ?? 0), 0));

    // Timeline de abonos (no anulados) del cliente.
    const abonosRaw = await this.prisma.pagoVenta.findMany({
      where: {
        anulado: false,
        venta: {
          empresaId,
          esCredito: true,
          ...(filtro.clienteId ? { clienteId: filtro.clienteId } : {}),
          ...(filtro.clienteEmpresaId
            ? { clienteEmpresaId: filtro.clienteEmpresaId }
            : {}),
        },
      },
      orderBy: { fechaPago: 'desc' },
      take: 200,
      select: {
        id: true,
        monto: true,
        metodoPago: true,
        fuente: true,
        fechaPago: true,
        venta: { select: { codigo: true } },
      },
    });

    return {
      cliente: {
        id: filtro.clienteId ?? filtro.clienteEmpresaId,
        tipo: filtro.clienteEmpresaId ? 'EMPRESA' : 'PERSONA',
        nombre,
        documento,
      },
      resumen: {
        saldoPendiente,
        totalVendido,
        totalAbonado,
        totalMora,
        cantidadVentas: cuentas.length,
        ventasConSaldo: conSaldo.length,
      },
      ventas: cuentas.map((c) => ({
        ventaId: c.ventaId,
        codigo: c.codigo,
        fechaVenta: c.fechaVenta,
        total: c.totalVenta,
        totalPagado: c.totalPagado,
        saldoPendiente: c.saldoPendiente,
        estado: c.estado,
        fechaVencimiento: c.fechaVencimiento,
        diasVencimiento: c.diasVencimiento,
        numeroCuotas: c.numeroCuotas,
        totalMora: c.totalMora,
      })),
      abonos: abonosRaw.map((a) => ({
        id: a.id,
        monto: Number(a.monto),
        metodoPago: a.metodoPago,
        fuente: a.fuente,
        fechaPago: a.fechaPago,
        ventaCodigo: a.venta?.codigo ?? null,
      })),
    };
  }

  // ── Helpers de abonos ──

  private _toImputable = (c: {
    id: string;
    monto: Prisma.Decimal;
    montoPrincipal: Prisma.Decimal;
    montoInteres: Prisma.Decimal;
    montoPagadoPrincipal: Prisma.Decimal;
    montoPagadoInteres: Prisma.Decimal;
    montoPagadoMora: Prisma.Decimal;
    fechaVencimiento: Date;
    estado: string;
  }): CuotaImputable => ({
    id: c.id,
    monto: Number(c.monto),
    montoPrincipal: Number(c.montoPrincipal ?? 0),
    montoInteres: Number(c.montoInteres ?? 0),
    montoPagadoPrincipal: Number(c.montoPagadoPrincipal ?? 0),
    montoPagadoInteres: Number(c.montoPagadoInteres ?? 0),
    montoPagadoMora: Number(c.montoPagadoMora ?? 0),
    fechaVencimiento: c.fechaVencimiento,
    estado: c.estado,
  });

  private async _configMora(
    tx: Prisma.TransactionClient,
    empresaId: string,
  ): Promise<ConfigMoraImputacion | null> {
    const cfg = await tx.configuracionEmpresa.findFirst({
      where: { empresaId },
      select: {
        moraHabilitada: true,
        porcentajeMoraDiario: true,
        moraMaximaPorcentaje: true,
        diasGraciaMora: true,
      },
    });
    if (!cfg) return null;
    return {
      moraHabilitada: cfg.moraHabilitada,
      porcentajeMoraDiario: Number(cfg.porcentajeMoraDiario ?? 0.05),
      moraMaximaPorcentaje: Number(cfg.moraMaximaPorcentaje ?? 30),
      diasGraciaMora: cfg.diasGraciaMora ?? 0,
    };
  }

  /**
   * Recomputa cuotas + estado de la venta desde cero: resetea las cuotas y
   * reaplica TODOS los abonos no anulados en orden cronológico. Lo usa anularAbono.
   */
  private async _recomputarCuotas(
    tx: Prisma.TransactionClient,
    empresaId: string,
    ventaId: string,
  ) {
    const cuotasDb = await tx.cuotaVenta.findMany({
      where: { ventaId, estado: { not: 'ANULADA' } },
      orderBy: { numero: 'asc' },
    });
    const configMora = await this._configMora(tx, empresaId);
    const ahora = new Date();

    // Estado en memoria, reseteado a cero pagos
    const cuotasMem: CuotaImputable[] = cuotasDb.map((c) => ({
      id: c.id,
      monto: Number(c.monto),
      montoPrincipal: Number(c.montoPrincipal ?? 0),
      montoInteres: Number(c.montoInteres ?? 0),
      montoPagadoPrincipal: 0,
      montoPagadoInteres: 0,
      montoPagadoMora: 0,
      fechaVencimiento: c.fechaVencimiento,
      estado: 'PENDIENTE',
    }));

    // Reaplicar abonos no anulados en orden cronológico
    const pagos = await tx.pagoVenta.findMany({
      where: { ventaId, anulado: false },
      orderBy: { fechaPago: 'asc' },
      select: { id: true, monto: true, fechaPago: true },
    });
    for (const p of pagos) {
      const res = imputarEnCuotas(cuotasMem, Number(p.monto), configMora, p.fechaPago);
      await tx.pagoVenta.update({
        where: { id: p.id },
        data: {
          cuotaVentaId: res.updates[0]?.id ?? null,
          montoPrincipal: res.breakdown.principal,
          montoInteres: res.breakdown.interes,
          montoMora: res.breakdown.mora,
        },
      });
    }

    // Persistir el estado final de cada cuota
    for (const cm of cuotasMem) {
      const montoPagado = round2(cm.montoPagadoPrincipal + cm.montoPagadoInteres);
      const saldo = Math.max(round2(cm.monto - montoPagado), 0);
      const pagada = cm.estado === 'PAGADA';
      const estado = pagada
        ? 'PAGADA'
        : montoPagado > 0
          ? 'PAGADA_PARCIAL'
          : cm.fechaVencimiento < ahora
            ? 'VENCIDA'
            : 'PENDIENTE';
      await tx.cuotaVenta.update({
        where: { id: cm.id },
        data: {
          montoPagado,
          montoPagadoPrincipal: cm.montoPagadoPrincipal,
          montoPagadoInteres: cm.montoPagadoInteres,
          montoPagadoMora: cm.montoPagadoMora,
          saldoPendiente: saldo,
          estado: estado as any,
          // La mora la recalcula el cron; al recomputar la dejamos limpia.
          montoMora: 0,
          ...(montoPagado === 0 && { diasVencido: 0, fechaCalculoMora: null }),
        },
      });
    }

    // Recomputar estado + montoRecibido de la venta
    const totalPagado = round2(
      pagos.reduce((s, p) => s + Number(p.monto), 0),
    );
    const venta = await tx.venta.findUnique({
      where: { id: ventaId },
      select: { total: true, totalConInteres: true },
    });
    const target = venta?.totalConInteres
      ? Number(venta.totalConInteres)
      : Number(venta?.total ?? 0);
    const estadoVenta =
      totalPagado > 0 && totalPagado >= target
        ? 'PAGADA_COMPLETA'
        : totalPagado > 0
          ? 'PAGADA_PARCIAL'
          : 'CONFIRMADA';
    await tx.venta.update({
      where: { id: ventaId },
      data: { estado: estadoVenta as any, montoRecibido: totalPagado },
    });
  }

  private _topDeudores(cuentas: any[]) {
    const deudaPorCliente = new Map<string, { nombre: string; total: number; cantidad: number }>();

    for (const c of cuentas) {
      if (c.estado === 'PAGADA') continue;
      const key = c.nombreCliente;
      if (!deudaPorCliente.has(key)) {
        deudaPorCliente.set(key, { nombre: key, total: 0, cantidad: 0 });
      }
      const d = deudaPorCliente.get(key)!;
      d.total += c.saldoPendiente;
      d.cantidad++;
    }

    return Array.from(deudaPorCliente.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((d) => ({ ...d, total: Math.round(d.total * 100) / 100 }));
  }
}
