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
  FuenteEgreso,
  EstadoAdelanto,
  EstadoBoletaPago,
  Prisma,
} from '@prisma/client';
import { AbrirCajaDto } from './dto/abrir-caja.dto';
import { CerrarCajaDto } from './dto/cerrar-caja.dto';
import { CrearMovimientoDto } from './dto/crear-movimiento.dto';
import { CrearArqueoDto } from './dto/crear-arqueo.dto';
import { AjusteTesoreriaDto } from './dto/ajuste-tesoreria.dto';
import { destinoBarrido } from './caja-barrido.util';

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
  [CategoriaMovimientoCaja.ADELANTO_COTIZACION]: true,
  [CategoriaMovimientoCaja.OTRO_INGRESO]: true,
  // Egresos puros
  [CategoriaMovimientoCaja.COMPRA]: false,
  [CategoriaMovimientoCaja.DEVOLUCION]: false,
  [CategoriaMovimientoCaja.DEVOLUCION_ADELANTO_COTIZACION]: false,
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

/**
 * Categorías reservadas a flujos del sistema: barrido del cierre de caja,
 * reversos de cajas cerradas y ajustes desde el endpoint de tesorería.
 * Un movimiento MANUAL con una de estas falsearía la trazabilidad de
 * tesorería (p.ej. un "barrido" que ningún cierre generó).
 */
const CATEGORIAS_SOLO_SISTEMA: CategoriaMovimientoCaja[] = [
  CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
  CategoriaMovimientoCaja.RETIRO_TESORERIA,
  CategoriaMovimientoCaja.AJUSTE_TESORERIA,
  CategoriaMovimientoCaja.REVERSO_CAJA_CERRADA,
];

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
    try {
      return await this._abrirCajaTx(empresaId, usuarioId, dto);
    } catch (e) {
      // Índice parcial Caja_usuario_abierta_unique (mig 20260612120000):
      // el perdedor de una carrera de doble-apertura choca con P2002.
      // Traducirlo al mismo 400 que la validación normal.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Ya tienes una caja abierta. Ciérrala antes de abrir una nueva.',
        );
      }
      throw e;
    }
  }

  private async _abrirCajaTx(
    empresaId: string,
    usuarioId: string,
    dto: AbrirCajaDto,
  ) {
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
          esCajaCentral: false, // la central no tiene cajero, defensa
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

      const caja = await tx.caja.create({
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

      // Si la apertura tiene seed > 0, el dinero sale de la Caja Central
      // (tesorería) de la sede. EGRESO RETIRO_TESORERIA en la central; NO
      // se crea INGRESO espejo en la operativa (el campo Caja.montoApertura
      // ya trackea el seed para el cálculo del esperado al cerrar).
      // Al cerrar, el barrido devuelve el conteo físico completo (seed +
      // ventas - egresos efectivo) a la central → ciclo cuadrado.
      const montoAperturaNum = Number(dto.montoApertura);
      if (montoAperturaNum > 0) {
        const central = await this.getOrCreateCajaCentral(
          empresaId,
          dto.sedeId,
          tx,
        );
        await tx.movimientoCaja.create({
          data: {
            cajaId: central.id,
            empresaId,
            tipo: TipoMovimientoCaja.EGRESO,
            categoria: CategoriaMovimientoCaja.RETIRO_TESORERIA,
            metodoPago: MetodoPagoVenta.EFECTIVO,
            monto: montoAperturaNum,
            descripcion: `Retiro para apertura ${caja.codigo}`,
            esManual: false,
            registradoPorId: usuarioId,
            metadata: {
              cajaAperturaId: caja.id,
              cajaAperturaCodigo: caja.codigo,
              esRetiroApertura: true,
            },
          },
        });
      }

      return caja;
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
    // Excluimos DEPOSITO/RETIRO_TESORERIA (barrido auto del cierre)
    // para que el saldo recalculado coincida con el snapshot.
    const resumenPorMetodo = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: {
        cajaId,
        anulado: false,
        categoria: {
          notIn: [
            CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
            CategoriaMovimientoCaja.RETIRO_TESORERIA,
          ],
        },
      },
      _sum: { monto: true },
    });

    const totalIngresos = resumenPorMetodo
      .filter((r) => r.tipo === TipoMovimientoCaja.INGRESO)
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);

    const totalEgresos = resumenPorMetodo
      .filter((r) => r.tipo === TipoMovimientoCaja.EGRESO)
      .reduce((sum, r) => sum + Number(r._sum.monto ?? 0), 0);

    const montoApertura = Number(caja.montoApertura);
    const saldoActual = Math.round((montoApertura + totalIngresos - totalEgresos) * 100) / 100;

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
    const saldoEfectivo = Math.round((montoApertura + ingresosEfectivo - egresosEfectivo) * 100) / 100;

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
        esCajaCentral: false, // la central no tiene cajero, defensa
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
      where: {
        cajaId: caja.id,
        anulado: false,
        categoria: {
          notIn: [
            CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
            CategoriaMovimientoCaja.RETIRO_TESORERIA,
          ],
        },
      },
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
      saldoActual: Math.round((montoApertura + totalIngresos - totalEgresos) * 100) / 100,
      saldoEfectivo: Math.round((montoApertura + ingresosEfectivo - egresosEfectivo) * 100) / 100,
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

    if (CATEGORIAS_SOLO_SISTEMA.includes(dto.categoria)) {
      throw new BadRequestException(
        `La categoría ${dto.categoria} la genera el sistema (cierres, reversos, tesorería) y no puede registrarse manualmente`,
      );
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
      ordenServicioId?: string;
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
        ordenServicioId: data.ordenServicioId,
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
      ordenServicioId?: string;
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
   * Registra movimiento en la caja del usuario. Si no tiene caja abierta,
   * cae a la Caja Central (Tesorería) de la sede — NUNCA se pierde el
   * movimiento. Usar para operaciones donde el egreso/ingreso DEBE quedar
   * registrado (devoluciones, etc.).
   */
  async registrarMovimientoEnCajaOTesoreria(
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
      devolucionId?: string;
      compraId?: string;
      cotizacionId?: string;
      ordenServicioId?: string;
      metadata?: any;
    },
    tx: Prisma.TransactionClient,
  ) {
    const cajaActiva = await tx.caja.findFirst({
      where: { empresaId, sedeId, usuarioId, estado: EstadoCaja.ABIERTA, esCajaCentral: false },
    });

    if (cajaActiva) {
      return tx.movimientoCaja.create({
        data: {
          cajaId: cajaActiva.id,
          empresaId,
          tipo: data.tipo,
          categoria: data.categoria,
          metodoPago: data.metodoPago,
          monto: data.monto,
          descripcion: data.descripcion,
          ventaId: data.ventaId,
          devolucionId: data.devolucionId,
          compraId: data.compraId,
          cotizacionId: data.cotizacionId,
          ordenServicioId: data.ordenServicioId,
          esManual: false,
          registradoPorId: usuarioId,
          metadata: data.metadata ?? undefined,
        },
      });
    }

    const central = await this.getOrCreateCajaCentral(empresaId, sedeId, tx);
    return tx.movimientoCaja.create({
      data: {
        cajaId: central.id,
        empresaId,
        tipo: data.tipo,
        categoria: data.categoria,
        metodoPago: data.metodoPago,
        monto: data.monto,
        descripcion: `[TESORERÍA] ${data.descripcion ?? data.categoria}`,
        ventaId: data.ventaId,
        devolucionId: data.devolucionId,
        compraId: data.compraId,
        cotizacionId: data.cotizacionId,
        ordenServicioId: data.ordenServicioId,
        esManual: false,
        registradoPorId: usuarioId,
        metadata: {
          ...(data.metadata ?? {}),
          sinCajaOperativa: true,
          usuarioOriginalId: usuarioId,
        },
      },
    });
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
        // Estado de la cotizacion permite que el cliente muestre badge
        // "DEVUELTO" en el ADELANTO_COTIZACION cuando la cotizacion
        // termino en RECHAZADA con devolucion registrada.
        cotizacion: { select: { id: true, codigo: true, estado: true } },
        // Badge "OS-XXXXX": adelantos de orden de servicio y ventas que
        // cobran una orden quedan vinculados visualmente a su orden.
        ordenServicio: { select: { id: true, codigo: true } },
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
      include: {
        usuario: {
          select: {
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
      },
    });

    if (!caja) {
      throw new NotFoundException('Caja no encontrada o no está abierta');
    }

    if (caja.esCajaCentral) {
      throw new BadRequestException(
        'La Caja Central de Tesorería es perpetua y no se cierra. Solo cajas operativas pueden cerrarse.',
      );
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
      const esperado = Math.round((apertura + ingresos - egresos) * 100) / 100;
      const conteo = dto.conteos.find((c) => c.metodoPago === metodo);
      const conteoFisico = conteo?.conteoFisico ?? 0;

      detallePorMetodoPago[metodo] = {
        apertura,
        ingresos,
        egresos,
        esperado,
        conteoFisico,
        diferencia: Math.round((conteoFisico - esperado) * 100) / 100,
      };
    }

    const totalEsperado = Math.round((montoApertura + totalIngresos - totalEgresos) * 100) / 100;
    const totalConteoFisico = dto.conteos.reduce(
      (sum, c) => sum + c.conteoFisico,
      0,
    );
    const diferencia = Math.round((totalConteoFisico - totalEsperado) * 100) / 100;

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

      // ── Barrido a Caja Central (Tesoreria) ──
      // Por cada metodo con conteoFisico > 0, generamos el par espejo:
      //   EGRESO en la caja operativa  (sale el dinero declarado)
      //   INGRESO en la Caja Central   (lo recibe la tesoreria de la sede)
      // Vinculo: descripcion rica + metadata.movimientoEspejoId/cierreId.
      // NO usamos `movimientoContrapartidaId` porque ese campo esta
      // reservado para el par INGRESO↔EGRESO de ANULACIONES (el filtro
      // `contrapartidaDe.is:null` que usa el listado las oculta — acá
      // queremos que ambos lados SI sean visibles en su caja).
      // Solo barremos el conteo declarado. Si hay diferencia con el
      // esperado, queda registrada en `cierre.diferencia` pero NO se
      // arrastra al barrido (la tesoreria recibe lo que el cajero
      // realmente entrego, no lo teorico).
      const central = await this.getOrCreateCajaCentral(
        empresaId,
        caja.sedeId,
        tx,
      );

      // Mapeo método→cuenta de recaudación: el digital configurado cae en su
      // banco (incrementa saldoActual); efectivo y lo no mapeado, en la bóveda.
      const recaudacion = await tx.cuentaRecaudacion.findMany({
        where: { empresaId },
        include: { banco: { select: { id: true, isActive: true, moneda: true } } },
      });
      const mapaBanco = new Map(recaudacion.map((r) => [r.metodoPago, r.banco]));

      // Resumen del barrido (informativo): todos los métodos con conteo > 0 y a
      // dónde fueron (bóveda o banco). Se adjunta a la metadata del INGRESO de
      // tesorería para que la card del cierre muestre el desglose completo,
      // aunque el digital ya no entre a la bóveda (va a los bancos).
      const barridoResumen: { metodoPago: string; monto: number; aBanco: boolean }[] = [];
      for (const metodo of metodosPago) {
        const cf = dto.conteos.find((c) => c.metodoPago === metodo)?.conteoFisico ?? 0;
        if (cf <= 0) continue;
        barridoResumen.push({
          metodoPago: String(metodo),
          monto: cf,
          aBanco: destinoBarrido(metodo, mapaBanco.get(metodo)) === 'BANCO',
        });
      }

      for (const metodo of metodosPago) {
        const conteoFisico =
          dto.conteos.find((c) => c.metodoPago === metodo)?.conteoFisico ?? 0;
        if (conteoFisico <= 0) continue;

        const banco = mapaBanco.get(metodo);
        const destino = destinoBarrido(metodo, banco);
        const aBanco = destino === 'BANCO';

        // EGRESO en la caja operativa: el dinero declarado sale del cajón
        // (independiente de si va a banco o a la bóveda).
        const egreso = await tx.movimientoCaja.create({
          data: {
            cajaId,
            empresaId,
            tipo: TipoMovimientoCaja.EGRESO,
            categoria: CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
            metodoPago: metodo,
            monto: conteoFisico,
            descripcion: aBanco
              ? `[BARRIDO -> BANCO] Depósito de cierre ${caja.codigo}`
              : `[BARRIDO -> TESORERIA] Depósito de cierre ${caja.codigo}`,
            esManual: false,
            registradoPorId: usuarioId,
            metadata: aBanco
              ? { destino: 'BANCO', bancoId: banco!.id, cierreId: cierre.id, barrido: true }
              : { cajaEspejoId: central.id, cierreId: cierre.id, barrido: true },
          },
        });

        if (aBanco) {
          // Digital → incrementa el saldo de la cuenta de recaudación.
          await tx.empresaBanco.update({
            where: { id: banco!.id },
            data: { saldoActual: { increment: conteoFisico } },
          });
        } else {
          // Efectivo / sin mapeo → INGRESO en la Caja Central (bóveda).
          await tx.movimientoCaja.create({
            data: {
              cajaId: central.id,
              empresaId,
              tipo: TipoMovimientoCaja.INGRESO,
              categoria: CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
              metodoPago: metodo,
              monto: conteoFisico,
              descripcion: `[BARRIDO <- ${caja.codigo}] Recepción de cierre`,
              esManual: false,
              registradoPorId: usuarioId,
              metadata: {
                cajaEspejoId: cajaId,
                cajaOrigenCodigo: caja.codigo,
                cajaOrigenUsuarioNombre: caja.usuario?.persona
                  ? `${caja.usuario.persona.nombres ?? ''} ${caja.usuario.persona.apellidos ?? ''}`.trim()
                  : null,
                movimientoEspejoId: egreso.id,
                cierreId: cierre.id,
                barrido: true,
                // Desglose completo del barrido (efectivo + digital→banco) para
                // mostrarlo informativo en la card de tesorería.
                barridoResumen,
              },
            },
          });
        }
      }

      return { caja: cajaActualizada, cierre };
    });

    return result;
  }

  /// Mapea el enum a un label legible. Single source of truth para los
  /// labels que se muestran al cajero — Flutter consume estos strings
  /// directos, así que si agregás una categoría nueva al schema, basta
  /// con sumarla acá.
  private labelCategoria(c: CategoriaMovimientoCaja): string {
    const map: Record<CategoriaMovimientoCaja, string> = {
      VENTA: 'Venta',
      PEDIDO_MARKETPLACE: 'Pedido Marketplace',
      COMPRA: 'Compra',
      DEVOLUCION: 'Devolución',
      ADELANTO_SERVICIO: 'Adelanto Servicio',
      ADELANTO_COTIZACION: 'Adelanto Cotización',
      DEVOLUCION_ADELANTO_COTIZACION: 'Devolución Adelanto Cotización',
      OTRO_INGRESO: 'Otro Ingreso',
      PAGO_PROVEEDOR: 'Pago Proveedor',
      GASTO_OPERATIVO: 'Gasto Operativo',
      OTRO_EGRESO: 'Otro Egreso',
      REPOSICION_CAJA_CHICA: 'Reposición Caja Chica',
      DEPOSITO_AGENTE: 'Depósito Agente',
      RETIRO_AGENTE: 'Retiro Agente',
      COMISION_AGENTE: 'Comisión Agente',
      PAGO_PLANILLA: 'Pago Planilla',
      ADELANTO_EMPLEADO: 'Adelanto Empleado',
      BONIFICACION_EMPLEADO: 'Bonificación Empleado',
      DEPOSITO_TESORERIA: 'Depósito a Tesorería',
      RETIRO_TESORERIA: 'Retiro de Tesorería',
      AJUSTE_TESORERIA: 'Ajuste de Tesorería',
      REVERSO_CAJA_CERRADA: 'Reverso (Caja Cerrada)',
    };
    return map[c] ?? c;
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

    // Excluimos DEPOSITO/RETIRO_TESORERIA: son movimientos auto-generados
    // por el cierre (barrido a Caja Central) y no representan actividad
    // operativa de la caja. Para caja abierta no aparecen aún; para caja
    // cerrada los ocultamos del resumen visible al cajero — el efectivo
    // que muestra coincide con lo "que debe tener" al momento del cierre,
    // antes del barrido.
    const filtroSinBarrido = {
      cajaId,
      anulado: false,
      categoria: {
        notIn: [
          CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
          CategoriaMovimientoCaja.RETIRO_TESORERIA,
        ],
      },
    };

    const resumenPorMetodo = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: filtroSinBarrido,
      _sum: { monto: true },
      _count: { id: true },
    });

    const resumenPorCategoria = await this.prisma.movimientoCaja.groupBy({
      by: ['categoria', 'tipo'],
      where: filtroSinBarrido,
      _sum: { monto: true },
      _count: { id: true },
    });

    // Egreso por anulación de venta: contrapartidas EGRESO creadas por
    // `reversarMovimientosDeOrigen` cuando se anula una venta cuya caja
    // origen sigue abierta. El helper las nace con `anulado: true` para
    // que no afecten el saldo (el INGRESO original también queda anulado;
    // ambos se cancelan), así que NO filtramos por `anulado` acá.
    // La firma (EGRESO + categoría DEVOLUCION + ventaId NOT NULL) solo
    // la produce ese helper — no hay falsos positivos.
    const egresoAnulacionAgg = await this.prisma.movimientoCaja.aggregate({
      where: {
        cajaId,
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
    const saldoActual = Math.round((montoApertura + totalIngresos - totalEgresos) * 100) / 100;

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
        saldo: Math.round((apertura + ingresos - egresos) * 100) / 100,
      };
    });

    // saldoEfectivo = lo que está físicamente en la gaveta. Solo cuenta
    // movimientos en EFECTIVO + apertura. saldoActual mezcla todos los
    // métodos y sirve como "total operado del día".
    const detalleEfectivo = detalles.find(
      (d) => d.metodoPago === MetodoPagoVenta.EFECTIVO,
    );
    const saldoEfectivo = detalleEfectivo?.saldo ?? montoApertura;

    // Desglose de Total Egresos por categoría real (manual) — sin
    // anuladas (que serían las contrapartidas de anulación). Ordenado
    // descendente por monto para que el cajero vea primero lo más grande.
    // Mandamos `label` formateado para que Flutter no tenga que mantener
    // un enum paralelo (hay categorías nuevas como ADELANTO_COTIZACION,
    // PAGO_PLANILLA, etc. que el enum del Flutter no contempla).
    const egresosPorCategoria = resumenPorCategoria
      .filter((r) => r.tipo === TipoMovimientoCaja.EGRESO)
      .map((r) => ({
        categoria: r.categoria,
        label: this.labelCategoria(r.categoria),
        total: Number(r._sum.monto ?? 0),
        cantidad: r._count.id,
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);

    return {
      caja,
      montoApertura,
      totalIngresos,
      totalEgresos,
      saldoActual,
      saldoEfectivo,
      egresoAnulacionVenta,
      cantidadAnulaciones,
      egresosPorCategoria,
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
        cotizacion: { select: { id: true, codigo: true, estado: true } },
        ordenServicio: { select: { id: true, codigo: true } },
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
    // Excluimos DEPOSITO/RETIRO_TESORERIA: son movimientos auto-generados
    // por el propio cierre (barrido a Caja Central). El snapshot del cierre
    // se calcula ANTES de inyectarlos, así que incluirlos al recalcular
    // generaría un drift falso siempre que hubo barrido. Las anulaciones
    // genuinas post-cierre (categoría DEVOLUCION/etc.) sí se reflejan
    // porque el original queda con `anulado: true` y el filtro las excluye.
    const totales = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: {
        cajaId,
        anulado: false,
        categoria: {
          notIn: [
            CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
            CategoriaMovimientoCaja.RETIRO_TESORERIA,
          ],
        },
      },
      _sum: { monto: true },
    });

    // Mismas dos agregaciones que getResumen para que la auditoría
    // muestre el mismo desglose: anulaciones de venta + egresos por
    // categoría real. Ver getResumen para el racional de los filtros.
    const egresoAnulacionAgg = await this.prisma.movimientoCaja.aggregate({
      where: {
        cajaId,
        tipo: TipoMovimientoCaja.EGRESO,
        categoria: CategoriaMovimientoCaja.DEVOLUCION,
        ventaId: { not: null },
      },
      _sum: { monto: true },
      _count: { id: true },
    });
    const egresoAnulacionVenta = Number(egresoAnulacionAgg._sum.monto ?? 0);
    const cantidadAnulaciones = egresoAnulacionAgg._count.id;

    const auditoriaPorCategoria = await this.prisma.movimientoCaja.groupBy({
      by: ['categoria', 'tipo'],
      where: {
        cajaId,
        anulado: false,
        // Mismo motivo que en `totales`: el barrido al cerrar no debe
        // aparecer como egreso operativo.
        categoria: {
          notIn: [
            CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
            CategoriaMovimientoCaja.RETIRO_TESORERIA,
          ],
        },
      },
      _sum: { monto: true },
      _count: { id: true },
    });
    const egresosPorCategoria = auditoriaPorCategoria
      .filter((r) => r.tipo === TipoMovimientoCaja.EGRESO)
      .map((r) => ({
        categoria: r.categoria,
        label: this.labelCategoria(r.categoria),
        total: Number(r._sum.monto ?? 0),
        cantidad: r._count.id,
      }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);

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
    const saldoActual = Math.round((montoApertura + totalIngresos - totalEgresos) * 100) / 100;
    const saldoEfectivo = Math.round((montoApertura + ingresosEfectivo - egresosEfectivo) * 100) / 100;

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
          saldo: Math.round((apertura + ingresos - egresos) * 100) / 100,
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
        egresoAnulacionVenta,
        cantidadAnulaciones,
        egresosPorCategoria,
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
      esCajaCentral: false, // la central nunca se cierra, defensa
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
      esCajaCentral: false, // critico: la central tambien esta ABIERTA, no debe
      // aparecer en el monitor operativo (tiene su propia pantalla de tesoreria).
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
          where: {
            cajaId: caja.id,
            anulado: false,
            categoria: {
              notIn: [
                CategoriaMovimientoCaja.DEPOSITO_TESORERIA,
                CategoriaMovimientoCaja.RETIRO_TESORERIA,
              ],
            },
          },
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
          saldoActual: Math.round((montoApertura + totalIngresos - totalEgresos) * 100) / 100,
          saldoEfectivo: Math.round((montoApertura + ingresosEfectivo - egresosEfectivo) * 100) / 100,
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
   * Política (modelo Caja Central):
   *
   *  - Para cada INGRESO original `anulado=false` vinculado al `ventaId`/`devolucionId`/`compraId`:
   *    - Si la caja origen está ABIERTA → se crea contrapartida EGRESO con
   *      `anulado=true` en LA MISMA caja, se marca el original `anulado=true`
   *      y se linkea vía `movimientoContrapartidaId`. Ambos quedan excluidos
   *      del saldo. Sin desfase entre cajas. Categoría DEVOLUCION.
   *    - Si la caja origen está CERRADA → el cierre histórico es inmutable.
   *      Se marca el original `anulado=true` SOLO para auditoría (no afecta
   *      el snapshot guardado). El EGRESO compensatorio sale de la
   *      CAJA CENTRAL DE LA SEDE DEL ORIGINAL (no de quien anula). Esto
   *      preserva la caja del admin/supervisor limpia y respeta multi-sede:
   *      si anulan venta de sede B desde sede A, la tesorería de B absorbe.
   *      Categoría REVERSO_CAJA_CERRADA, `anulado=false` (cuenta en saldo).
   *
   *  - Caso edge: la venta fue cobrada cuando no había caja activa (no hay
   *    MovimientoCaja para esa venta). Si el caller pasa `fallback`, el EGRESO
   *    va a la Caja Central de la sede del fallback (donde se hizo la venta).
   *
   * Devuelve contadores para que el caller pueda loggear/notificar. Con la
   * Caja Central auto-creada por sede, `sinCompensar` solo crece si la sede
   * no existe — escenario muy improbable.
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
    compensadosEnTesoreria: number;
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
          select: {
            id: true,
            estado: true,
            sedeId: true,
            usuarioId: true,
            codigo: true,
            fechaCierre: true,
            usuario: {
              select: {
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        },
      },
    });

    let reversadosEnCajaOriginal = 0;
    let compensadosEnTesoreria = 0;
    let sinCompensar = 0;

    for (const orig of originales) {
      const descrBase = `[ANULACION ${motivo}] Reverso de ${orig.descripcion ?? orig.categoria}`;

      if (orig.caja.estado === EstadoCaja.ABIERTA) {
        // Caja origen sigue abierta — reverso limpio en la misma caja.
        // Par INGRESO original anulado=true ↔ EGRESO contrapartida anulado=true.
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
        // Caja origen ya CERRADA — cierre snapshot inmutable.
        // Marcamos el original anulado=true solo para auditoría (recalculados
        // recalcularán sin él vs snapshot congelado → drift visible). El
        // EGRESO compensatorio sale de la Caja Central de la SEDE DEL ORIGINAL
        // (no de la caja del que anula) — preserva la caja del admin limpia
        // y respeta multi-sede.
        await tx.movimientoCaja.update({
          where: { id: orig.id },
          data: {
            anulado: true,
            motivoAnulacion: `${motivo} | Caja origen ${orig.caja.codigo} ya cerrada; egreso compensatorio en Tesorería de la sede`,
            anuladoPorId: usuarioIdQuienAnula,
            fechaAnulacion: new Date(),
          },
        });

        const central = await this.getOrCreateCajaCentral(
          empresaId,
          orig.caja.sedeId,
          tx,
        );

        const fechaCierreStr = orig.caja.fechaCierre
          ? orig.caja.fechaCierre.toISOString().slice(0, 10)
          : 'desconocida';

        await tx.movimientoCaja.create({
          data: {
            cajaId: central.id,
            empresaId,
            tipo: TipoMovimientoCaja.EGRESO,
            categoria: CategoriaMovimientoCaja.REVERSO_CAJA_CERRADA,
            metodoPago: orig.metodoPago,
            monto: orig.monto,
            descripcion: `[REVERSO ${motivo}] ${orig.caja.codigo} cerrada ${fechaCierreStr} — devolución desde Tesorería`,
            ventaId: orig.ventaId,
            devolucionId: orig.devolucionId,
            compraId: orig.compraId,
            esManual: false,
            registradoPorId: usuarioIdQuienAnula,
            anulado: false,
            metadata: {
              movimientoOriginalId: orig.id,
              cajaOrigenId: orig.caja.id,
              cajaOrigenCodigo: orig.caja.codigo,
              cajaOrigenUsuarioNombre: orig.caja.usuario?.persona
                ? `${orig.caja.usuario.persona.nombres ?? ''} ${orig.caja.usuario.persona.apellidos ?? ''}`.trim()
                : null,
              fechaCierreOriginal: fechaCierreStr,
              esReversoCajaCerrada: true,
            },
          },
        });

        compensadosEnTesoreria++;
      }
    }

    // Sin movimientos originales pero sí hubo cobranza física → usar fallback.
    // Casos: venta cobrada cuando no había caja activa, o cobranza vía sistema
    // externo. El EGRESO va a la Caja Central de la sede del fallback (donde
    // se hizo la venta), no a la caja del que anula.
    if (originales.length === 0 && fallback && fallback.pagos.length > 0) {
      const central = await this.getOrCreateCajaCentral(
        empresaId,
        fallback.sedeId,
        tx,
      );
      for (const p of fallback.pagos) {
        await tx.movimientoCaja.create({
          data: {
            cajaId: central.id,
            empresaId,
            tipo: TipoMovimientoCaja.EGRESO,
            categoria: CategoriaMovimientoCaja.REVERSO_CAJA_CERRADA,
            metodoPago: p.metodoPago,
            monto: p.monto,
            descripcion: `[REVERSO ${motivo}] Sin caja original — devolución desde Tesorería`,
            ventaId: criterio.ventaId,
            devolucionId: criterio.devolucionId,
            compraId: criterio.compraId,
            esManual: false,
            registradoPorId: usuarioIdQuienAnula,
            anulado: false,
            metadata: {
              sinMovimientoOriginal: true,
              sedeIdFallback: fallback.sedeId,
              esReversoCajaCerrada: true,
            },
          },
        });
        compensadosEnTesoreria++;
      }
    }

    return { reversadosEnCajaOriginal, compensadosEnTesoreria, sinCompensar };
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
      const esperado = Math.round((apertura + ingresos - egresos) * 100) / 100;
      const conteo = dto.conteos.find((c) => c.metodoPago === metodo);
      const conteoFisico = conteo?.conteoFisico ?? 0;

      detallePorMetodoPago[metodo] = {
        apertura,
        ingresos,
        egresos,
        esperado,
        conteoFisico,
        diferencia: Math.round((conteoFisico - esperado) * 100) / 100,
      };
    }

    const totalEsperado = Math.round((montoApertura + totalIngresos - totalEgresos) * 100) / 100;
    const totalConteoFisico = dto.conteos.reduce(
      (sum, c) => sum + c.conteoFisico,
      0,
    );
    const diferencia = Math.round((totalConteoFisico - totalEsperado) * 100) / 100;

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

  // ─── Helper: obtener o crear Caja Central de la sede ───

  /**
   * Obtiene (o crea idempotentemente) la Caja Central de tesoreria de la
   * sede. Existe una sola por sede, perpetua (no se cierra), sin cajero
   * asignado. Absorbe:
   *  - El barrido de efectivo al cerrar caja operativa (Fase 2).
   *  - El EGRESO de compensacion cuando se anula/devuelve una venta cuya
   *    caja origen ya esta CERRADA (Fase 3).
   *  - Ajustes manuales del administrador (deposito/retiro/ajuste).
   *
   * Race-safe: el UNIQUE PARCIAL (sedeId) WHERE esCajaCentral=true
   * impide duplicados a nivel BD. Si dos transacciones concurrentes
   * intentan crearla, una recibe P2002 y refetchea la existente.
   *
   * El caller debe pasar `tx` activo — el helper opera dentro de esa
   * transaccion para que su efecto sea atomico con el flujo que la usa.
   */
  async getOrCreateCajaCentral(
    empresaId: string,
    sedeId: string,
    tx: Prisma.TransactionClient,
  ) {
    const existente = await tx.caja.findFirst({
      where: { empresaId, sedeId, esCajaCentral: true },
    });
    if (existente) return existente;

    // Codigo previsible: TESORERIA-<sedeCodigo>. Si por algun motivo la
    // sede no tiene codigo (legacy), usamos un sufijo del id como fallback.
    const sede = await tx.sede.findUnique({
      where: { id: sedeId },
      select: { codigo: true },
    });
    const codigo = `TESORERIA-${sede?.codigo ?? sedeId.slice(-6).toUpperCase()}`;

    try {
      return await tx.caja.create({
        data: {
          empresaId,
          sedeId,
          usuarioId: null,
          codigo,
          montoApertura: 0,
          estado: EstadoCaja.ABIERTA,
          esCajaCentral: true,
          observacionesApertura:
            'Caja Central de Tesoreria (auto-creada). Acumula el efectivo recaudado de la sede y absorbe egresos de cajas cerradas.',
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const concurrente = await tx.caja.findFirst({
          where: { empresaId, sedeId, esCajaCentral: true },
        });
        if (concurrente) return concurrente;
      }
      throw e;
    }
  }

  // ─── Tesoreria (Caja Central) ───

  /**
   * Resumen de la Caja Central de una sede: saldos por bucket (efectivo y
   * digital separados, segun decision de diseno), totales y ultimo
   * movimiento. Auto-crea la central si no existe.
   */
  async getTesoreriaResumen(empresaId: string, sedeId: string) {
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId },
      select: { id: true, nombre: true, codigo: true },
    });
    if (!sede) {
      throw new NotFoundException('Sede no encontrada');
    }

    const central = await this.prisma.$transaction((tx) =>
      this.getOrCreateCajaCentral(empresaId, sedeId, tx),
    );

    const totales = await this.prisma.movimientoCaja.groupBy({
      by: ['metodoPago', 'tipo'],
      where: { cajaId: central.id, anulado: false },
      _sum: { monto: true },
    });

    let totalIngresos = 0;
    let totalEgresos = 0;
    let ingresosEfectivo = 0;
    let egresosEfectivo = 0;
    let ingresosDigital = 0;
    let egresosDigital = 0;

    for (const row of totales) {
      const monto = Number(row._sum.monto ?? 0);
      const esEfectivo = row.metodoPago === MetodoPagoVenta.EFECTIVO;
      if (row.tipo === TipoMovimientoCaja.INGRESO) {
        totalIngresos += monto;
        if (esEfectivo) ingresosEfectivo += monto;
        else ingresosDigital += monto;
      } else {
        totalEgresos += monto;
        if (esEfectivo) egresosEfectivo += monto;
        else egresosDigital += monto;
      }
    }

    const saldoEfectivo = ingresosEfectivo - egresosEfectivo;
    const saldoDigital = ingresosDigital - egresosDigital;
    const saldoTotal = saldoEfectivo + saldoDigital;

    const ultimoMovimiento = await this.prisma.movimientoCaja.findFirst({
      where: { cajaId: central.id, anulado: false },
      orderBy: { fechaMovimiento: 'desc' },
      select: {
        id: true,
        tipo: true,
        categoria: true,
        monto: true,
        metodoPago: true,
        descripcion: true,
        fechaMovimiento: true,
      },
    });

    const totalMovimientos = await this.prisma.movimientoCaja.count({
      where: { cajaId: central.id },
    });

    return {
      caja: {
        id: central.id,
        codigo: central.codigo,
        sedeId: central.sedeId,
        esCajaCentral: true,
        fechaApertura: central.fechaApertura,
      },
      sede,
      saldoEfectivo: Math.round(saldoEfectivo * 100) / 100,
      saldoDigital: Math.round(saldoDigital * 100) / 100,
      saldoTotal: Math.round(saldoTotal * 100) / 100,
      totalIngresos: Math.round(totalIngresos * 100) / 100,
      totalEgresos: Math.round(totalEgresos * 100) / 100,
      totalMovimientos,
      ultimoMovimiento,
    };
  }

  /**
   * Vista consolidada de tesorería de la empresa: la(s) bóveda(s) de efectivo
   * (Caja Central por sede) + las cuentas bancarias con su saldo y qué método
   * recauda cada una. Es el "dónde está mi plata" tras F2 (digital→bancos).
   * `saldoDigitalHistorico` = digital que quedó en la central de cierres
   * previos a F2 (idealmente 0 de acá en adelante).
   */
  async getTesoreriaConsolidado(empresaId: string) {
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const centrales = await this.prisma.caja.findMany({
      where: { empresaId, esCajaCentral: true },
      include: { sede: { select: { id: true, nombre: true } } },
    });

    const bovedas: any[] = [];
    let totalEfectivo = 0;
    let totalDigitalHistorico = 0;

    for (const central of centrales) {
      const totales = await this.prisma.movimientoCaja.groupBy({
        by: ['metodoPago', 'tipo'],
        where: { cajaId: central.id, anulado: false },
        _sum: { monto: true },
      });
      let efectivo = 0;
      let digital = 0;
      for (const row of totales) {
        const monto = Number(row._sum.monto ?? 0);
        const signed = row.tipo === TipoMovimientoCaja.INGRESO ? monto : -monto;
        if (row.metodoPago === MetodoPagoVenta.EFECTIVO) efectivo += signed;
        else digital += signed;
      }
      efectivo = r2(efectivo);
      digital = r2(digital);
      totalEfectivo += efectivo;
      totalDigitalHistorico += digital;
      bovedas.push({
        sedeId: central.sede?.id ?? central.sedeId,
        sedeNombre: central.sede?.nombre ?? null,
        cajaId: central.id,
        saldoEfectivo: efectivo,
        saldoDigitalHistorico: digital,
      });
    }

    // Bancos + métodos que recauda cada uno
    const [bancos, recaud, recaudado] = await Promise.all([
      this.prisma.empresaBanco.findMany({
        where: { empresaId, isActive: true },
        orderBy: [{ esPrincipal: 'desc' }, { nombreBanco: 'asc' }],
      }),
      this.prisma.cuentaRecaudacion.findMany({ where: { empresaId } }),
      // Cuánto entró a cada banco por método (barrido del cierre + migración).
      // Son los EGRESO de caja/tesorería con metadata.bancoId hacia ese banco.
      this.prisma.$queryRaw<{ bancoId: string; metodoPago: string; total: number }[]>`
        SELECT (metadata->>'bancoId') AS "bancoId", "metodoPago", SUM("monto")::float8 AS total
        FROM "MovimientoCaja"
        WHERE "empresaId" = ${empresaId} AND tipo = 'EGRESO' AND anulado = false
          AND (metadata->>'bancoId') IS NOT NULL
        GROUP BY 1, 2`,
    ]);
    const metodosPorBanco = new Map<string, string[]>();
    for (const r of recaud) {
      const arr = metodosPorBanco.get(r.bancoId) ?? [];
      arr.push(r.metodoPago);
      metodosPorBanco.set(r.bancoId, arr);
    }
    const recaudadoPorBanco = new Map<string, Record<string, number>>();
    for (const r of recaudado) {
      const m = recaudadoPorBanco.get(r.bancoId) ?? {};
      m[r.metodoPago] = Math.round(Number(r.total) * 100) / 100;
      recaudadoPorBanco.set(r.bancoId, m);
    }

    const bancosOut = bancos.map((b) => ({
      id: b.id,
      nombreBanco: b.nombreBanco,
      numeroCuenta: b.numeroCuenta,
      moneda: b.moneda ?? 'PEN',
      esPrincipal: b.esPrincipal,
      saldoActual: b.saldoActual != null ? Number(b.saldoActual) : 0,
      metodos: metodosPorBanco.get(b.id) ?? [],
      // Acumulado de lo que entró por cada método (recaudación). No es el saldo
      // partido por método (los pagos salientes no se atribuyen a un método).
      recaudadoPorMetodo: recaudadoPorBanco.get(b.id) ?? {},
    }));

    const bancosPorMoneda: Record<string, number> = {};
    for (const b of bancosOut) {
      bancosPorMoneda[b.moneda] = r2((bancosPorMoneda[b.moneda] ?? 0) + b.saldoActual);
    }

    // Total global por método (suma de lo recaudado en TODOS los bancos): los
    // chips "Yape X / Plin Y / Tarjeta Z" del desglose de medios digitales.
    const recaudadoPorMetodo: Record<string, number> = {};
    for (const r of recaudado) {
      recaudadoPorMetodo[r.metodoPago] = r2(
        (recaudadoPorMetodo[r.metodoPago] ?? 0) + Number(r.total),
      );
    }

    return {
      bovedas,
      totalEfectivo: r2(totalEfectivo),
      totalDigitalHistorico: r2(totalDigitalHistorico),
      bancos: bancosOut,
      bancosPorMoneda,
      recaudadoPorMetodo,
    };
  }

  /**
   * Migra el DIGITAL HISTÓRICO acumulado en la(s) Caja(s) Central(es) hacia
   * las cuentas bancarias, según el mapeo de recaudación vigente. Para cada
   * método con saldo digital > 0 y cuenta de recaudación activa en PEN:
   *   - EGRESO AJUSTE_TESORERIA en la central (deja el bucket digital en 0),
   *   - incrementa EmpresaBanco.saldoActual,
   *   - registra un AjusteBanco (auditable).
   * Idempotente: tras migrar, el saldo digital queda en 0 y re-ejecutar no hace
   * nada. Lo que no tiene mapeo (o banco inactivo/no-PEN) se omite (queda en
   * tesorería). El EFECTIVO nunca se toca (es la bóveda).
   */
  async migrarDigitalHistorico(empresaId: string, usuarioId: string | null) {
    const r2 = (n: number) => Math.round(n * 100) / 100;

    return this.prisma.$transaction(async (tx) => {
      const centrales = await tx.caja.findMany({
        where: { empresaId, esCajaCentral: true },
        select: { id: true, sedeId: true, codigo: true },
      });
      const recaud = await tx.cuentaRecaudacion.findMany({
        where: { empresaId },
        include: { banco: { select: { id: true, isActive: true, moneda: true, nombreBanco: true } } },
      });
      const mapa = new Map(recaud.map((r) => [r.metodoPago, r.banco]));

      const movido: any[] = [];
      const omitido: any[] = [];
      let totalMovido = 0;

      for (const central of centrales) {
        const totales = await tx.movimientoCaja.groupBy({
          by: ['metodoPago', 'tipo'],
          where: { cajaId: central.id, anulado: false },
          _sum: { monto: true },
        });
        const saldoPorMetodo: Record<string, number> = {};
        for (const row of totales) {
          if (row.metodoPago === MetodoPagoVenta.EFECTIVO) continue; // efectivo = bóveda
          const m = Number(row._sum.monto ?? 0);
          saldoPorMetodo[row.metodoPago] =
            (saldoPorMetodo[row.metodoPago] ?? 0) +
            (row.tipo === TipoMovimientoCaja.INGRESO ? m : -m);
        }

        for (const [metodo, saldoRaw] of Object.entries(saldoPorMetodo)) {
          const monto = r2(saldoRaw);
          if (monto <= 0) continue;

          const banco = mapa.get(metodo as MetodoPagoVenta);
          if (!banco || !banco.isActive || (banco.moneda ?? 'PEN') !== 'PEN') {
            omitido.push({
              sedeId: central.sedeId,
              metodo,
              monto,
              razon: !banco ? 'sin cuenta de recaudación' : 'banco inactivo o no-PEN',
            });
            continue;
          }

          // 1) EGRESO en la central: saca el digital de la bóveda.
          await tx.movimientoCaja.create({
            data: {
              cajaId: central.id,
              empresaId,
              tipo: TipoMovimientoCaja.EGRESO,
              categoria: CategoriaMovimientoCaja.AJUSTE_TESORERIA,
              metodoPago: metodo as MetodoPagoVenta,
              monto,
              descripcion: `[MIGRACIÓN] Digital histórico ${metodo} → ${banco.nombreBanco}`,
              esManual: true,
              registradoPorId: usuarioId ?? undefined,
              metadata: { migracionDigital: true, bancoId: banco.id },
            },
          });

          // 2) Incrementa el saldo del banco. El registro/auditoría es el
          //    MovimientoCaja "[MIGRACIÓN]" de arriba (que también aparece como
          //    recaudación en el estado de cuenta). NO creamos AjusteBanco para
          //    no contar el mismo movimiento dos veces.
          const cuenta = await tx.empresaBanco.findUnique({
            where: { id: banco.id },
            select: { saldoActual: true },
          });
          const anterior = cuenta?.saldoActual != null ? Number(cuenta.saldoActual) : 0;
          await tx.empresaBanco.update({
            where: { id: banco.id },
            data: { saldoActual: r2(anterior + monto) },
          });

          movido.push({ sedeId: central.sedeId, metodo, monto, bancoId: banco.id, nombreBanco: banco.nombreBanco });
          totalMovido += monto;
        }
      }

      return { movido, omitido, totalMovido: r2(totalMovido) };
    });
  }

  /**
   * Listado paginado de movimientos de la Caja Central de una sede, con
   * filtros opcionales (tipo, metodo, categoria, fechas, busqueda libre).
   */
  async getTesoreriaMovimientos(
    empresaId: string,
    sedeId: string,
    filtros: {
      tipo?: string;
      metodoPago?: string;
      categoria?: string;
      fechaDesde?: string;
      fechaHasta?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId },
      select: { id: true },
    });
    if (!sede) {
      throw new NotFoundException('Sede no encontrada');
    }

    const central = await this.prisma.$transaction((tx) =>
      this.getOrCreateCajaCentral(empresaId, sedeId, tx),
    );

    const page = Math.max(1, filtros.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filtros.pageSize ?? 50));

    const where: Prisma.MovimientoCajaWhereInput = {
      cajaId: central.id,
      empresaId,
    };
    if (filtros.tipo) {
      where.tipo = filtros.tipo as TipoMovimientoCaja;
    }
    if (filtros.metodoPago) {
      where.metodoPago = filtros.metodoPago as MetodoPagoVenta;
    }
    if (filtros.categoria) {
      where.categoria = filtros.categoria as CategoriaMovimientoCaja;
    }
    if (filtros.fechaDesde || filtros.fechaHasta) {
      where.fechaMovimiento = {};
      if (filtros.fechaDesde) {
        where.fechaMovimiento.gte = new Date(filtros.fechaDesde);
      }
      if (filtros.fechaHasta) {
        where.fechaMovimiento.lte = new Date(filtros.fechaHasta);
      }
    }
    if (filtros.q) {
      where.descripcion = { contains: filtros.q, mode: 'insensitive' };
    }

    // Rango de fechas (para filtrar también los egresos bancarios de RRHH).
    const rango =
      filtros.fechaDesde || filtros.fechaHasta
        ? {
            ...(filtros.fechaDesde
              ? { gte: new Date(filtros.fechaDesde) }
              : {}),
            ...(filtros.fechaHasta
              ? { lte: new Date(filtros.fechaHasta) }
              : {}),
          }
        : undefined;

    const TOPE = 500;
    const empSel = {
      empleado: {
        select: {
          usuario: {
            select: {
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      },
    };

    // Movimientos REALES de la central + egresos BANCARIOS de RRHH (informativos:
    // no son MovimientoCaja, salieron de un banco; se muestran para que el
    // egreso sea visible en la lista de tesorería "afecta <Banco>").
    const [centralMovs, adelantos, boletas, bancos] = await Promise.all([
      this.prisma.movimientoCaja.findMany({
        where,
        orderBy: { fechaMovimiento: 'desc' },
        take: TOPE,
        include: {
          registradoPor: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
          venta: { select: { id: true, codigo: true } },
          compra: { select: { id: true, codigo: true } },
          devolucion: { select: { id: true, codigo: true } },
          cotizacion: { select: { id: true, codigo: true, estado: true } },
        },
      }),
      this.prisma.adelantoPago.findMany({
        where: {
          empresaId,
          fuentePago: FuenteEgreso.BANCO,
          bancoId: { not: null },
          estado: EstadoAdelanto.PAGADO_ADELANTO,
          empleado: { sedeId },
          ...(rango ? { actualizadoEn: rango } : {}),
        },
        orderBy: { actualizadoEn: 'desc' },
        take: TOPE,
        select: {
          id: true,
          monto: true,
          metodoPago: true,
          bancoId: true,
          actualizadoEn: true,
          ...empSel,
        },
      }),
      this.prisma.boletaPago.findMany({
        where: {
          empresaId,
          fuentePago: FuenteEgreso.BANCO,
          bancoId: { not: null },
          estado: EstadoBoletaPago.PAGADA_BOLETA,
          empleado: { sedeId },
          ...(rango ? { fechaPago: rango } : {}),
        },
        orderBy: { fechaPago: 'desc' },
        take: TOPE,
        select: {
          id: true,
          totalNeto: true,
          metodoPago: true,
          bancoId: true,
          fechaPago: true,
          periodo: { select: { periodo: true } },
          ...empSel,
        },
      }),
      this.prisma.empresaBanco.findMany({
        where: { empresaId },
        select: { id: true, nombreBanco: true },
      }),
    ]);

    const bancoNombre = new Map(bancos.map((b) => [b.id, b.nombreBanco]));
    const nombreEmp = (x: any): string => {
      const p = x?.empleado?.usuario?.persona;
      return p ? `${p.nombres ?? ''} ${p.apellidos ?? ''}`.trim() : '';
    };

    let bancarios: any[] = [
      ...adelantos.map((a) => ({
        id: `adelanto-${a.id}`,
        cajaId: central.id,
        tipo: 'EGRESO',
        categoria: 'ADELANTO_EMPLEADO',
        metodoPago: a.metodoPago ?? 'EFECTIVO',
        monto: Number(a.monto),
        descripcion: `[${bancoNombre.get(a.bancoId!) ?? 'Banco'}] Adelanto de sueldo - ${nombreEmp(a)}`.trim(),
        fechaMovimiento: a.actualizadoEn,
        esManual: false,
        anulado: false,
        esBancario: true,
        bancoNombre: bancoNombre.get(a.bancoId!) ?? null,
      })),
      ...boletas.map((b) => ({
        id: `boleta-${b.id}`,
        cajaId: central.id,
        tipo: 'EGRESO',
        categoria: 'PAGO_PLANILLA',
        metodoPago: b.metodoPago ?? 'EFECTIVO',
        monto: Number(b.totalNeto),
        descripcion: `[${bancoNombre.get(b.bancoId!) ?? 'Banco'}] Pago planilla ${b.periodo?.periodo ?? ''} - ${nombreEmp(b)}`.trim(),
        fechaMovimiento: b.fechaPago,
        esManual: false,
        anulado: false,
        esBancario: true,
        bancoNombre: bancoNombre.get(b.bancoId!) ?? null,
      })),
    ];

    // Aplicar los mismos filtros a los ítems bancarios (son egresos).
    if (filtros.tipo && filtros.tipo !== 'EGRESO') bancarios = [];
    if (filtros.categoria) {
      bancarios = bancarios.filter((i) => i.categoria === filtros.categoria);
    }
    if (filtros.metodoPago) {
      bancarios = bancarios.filter((i) => i.metodoPago === filtros.metodoPago);
    }
    if (filtros.q) {
      const q = filtros.q.toLowerCase();
      bancarios = bancarios.filter((i) =>
        i.descripcion.toLowerCase().includes(q),
      );
    }

    const todos = [...centralMovs, ...bancarios].sort(
      (a, b) =>
        new Date(b.fechaMovimiento).getTime() -
        new Date(a.fechaMovimiento).getTime(),
    );
    const total = todos.length;
    const start = (page - 1) * pageSize;
    const items = todos.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Ajuste manual en la Caja Central de una sede. Crea un movimiento con
   * categoria=AJUSTE_TESORERIA (visible como deposito o retiro segun
   * `tipo`). Pensado para que el admin compense diferencias post-cierre,
   * registre retiros de tesoreria a banco, o haga correcciones contables.
   *
   * NO usa el guard `_validarCoherenciaTipoCategoria` porque AJUSTE_TESORERIA
   * es ambigua por diseño (acepta INGRESO y EGRESO).
   */
  async crearAjusteTesoreria(
    empresaId: string,
    sedeId: string,
    usuarioId: string,
    dto: AjusteTesoreriaDto,
  ) {
    const sede = await this.prisma.sede.findFirst({
      where: { id: sedeId, empresaId },
      select: { id: true },
    });
    if (!sede) {
      throw new NotFoundException('Sede no encontrada');
    }

    return this.prisma.$transaction(async (tx) => {
      const central = await this.getOrCreateCajaCentral(empresaId, sedeId, tx);

      return tx.movimientoCaja.create({
        data: {
          cajaId: central.id,
          empresaId,
          tipo: dto.tipo,
          categoria: CategoriaMovimientoCaja.AJUSTE_TESORERIA,
          metodoPago: dto.metodoPago,
          monto: dto.monto,
          descripcion: dto.descripcion,
          categoriaGastoId: dto.categoriaGastoId,
          esManual: true,
          registradoPorId: usuarioId,
          metadata: { ajusteTesoreria: true },
        },
      });
    });
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
