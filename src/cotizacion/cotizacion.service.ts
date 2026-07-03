import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AppLoggerService } from '../common/logger/logger.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { CompatibilidadService } from '../producto/compatibilidad.service';
import {
  PrecioNivelService,
  VipPrecioContexto,
} from '../producto/precio-nivel.service';
import { CreateCotizacionDto } from './dto/create-cotizacion.dto';
import { UpdateCotizacionDto } from './dto/update-cotizacion.dto';
import { UpdateEstadoCotizacionDto } from './dto/update-estado-cotizacion.dto';
import { CreateCotizacionDetalleDto } from './dto/create-cotizacion-detalle.dto';
import {
  CategoriaMovimientoCaja,
  EstadoCotizacion,
  MetodoPagoVenta,
  Prisma,
  ReservaCotizacionEstado,
  Rol,
  TipoMovimientoCaja,
  TipoNotificacion,
} from '@prisma/client';
import { PlanLimitsService } from '../common/services/plan-limits.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { RealtimeInvalidationService } from '../notificacion/realtime-invalidation.service';
import { CajaService } from '../caja/caja.service';

@Injectable()
export class CotizacionService {
  private readonly logger: AppLoggerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuracionCodigos: ConfiguracionCodigosService,
    private readonly compatibilidadService: CompatibilidadService,
    private readonly planLimitsService: PlanLimitsService,
    private readonly notificacionService: NotificacionService,
    private readonly precioNivelService: PrecioNivelService,
    private readonly realtime: RealtimeInvalidationService,
    private readonly cajaService: CajaService,
    loggerService: AppLoggerService,
  ) {
    this.logger = loggerService;
    this.logger.setContext(CotizacionService.name);
  }

  /**
   * Recalcula `precioUnitario` desde el backend usando los niveles de precio
   * configurados (PrecioNivel) para evitar manipulación cliente-side.
   * Mismo patrón que `VentaService.aplicarPreciosBackendNivel`.
   *
   * Considera las políticas de precio especial (VIP) del cliente: sin esto,
   * el recálculo anti-manipulación pisaba el precio VIP que la app envió con
   * el precio de sede y la cotización salía a precio base.
   *
   * Además fija `precioRegular` de forma AUTORITATIVA (server-side): el
   * precio base antes del nivel/VIP cuando hubo rebaja, null si no.
   */
  private async aplicarPreciosBackendNivel(
    detalles: CreateCotizacionDetalleDto[],
    sedeId: string,
    empresaId: string,
    clienteId?: string | null,
  ): Promise<CreateCotizacionDetalleDto[]> {
    const vipResolver = await this._buildVipResolverCotizacion(
      empresaId,
      clienteId ?? null,
      detalles,
    );

    const result: CreateCotizacionDetalleDto[] = [];
    for (const d of detalles) {
      const productoIdParaNivel = d.productoId ?? null;
      if (!productoIdParaNivel && !d.varianteId) {
        result.push(d);
        continue;
      }
      const vips = vipResolver
        ? vipResolver(d.productoId ?? null, d.varianteId ?? null)
        : [];
      try {
        const calc = await this.precioNivelService.calcularPrecioSegunCantidad(
          productoIdParaNivel,
          d.varianteId ?? null,
          sedeId,
          d.cantidad,
          { vips },
        );
        if (
          d.precioUnitario != null &&
          Math.abs(d.precioUnitario - calc.precioUnitario) > 0.01
        ) {
          this.logger.warn(
            `Precio recalculado en backend para item ${d.descripcion}: cliente envió ` +
              `${d.precioUnitario} pero backend calculó ${calc.precioUnitario}. ` +
              `Aplicando precio del backend (nivel: ${calc.nivelAplicado}).`,
          );
        }
        // Server-authoritative: el precio regular es el precio PÚBLICO
        // vigente (min de base/oferta/liquidación) — solo las rebajas de
        // nivel/VIP cuentan como "precio especial". Las ofertas públicas
        // NO se muestran como descuento de la cotización, pero sí se
        // persiste el precio de sede pre-oferta como referencia informativa.
        const publico = calc.precioPublico ?? calc.precioBase;
        result.push({
          ...d,
          precioUnitario: calc.precioUnitario,
          precioRegular:
            publico > calc.precioUnitario + 0.0001 ? publico : undefined,
          precioAntesOferta:
            calc.precioBase > publico + 0.0001 ? calc.precioBase : undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `No se pudo recalcular precio para "${d.descripcion}": ${msg}. ` +
            `Usando precio del cliente como fallback.`,
        );
        result.push(d);
      }
    }
    return result;
  }

  /**
   * Resolver de contextos VIP para cotizaciones (versión de
   * `VentaService._buildResolverVip`): carga las políticas de precio
   * especial vigentes asignadas al cliente y devuelve una función que,
   * por línea, entrega los contextos aplicables según su alcance
   * (todos / productos / categorías). Null si no hay cliente o políticas.
   */
  private async _buildVipResolverCotizacion(
    empresaId: string,
    clienteId: string | null,
    detalles: CreateCotizacionDetalleDto[],
  ): Promise<
    ((productoId: string | null, varianteId: string | null) => VipPrecioContexto[]) | null
  > {
    if (!clienteId) return null;

    const now = new Date();
    const asignaciones = await this.prisma.clientePoliticaDescuento.findMany({
      where: {
        empresaId,
        isActive: true,
        deletedAt: null,
        clienteId,
        politica: {
          isActive: true,
          deletedAt: null,
          AND: [
            { OR: [{ fechaInicio: null }, { fechaInicio: { lte: now } }] },
            { OR: [{ fechaFin: null }, { fechaFin: { gte: now } }] },
          ],
        },
      },
      include: {
        politica: {
          include: {
            productosAplicables: {
              select: { productoId: true, descuentoOverride: true },
            },
            categoriasAplicables: {
              select: { categoriaId: true, descuentoOverride: true },
            },
          },
        },
      },
    });
    if (!asignaciones.length) return null;

    const politicas = asignaciones.map((a) => a.politica);

    // Resolver categorías solo si alguna política usa alcance por categoría.
    const usaCategorias = politicas.some(
      (p) => !p.aplicarATodos && p.categoriasAplicables.length > 0,
    );
    const categoriaPorProducto = new Map<string, string | null>();
    const categoriaPorVariante = new Map<string, string | null>();
    if (usaCategorias) {
      const productoIds = new Set<string>();
      const varianteIds = new Set<string>();
      for (const d of detalles) {
        if (d.productoId) productoIds.add(d.productoId);
        if (d.varianteId) varianteIds.add(d.varianteId);
      }
      if (productoIds.size) {
        const prods = await this.prisma.producto.findMany({
          where: { id: { in: [...productoIds] }, empresaId },
          select: { id: true, empresaCategoriaId: true },
        });
        prods.forEach((p) =>
          categoriaPorProducto.set(p.id, p.empresaCategoriaId ?? null),
        );
      }
      if (varianteIds.size) {
        const vars = await this.prisma.productoVariante.findMany({
          where: { id: { in: [...varianteIds] }, empresaId },
          select: {
            id: true,
            producto: { select: { empresaCategoriaId: true } },
          },
        });
        vars.forEach((v) =>
          categoriaPorVariante.set(v.id, v.producto?.empresaCategoriaId ?? null),
        );
      }
    }

    return (productoId: string | null, varianteId: string | null) => {
      const categoria = varianteId
        ? categoriaPorVariante.get(varianteId) ?? null
        : productoId
          ? categoriaPorProducto.get(productoId) ?? null
          : null;

      const aplicables = politicas.filter((p) => {
        if (p.aplicarATodos) return true;
        if (
          productoId &&
          p.productosAplicables.some((x) => x.productoId === productoId)
        ) {
          return true;
        }
        if (
          categoria &&
          p.categoriasAplicables.some((x) => x.categoriaId === categoria)
        ) {
          return true;
        }
        return false;
      });
      return aplicables.map((g) => {
        let valor = Number(g.valorDescuento);
        const ovProd = productoId
          ? g.productosAplicables.find(
              (x) => x.productoId === productoId && x.descuentoOverride != null,
            )
          : null;
        const ovCat =
          !ovProd && categoria
            ? g.categoriasAplicables.find(
                (x) =>
                  x.categoriaId === categoria && x.descuentoOverride != null,
              )
            : null;
        if (ovProd?.descuentoOverride != null) {
          valor = Number(ovProd.descuentoOverride);
        } else if (ovCat?.descuentoOverride != null) {
          valor = Number(ovCat.descuentoOverride);
        }

        return {
          politicaId: g.id,
          etiqueta: `VIP: ${g.nombre}`,
          modo: g.tipoCalculo as VipPrecioContexto['modo'],
          valor,
          markupSobreCosto:
            g.markupSobreCosto != null ? Number(g.markupSobreCosto) : 0,
          estrategiaMayor: g.estrategiaMayor as 'PRIMER_NIVEL' | 'MEJOR_NIVEL',
          descuentoMaximo:
            g.descuentoMaximo != null ? Number(g.descuentoMaximo) : null,
        };
      });
    };
  }

  /**
   * Crear cotizacion con detalles en transaccion
   */
  async create(empresaId: string, dto: CreateCotizacionDto) {
    this.logger.info('Creando cotizacion', { empresaId, sede: dto.sedeId });

    // Verificar límite de cotizaciones del plan de suscripción
    await this.planLimitsService.checkCotizacionesLimit(empresaId);

    // ── Validar inputs de reserva/adelanto ANTES de transacción ──
    const reservarStock = dto.reservarStock === true;
    const adelantoMonto = dto.adelantoMonto != null && dto.adelantoMonto > 0
        ? Number(dto.adelantoMonto)
        : 0;
    if (adelantoMonto > 0 && !dto.cajaId) {
      throw new BadRequestException(
        'Se requiere cajaId para registrar el pago adelantado',
      );
    }

    const cotizacion = await this.prisma.$transaction(async (tx) => {
      // Generar codigo
      const { codigoCotizacion } =
        await this.configuracionCodigos.generarCodigoCotizacion(
          empresaId,
          dto.sedeId,
          tx,
        );

      // Forzar precios del backend (defensa contra manipulación cliente)
      // y luego calcular totales por línea. Pasa el cliente para que el
      // recálculo respete sus políticas de precio VIP.
      const detallesEnforced = await this.aplicarPreciosBackendNivel(
        dto.detalles,
        dto.sedeId,
        empresaId,
        dto.clienteId,
      );
      const detallesCalculados = detallesEnforced.map((d, index) =>
        this.calcularDetalle(d, index),
      );

      // Rechazar insumos (materia prima — no se cotizan al cliente
      // porque tampoco se venden directo).
      await this._assertNoInsumos(tx, detallesCalculados);

      // Validar descuentos máximos por producto
      await this._validarDescuentosMaximos(tx, detallesCalculados);

      // ── Reserva de stock ──
      // Si `reservarStock=true`, validamos disponibilidad y preparamos
      // el mapeo de cada item a su `productoStockId` para guardarlo en
      // el detalle. Items de servicio o manuales (sin productoId ni
      // varianteId) NO reservan stock. La validación se hace ANTES de
      // crear la cotización para que un error de stock no deje datos
      // huérfanos.
      const reservaInfo = reservarStock
        ? await this._prepararReservaInfo(
            tx,
            empresaId,
            dto.sedeId,
            detallesCalculados,
          )
        : detallesCalculados.map(() => null);

      // Calcular totales del header
      const subtotal = detallesCalculados.reduce(
        (sum, d) => sum + d.subtotal,
        0,
      );
      const totalDescuento = detallesCalculados.reduce(
        (sum, d) => sum + d.descuento,
        0,
      );
      const totalImpuestos = detallesCalculados.reduce(
        (sum, d) => sum + d.igv,
        0,
      );
      const total = detallesCalculados.reduce((sum, d) => sum + d.total, 0);

      const cotizacion = await tx.cotizacion.create({
        data: {
          empresaId,
          sedeId: dto.sedeId,
          clienteId: dto.clienteId,
          vendedorId: dto.vendedorId,
          // Con cliente REAL asignado (DNI) la cotización nace PENDIENTE:
          // es una propuesta formal dirigida a alguien y aparece de
          // inmediato en su cuenta del marketplace (match por Persona).
          // Sin cliente queda BORRADOR (default) — invisible al público.
          ...(dto.clienteId ? { estado: EstadoCotizacion.PENDIENTE } : {}),
          codigo: codigoCotizacion,
          nombre: dto.nombre,
          nombreCliente: dto.nombreCliente,
          documentoCliente: dto.documentoCliente,
          emailCliente: dto.emailCliente,
          telefonoCliente: dto.telefonoCliente,
          direccionCliente: dto.direccionCliente,
          moneda: dto.moneda ?? 'PEN',
          tipoCambio: dto.tipoCambio,
          subtotal,
          descuento: totalDescuento,
          impuestos: totalImpuestos,
          total,
          fechaVencimiento: dto.fechaVencimiento
            ? new Date(dto.fechaVencimiento)
            : null,
          observaciones: dto.observaciones,
          condiciones: dto.condiciones,
          adelantoMonto: adelantoMonto > 0 ? adelantoMonto : null,
          adelantoRequerido:
            dto.adelantoRequerido && dto.adelantoRequerido > 0
              ? dto.adelantoRequerido
              : null,
          detalles: {
            create: detallesCalculados.map((d, idx) => {
              const info = reservaInfo[idx];
              return {
                productoId: d.productoId,
                varianteId: d.varianteId,
                servicioId: d.servicioId,
                descripcion: d.descripcion,
                cantidad: d.cantidad,
                precioUnitario: d.precioUnitario,
                descuento: d.descuento,
                precioRegular: d.precioRegular,
                precioAntesOferta: d.precioAntesOferta,
                tipoAfectacion: d.tipoAfectacion,
                porcentajeIGV: d.porcentajeIGV,
                igv: d.igv,
                icbper: d.icbper,
                subtotal: d.subtotal,
                total: d.total,
                orden: d.orden,
                productoStockId: info?.productoStockId,
                cantidadReservada: info?.cantidad,
                reservaEstado: info ? ReservaCotizacionEstado.ACTIVA : null,
              };
            }),
          },
        },
        include: {
          detalles: {
            include: {
              producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
              variante: { select: { id: true, nombre: true, sku: true } },
              servicio: { select: { id: true, nombre: true, codigoEmpresa: true } },
            },
            orderBy: { orden: 'asc' },
          },
          sede: { select: { id: true, nombre: true } },
          cliente: {
            select: {
              id: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
          vendedor: {
            select: {
              id: true,
              aliasTicket: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      // ── Aplicar reserva de stock (incrementar stockReservadoCotizacion) ──
      if (reservarStock) {
        for (const info of reservaInfo) {
          if (info == null) continue;
          await tx.productoStock.update({
            where: { id: info.productoStockId },
            data: {
              stockReservadoCotizacion: { increment: info.cantidad },
            },
          });
        }
      }

      // ── Registrar pago adelantado en caja (si aplica) ──
      if (adelantoMonto > 0) {
        // Validar caja abierta perteneciente al vendedor en la sede.
        const caja = await tx.caja.findFirst({
          where: {
            id: dto.cajaId,
            empresaId,
            sedeId: dto.sedeId,
            estado: 'ABIERTA',
          },
          select: { id: true },
        });
        if (!caja) {
          throw new BadRequestException(
            'La caja indicada no existe, no pertenece a esta sede o está cerrada',
          );
        }
        const movimiento = await tx.movimientoCaja.create({
          data: {
            cajaId: caja.id,
            empresaId,
            tipo: TipoMovimientoCaja.INGRESO,
            categoria: CategoriaMovimientoCaja.ADELANTO_COTIZACION,
            metodoPago: MetodoPagoVenta.EFECTIVO,
            monto: adelantoMonto,
            descripcion: `Adelanto cotización ${cotizacion.codigo}`,
            cotizacionId: cotizacion.id,
            registradoPorId: dto.vendedorId,
            // Generado por el flujo de crear cotización, no por el form
            // de "Nuevo Movimiento" del cajero → esManual=false.
            esManual: false,
          },
        });
        await tx.cotizacion.update({
          where: { id: cotizacion.id },
          data: { movimientoCajaId: movimiento.id },
        });
      }

      this.logger.log(
        `Cotizacion creada: ${cotizacion.codigo}` +
          (reservarStock ? ' [stock reservado]' : '') +
          (adelantoMonto > 0 ? ` [adelanto S/${adelantoMonto.toFixed(2)}]` : ''),
      );
      return cotizacion;
    });

    // Emitir FCM fuera de la transacción: si se reservó stock, los
    // otros devices deben actualizar la disponibilidad mostrada.
    if (reservarStock) {
      this.realtime.notifyStockCambiado({
        empresaId,
        sedeId: dto.sedeId,
      });
    }

    // Notificar al CLIENTE del marketplace (best-effort): si el cliente
    // asignado tiene cuenta (misma Persona, match global por DNI), la
    // cotización ya es visible en "Mis cotizaciones" — avisarle.
    if (dto.clienteId) {
      try {
        const cliente = await this.prisma.empresaPersona.findUnique({
          where: { id: dto.clienteId },
          select: {
            personaId: true,
            empresa: { select: { nombre: true } },
          },
        });
        const usuarioCliente = cliente
          ? await this.prisma.usuario.findUnique({
              where: { personaId: cliente.personaId },
              select: { id: true },
            })
          : null;
        if (usuarioCliente) {
          await this.notificacionService.enviarAUsuario(
            usuarioCliente.id,
            'Tienes una nueva cotización',
            `${cliente!.empresa.nombre} te envió la cotización ${cotizacion.codigo} por S/ ${Number(cotizacion.total).toFixed(2)}`,
            {
              tipo: TipoNotificacion.SISTEMA,
              empresaId,
              data: { cotizacionId: cotizacion.id, tipo: 'cotizacion-cliente' },
            },
          );
        }
      } catch (_) {
        // La notificación nunca debe romper la creación.
      }
    }

    return cotizacion;
  }

  /**
   * Listar cotizaciones con filtros
   */
  async findAll(
    empresaId: string,
    filtros?: {
      sedeId?: string;
      estado?: EstadoCotizacion;
      fechaDesde?: string;
      fechaHasta?: string;
      clienteId?: string;
      search?: string;
      userId?: string;
      userRole?: string;
    },
  ) {
    const where: Prisma.CotizacionWhereInput = { empresaId };

    // VENDEDOR y CAJERO solo ven sus propias cotizaciones (las que ellos
    // emitieron). Roles administrativos (SUPER_ADMIN, EMPRESA_ADMIN, etc.)
    // ven todas las cotizaciones del tenant.
    if (
      filtros?.userId &&
      (filtros?.userRole === Rol.VENDEDOR ||
        filtros?.userRole === Rol.CAJERO)
    ) {
      where.vendedorId = filtros.userId;
    }

    if (filtros?.sedeId) where.sedeId = filtros.sedeId;
    if (filtros?.estado) where.estado = filtros.estado;
    if (filtros?.clienteId) where.clienteId = filtros.clienteId;

    if (filtros?.fechaDesde || filtros?.fechaHasta) {
      where.fechaEmision = {};
      if (filtros.fechaDesde) where.fechaEmision.gte = new Date(filtros.fechaDesde);
      if (filtros.fechaHasta) where.fechaEmision.lte = new Date(filtros.fechaHasta);
    }

    if (filtros?.search) {
      where.OR = [
        { codigo: { contains: filtros.search, mode: 'insensitive' } },
        { nombreCliente: { contains: filtros.search, mode: 'insensitive' } },
        { documentoCliente: { contains: filtros.search, mode: 'insensitive' } },
      ];
    }

    const cotizaciones = await this.prisma.cotizacion.findMany({
      where,
      include: {
        sede: { select: { id: true, nombre: true } },
        cliente: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        vendedor: {
          select: {
            id: true,
            aliasTicket: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        _count: { select: { detalles: true } },
      },
      orderBy: { creadoEn: 'desc' },
    });

    // Calcular `tieneReservaActiva` en una sola query batch (sin N+1).
    // Buscamos qué cotizaciones del set tienen al menos un detalle con
    // `reservaEstado = ACTIVA`. Constante, no escala con N.
    if (cotizaciones.length === 0) return [];
    const ids = cotizaciones.map((c) => c.id);
    const conReserva = await this.prisma.cotizacionDetalle.findMany({
      where: {
        cotizacionId: { in: ids },
        reservaEstado: ReservaCotizacionEstado.ACTIVA,
      },
      select: { cotizacionId: true },
      distinct: ['cotizacionId'],
    });
    const setConReserva = new Set(conReserva.map((d) => d.cotizacionId));

    return cotizaciones.map((c) => ({
      ...c,
      tieneReservaActiva: setConReserva.has(c.id),
    }));
  }

  /**
   * Detalle completo de una cotizacion
   */
  async findOne(id: string, empresaId: string) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          include: {
            producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
            variante: { select: { id: true, nombre: true, sku: true } },
            servicio: { select: { id: true, nombre: true, codigoEmpresa: true } },
          },
          orderBy: { orden: 'asc' },
        },
        sede: { select: { id: true, nombre: true } },
        cliente: {
          select: {
            id: true,
            persona: { select: { nombres: true, apellidos: true, dni: true } },
          },
        },
        vendedor: {
          select: {
            id: true,
            aliasTicket: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        // Solicitud del marketplace que originó esta cotización (si existe):
        // la app muestra el vínculo en el detalle.
        solicitudOrigen: {
          select: {
            id: true,
            codigo: true,
            estado: true,
            creadoEn: true,
            solicitante: {
              select: {
                persona: { select: { nombres: true, apellidos: true } },
                email: true,
              },
            },
          },
          take: 1,
        },
        // Venta resultante (cotización CONVERTIDA): el detalle muestra el
        // resumen REAL de la venta — puede diferir del total cotizado si
        // se excluyeron items al convertir.
        venta: {
          select: { id: true, codigo: true, total: true, estado: true },
        },
      },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    // Derivado: si algún detalle tiene reserva activa, el flag es true.
    return {
      ...cotizacion,
      tieneReservaActiva: cotizacion.detalles.some(
        (d) => d.reservaEstado === ReservaCotizacionEstado.ACTIVA,
      ),
    };
  }

  /**
   * Actualizar cotizacion (solo si BORRADOR)
   */
  async update(id: string, empresaId: string, dto: UpdateCotizacionDto) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    // Editables: BORRADOR (siempre) y PENDIENTE sin dinero de por medio
    // (las cotizaciones con cliente asignado nacen PENDIENTE para ser
    // visibles en su cuenta del marketplace; la empresa aún puede
    // corregirlas mientras el cliente no haya pagado un adelanto).
    const editable =
      cotizacion.estado === EstadoCotizacion.BORRADOR ||
      (cotizacion.estado === EstadoCotizacion.PENDIENTE &&
        Number(cotizacion.adelantoMonto ?? 0) <= 0);
    if (!editable) {
      throw new BadRequestException(
        'Solo se pueden editar cotizaciones en BORRADOR o PENDIENTES sin adelanto pagado',
      );
    }

    let huboCambioReservas = false;

    const actualizada = await this.prisma.$transaction(async (tx) => {
      // Si vienen detalles nuevos, reemplazar los existentes
      if (dto.detalles && dto.detalles.length > 0) {
        // Liberar reservas activas ANTES de borrar los detalles; si no,
        // stockReservadoCotizacion quedaría incrementado sin ningún
        // detalle que lo respalde (stock fantasma imposible de liberar).
        // El adelanto NO se toca: editar un borrador no devuelve dinero.
        const teniaReservaActiva = await this._liberarReservasDeDetalles(
          tx,
          id,
        );

        await tx.cotizacionDetalle.deleteMany({
          where: { cotizacionId: id },
        });

        // Forzar precios del backend (defensa contra manipulación cliente),
        // respetando las políticas VIP del cliente de la cotización.
        const detallesEnforced = await this.aplicarPreciosBackendNivel(
          dto.detalles,
          cotizacion.sedeId,
          empresaId,
          dto.clienteId ?? cotizacion.clienteId,
        );
        const detallesCalculados = detallesEnforced.map((d, index) =>
          this.calcularDetalle(d, index),
        );

        // Rechazar insumos
        await this._assertNoInsumos(tx, detallesCalculados);

        // Validar descuentos máximos por producto (igual que en create)
        await this._validarDescuentosMaximos(tx, detallesCalculados);

        // Si la cotización tenía reserva activa, los nuevos detalles
        // heredan la reserva: validar disponibilidad y re-reservar.
        const reservaInfo = teniaReservaActiva
          ? await this._prepararReservaInfo(
              tx,
              empresaId,
              cotizacion.sedeId,
              detallesCalculados,
            )
          : detallesCalculados.map(() => null);

        await tx.cotizacionDetalle.createMany({
          data: detallesCalculados.map((d, idx) => {
            const info = reservaInfo[idx];
            return {
              cotizacionId: id,
              productoId: d.productoId,
              varianteId: d.varianteId,
              servicioId: d.servicioId,
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              descuento: d.descuento,
              precioRegular: d.precioRegular,
              precioAntesOferta: d.precioAntesOferta,
              tipoAfectacion: d.tipoAfectacion,
              porcentajeIGV: d.porcentajeIGV,
              igv: d.igv,
              icbper: d.icbper,
              subtotal: d.subtotal,
              total: d.total,
              orden: d.orden,
              productoStockId: info?.productoStockId,
              cantidadReservada: info?.cantidad,
              reservaEstado: info ? ReservaCotizacionEstado.ACTIVA : null,
            };
          }),
        });

        for (const info of reservaInfo) {
          if (info == null) continue;
          await tx.productoStock.update({
            where: { id: info.productoStockId },
            data: {
              stockReservadoCotizacion: { increment: info.cantidad },
            },
          });
        }

        huboCambioReservas = teniaReservaActiva;

        const subtotal = detallesCalculados.reduce(
          (sum, d) => sum + d.subtotal,
          0,
        );
        const totalDescuento = detallesCalculados.reduce(
          (sum, d) => sum + d.descuento,
          0,
        );
        const totalImpuestos = detallesCalculados.reduce(
          (sum, d) => sum + d.igv,
          0,
        );
        const total = detallesCalculados.reduce(
          (sum, d) => sum + d.total,
          0,
        );

        return tx.cotizacion.update({
          where: { id },
          data: {
            ...(dto.clienteId !== undefined && { clienteId: dto.clienteId }),
            ...(dto.vendedorId !== undefined && { vendedorId: dto.vendedorId }),
            ...(dto.nombre !== undefined && { nombre: dto.nombre }),
            ...(dto.nombreCliente !== undefined && { nombreCliente: dto.nombreCliente }),
            ...(dto.documentoCliente !== undefined && { documentoCliente: dto.documentoCliente }),
            ...(dto.emailCliente !== undefined && { emailCliente: dto.emailCliente }),
            ...(dto.telefonoCliente !== undefined && { telefonoCliente: dto.telefonoCliente }),
            ...(dto.direccionCliente !== undefined && { direccionCliente: dto.direccionCliente }),
            ...(dto.moneda !== undefined && { moneda: dto.moneda }),
            ...(dto.tipoCambio !== undefined && { tipoCambio: dto.tipoCambio }),
            ...(dto.observaciones !== undefined && { observaciones: dto.observaciones }),
            ...(dto.condiciones !== undefined && { condiciones: dto.condiciones }),
            ...(dto.fechaVencimiento !== undefined && {
              fechaVencimiento: dto.fechaVencimiento
                ? new Date(dto.fechaVencimiento)
                : null,
            }),
            subtotal,
            descuento: totalDescuento,
            impuestos: totalImpuestos,
            total,
          },
          include: {
            detalles: {
              include: {
                producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
                variante: { select: { id: true, nombre: true, sku: true } },
                servicio: { select: { id: true, nombre: true, codigoEmpresa: true } },
              },
              orderBy: { orden: 'asc' },
            },
            sede: { select: { id: true, nombre: true } },
            vendedor: {
              select: {
                id: true,
                aliasTicket: true,
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        });
      }

      // Solo actualizar header
      return tx.cotizacion.update({
        where: { id },
        data: {
          ...(dto.clienteId !== undefined && { clienteId: dto.clienteId }),
          ...(dto.vendedorId !== undefined && { vendedorId: dto.vendedorId }),
          ...(dto.nombreCliente !== undefined && { nombreCliente: dto.nombreCliente }),
          ...(dto.documentoCliente !== undefined && { documentoCliente: dto.documentoCliente }),
          ...(dto.emailCliente !== undefined && { emailCliente: dto.emailCliente }),
          ...(dto.telefonoCliente !== undefined && { telefonoCliente: dto.telefonoCliente }),
          ...(dto.direccionCliente !== undefined && { direccionCliente: dto.direccionCliente }),
          ...(dto.moneda !== undefined && { moneda: dto.moneda }),
          ...(dto.tipoCambio !== undefined && { tipoCambio: dto.tipoCambio }),
          ...(dto.observaciones !== undefined && { observaciones: dto.observaciones }),
          ...(dto.condiciones !== undefined && { condiciones: dto.condiciones }),
          ...(dto.fechaVencimiento !== undefined && {
            fechaVencimiento: dto.fechaVencimiento
              ? new Date(dto.fechaVencimiento)
              : null,
          }),
        },
        include: {
          detalles: {
            include: {
              producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
              variante: { select: { id: true, nombre: true, sku: true } },
              servicio: { select: { id: true, nombre: true, codigoEmpresa: true } },
            },
            orderBy: { orden: 'asc' },
          },
          sede: { select: { id: true, nombre: true } },
          vendedor: {
            select: {
              id: true,
              aliasTicket: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });
    });

    // La edición liberó y re-aplicó reservas → avisar a los clientes
    // para que refresquen stock disponible.
    if (huboCambioReservas) {
      this.realtime.notifyStockCambiado({
        empresaId,
        sedeId: cotizacion.sedeId,
      });
    }

    return actualizada;
  }

  /**
   * Cambiar estado con validaciones de flujo
   */
  async updateEstado(
    id: string,
    empresaId: string,
    dto: UpdateEstadoCotizacionDto,
    actorUserId: string,
  ) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    this.validarTransicionEstado(cotizacion.estado, dto.estado);

    if (dto.estado === EstadoCotizacion.CONVERTIDA && !dto.comprobanteId) {
      throw new BadRequestException(
        'Se requiere comprobanteId para el estado CONVERTIDA',
      );
    }

    // Estados terminales que liberan/convierten reservas si las había:
    // - RECHAZADA/VENCIDA → liberar (stock devuelto + adelanto devuelto)
    // - CONVERTIDA       → marcar como CONVERTIDA (stock pasa a la venta)
    const motivoReserva: 'LIBERAR' | 'CONVERTIR' | null =
      dto.estado === EstadoCotizacion.RECHAZADA ||
      dto.estado === EstadoCotizacion.VENCIDA
        ? 'LIBERAR'
        : dto.estado === EstadoCotizacion.CONVERTIDA
          ? 'CONVERTIR'
          : null;

    const { updated, huboReservas } = await this.prisma.$transaction(
      async (tx) => {
        const huboReservas =
          motivoReserva != null
            ? await this.liberarReservas(tx, id, motivoReserva, actorUserId)
            : false;
        const updated = await tx.cotizacion.update({
          where: { id },
          data: {
            estado: dto.estado,
            ...(dto.comprobanteId && { comprobanteId: dto.comprobanteId }),
          },
          include: {
            sede: { select: { id: true, nombre: true } },
            vendedor: {
              select: {
                id: true,
                aliasTicket: true,
                persona: { select: { nombres: true, apellidos: true } },
              },
            },
          },
        });
        return { updated, huboReservas };
      },
    );

    // Notificar cajeros cuando se aprueba (cola POS)
    if (dto.estado === EstadoCotizacion.APROBADA) {
      this.notificarCajerosNuevaCotizacion(
        empresaId,
        cotizacion.codigo,
        cotizacion.total ? Number(cotizacion.total) : 0,
      ).catch(() => {});
    }

    // Emitir FCM si se liberó/convirtió stock — otros devices deben
    // actualizar la disponibilidad mostrada.
    if (huboReservas) {
      this.realtime.notifyStockCambiado({
        empresaId,
        sedeId: cotizacion.sedeId,
      });
    }

    return updated;
  }

  /**
   * Eliminar cotizacion (solo BORRADOR)
   */
  async remove(id: string, empresaId: string, actorUserId: string) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    if (cotizacion.estado !== EstadoCotizacion.BORRADOR) {
      throw new BadRequestException(
        'Solo se pueden eliminar cotizaciones en estado BORRADOR',
      );
    }

    // Si tenía reservas activas o adelanto, liberar/devolver antes de
    // borrar (Cascade dejaría stock "perdido" en stockReservadoCotizacion).
    const huboReservas = await this.prisma.$transaction(async (tx) => {
      const result = await this.liberarReservas(
        tx,
        id,
        'LIBERAR',
        actorUserId,
      );
      await tx.cotizacion.delete({ where: { id } });
      return result;
    });

    if (huboReservas) {
      this.realtime.notifyStockCambiado({
        empresaId,
        sedeId: cotizacion.sedeId,
      });
    }

    return { message: 'Cotizacion eliminada exitosamente' };
  }

  /**
   * Validar compatibilidad de items del detalle
   */
  async validarCompatibilidadItems(
    empresaId: string,
    detalles: CreateCotizacionDetalleDto[],
  ) {
    const productos = detalles
      .filter((d) => d.productoId || d.varianteId)
      .map((d) => ({
        productoId: d.productoId,
        varianteId: d.varianteId,
      }));

    if (productos.length < 2) {
      return { compatible: true, conflictos: [] };
    }

    return this.compatibilidadService.validarCompatibilidad(
      empresaId,
      productos,
    );
  }

  /**
   * Duplicar cotizacion como BORRADOR
   */
  async duplicar(id: string, empresaId: string) {
    const original = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
      include: { detalles: { orderBy: { orden: 'asc' } } },
    });

    if (!original) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    return this.prisma.$transaction(async (tx) => {
      const { codigoCotizacion } =
        await this.configuracionCodigos.generarCodigoCotizacion(
          empresaId,
          original.sedeId,
          tx,
        );

      const copia = await tx.cotizacion.create({
        data: {
          empresaId,
          sedeId: original.sedeId,
          clienteId: original.clienteId,
          vendedorId: original.vendedorId,
          codigo: codigoCotizacion,
          nombre: original.nombre,
          nombreCliente: original.nombreCliente,
          documentoCliente: original.documentoCliente,
          emailCliente: original.emailCliente,
          telefonoCliente: original.telefonoCliente,
          direccionCliente: original.direccionCliente,
          moneda: original.moneda,
          tipoCambio: original.tipoCambio,
          subtotal: original.subtotal,
          descuento: original.descuento,
          impuestos: original.impuestos,
          total: original.total,
          observaciones: original.observaciones,
          condiciones: original.condiciones,
          estado: EstadoCotizacion.BORRADOR,
          detalles: {
            create: original.detalles.map((d) => ({
              productoId: d.productoId,
              varianteId: d.varianteId,
              servicioId: d.servicioId,
              descripcion: d.descripcion,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              descuento: d.descuento,
              precioRegular: d.precioRegular,
              precioAntesOferta: d.precioAntesOferta,
              tipoAfectacion: d.tipoAfectacion,
              porcentajeIGV: d.porcentajeIGV,
              igv: d.igv,
              icbper: d.icbper,
              subtotal: d.subtotal,
              total: d.total,
              orden: d.orden,
            })),
          },
        },
        include: {
          detalles: {
            orderBy: { orden: 'asc' },
          },
          sede: { select: { id: true, nombre: true } },
          vendedor: {
            select: {
              id: true,
              aliasTicket: true,
              persona: { select: { nombres: true, apellidos: true } },
            },
          },
        },
      });

      this.logger.log(`Cotizacion duplicada: ${original.codigo} -> ${copia.codigo}`);
      return copia;
    });
  }

  // =====================================================
  // HELPERS PRIVADOS
  // =====================================================

  /**
   * Calcular totales de una linea de detalle
   */
  private calcularDetalle(dto: CreateCotizacionDetalleDto, index: number) {
    const cantidad = dto.cantidad;
    const precioUnitario = dto.precioUnitario;
    const descuento = dto.descuento ?? 0;
    const porcentajeIGV = dto.porcentajeIGV ?? 18;
    const incluyeIgv = dto.precioIncluyeIgv ?? false;

    const subtotalBruto = cantidad * precioUnitario;

    let subtotal: number;
    let igv: number;
    let total: number;

    if (incluyeIgv) {
      // Precio ya incluye IGV → extraer base e IGV
      total = subtotalBruto - descuento;
      subtotal = total / (1 + porcentajeIGV / 100);
      igv = total - subtotal;
    } else {
      // Precio sin IGV → sumar IGV
      subtotal = subtotalBruto - descuento;
      igv = subtotal * (porcentajeIGV / 100);
      total = subtotal + igv;
    }

    // Tipo de afectación IGV (SUNAT Cat. 07)
    const tipoAfectacion = dto.tipoAfectacion || (porcentajeIGV > 0 ? '10' : '10');
    const icbperMonto = dto.icbper ?? 0;
    const totalConIcbper = total + icbperMonto;

    return {
      productoId: dto.productoId || null,
      varianteId: dto.varianteId || null,
      servicioId: dto.servicioId || null,
      descripcion: dto.descripcion,
      cantidad,
      precioUnitario,
      descuento,
      // Precio regular (antes del nivel por mayor / VIP): solo se persiste
      // si es mayor al precio cobrado — permite mostrar el ahorro completo.
      precioRegular:
        dto.precioRegular != null && dto.precioRegular > precioUnitario
          ? dto.precioRegular
          : null,
      // Precio de sede pre-oferta (informativo, no cuenta como descuento).
      precioAntesOferta:
        dto.precioAntesOferta != null && dto.precioAntesOferta > precioUnitario
          ? dto.precioAntesOferta
          : null,
      tipoAfectacion,
      porcentajeIGV,
      igv: Math.round(igv * 100) / 100,
      icbper: Math.round(icbperMonto * 100) / 100,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round(totalConIcbper * 100) / 100,
      orden: index,
    };
  }

  /**
   * Confirmación AUTOMÁTICA del adelanto de separación vía api-yape (webhook
   * `payment.confirmed` con reference `cotizacion:<id>`): el cliente del
   * marketplace aceptó la cotización y yapeó el adelanto requerido.
   *
   * Efectos (en transacción): reserva el stock de los detalles (si no estaba
   * reservado; best-effort — el dinero ya entró, no se bloquea por stock),
   * registra el INGRESO en la Caja Central de la sede de la cotización
   * (categoría ADELANTO_COTIZACION) y pasa la cotización a APROBADA con
   * `adelantoMonto` = lo pagado. Idempotente (adelanto ya registrado → no-op).
   * Al convertir a venta, el adelanto se aplica como pago previo (flujo
   * existente); al anular/rechazar se devuelve (flujo existente).
   */
  async confirmarAdelantoYapeAutomatico(
    empresaId: string,
    cotizacionId: string,
    datos: { monto: number; metodo: 'YAPE' | 'PLIN'; referencia?: string },
  ) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id: cotizacionId, empresaId },
      include: {
        detalles: {
          select: {
            id: true,
            productoId: true,
            varianteId: true,
            descripcion: true,
            cantidad: true,
            reservaEstado: true,
          },
        },
        solicitudOrigen: { select: { solicitanteId: true } },
        // Para notificar en cotizaciones DIRECTAS (sin solicitud): el
        // usuario marketplace se resuelve por la Persona del cliente.
        cliente: { select: { personaId: true } },
      },
    });
    if (!cotizacion) return { accion: 'cotizacion-no-encontrada' };

    // Idempotencia POR PAGO (los pagos son acumulables — total o parciales):
    // un webhook duplicado del mismo pago no debe sumar dos veces. Se
    // detecta por el pagoId guardado en la metadata del MovimientoCaja.
    if (datos.referencia) {
      const yaRegistrado = await this.prisma.movimientoCaja.findFirst({
        where: {
          cotizacionId,
          categoria: CategoriaMovimientoCaja.ADELANTO_COTIZACION,
          metadata: { path: ['pagoId'], equals: datos.referencia },
        },
        select: { id: true },
      });
      if (yaRegistrado) return { accion: 'pago-ya-registrado' };
    }
    // Webhook tardío sobre cotización terminal → ignorar.
    const pagables: EstadoCotizacion[] = [
      EstadoCotizacion.BORRADOR,
      EstadoCotizacion.PENDIENTE,
      EstadoCotizacion.APROBADA,
    ];
    if (!pagables.includes(cotizacion.estado)) {
      return { accion: 'cotizacion-no-pagable' };
    }

    const total = Number(cotizacion.total);
    const adelantoPrevio = Number(cotizacion.adelantoMonto ?? 0);
    const saldoPendiente = Math.max(0, total - adelantoPrevio);
    if (saldoPendiente <= 0.005) {
      return { accion: 'cotizacion-ya-pagada' };
    }
    // Clamp al saldo: nunca acumular más que el total de la cotización.
    const monto = Math.min(datos.monto, saldoPendiente);
    const acumulado = Math.round((adelantoPrevio + monto) * 100) / 100;
    const pagadaCompleta = acumulado >= total - 0.005;

    await this.prisma.$transaction(async (tx) => {
      // 1) Reservar stock si no había reserva activa. Best-effort: si no
      //    alcanza el stock NO se bloquea (el cliente ya pagó) — la empresa
      //    resuelve al preparar.
      const sinReserva = cotizacion.detalles.every(
        (d) => d.reservaEstado !== ReservaCotizacionEstado.ACTIVA,
      );
      if (sinReserva) {
        try {
          const detallesInfo = cotizacion.detalles.map((d) => ({
            productoId: d.productoId,
            varianteId: d.varianteId,
            descripcion: d.descripcion,
            cantidad: Number(d.cantidad),
          }));
          const reservaInfo = await this._prepararReservaInfo(
            tx,
            empresaId,
            cotizacion.sedeId,
            detallesInfo,
          );
          for (let i = 0; i < cotizacion.detalles.length; i++) {
            const info = reservaInfo[i];
            if (!info) continue;
            await tx.productoStock.update({
              where: { id: info.productoStockId },
              data: { stockReservadoCotizacion: { increment: info.cantidad } },
            });
            await tx.cotizacionDetalle.update({
              where: { id: cotizacion.detalles[i].id },
              data: {
                productoStockId: info.productoStockId,
                cantidadReservada: info.cantidad,
                reservaEstado: ReservaCotizacionEstado.ACTIVA,
              },
            });
          }
        } catch (e) {
          this.logger.warn(
            `Adelanto cotización ${cotizacion.codigo}: stock NO reservado (${e?.message ?? e})`,
          );
        }
      }

      // 2) Ingreso del adelanto a la Caja Central de la sede de la cotización
      //    (pago digital automático, sin cajero — nunca se pierde).
      let movimientoCajaId: string | undefined;
      const admin = await tx.empresaUsuarioRol.findFirst({
        where: { empresaId, rol: 'EMPRESA_ADMIN', estado: 'ACTIVO' },
        select: { usuarioId: true },
      });
      if (admin) {
        const central = await this.cajaService.getOrCreateCajaCentral(
          empresaId,
          cotizacion.sedeId,
          tx,
        );
        const movimiento = await tx.movimientoCaja.create({
          data: {
            cajaId: central.id,
            empresaId,
            tipo: TipoMovimientoCaja.INGRESO,
            categoria: CategoriaMovimientoCaja.ADELANTO_COTIZACION,
            metodoPago:
              datos.metodo === 'PLIN'
                ? MetodoPagoVenta.PLIN
                : MetodoPagoVenta.YAPE,
            monto,
            descripcion: pagadaCompleta
                ? `Pago cotización ${cotizacion.codigo} (Yape automático — completa el total)`
                : `Abono cotización ${cotizacion.codigo} (Yape automático)`,
            cotizacionId: cotizacion.id,
            registradoPorId: admin.usuarioId,
            esManual: false,
            metadata: {
              automatico: true,
              fuente: 'webhook-yape',
              // pagoId = idempotencia por pago (los abonos son acumulables).
              ...(datos.referencia && { pagoId: datos.referencia }),
            },
          },
        });
        movimientoCajaId = movimiento.id;
      } else {
        this.logger.warn(
          `Adelanto cotización ${cotizacion.codigo}: sin EMPRESA_ADMIN activo — ingreso a caja NO registrado`,
        );
      }

      // 3) ACUMULAR el pago y aprobar la cotización (cliente aceptó).
      //    `movimientoCajaId` conserva el PRIMER pago (traza del adelanto
      //    original; los siguientes quedan trazados por cotizacionId).
      await tx.cotizacion.update({
        where: { id: cotizacion.id },
        data: {
          adelantoMonto: acumulado,
          ...(movimientoCajaId &&
            !cotizacion.movimientoCajaId && { movimientoCajaId }),
          ...(cotizacion.estado !== EstadoCotizacion.APROBADA && {
            estado: EstadoCotizacion.APROBADA,
          }),
        },
      });
    });

    // Notificaciones best-effort.
    try {
      // Destinatario: el solicitante (flujo de solicitud) o el usuario
      // marketplace cuya Persona es el cliente (cotización DIRECTA).
      let solicitanteId = cotizacion.solicitudOrigen[0]?.solicitanteId;
      if (!solicitanteId && cotizacion.cliente?.personaId) {
        const usuarioCliente = await this.prisma.usuario.findUnique({
          where: { personaId: cotizacion.cliente.personaId },
          select: { id: true },
        });
        solicitanteId = usuarioCliente?.id;
      }
      if (solicitanteId) {
        await this.notificacionService.enviarAUsuario(
          solicitanteId,
          pagadaCompleta ? '¡Pago completo confirmado!' : 'Abono confirmado',
          pagadaCompleta
              ? `Tu pago de S/ ${monto.toFixed(2)} completó el total de la cotización ${cotizacion.codigo}. ¡Tus productos quedaron reservados!`
              : `Tu abono de S/ ${monto.toFixed(2)} para la cotización ${cotizacion.codigo} fue confirmado. Pagado S/ ${acumulado.toFixed(2)} de S/ ${total.toFixed(2)} — tus productos quedaron separados.`,
          {
            tipo: TipoNotificacion.SISTEMA,
            empresaId,
            data: { cotizacionId: cotizacion.id },
            guardar: true,
          },
        );
      }
    } catch (_) {}
    try {
      const staff = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          rol: { in: ['EMPRESA_ADMIN', 'SEDE_ADMIN', 'VENDEDOR'] },
        },
        select: { usuarioId: true },
      });
      const ids = [...new Set(staff.map((s) => s.usuarioId))];
      if (ids.length > 0) {
        await this.notificacionService.enviarAUsuarios(
          ids,
          pagadaCompleta ? 'Cotización PAGADA completa' : 'Cotización separada',
          pagadaCompleta
              ? `El cliente pagó S/ ${monto.toFixed(2)} y completó el total de la cotización ${cotizacion.codigo} (S/ ${total.toFixed(2)}). Stock apartado — lista para convertir a venta.`
              : `El cliente abonó S/ ${monto.toFixed(2)} por la cotización ${cotizacion.codigo} (pagado S/ ${acumulado.toFixed(2)} de S/ ${total.toFixed(2)}, confirmación automática). Stock apartado.`,
          {
            tipo: TipoNotificacion.SISTEMA,
            empresaId,
            data: { cotizacionId: cotizacion.id },
          },
        );
      }
    } catch (_) {}

    return {
      accion: 'pago-registrado',
      cotizacionId: cotizacion.id,
      acumulado,
      pagadaCompleta,
    };
  }

  /**
   * Validar transicion de estado
   */
  /// Libera las reservas de stock activas de una cotización. Decrementa
  /// `stockReservadoCotizacion` en cada `ProductoStock` afectado y marca
  /// los detalles con `reservaEstado` actualizado.
  ///
  /// - `motivo: 'LIBERAR'` → la reserva se devuelve al stock disponible
  ///   (cotización anulada, rechazada o vencida).
  /// - `motivo: 'CONVERTIR'` → la reserva pasa a la venta (la venta
  ///   misma decrementará `stockActual` cuando se cree).
  ///
  /// Si la cotización tenía `movimientoCajaId` (adelanto registrado) y
  /// `motivo === 'LIBERAR'`, crea un movimiento de contrapartida tipo
  /// `DEVOLUCION_ADELANTO_COTIZACION` para que el cajero tenga el dinero
  /// en caja para devolver al cliente. Para `'CONVERTIR'` el adelanto
  /// queda como ingreso de caja y el cajero lo aplica manualmente a la
  /// venta resultante.
  ///
  /// Devuelve `true` si había reservas activas (para que el caller emita
  /// FCM STOCK_CAMBIADO).
  ///
  /// Público porque también lo usa CotizacionTasksService (cron de
  /// vencimiento) — antes el cron tenía una copia propia que divergió
  /// (EFECTIVO hardcodeado, sin fallback a Caja Central).
  async liberarReservas(
    tx: Prisma.TransactionClient,
    cotizacionId: string,
    motivo: 'LIBERAR' | 'CONVERTIR',
    actorUserId: string,
  ): Promise<boolean> {
    const detallesConReserva = await tx.cotizacionDetalle.findMany({
      where: {
        cotizacionId,
        reservaEstado: ReservaCotizacionEstado.ACTIVA,
      },
      select: {
        id: true,
        productoStockId: true,
        cantidadReservada: true,
      },
    });
    if (detallesConReserva.length === 0) return false;

    const nuevoEstado =
      motivo === 'LIBERAR'
        ? ReservaCotizacionEstado.LIBERADA
        : ReservaCotizacionEstado.CONVERTIDA;

    for (const d of detallesConReserva) {
      if (!d.productoStockId || !d.cantidadReservada) continue;
      await tx.productoStock.update({
        where: { id: d.productoStockId },
        data: {
          stockReservadoCotizacion: { decrement: d.cantidadReservada },
        },
      });
      await tx.cotizacionDetalle.update({
        where: { id: d.id },
        data: { reservaEstado: nuevoEstado },
      });
    }

    // Devolución del adelanto solo si se libera (no se convierte).
    if (motivo === 'LIBERAR') {
      const cotizacion = await tx.cotizacion.findUnique({
        where: { id: cotizacionId },
        select: {
          empresaId: true,
          codigo: true,
          movimientoCajaId: true,
          adelantoMonto: true,
        },
      });
      if (
        cotizacion?.movimientoCajaId &&
        cotizacion.adelantoMonto != null &&
        Number(cotizacion.adelantoMonto) > 0
      ) {
        const ingresoOriginal = await tx.movimientoCaja.findUnique({
          where: { id: cotizacion.movimientoCajaId },
          select: {
            id: true,
            cajaId: true,
            anulado: true,
            metodoPago: true,
            caja: {
              select: {
                estado: true,
                sedeId: true,
                codigo: true,
                usuario: {
                  select: {
                    persona: { select: { nombres: true, apellidos: true } },
                  },
                },
              },
            },
          },
        });
        // Crear contrapartida solo si el ingreso original no fue anulado.
        if (ingresoOriginal && !ingresoOriginal.anulado) {
          const cajaAbierta =
            ingresoOriginal.caja.estado === 'ABIERTA';

          if (cajaAbierta) {
            // Caso A: la caja del adelanto sigue abierta → EGRESO en la
            // misma caja (cajero tiene el efectivo ahí para devolver).
            await tx.movimientoCaja.create({
              data: {
                cajaId: ingresoOriginal.cajaId,
                empresaId: cotizacion.empresaId,
                tipo: TipoMovimientoCaja.EGRESO,
                categoria:
                  CategoriaMovimientoCaja.DEVOLUCION_ADELANTO_COTIZACION,
                // Espejamos el metodo del ingreso original (antes hardcoded
                // EFECTIVO — incorrecto si el adelanto fue YAPE/transferencia).
                metodoPago: ingresoOriginal.metodoPago,
                monto: cotizacion.adelantoMonto,
                descripcion: `Devolución adelanto cotización ${cotizacion.codigo}`,
                cotizacionId,
                registradoPorId: actorUserId,
                // Generado por el flujo de anular cotización, no manual.
                esManual: false,
              },
            });
          } else {
            // Caso B: caja origen CERRADA → EGRESO sale de la Caja Central
            // (Tesoreria) de la sede del adelanto. El cierre histórico de
            // esa caja queda inmutable; el dinero efectivamente ya pasó a
            // tesorería al cerrar (vía el barrido). Ahora sale desde ahí.
            const central = await this.cajaService.getOrCreateCajaCentral(
              cotizacion.empresaId,
              ingresoOriginal.caja.sedeId,
              tx,
            );
            await tx.movimientoCaja.create({
              data: {
                cajaId: central.id,
                empresaId: cotizacion.empresaId,
                tipo: TipoMovimientoCaja.EGRESO,
                categoria:
                  CategoriaMovimientoCaja.DEVOLUCION_ADELANTO_COTIZACION,
                metodoPago: ingresoOriginal.metodoPago,
                monto: cotizacion.adelantoMonto,
                descripcion: `[TESORERIA] Devolución adelanto cotización ${cotizacion.codigo} (${ingresoOriginal.caja.codigo} cerrada)`,
                cotizacionId,
                registradoPorId: actorUserId,
                esManual: false,
                metadata: {
                  movimientoOriginalId: ingresoOriginal.id,
                  cajaOrigenId: ingresoOriginal.cajaId,
                  cajaOrigenCodigo: ingresoOriginal.caja.codigo,
                  cajaOrigenUsuarioNombre: ingresoOriginal.caja.usuario?.persona
                    ? `${ingresoOriginal.caja.usuario.persona.nombres ?? ''} ${ingresoOriginal.caja.usuario.persona.apellidos ?? ''}`.trim()
                    : null,
                  esDevolucionAdelantoCajaCerrada: true,
                },
              },
            });
          }
        }
      }
    }

    return true;
  }

  private validarTransicionEstado(
    actual: EstadoCotizacion,
    nuevo: EstadoCotizacion,
  ) {
    const transicionesValidas: Record<EstadoCotizacion, EstadoCotizacion[]> = {
      [EstadoCotizacion.BORRADOR]: [
        EstadoCotizacion.PENDIENTE,
        EstadoCotizacion.VENCIDA,
      ],
      [EstadoCotizacion.PENDIENTE]: [
        EstadoCotizacion.APROBADA,
        EstadoCotizacion.RECHAZADA,
        EstadoCotizacion.VENCIDA,
      ],
      [EstadoCotizacion.APROBADA]: [EstadoCotizacion.CONVERTIDA],
      [EstadoCotizacion.RECHAZADA]: [],
      [EstadoCotizacion.VENCIDA]: [],
      [EstadoCotizacion.CONVERTIDA]: [],
    };

    const permitidos = transicionesValidas[actual];
    if (!permitidos || !permitidos.includes(nuevo)) {
      throw new BadRequestException(
        `No se puede cambiar de ${actual} a ${nuevo}`,
      );
    }
  }

  /**
   * Cola POS: cotizaciones pendientes y aprobadas listas para cobro
   */
  async getColaPOS(empresaId: string, sedeId?: string, userId?: string, userRole?: string) {
    const where: any = {
      empresaId,
      estado: { in: [EstadoCotizacion.PENDIENTE, EstadoCotizacion.APROBADA] },
    };
    if (sedeId) where.sedeId = sedeId;

    // VENDEDOR y CAJERO solo ven sus propias cotizaciones en la cola POS.
    if (userId && (userRole === Rol.VENDEDOR || userRole === Rol.CAJERO)) {
      where.vendedorId = userId;
    }

    const cotizaciones = await this.prisma.cotizacion.findMany({
      where,
      orderBy: { creadoEn: 'asc' }, // Las más antiguas primero (FIFO)
      include: {
        sede: { select: { id: true, nombre: true } },
        cliente: {
          include: { persona: { select: { nombres: true, apellidos: true } } },
        },
        vendedor: {
          select: {
            aliasTicket: true,
            persona: { select: { nombres: true, apellidos: true } },
          },
        },
        detalles: {
          include: {
            producto: { select: { id: true, nombre: true } },
            variante: { select: { id: true, nombre: true } },
          },
        },
        _count: { select: { detalles: true } },
      },
    });

    return cotizaciones.map((c) => ({
      id: c.id,
      codigo: c.codigo,
      estado: c.estado,
      nombreCliente: c.nombreCliente ||
        (c.cliente?.persona ? `${c.cliente.persona.nombres} ${c.cliente.persona.apellidos}` : 'Sin cliente'),
      vendedor: c.vendedor?.persona
        ? `${c.vendedor.persona.nombres} ${c.vendedor.persona.apellidos}`
        : 'Sin vendedor',
      sede: c.sede?.nombre,
      total: c.total ? Number(c.total) : 0,
      moneda: c.moneda,
      totalItems: c._count.detalles,
      tieneReservaActiva: c.detalles.some(
        (d) => d.reservaEstado === ReservaCotizacionEstado.ACTIVA,
      ),
      detalles: c.detalles.map((d) => ({
        id: d.id,
        producto: d.producto?.nombre || d.variante?.nombre || d.descripcion,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario ? Number(d.precioUnitario) : 0,
        subtotal: d.subtotal ? Number(d.subtotal) : 0,
      })),
      creadoEn: c.creadoEn,
    }));
  }

  /**
   * Validar stock disponible para cada item de una cotización
   */
  async validarStockCotizacion(id: string, empresaId: string) {
    const cotizacion = await this.prisma.cotizacion.findFirst({
      where: { id, empresaId },
      include: {
        detalles: {
          include: {
            producto: { select: { id: true, nombre: true } },
            variante: { select: { id: true, nombre: true } },
          },
        },
      },
    });

    if (!cotizacion) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    const resultado = [];

    for (const detalle of cotizacion.detalles) {
      // Servicios no tienen stock
      if (!detalle.productoId && !detalle.varianteId) {
        resultado.push({
          detalleId: detalle.id,
          descripcion: detalle.descripcion,
          cantidad: Number(detalle.cantidad),
          stockDisponible: null,
          sinStock: false,
          esServicio: true,
        });
        continue;
      }

      // El detalle de variante guarda productoId Y varianteId, pero la fila de
      // ProductoStock de una variante tiene productoId=NULL → buscar por
      // varianteId solo (antes el AND productoId+varianteId no matcheaba nada
      // → "sin stock" falso en variantes que SÍ tenían stock).
      const productoStock = await this.prisma.productoStock.findFirst({
        where: detalle.varianteId
          ? { sedeId: cotizacion.sedeId, varianteId: detalle.varianteId }
          : {
              sedeId: cotizacion.sedeId,
              productoId: detalle.productoId,
              varianteId: null,
            },
      });

      const cantidad = Number(detalle.cantidad);
      let stockDisponible = 0;

      if (productoStock) {
        stockDisponible =
          productoStock.stockActual -
          productoStock.stockReservado -
          productoStock.stockReservadoVenta -
          productoStock.stockReservadoCombo -
          productoStock.stockDanado -
          productoStock.stockEnGarantia;
      }

      resultado.push({
        detalleId: detalle.id,
        descripcion: detalle.descripcion,
        productoNombre: detalle.producto?.nombre || detalle.variante?.nombre,
        cantidad,
        stockDisponible: Math.max(0, stockDisponible),
        sinStock: cantidad > stockDisponible,
        esServicio: false,
      });
    }

    return {
      cotizacionId: id,
      todosConStock: resultado.every((r) => !r.sinStock),
      items: resultado,
    };
  }

  /**
   * Notificar a cajeros cuando una cotización se aprueba
   */
  async notificarCajerosNuevaCotizacion(empresaId: string, cotizacionCodigo: string, total: number) {
    // Buscar usuarios con rol CAJERO en esta empresa
    const cajeros = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        rol: { in: ['CAJERO', 'EMPRESA_ADMIN', 'SUPER_ADMIN'] },
      },
      select: { usuarioId: true },
    });

    const cajeroIds = cajeros.map((c) => c.usuarioId);
    if (cajeroIds.length > 0) {
      await this.notificacionService.enviarAUsuarios(
        cajeroIds,
        `Nueva cotización ${cotizacionCodigo}`,
        `Lista para cobro - Total: S/ ${total.toFixed(2)}`,
        {
          tipo: TipoNotificacion.SISTEMA,
          empresaId,
          data: { action: 'COLA_POS', cotizacionCodigo },
        },
      );
    }
  }

  /**
   * Rechaza si alguno de los productoIds en los detalles está marcado
   * como insumo. Los insumos son materia prima y no se venden ni se
   * cotizan al cliente final (mismo guard que venta.service).
   */
  /// Valida que el descuento de cada línea no exceda el `descuentoMaximo`
  /// configurado en el producto. Compartido por create() y update().
  private async _validarDescuentosMaximos(
    tx: Prisma.TransactionClient,
    detalles: Array<{
      productoId: string | null;
      descripcion: string;
      cantidad: number;
      precioUnitario: number;
      descuento: number;
    }>,
  ): Promise<void> {
    const detallesConDescuento = detalles.filter(
      (d) => d.descuento > 0 && d.productoId,
    );
    if (detallesConDescuento.length === 0) return;

    const productoIds = [
      ...new Set(detallesConDescuento.map((d) => d.productoId!)),
    ];
    const productosConLimite = await tx.producto.findMany({
      where: {
        id: { in: productoIds },
        descuentoMaximo: { not: null },
        esCombo: false,
      },
      select: { id: true, descuentoMaximo: true },
    });
    const limiteMap = new Map(
      productosConLimite.map((p) => [p.id, Number(p.descuentoMaximo)]),
    );

    for (const detalle of detallesConDescuento) {
      const limite = limiteMap.get(detalle.productoId!);
      if (limite != null && limite > 0) {
        const subtotalBruto = detalle.cantidad * detalle.precioUnitario;
        const porcentaje =
          subtotalBruto > 0 ? (detalle.descuento / subtotalBruto) * 100 : 0;
        if (porcentaje > limite) {
          throw new BadRequestException(
            `Descuento de "${detalle.descripcion}" (${porcentaje.toFixed(1)}%) excede el máximo permitido (${limite}%)`,
          );
        }
      }
    }
  }

  /// Valida disponibilidad y construye el mapeo index → reserva para cada
  /// detalle (null si el item no reserva: servicios o líneas manuales).
  /// Compartido por create() (reservarStock=true) y update() (cotización
  /// que ya tenía reserva activa).
  private async _prepararReservaInfo(
    tx: Prisma.TransactionClient,
    empresaId: string,
    sedeId: string,
    detalles: Array<{
      productoId: string | null;
      varianteId: string | null;
      descripcion: string;
      cantidad: number;
    }>,
  ): Promise<Array<{ productoStockId: string; cantidad: number } | null>> {
    const reservaInfo: Array<{
      productoStockId: string;
      cantidad: number;
    } | null> = [];
    for (const d of detalles) {
      const isProducto = d.productoId != null || d.varianteId != null;
      if (!isProducto) {
        reservaInfo.push(null);
        continue;
      }
      const stock = await tx.productoStock.findFirst({
        where: {
          empresaId,
          sedeId,
          productoId: d.varianteId ? null : d.productoId,
          varianteId: d.varianteId ?? null,
        },
        select: {
          id: true,
          stockActual: true,
          stockReservado: true,
          stockReservadoVenta: true,
          stockReservadoCombo: true,
          stockReservadoCotizacion: true,
          stockDanado: true,
          stockEnGarantia: true,
        },
      });
      if (!stock) {
        throw new BadRequestException(
          `No hay stock registrado en esta sede para "${d.descripcion}"`,
        );
      }
      const disponible =
        stock.stockActual -
        stock.stockReservado -
        stock.stockReservadoVenta -
        stock.stockReservadoCombo -
        stock.stockReservadoCotizacion -
        stock.stockDanado -
        stock.stockEnGarantia;
      const cantidadInt = Math.ceil(d.cantidad);
      if (disponible < cantidadInt) {
        throw new BadRequestException(
          `Stock insuficiente para reservar "${d.descripcion}": ` +
            `solicitado ${cantidadInt}, disponible ${disponible}`,
        );
      }
      reservaInfo.push({
        productoStockId: stock.id,
        cantidad: cantidadInt,
      });
    }
    return reservaInfo;
  }

  /// Decrementa stockReservadoCotizacion de los detalles con reserva
  /// ACTIVA, sin tocar el adelanto (a diferencia de _liberarReservas).
  /// Pensado para la edición de BORRADOR, donde los detalles se
  /// reemplazan y la reserva se re-aplica sobre los nuevos.
  /// Devuelve `true` si había reservas activas.
  private async _liberarReservasDeDetalles(
    tx: Prisma.TransactionClient,
    cotizacionId: string,
  ): Promise<boolean> {
    const detallesConReserva = await tx.cotizacionDetalle.findMany({
      where: {
        cotizacionId,
        reservaEstado: ReservaCotizacionEstado.ACTIVA,
      },
      select: { productoStockId: true, cantidadReservada: true },
    });
    if (detallesConReserva.length === 0) return false;

    for (const d of detallesConReserva) {
      if (!d.productoStockId || !d.cantidadReservada) continue;
      await tx.productoStock.update({
        where: { id: d.productoStockId },
        data: {
          stockReservadoCotizacion: { decrement: d.cantidadReservada },
        },
      });
    }
    return true;
  }

  private async _assertNoInsumos(
    tx: Prisma.TransactionClient,
    detalles: Array<{ productoId: string | null; descripcion: string }>,
  ): Promise<void> {
    const ids = [
      ...new Set(
        detalles
          .filter((d) => d.productoId != null)
          .map((d) => d.productoId as string),
      ),
    ];
    if (ids.length === 0) return;
    const insumos = await tx.producto.findMany({
      where: { id: { in: ids }, esInsumo: true },
      select: { id: true, nombre: true },
    });
    if (insumos.length > 0) {
      throw new BadRequestException(
        `Producto(s) marcado(s) como insumo no se pueden cotizar: ${insumos
          .map((p) => `"${p.nombre}"`)
          .join(', ')}. Si querés cotizarlos al cliente, desmarcá "Es insumo" en el detalle del producto.`,
      );
    }
  }
}
