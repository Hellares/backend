import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import {
  EstadoCaja,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
  TipoArqueoCaja,
  Prisma,
} from '@prisma/client';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import { CrearArqueoDto } from './dto/crear-arqueo.dto';

/**
 * Mapeo categoria → tipo natural. Una categoría representa un evento de negocio
 * con polaridad inherente: COMPRA siempre es egreso, VENTA siempre es ingreso.
 * Si llega un movimiento manual con la polaridad inversa, lo rechazamos —
 * casi siempre es un bug de UI (clasificación equivocada en el cliente).
 *
 * Categorías omitidas del map (sin polaridad fija) se aceptan con cualquier tipo.
 */
const CATEGORIA_ES_INGRESO: Partial<Record<CategoriaMovimientoCaja, boolean>> = {
  // Ingresos puros
  [CategoriaMovimientoCaja.VENTA]: true,
  [CategoriaMovimientoCaja.PEDIDO_MARKETPLACE]: true,
  [CategoriaMovimientoCaja.ADELANTO_SERVICIO]: true,
  [CategoriaMovimientoCaja.OTRO_INGRESO]: true,
  // Egresos puros
  [CategoriaMovimientoCaja.COMPRA]: false,
  [CategoriaMovimientoCaja.DEVOLUCION]: false,
  [CategoriaMovimientoCaja.PAGO_PROVEEDOR]: false,
  [CategoriaMovimientoCaja.GASTO_OPERATIVO]: false,
  [CategoriaMovimientoCaja.OTRO_EGRESO]: false,
  [CategoriaMovimientoCaja.REPOSICION_CAJA_CHICA]: false,
  [CategoriaMovimientoCaja.COMISION_AGENTE]: false,
  [CategoriaMovimientoCaja.PAGO_PLANILLA]: false,
  [CategoriaMovimientoCaja.ADELANTO_EMPLEADO]: false,
  [CategoriaMovimientoCaja.BONIFICACION_EMPLEADO]: false,
  // DEPOSITO_AGENTE / RETIRO_AGENTE: pueden ser ambos según la dirección del
  // efectivo respecto al banco — no se valida polaridad.
};

@Injectable()
export class CajaService {
  private readonly logger = new Logger(CajaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificacionService: NotificacionService,
  ) {}

  /**
   * Valida coherencia entre `tipo` y `categoria`. Lanza BadRequest si la
   * polaridad de la categoría es opuesta al tipo. Ver `CATEGORIA_ES_INGRESO`
   * para la tabla de polaridades.
   *
   * Este guard nace de un bug real (2026-05-19): el cliente Flutter clasificaba
   * COMPRA/DEVOLUCION como categorías de INGRESO, y los cajeros las elegían
   * para registrar egresos. Resultado: tipo=INGRESO + categoria=COMPRA →
   * el monto SUMABA al saldo en lugar de RESTAR. El cliente arregló su lado
   * pero acá dejamos la red defensiva.
   */
  private _validarCoherenciaTipoCategoria(
    tipo: TipoMovimientoCaja,
    categoria: CategoriaMovimientoCaja,
  ): void {
    const esIngreso = CATEGORIA_ES_INGRESO[categoria];
    if (esIngreso === undefined) return; // categoría sin polaridad fija
    const esIngresoTipo = tipo === TipoMovimientoCaja.INGRESO;
    if (esIngreso !== esIngresoTipo) {
      const polaridadCat = esIngreso ? 'INGRESO' : 'EGRESO';
      throw new BadRequestException(
        `Categoría ${categoria} es de polaridad ${polaridadCat}, ` +
          `no puede registrarse como tipo=${tipo}. ` +
          `Revisa la selección de tipo/categoría en el formulario.`,
      );
    }
  }

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
  /**
   * Devuelve una caja por id con la misma forma agregada que `getCajaActiva`
   * (sede, usuario, saldos, totales por método). Pensado para que un admin
   * pueda abrir el dashboard de la caja de otro cajero desde el monitor
   * y operarla (arqueo, cerrar) reusando la misma `CajaPage` del cajero.
   *
   * No filtra por `usuarioId` — el guard `VIEW_CAJA` ya autoriza el acceso
   * a nivel empresa. La caja puede estar ABIERTA o CERRADA; el cliente
   * decide qué mostrar según `caja.estado`.
   */
  async getCajaPorId(empresaId: string, cajaId: string) {
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId },
      include: {
        sede: { select: { id: true, nombre: true, codigo: true } },
        sedeFacturacion: {
          select: {
            id: true,
            nombre: true,
            rucSede: true,
            razonSocialSede: true,
          },
        },
        usuario: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        cierre: true,
        _count: { select: { movimientos: true } },
      },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada');
    }

    // Mismo cálculo de saldos que getCajaActiva (groupBy por método +
    // tipo). Si la caja está cerrada, los movimientos siguen siendo los
    // mismos; el cliente puede mostrar el cierre adjunto si existe.
    const resumenPorMetodo = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId, anulado: false },
      _sum: { monto: true },
    });

    const totalIngresos = resumenPorMetodo
      .filter((r) => r.tipo === TipoMovimientoCaja.INGRESO)
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);

    const totalEgresos = resumenPorMetodo
      .filter((r) => r.tipo === TipoMovimientoCaja.EGRESO)
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);

    const montoApertura = Number(caja.montoApertura);
    const saldoActual = montoApertura + totalIngresos - totalEgresos;

    const ingresosEfectivo = resumenPorMetodo
      .filter(
        (r) =>
          r.tipo === TipoMovimientoCaja.INGRESO &&
          r.metodoPago === MetodoPagoVenta.EFECTIVO,
      )
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);
    const egresosEfectivo = resumenPorMetodo
      .filter(
        (r) =>
          r.tipo === TipoMovimientoCaja.EGRESO &&
          r.metodoPago === MetodoPagoVenta.EFECTIVO,
      )
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);
    const saldoEfectivo = montoApertura + ingresosEfectivo - egresosEfectivo;

    return {
      ...caja,
      totalIngresos,
      totalEgresos,
      saldoActual,
      saldoEfectivo,
      totalMovimientos: caja._count.movimientos,
    };
  }

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

    this._validarCoherenciaTipoCategoria(dto.tipo, dto.categoria);

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

    // Construir detalle por método de pago. Excluimos MIXTO: es solo
    // una etiqueta UX para ventas con multi-pago (la fuente real es la
    // tabla PagoVenta que ya desglosa por metodo real), nunca hay un
    // MovimientoCaja con metodoPago=MIXTO. Devolverlo generaba ruido
    // (linea S/0) y ademas el cliente Flutter lo remapeaba a EFECTIVO
    // por su default → duplicaba la linea EFECTIVO en la lista.
    const metodosPago = Object.values(MetodoPagoVenta).filter(
      (m) => m !== MetodoPagoVenta.MIXTO,
    );
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

    // Egreso por anulación de venta: EGRESO + categoría DEVOLUCION +
    // ventaId NOT NULL. La categoría DEVOLUCION en esta caja se crea
    // exclusivamente desde `reversarMovimientosDeOrigen` (helper de
    // anulación), así que cualquier match acá representa dinero que salió
    // de la caja por anular una venta. Sirve para que el cajero vea
    // separadamente cuánto perdió por anulaciones.
    const egresoAnulacionAgg = await this.prisma.movimientoCaja.aggregate({
      where: {
        cajaId,
        anulado: false,
        tipo: TipoMovimientoCaja.EGRESO,
        categoria: CategoriaMovimientoCaja.DEVOLUCION,
        ventaId: { not: null },
      },
      _sum: { monto: true },
      _count: { id: true },
    });
    const egresoAnulacionVenta = Number(egresoAnulacionAgg._sum.monto ?? 0);
    const cantidadAnulaciones = egresoAnulacionAgg._count.id;

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
    // para que el cliente decida ocultar lo que no aplica. Excluimos
    // MIXTO (ver comentario en cerrarCaja: es etiqueta UX, no metodo real).
    const detalles = Object.values(MetodoPagoVenta)
      .filter((m) => m !== MetodoPagoVenta.MIXTO)
      .map((metodo) => {
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
      egresoAnulacionVenta,
      cantidadAnulaciones,
      // Alias `saldo` para el shape que consume ResumenCajaModel del Flutter.
      saldo: saldoActual,
      detalles,
      resumenPorMetodo, // backward compat: groupBy raw por si otro consumer lo usa
      resumenPorCategoria,
    };
  }

  /**
   * Auditoría completa de una caja (abierta o cerrada).
   *
   * Devuelve TODO lo necesario para que el cliente arme la pantalla de
   * "Caja desde Apertura → Cierre":
   *  - Datos de la caja + sede + cajero + duración
   *  - Cierre (si CERRADA) o snapshot de saldos en vivo (si ABIERTA)
   *  - Arqueos intermedios (RUTINARIO/SORPRESIVO/RELEVO) con sus diferencias
   *  - TODOS los movimientos: incluye anulados y contrapartidas (con flags),
   *    para que el auditor vea la historia completa sin omisiones.
   *
   * Diferencia clave vs `getMovimientos`: aquel oculta contrapartidas para
   * limpiar la UI del dashboard; esta auditoría las muestra explícitamente
   * con `esContrapartida=true` para trazabilidad de anulaciones.
   */
  async getAuditoria(empresaId: string, cajaId: string) {
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
        cerradoPor: {
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

    // Movimientos completos (incluye anulados y contrapartidas con flags).
    const movimientosRaw = await this.prisma.movimientoCaja.findMany({
      where: { cajaId },
      orderBy: { fechaMovimiento: 'asc' },
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
        anuladoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    const movimientos = movimientosRaw.map((m) => ({
      ...m,
      esContrapartida: m.movimientoContrapartidaId !== null,
    }));

    // Totales en vivo (siempre, abierta o cerrada — útil para comparar contra
    // el cierre snapshot si está cerrada, o para mostrar saldo actual si abierta).
    const totales = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId, anulado: false },
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
    const saldoActual = montoApertura + totalIngresos - totalEgresos;
    const saldoEfectivo = montoApertura + ingresosEfectivo - egresosEfectivo;

    // Detalle por método: incluye apertura imputada a EFECTIVO. Excluye MIXTO.
    const detallesPorMetodo = Object.values(MetodoPagoVenta)
      .filter((m) => m !== MetodoPagoVenta.MIXTO)
      .map((metodo) => {
        const ingresos = Number(
          totales.find(
            (r) => r.metodoPago === metodo && r.tipo === TipoMovimientoCaja.INGRESO,
          )?._sum.monto ?? 0,
        );
        const egresos = Number(
          totales.find(
            (r) => r.metodoPago === metodo && r.tipo === TipoMovimientoCaja.EGRESO,
          )?._sum.monto ?? 0,
        );
        const apertura = metodo === MetodoPagoVenta.EFECTIVO ? montoApertura : 0;
        return {
          metodoPago: metodo,
          apertura,
          ingresos,
          egresos,
          saldo: apertura + ingresos - egresos,
        };
      });

    // Arqueos intermedios (no afectan saldo, son snapshots).
    const arqueos = await this.prisma.arqueoCaja.findMany({
      where: { cajaId },
      orderBy: { fechaArqueo: 'asc' },
      include: {
        realizadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        autorizadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        turnoEntregadoA: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    return {
      caja,
      // Snapshot en vivo de la caja (refleja BD actual con filtro anulado).
      // Si caja está CERRADA, comparar contra caja.cierre para detectar drift
      // (ej: si se anuló un movimiento DESPUÉS del cierre).
      resumenActual: {
        montoApertura,
        totalIngresos,
        totalEgresos,
        saldoActual,
        saldoEfectivo,
        detallesPorMetodo,
      },
      cierre: caja.cierre, // null si caja está abierta
      arqueos,
      movimientos,
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
            detallePorMetodoPago: true,
            observaciones: true,
            creadoEn: true,
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

        // Último movimiento (excluye anulados y contrapartidas para no
        // mostrar líneas "fantasma" tras una anulación reciente).
        const ultimoMovimiento = await this.prisma.movimientoCaja.findFirst({
          where: {
            cajaId: caja.id,
            anulado: false,
            contrapartidaDe: { is: null },
          },
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
   * Reversar TODOS los MovimientoCaja originados por una venta/devolución/compra.
   *
   * Política (importante para que la caja cuadre):
   *
   *  - Para cada INGRESO original `anulado=false` vinculado al `ventaId`/`devolucionId`/`compraId`:
   *    - Si la caja origen está ABIERTA → se crea contrapartida EGRESO con
   *      `anulado=true` en LA MISMA caja, se marca el original `anulado=true`
   *      y se linkea vía `movimientoContrapartidaId`. Ambos quedan excluidos
   *      del saldo. Sin desfase entre cajas.
   *    - Si la caja origen está CERRADA → el cierre histórico es inmutable.
   *      Se marca el original `anulado=true` para auditoría (no afecta el
   *      cierre snapshot guardado). Si quien anula tiene caja abierta, se
   *      crea EGRESO ajuste ahí (NO anulado, sí cuenta) con descripción que
   *      indica el origen. Si NO tiene caja, se loggea warning y queda pendiente.
   *
   *  - Caso edge: la venta fue cobrada cuando no había caja activa (no hay
   *    MovimientoCaja para esa venta). Si el caller pasa `fallback`, se crea
   *    el ajuste en la caja del que anula con esos datos. Sin `fallback`, no
   *    se hace nada.
   *
   * Devuelve contadores para que el caller pueda loggear/notificar.
   *
   * IMPORTANTE: el caller pasa un `tx` activo; el helper opera enteramente
   * dentro de esa transacción.
   */
  async reversarMovimientosDeOrigen(
    empresaId: string,
    criterio: { ventaId?: string; devolucionId?: string; compraId?: string },
    usuarioIdQuienAnula: string,
    motivo: string,
    fallback: {
      sedeId: string;
      pagos: Array<{ metodoPago: MetodoPagoVenta; monto: number }>;
    } | null,
    tx: Prisma.TransactionClient,
  ): Promise<{
    reversadosEnCajaOriginal: number;
    ajustesEnCajaActual: number;
    sinCompensar: number;
  }> {
    const where: Prisma.MovimientoCajaWhereInput = {
      empresaId,
      anulado: false,
      tipo: TipoMovimientoCaja.INGRESO,
    };
    if (criterio.ventaId) where.ventaId = criterio.ventaId;
    if (criterio.devolucionId) where.devolucionId = criterio.devolucionId;
    if (criterio.compraId) where.compraId = criterio.compraId;

    const originales = await tx.movimientoCaja.findMany({
      where,
      include: {
        caja: {
          select: { id: true, estado: true, sedeId: true, usuarioId: true, codigo: true },
        },
      },
    });

    const cajaActualDelQueAnula = await tx.caja.findFirst({
      where: { empresaId, usuarioId: usuarioIdQuienAnula, estado: EstadoCaja.ABIERTA },
      select: { id: true, sedeId: true, codigo: true },
    });

    let reversadosEnCajaOriginal = 0;
    let ajustesEnCajaActual = 0;
    let sinCompensar = 0;

    for (const orig of originales) {
      const descrBase = `[ANULACION ${motivo}] Reverso de ${orig.descripcion ?? orig.categoria}`;

      if (orig.caja.estado === EstadoCaja.ABIERTA) {
        // Caja origen sigue abierta — reverso limpio en la misma caja.
        const contrapartida = await tx.movimientoCaja.create({
          data: {
            cajaId: orig.caja.id,
            empresaId,
            tipo: TipoMovimientoCaja.EGRESO,
            categoria: CategoriaMovimientoCaja.DEVOLUCION,
            metodoPago: orig.metodoPago,
            monto: orig.monto,
            descripcion: descrBase,
            ventaId: orig.ventaId,
            devolucionId: orig.devolucionId,
            compraId: orig.compraId,
            esManual: false,
            registradoPorId: usuarioIdQuienAnula,
            anulado: true,
          },
        });

        await tx.movimientoCaja.update({
          where: { id: orig.id },
          data: {
            anulado: true,
            motivoAnulacion: motivo,
            anuladoPorId: usuarioIdQuienAnula,
            fechaAnulacion: new Date(),
            movimientoContrapartidaId: contrapartida.id,
          },
        });

        reversadosEnCajaOriginal++;
      } else {
        // Caja origen ya cerrada — cierre snapshot inmutable.
        // Marcamos original anulado SOLO para auditoría en el listado.
        await tx.movimientoCaja.update({
          where: { id: orig.id },
          data: {
            anulado: true,
            motivoAnulacion: `${motivo} | Caja origen ${orig.caja.codigo} ya cerrada; ajuste compensatorio aparte`,
            anuladoPorId: usuarioIdQuienAnula,
            fechaAnulacion: new Date(),
          },
        });

        if (cajaActualDelQueAnula) {
          await tx.movimientoCaja.create({
            data: {
              cajaId: cajaActualDelQueAnula.id,
              empresaId,
              tipo: TipoMovimientoCaja.EGRESO,
              categoria: CategoriaMovimientoCaja.DEVOLUCION,
              metodoPago: orig.metodoPago,
              monto: orig.monto,
              descripcion: `${descrBase} | Caja origen ${orig.caja.codigo} cerrada — ajuste contable aquí`,
              ventaId: orig.ventaId,
              devolucionId: orig.devolucionId,
              compraId: orig.compraId,
              esManual: false,
              registradoPorId: usuarioIdQuienAnula,
              anulado: false,
            },
          });
          ajustesEnCajaActual++;
        } else {
          sinCompensar++;
          this.logger.warn(
            `reversarMovimientosDeOrigen: original ${orig.id} (caja ${orig.caja.codigo} CERRADA) marcado anulado pero NO compensado — quien anula (${usuarioIdQuienAnula}) no tiene caja abierta. Tesorería debe ajustar.`,
          );
        }
      }
    }

    // Sin movimientos originales pero sí hubo cobranza física → usar fallback.
    // Casos: venta cobrada cuando no había caja activa, o cobranza vía
    // sistema externo. El caller decide si pasarlo.
    if (originales.length === 0 && fallback && fallback.pagos.length > 0) {
      if (cajaActualDelQueAnula) {
        for (const p of fallback.pagos) {
          await tx.movimientoCaja.create({
            data: {
              cajaId: cajaActualDelQueAnula.id,
              empresaId,
              tipo: TipoMovimientoCaja.EGRESO,
              categoria: CategoriaMovimientoCaja.DEVOLUCION,
              metodoPago: p.metodoPago,
              monto: p.monto,
              descripcion: `[ANULACION ${motivo}] Sin movimiento de caja original; ajuste compensatorio`,
              ventaId: criterio.ventaId,
              devolucionId: criterio.devolucionId,
              compraId: criterio.compraId,
              esManual: false,
              registradoPorId: usuarioIdQuienAnula,
              anulado: false,
            },
          });
          ajustesEnCajaActual++;
        }
      } else {
        sinCompensar += fallback.pagos.length;
        this.logger.warn(
          `reversarMovimientosDeOrigen: sin movimientos originales, con pagos fallback (${fallback.pagos.length}), pero quien anula (${usuarioIdQuienAnula}) no tiene caja abierta. Nada compensado.`,
        );
      }
    }

    return { reversadosEnCajaOriginal, ajustesEnCajaActual, sinCompensar };
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

  // ─── Arqueos de caja ───

  /**
   * Crear arqueo (conteo intermedio sin cerrar la caja).
   *
   * Validaciones por tipo:
   * - SORPRESIVO: el que realiza no puede ser el cajero titular (es
   *   auditoria, autoauditarse no tiene sentido).
   * - RELEVO: turnoEntregadoAId requerido + debe ser usuario de la
   *   misma empresa.
   * - RUTINARIO: cualquiera con permiso puede.
   *
   * Si la diferencia (sobrante o faltante) supera el umbral, dispara
   * push al owner de la empresa.
   */
  async crearArqueo(
    empresaId: string,
    cajaId: string,
    realizadoPorId: string,
    dto: CrearArqueoDto,
  ) {
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId },
      select: {
        id: true,
        codigo: true,
        estado: true,
        usuarioId: true,
        montoApertura: true,
        sede: { select: { id: true, nombre: true } },
        usuario: {
          select: {
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    if (!caja) throw new NotFoundException('Caja no encontrada');
    if (caja.estado !== EstadoCaja.ABIERTA) {
      throw new BadRequestException(
        'Solo se puede arquear una caja ABIERTA. Para auditar una caja cerrada, mira el resumen de cierre.',
      );
    }

    // ── Validaciones especificas por tipo ──
    if (dto.tipo === TipoArqueoCaja.SORPRESIVO) {
      if (realizadoPorId === caja.usuarioId) {
        throw new ForbiddenException(
          'Un arqueo SORPRESIVO debe realizarlo alguien distinto al cajero titular (auditoria externa).',
        );
      }
    }
    if (dto.tipo === TipoArqueoCaja.RELEVO) {
      if (!dto.turnoEntregadoAId) {
        throw new BadRequestException(
          'Arqueo de RELEVO requiere indicar el usuario que recibe el turno.',
        );
      }
      const sucesor = await this.prisma.usuario.findFirst({
        where: { id: dto.turnoEntregadoAId },
        select: { id: true, empresas: { where: { empresaId } } },
      });
      if (!sucesor || sucesor.empresas.length === 0) {
        throw new BadRequestException(
          'El usuario que recibe el turno no pertenece a esta empresa.',
        );
      }
    }

    // ── Calcular totales por metodo (mismo patron que cerrarCaja) ──
    const movimientos = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId, anulado: false },
      _sum: { monto: true },
    });

    const metodosPago = Object.values(MetodoPagoVenta).filter(
      (m) => m !== MetodoPagoVenta.MIXTO,
    );
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

      const apertura = metodo === MetodoPagoVenta.EFECTIVO ? montoApertura : 0;
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

    // ── Validar desglose efectivo (si se envia) ──
    // Suma de (denominacion * cantidad) debe coincidir con el conteo
    // EFECTIVO (tolerancia 1 centavo por redondeos).
    if (dto.desgloseEfectivo) {
      const sumaDesglose = Object.entries(dto.desgloseEfectivo).reduce(
        (s, [denom, cant]) => s + Number(denom) * Number(cant),
        0,
      );
      const conteoEfectivo =
        detallePorMetodoPago[MetodoPagoVenta.EFECTIVO]?.conteoFisico ?? 0;
      if (Math.abs(sumaDesglose - conteoEfectivo) > 0.01) {
        throw new BadRequestException(
          `Desglose de efectivo (S/ ${sumaDesglose.toFixed(2)}) no coincide con el conteo fisico EFECTIVO (S/ ${conteoEfectivo.toFixed(2)}).`,
        );
      }
    }

    // ── Crear arqueo ──
    const arqueo = await this.prisma.arqueoCaja.create({
      data: {
        cajaId,
        empresaId,
        tipo: dto.tipo,
        montoApertura,
        totalIngresos,
        totalEgresos,
        totalEsperado,
        totalConteoFisico,
        diferencia,
        detallePorMetodoPago,
        desgloseEfectivo: dto.desgloseEfectivo ?? undefined,
        observaciones: dto.observaciones,
        realizadoPorId,
        autorizadoPorId: dto.autorizadoPorId ?? null,
        turnoEntregadoAId: dto.turnoEntregadoAId ?? null,
      },
      include: {
        realizadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        autorizadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        turnoEntregadoA: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        caja: {
          select: {
            id: true,
            codigo: true,
            sede: { select: { id: true, nombre: true } },
          },
        },
      },
    });

    // ── Alertar al admin si hay diferencia significativa ──
    // Umbral: S/1.00 (centavos no califican como sospechoso).
    if (Math.abs(diferencia) >= 1) {
      await this._notificarDiferencia(empresaId, arqueo, caja).catch((err) =>
        this.logger.warn(
          `No se pudo enviar alerta de arqueo ${arqueo.id}: ${err.message}`,
        ),
      );
      await this.prisma.arqueoCaja.update({
        where: { id: arqueo.id },
        data: { alertaEnviada: true },
      });
    }

    return arqueo;
  }

  /**
   * Listar arqueos de una caja, mas reciente primero.
   */
  async getArqueos(empresaId: string, cajaId: string) {
    const caja = await this.prisma.caja.findFirst({
      where: { id: cajaId, empresaId },
      select: { id: true },
    });
    if (!caja) throw new NotFoundException('Caja no encontrada');

    return this.prisma.arqueoCaja.findMany({
      where: { cajaId },
      orderBy: { fechaArqueo: 'desc' },
      include: {
        realizadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        autorizadoPor: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        turnoEntregadoA: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });
  }

  /**
   * Envia push a admins/gerentes de la empresa cuando un arqueo arroja
   * diferencia material. Receptores: usuarios con rol GERENTE_SEDE o
   * ADMINISTRADOR en cualquier sede de la empresa (distinct para no
   * enviar duplicados si un user es admin de varias sedes).
   */
  private async _notificarDiferencia(
    empresaId: string,
    arqueo: {
      id: string;
      tipo: TipoArqueoCaja;
      diferencia: Prisma.Decimal;
    },
    caja: {
      codigo: string;
      sede: { nombre: string } | null;
      usuario: {
        persona: { nombres: string; apellidos: string } | null;
      } | null;
    },
  ) {
    const adminRoles = await this.prisma.usuarioSedeRol.findMany({
      where: {
        rol: { in: ['GERENTE_SEDE', 'ADMINISTRADOR'] },
        sede: { empresaId },
      },
      select: { usuarioId: true },
      distinct: ['usuarioId'],
    });
    if (adminRoles.length === 0) return;

    const diff = Number(arqueo.diferencia);
    const signo = diff > 0 ? 'sobrante' : 'faltante';
    const cajero = caja.usuario?.persona
      ? `${caja.usuario.persona.nombres} ${caja.usuario.persona.apellidos}`.trim()
      : 'desconocido';

    const titulo = `Arqueo ${arqueo.tipo.toLowerCase()}: ${signo} en ${caja.codigo}`;
    const cuerpo = `Diferencia de S/ ${Math.abs(diff).toFixed(2)} (${signo}) detectada en ${caja.codigo} (${caja.sede?.nombre ?? 'sede'}). Cajero: ${cajero}.`;

    await Promise.all(
      adminRoles.map((r) =>
        this.notificacionService.enviarAUsuario(r.usuarioId, titulo, cuerpo, {
          empresaId,
          data: {
            tipo: 'ARQUEO_CAJA_DIFERENCIA',
            arqueoId: arqueo.id,
          },
          respetarPreferencias: false,
        }),
      ),
    );
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
