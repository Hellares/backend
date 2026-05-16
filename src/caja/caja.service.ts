import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  EstadoCaja,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
  Prisma,
} from '@prisma/client';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';

@Injectable()
export class CajaService {
  private readonly logger = new Logger(CajaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abrir una nueva caja.
   *
   * Toda la operación (validación + generación de código + insert) corre
   * en UNA SOLA transacción para evitar:
   *  1. Race condition (dos abrirCaja simultáneos del mismo usuario que
   *     pasaban ambos la validación y creaban dos cajas).
   *  2. Huecos en numeración (antes: si _generarCodigoCaja incrementaba
   *     ultimaCaja en tx propia y el create posterior fallaba, el contador
   *     quedaba avanzado y aparecían CAJA-001, CAJA-003 con CAJA-002
   *     perdida en el aire).
   */
  async abrirCaja(empresaId: string, usuarioId: string, dto: AbrirCajaDto) {
    return this.prisma.$transaction(async (tx) => {
      // Política: 1 caja activa por cajero en TODA la empresa (no por sede).
      // Si el cajero se mueve a otra sede, primero debe cerrar la actual.
      // Sin esto, un mismo user podía tener cajas abiertas en sede A y B
      // simultáneamente, y getCajaActiva (que no filtra por sede) devolvía
      // "la primera" → ventas iban a la caja equivocada al cerrar.
      const cajaExistente = await tx.caja.findFirst({
        where: {
          empresaId,
          usuarioId,
          estado: EstadoCaja.ABIERTA,
        },
        select: {
          id: true,
          codigo: true,
          sede: { select: { nombre: true } },
        },
      });

      if (cajaExistente) {
        throw new BadRequestException(
          `Ya tienes una caja abierta (${cajaExistente.codigo} en sede ${cajaExistente.sede?.nombre ?? 'desconocida'}). ` +
            'Ciérrala antes de abrir una nueva.',
        );
      }

      const codigo = await this._generarCodigoCaja(tx, empresaId);

      return tx.caja.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          usuarioId,
          codigo,
          montoApertura: dto.montoApertura,
          estado: EstadoCaja.ABIERTA,
          observacionesApertura: dto.observaciones,
          sedeFacturacionId: dto.sedeFacturacionId || null,
        },
        include: {
          sede: { select: { id: true, nombre: true, codigo: true } },
          usuario: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });
    });
  }

  /**
   * Obtener caja activa del usuario
   */
  async getCajaActiva(empresaId: string, usuarioId: string) {
    const caja = await this.prisma.caja.findFirst({
      where: {
        empresaId,
        usuarioId,
        estado: EstadoCaja.ABIERTA,
      },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        sedeFacturacion: { select: { id: true, nombre: true, rucSede: true, razonSocialSede: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        _count: {
          select: { movimientos: true },
        },
      },
    });

    if (!caja) {
      return null;
    }

    // Agrupamos por (metodoPago, tipo) para poder distinguir EFECTIVO del
    // resto. `saldoActual` mantiene la semántica histórica (total operado
    // sumando todos los métodos) para no romper consumidores; `saldoEfectivo`
    // es lo que realmente está en la gaveta física y es lo que el cajero
    // debe contar al cerrar.
    const totales = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId: caja.id, anulado: false },
      _sum: { monto: true },
    });

    let totalIngresos = 0;
    let totalEgresos = 0;
    let ingresosEfectivo = 0;
    let egresosEfectivo = 0;
    for (const row of totales) {
      const monto = Number(row._sum.monto ?? 0);
      if (row.tipo === TipoMovimientoCaja.INGRESO) {
        totalIngresos += monto;
        if (row.metodoPago === MetodoPagoVenta.EFECTIVO) ingresosEfectivo += monto;
      } else {
        totalEgresos += monto;
        if (row.metodoPago === MetodoPagoVenta.EFECTIVO) egresosEfectivo += monto;
      }
    }

    const montoApertura = Number(caja.montoApertura);

    return {
      ...caja,
      totalIngresos,
      totalEgresos,
      saldoActual: montoApertura + totalIngresos - totalEgresos,
      saldoEfectivo: montoApertura + ingresosEfectivo - egresosEfectivo,
    };
  }

  /**
   * Crear movimiento manual en la caja
   */
  async crearMovimiento(
    empresaId: string,
    cajaId: string,
    usuarioId: string,
    dto: CrearMovimientoDto,
  ) {
    // Verificar que la caja exista y esté abierta
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId, estado: EstadoCaja.ABIERTA },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada o no está abierta');
    }

    const movimiento = await this.prisma.movimientoCaja.create({
      data: {
        cajaId,
        empresaId,
        tipo: dto.tipo,
        categoria: dto.categoria,
        metodoPago: dto.metodoPago,
        monto: dto.monto,
        descripcion: dto.descripcion,
        categoriaGastoId: dto.categoriaGastoId,
        esManual: true,
        registradoPorId: usuarioId,
      },
    });

    return movimiento;
  }

  /**
   * Crear movimiento automático (llamado desde otros módulos).
   *
   * SEGURIDAD: valida que la caja exista, pertenezca a la empresa y
   * esté ABIERTA antes del insert. Si está CERRADA (o no existe), NO
   * inserta y devuelve null + warning en logs. Antes esta función
   * insertaba ciegamente — un cajaId stale podía meter un movimiento en
   * una caja ya cerrada distorsionando el cierre histórico que el cajero
   * ya firmó.
   *
   * Devuelve null cuando se rechazó el insert (para que el llamador pueda
   * decidir si tratar como warning silencioso o como error; los actuales
   * llamadores ya manejan que no haya caja vía registrarMovimientoSiHayCaja).
   */
  async crearMovimientoAutomatico(
    empresaId: string,
    cajaId: string,
    data: {
      tipo: TipoMovimientoCaja;
      categoria: CategoriaMovimientoCaja;
      metodoPago: MetodoPagoVenta;
      monto: number;
      descripcion?: string;
      ventaId?: string;
      pedidoMarketplaceId?: string;
      compraId?: string;
      devolucionId?: string;
      boletaPagoId?: string;
      adelantoPagoId?: string;
      registradoPorId: string;
      metadata?: any;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    const caja = await client.caja.findFirst({
      where: { id: cajaId, empresaId },
      select: { id: true, estado: true, codigo: true },
    });

    if (!caja) {
      this.logger.warn(
        `crearMovimientoAutomatico: caja ${cajaId} no encontrada en empresa ${empresaId}. Movimiento ${data.categoria} ${data.tipo} S/${data.monto} NO registrado.`,
      );
      return null;
    }

    if (caja.estado !== EstadoCaja.ABIERTA) {
      this.logger.warn(
        `crearMovimientoAutomatico: caja ${caja.codigo} ya está CERRADA. Movimiento ${data.categoria} ${data.tipo} S/${data.monto} NO registrado (evita distorsionar cierre firmado).`,
      );
      return null;
    }

    const movimiento = await client.movimientoCaja.create({
      data: {
        cajaId,
        empresaId,
        tipo: data.tipo,
        categoria: data.categoria,
        metodoPago: data.metodoPago,
        monto: data.monto,
        descripcion: data.descripcion,
        ventaId: data.ventaId,
        pedidoMarketplaceId: data.pedidoMarketplaceId,
        compraId: data.compraId,
        devolucionId: data.devolucionId,
        boletaPagoId: data.boletaPagoId,
        adelantoPagoId: data.adelantoPagoId,
        esManual: false,
        registradoPorId: data.registradoPorId,
        metadata: data.metadata ?? undefined,
      },
    });

    return movimiento;
  }

  /**
   * Registrar movimiento automático en la caja del USUARIO actual de la sede.
   * Si el usuario no tiene caja abierta, no hace nada (no bloquea la operación
   * — la validación previa de "exige caja" debe hacerla el llamador con
   * `validarCajaParaVender` si corresponde).
   *
   * IMPORTANTE: NO usa fallback a "cualquier caja de la sede" — esa lógica
   * vieja metía las ventas de A en la caja de B cuando A no tenía caja
   * abierta, generando desfases imposibles de cuadrar al cierre.
   */
  async registrarMovimientoSiHayCaja(
    empresaId: string,
    sedeId: string,
    usuarioId: string,
    data: {
      tipo: TipoMovimientoCaja;
      categoria: CategoriaMovimientoCaja;
      metodoPago: MetodoPagoVenta;
      monto: number;
      descripcion?: string;
      ventaId?: string;
      pedidoMarketplaceId?: string;
      compraId?: string;
      devolucionId?: string;
      boletaPagoId?: string;
      adelantoPagoId?: string;
      metadata?: any;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;

    const cajaActiva = await client.caja.findFirst({
      where: { empresaId, sedeId, usuarioId, estado: EstadoCaja.ABIERTA },
    });

    if (!cajaActiva) return;

    await this.crearMovimientoAutomatico(empresaId, cajaActiva.id, {
      ...data,
      registradoPorId: usuarioId,
    }, tx);
  }

  /**
   * Valida que el usuario tenga caja abierta en la sede ANTES de iniciar
   * una venta. Solo se aplica si `empresa.requiereCajaParaVender = true`.
   *
   * Si el flag está OFF (default), no valida nada (comportamiento histórico).
   * Si está ON, bloquea con BadRequestException si el cajero no tiene caja
   * abierta en la sede destino — cada cajero con su caja.
   *
   * Usada por venta.service en `create`, `crearYCobrar`, `crearDesdeCotizacion`.
   */
  async validarCajaParaVender(
    empresaId: string,
    sedeId: string,
    usuarioId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;

    const empresa = await client.empresa.findUnique({
      where: { id: empresaId },
      select: { requiereCajaParaVender: true },
    });

    if (!empresa?.requiereCajaParaVender) return;

    const cajaAbierta = await client.caja.findFirst({
      where: { empresaId, sedeId, usuarioId, estado: EstadoCaja.ABIERTA },
      select: { id: true },
    });

    if (!cajaAbierta) {
      throw new BadRequestException(
        'Debes abrir caja antes de procesar una venta. Cada cajero gestiona su propia caja.',
      );
    }
  }

  /**
   * Listar movimientos de una caja
   */
  async getMovimientos(empresaId: string, cajaId: string) {
    // Verificar que la caja exista
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    // Excluimos las contrapartidas auto-generadas por anularMovimiento
    // (los inversos con [ANULACION] en la descripcion). El original
    // anulado SI se muestra para que el cajero/auditor vea que se anulo
    // (la UI lo presenta tachado/con badge). Asi evitamos pares
    // duplicados original+contrapartida ensuciando la lista, sin perder
    // trazabilidad.
    //
    // `contrapartidaDe` es la relacion inversa de movimientoContrapartidaId:
    // un movimiento que es "contrapartida de otro" tiene esa relacion no
    // nula. Lo filtramos con `is: null` para excluir SOLO contrapartidas.
    const movimientos = await this.prisma.movimientoCaja.findMany({
      where: {
        cajaId,
        contrapartidaDe: { is: null },
      },
      orderBy: { fechaMovimiento: 'desc' },
      include: {
        venta: { select: { id: true, codigo: true } },
        pedidoMarketplace: { select: { id: true, codigo: true } },
        compra: { select: { id: true, codigo: true } },
        devolucion: { select: { id: true, codigo: true } },
        categoriaGasto: { select: { id: true, nombre: true, tipo: true, icono: true, color: true } },
        registradoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    return movimientos;
  }

  /**
   * Cerrar caja
   */
  async cerrarCaja(
    empresaId: string,
    cajaId: string,
    usuarioId: string,
    dto: CerrarCajaDto,
  ) {
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId, estado: EstadoCaja.ABIERTA },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada o no está abierta');
    }

    // Calcular totales por método de pago y tipo
    const movimientos = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId, anulado: false },
      _sum: { monto: true },
    });

    // Construir detalle por método de pago
    const metodosPago = Object.values(MetodoPagoVenta);
    const detallePorMetodoPago: Record<
      string,
      {
        apertura: number;
        ingresos: number;
        egresos: number;
        esperado: number;
        conteoFisico: number;
        diferencia: number;
      }
    > = {};

    let totalIngresos = 0;
    let totalEgresos = 0;
    // El monto de apertura SIEMPRE es efectivo (el cajero lo deja físicamente
    // en la caja al abrir). Se imputa al método EFECTIVO para que detalle y
    // total cuadren al sumar (antes esperado por método era ingresos-egresos
    // y el totalEsperado sumaba aparte el montoApertura → desfase del monto
    // de apertura en la línea EFECTIVO del cierre).
    const montoApertura = Number(caja.montoApertura);

    for (const metodo of metodosPago) {
      const ingresos = Number(
        movimientos.find(
          (m) => m.metodoPago === metodo && m.tipo === TipoMovimientoCaja.INGRESO,
        )?._sum.monto ?? 0,
      );
      const egresos = Number(
        movimientos.find(
          (m) => m.metodoPago === metodo && m.tipo === TipoMovimientoCaja.EGRESO,
        )?._sum.monto ?? 0,
      );

      totalIngresos += ingresos;
      totalEgresos += egresos;

      const apertura =
        metodo === MetodoPagoVenta.EFECTIVO ? montoApertura : 0;
      const esperado = apertura + ingresos - egresos;
      const conteo = dto.conteos.find((c) => c.metodoPago === metodo);
      const conteoFisico = conteo?.conteoFisico ?? 0;

      detallePorMetodoPago[metodo] = {
        apertura,
        ingresos,
        egresos,
        esperado,
        conteoFisico,
        diferencia: conteoFisico - esperado,
      };
    }

    const totalEsperado = montoApertura + totalIngresos - totalEgresos;
    const totalConteoFisico = dto.conteos.reduce(
      (sum, c) => sum + c.conteoFisico,
      0,
    );
    const diferencia = totalConteoFisico - totalEsperado;

    // Crear cierre y actualizar caja en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      const cierre = await tx.cierreCaja.create({
        data: {
          cajaId,
          totalIngresos,
          totalEgresos,
          totalEsperado,
          totalConteoFisico,
          diferencia,
          detallePorMetodoPago,
          observaciones: dto.observaciones,
        },
      });

      const cajaActualizada = await tx.caja.update({
        where: { id: cajaId },
        data: {
          estado: EstadoCaja.CERRADA,
          fechaCierre: new Date(),
          cerradoPorId: usuarioId,
          observacionesCierre: dto.observaciones,
        },
        include: {
          sede: { select: { id: true, nombre: true, codigo: true } },
          usuario: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      return { caja: cajaActualizada, cierre };
    });

    return result;
  }

  /**
   * Obtener resumen de una caja: totales generales + detalle por método
   * de pago. El cliente Flutter (cerrar_caja_page) consume `detalles[]`
   * con shape `{ metodoPago, totalIngresos, totalEgresos, saldo }`.
   *
   * El `saldo` por método incluye el `montoApertura` cuando el método es
   * EFECTIVO (mismo criterio que cerrarCaja: la apertura es física, va
   * a EFECTIVO). Sin esto el cajero veía esperado=0 en EFECTIVO al
   * pre-cierre aunque hubiera abierto con S/100.
   */
  async getResumen(empresaId: string, cajaId: string) {
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        cierre: true,
      },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    const resumenPorMetodo = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId, anulado: false },
      _sum: { monto: true },
      _count: { id: true },
    });

    const resumenPorCategoria = await this.prisma.movimientoCaja.groupBy({
      by: ['categoria', 'tipo'],
      where: { cajaId, anulado: false },
      _sum: { monto: true },
      _count: { id: true },
    });

    // Totales generales
    const totalIngresos = resumenPorMetodo
      .filter((r) => r.tipo === TipoMovimientoCaja.INGRESO)
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);

    const totalEgresos = resumenPorMetodo
      .filter((r) => r.tipo === TipoMovimientoCaja.EGRESO)
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);

    const montoApertura = Number(caja.montoApertura);
    const saldoActual = montoApertura + totalIngresos - totalEgresos;

    // Detalle por método agregado (lo que consume Flutter en cerrar_caja).
    // Para cada método incluye totalIngresos, totalEgresos y saldo, sumando
    // la apertura al EFECTIVO. Devolvemos TODOS los métodos (incluso 0)
    // para que el cliente decida ocultar lo que no aplica.
    const detalles = Object.values(MetodoPagoVenta).map((metodo) => {
      const ingresos = Number(
        resumenPorMetodo.find(
          (r) => r.metodoPago === metodo && r.tipo === TipoMovimientoCaja.INGRESO,
        )?._sum.monto ?? 0,
      );
      const egresos = Number(
        resumenPorMetodo.find(
          (r) => r.metodoPago === metodo && r.tipo === TipoMovimientoCaja.EGRESO,
        )?._sum.monto ?? 0,
      );
      const apertura = metodo === MetodoPagoVenta.EFECTIVO ? montoApertura : 0;
      return {
        metodoPago: metodo,
        apertura,
        totalIngresos: ingresos,
        totalEgresos: egresos,
        saldo: apertura + ingresos - egresos,
      };
    });

    // saldoEfectivo = lo que está físicamente en la gaveta. Solo cuenta
    // movimientos en EFECTIVO + apertura. saldoActual mezcla todos los
    // métodos y sirve como "total operado del día".
    const detalleEfectivo = detalles.find(
      (d) => d.metodoPago === MetodoPagoVenta.EFECTIVO,
    );
    const saldoEfectivo = detalleEfectivo?.saldo ?? montoApertura;

    return {
      caja,
      montoApertura,
      totalIngresos,
      totalEgresos,
      saldoActual,
      saldoEfectivo,
      // Alias `saldo` para el shape que consume ResumenCajaModel del Flutter.
      saldo: saldoActual,
      detalles,
      resumenPorMetodo, // backward compat: groupBy raw por si otro consumer lo usa
      resumenPorCategoria,
    };
  }

  /**
   * Historial de cajas cerradas
   */
  async getHistorial(
    empresaId: string,
    sedeId?: string,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    const where: Prisma.CajaWhereInput = {
      empresaId,
      estado: EstadoCaja.CERRADA,
    };

    if (sedeId) {
      where.sedeId = sedeId;
    }

    // Filtramos por fechaCierre, no fechaApertura. Es el "Historial de
    // cajas CERRADAS" y el orden ya es por fechaCierre desc — la fecha
    // relevante para auditoria es cuando se cerro, no cuando se abrio.
    // Caso real: CAJA-00002 abierta 2026-05-04, cerrada 2026-05-16. Si
    // alguien filtraba "ultimas 7 dias" por fechaApertura, no la veia
    // aunque el cierre fue ayer.
    if (fechaDesde || fechaHasta) {
      where.fechaCierre = {};
      if (fechaDesde) {
        where.fechaCierre.gte = new Date(fechaDesde);
      }
      if (fechaHasta) {
        where.fechaCierre.lte = new Date(fechaHasta);
      }
    }

    const cajas = await this.prisma.caja.findMany({
      where,
      orderBy: { fechaCierre: 'desc' },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        cerradoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        cierre: {
          select: {
            totalIngresos: true,
            totalEgresos: true,
            totalEsperado: true,
            totalConteoFisico: true,
            diferencia: true,
          },
        },
      },
    });

    return cajas;
  }

  /**
   * Monitor de cajas: todas las cajas abiertas de la empresa con totales en vivo
   */
  async getMonitor(empresaId: string, sedeId?: string) {
    const where: Prisma.CajaWhereInput = {
      empresaId,
      estado: EstadoCaja.ABIERTA,
    };

    if (sedeId) {
      where.sedeId = sedeId;
    }

    const cajasAbiertas = await this.prisma.caja.findMany({
      where,
      orderBy: { fechaApertura: 'desc' },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        _count: {
          select: { movimientos: true },
        },
      },
    });

    // Calcular totales para cada caja en paralelo. groupBy por
    // (metodoPago, tipo) para separar saldoEfectivo (lo físico en gaveta)
    // de saldoActual (total operado, mezcla todos los métodos).
    const cajasConTotales = await Promise.all(
      cajasAbiertas.map(async (caja) => {
        const totales = await this.prisma.movimientoCaja.groupBy({
          by: ['metodoPago', 'tipo'],
          where: { cajaId: caja.id, anulado: false },
          _sum: { monto: true },
        });

        let totalIngresos = 0;
        let totalEgresos = 0;
        let ingresosEfectivo = 0;
        let egresosEfectivo = 0;
        for (const row of totales) {
          const monto = Number(row._sum.monto ?? 0);
          if (row.tipo === TipoMovimientoCaja.INGRESO) {
            totalIngresos += monto;
            if (row.metodoPago === MetodoPagoVenta.EFECTIVO) ingresosEfectivo += monto;
          } else {
            totalEgresos += monto;
            if (row.metodoPago === MetodoPagoVenta.EFECTIVO) egresosEfectivo += monto;
          }
        }

        const montoApertura = Number(caja.montoApertura);

        // Último movimiento
        const ultimoMovimiento = await this.prisma.movimientoCaja.findFirst({
          where: { cajaId: caja.id },
          orderBy: { fechaMovimiento: 'desc' },
          select: {
            tipo: true,
            categoria: true,
            monto: true,
            descripcion: true,
            fechaMovimiento: true,
          },
        });

        return {
          ...caja,
          totalIngresos,
          totalEgresos,
          saldoActual: montoApertura + totalIngresos - totalEgresos,
          saldoEfectivo: montoApertura + ingresosEfectivo - egresosEfectivo,
          ultimoMovimiento,
        };
      }),
    );

    // Resumen general
    const totalCajasAbiertas = cajasConTotales.length;
    const totalIngresosGlobal = cajasConTotales.reduce((s, c) => s + c.totalIngresos, 0);
    const totalEgresosGlobal = cajasConTotales.reduce((s, c) => s + c.totalEgresos, 0);
    const totalSaldoGlobal = cajasConTotales.reduce((s, c) => s + c.saldoActual, 0);
    const totalSaldoEfectivoGlobal = cajasConTotales.reduce(
      (s, c) => s + c.saldoEfectivo,
      0,
    );

    return {
      resumen: {
        totalCajasAbiertas,
        totalIngresos: Math.round(totalIngresosGlobal * 100) / 100,
        totalEgresos: Math.round(totalEgresosGlobal * 100) / 100,
        totalSaldo: Math.round(totalSaldoGlobal * 100) / 100,
        totalSaldoEfectivo: Math.round(totalSaldoEfectivoGlobal * 100) / 100,
      },
      cajas: cajasConTotales,
    };
  }

  /**
   * Anular un movimiento manual de caja
   * Crea un movimiento inverso (contrapartida) y marca el original como anulado
   */
  async anularMovimiento(
    empresaId: string,
    cajaId: string,
    movimientoId: string,
    usuarioId: string,
    dto: { autorizadoPorId: string; motivo: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const movimiento = await tx.movimientoCaja.findFirst({
        where: { id: movimientoId, cajaId, empresaId },
      });

      if (!movimiento) {
        throw new NotFoundException('Movimiento no encontrado');
      }

      if (movimiento.anulado) {
        throw new BadRequestException('Este movimiento ya fue anulado');
      }

      if (!movimiento.esManual) {
        throw new BadRequestException('Solo se pueden anular movimientos manuales. Los movimientos automaticos se anulan desde su entidad origen (venta, devolucion, etc.)');
      }

      // Verificar que la caja esté abierta
      const caja = await tx.caja.findFirst({
        where: { id: cajaId, empresaId, estado: 'ABIERTA' },
      });

      if (!caja) {
        throw new BadRequestException('La caja debe estar abierta para anular movimientos');
      }

      // Crear movimiento inverso (contrapartida)
      const tipoInverso = movimiento.tipo === 'INGRESO' ? 'EGRESO' : 'INGRESO';

      const contrapartida = await tx.movimientoCaja.create({
        data: {
          cajaId,
          empresaId,
          tipo: tipoInverso as any,
          categoria: movimiento.categoria,
          metodoPago: movimiento.metodoPago,
          monto: movimiento.monto,
          descripcion: `[ANULACION] ${movimiento.descripcion ?? movimiento.categoria} - Motivo: ${dto.motivo}`,
          categoriaGastoId: movimiento.categoriaGastoId,
          esManual: false,
          registradoPorId: usuarioId,
          anulado: true,
        },
      });

      // Marcar original como anulado
      await tx.movimientoCaja.update({
        where: { id: movimientoId },
        data: {
          anulado: true,
          motivoAnulacion: dto.motivo,
          anuladoPorId: usuarioId,
          autorizadoPorId: dto.autorizadoPorId,
          fechaAnulacion: new Date(),
          movimientoContrapartidaId: contrapartida.id,
        },
      });

      return { movimientoAnulado: movimiento, contrapartida };
    });
  }

  // ─── Configuración ───

  async getConfiguracion(empresaId: string) {
    const empresa = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { requiereCajaParaVender: true },
    });
    return { requiereCajaParaVender: empresa?.requiereCajaParaVender ?? false };
  }

  async updateConfiguracion(empresaId: string, requiereCajaParaVender: boolean) {
    await this.prisma.empresa.update({
      where: { id: empresaId },
      data: { requiereCajaParaVender },
    });
    return this.getConfiguracion(empresaId);
  }

  // ─── Helper: generar código de caja ───

  private async _generarCodigoCaja(
    tx: Prisma.TransactionClient,
    empresaId: string,
  ): Promise<string> {
    let config = await tx.configuracionCodigos.findUnique({
      where: { empresaId },
    });

    if (!config) {
      config = await tx.configuracionCodigos.create({
        data: { empresaId },
      });
    }

    const updated = await tx.configuracionCodigos.update({
      where: { empresaId },
      data: {
        ultimaCaja: { increment: 1 },
      },
    });

    const numero = updated.ultimaCaja
      .toString()
      .padStart(config.cajaLongitud, '0');

    return `${config.cajaCodigo}${config.cajaSeparador}${numero}`;
  }
}
