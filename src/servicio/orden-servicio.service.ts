import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EvolutionApiService } from '../whatsapp/evolution-api.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { AvisoMantenimientoService } from '../aviso-mantenimiento/aviso-mantenimiento.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { CajaService } from '../caja/caja.service';
import { TipoNotificacion } from '@prisma/client';
import {
  EstadoOrdenServicio,
  EstadoDiagnostico,
  EstadoComponente,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
  Prisma,
  TipoCampoServicio,
} from '@prisma/client';
import { CreateOrdenServicioDto } from './dto/create-orden-servicio.dto';
import { UpdateOrdenServicioDto } from './dto/update-orden-servicio.dto';
import { TransitionEstadoDto } from './dto/transition-estado.dto';
import { QueryOrdenServicioDto } from './dto/query-orden-servicio.dto';
import { createCursorPaginatedResponse } from '../common/utils/pagination.util';

// B1 FIX: TERCERIZADO removido de transiciones directas — solo se permite via tercerizacion.crear()
// B13 FIX: LISTO_ENTREGA ahora permite revertir a EN_REPARACION y CANCELADO
const VALID_TRANSITIONS: Record<EstadoOrdenServicio, EstadoOrdenServicio[]> = {
  RECIBIDO: [EstadoOrdenServicio.EN_DIAGNOSTICO, EstadoOrdenServicio.CANCELADO],
  EN_DIAGNOSTICO: [
    EstadoOrdenServicio.ESPERANDO_APROBACION,
    EstadoOrdenServicio.EN_REPARACION,
    EstadoOrdenServicio.CANCELADO,
  ],
  ESPERANDO_APROBACION: [
    EstadoOrdenServicio.EN_REPARACION,
    EstadoOrdenServicio.CANCELADO,
  ],
  EN_REPARACION: [
    EstadoOrdenServicio.PENDIENTE_PIEZAS,
    EstadoOrdenServicio.REPARADO,
    EstadoOrdenServicio.CANCELADO,
  ],
  PENDIENTE_PIEZAS: [
    EstadoOrdenServicio.EN_REPARACION,
    EstadoOrdenServicio.CANCELADO,
  ],
  REPARADO: [EstadoOrdenServicio.LISTO_ENTREGA],
  LISTO_ENTREGA: [EstadoOrdenServicio.ENTREGADO, EstadoOrdenServicio.EN_REPARACION, EstadoOrdenServicio.CANCELADO],
  ENTREGADO: [EstadoOrdenServicio.FINALIZADO, EstadoOrdenServicio.EN_DIAGNOSTICO],
  CANCELADO: [],
  FINALIZADO: [EstadoOrdenServicio.EN_DIAGNOSTICO],
  TERCERIZADO: [EstadoOrdenServicio.REPARADO, EstadoOrdenServicio.RECIBIDO],
};

// Estados terminales: no permiten edición ni asignación de técnico
const ESTADOS_TERMINALES: EstadoOrdenServicio[] = [
  EstadoOrdenServicio.CANCELADO,
  EstadoOrdenServicio.FINALIZADO,
  EstadoOrdenServicio.TERCERIZADO,
];

// Include reutilizable para OrdenServicio
const ORDEN_SERVICIO_BASE_INCLUDE = {
  cliente: { include: { persona: true } },
  clienteEmpresa: { include: { contactos: true } },
  contactoClienteEmpresa: true,
  tecnico: { include: { persona: true } },
  modeloEquipo: true,
  servicio: true,
  // Señal precisa de "cobrada": existe un VentaDetalle vinculado (1:1).
  // Distingue cobrada vs finalizada-sin-cobro. Solo el id (liviano).
  ventaDetalle: { select: { id: true } },
  // Componentes (liviano, sin el join a `componente`) para que la LISTA calcule
  // el total facturable aditivo (servicio + repuestos) y el saldo en la card.
  // Incluye los campos que exige el modelo Flutter (id/ordenServicioId/
  // componenteId/tipoAccion no-nulos) para no romper el parseo de la lista.
  componentes: {
    select: {
      id: true,
      ordenServicioId: true,
      componenteId: true,
      tipoAccion: true,
      estadoComponente: true,
      costoAccion: true,
      costoRepuestos: true,
    },
  },
} as const;

const ORDEN_SERVICIO_FULL_INCLUDE = {
  ...ORDEN_SERVICIO_BASE_INCLUDE,
  // Detalle: componentes completos (sobreescribe el select liviano del BASE).
  componentes: {
    include: { componente: { include: { tipoComponente: true } } },
  },
  // Libro de adelantos (cada abono con fecha/hora/método/usuario).
  adelantos: { orderBy: { creadoEn: 'desc' as const } },
} as const;

const ORDEN_SERVICIO_DETAIL_INCLUDE = {
  ...ORDEN_SERVICIO_FULL_INCLUDE,
  tercerizacionOrigen: {
    include: {
      empresaDestino: { select: { id: true, nombre: true, logo: true, telefono: true } },
    },
  },
  tercerizacionDestino: {
    include: {
      empresaOrigen: { select: { id: true, nombre: true, logo: true, telefono: true } },
    },
  },
} as const;

@Injectable()
export class OrdenServicioService {
  private readonly logger = new Logger(OrdenServicioService.name);

  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
    @Inject(forwardRef(() => AvisoMantenimientoService))
    private avisoMantenimientoService: AvisoMantenimientoService,
    private notificacionService: NotificacionService,
    private cajaService: CajaService,
    @Inject(forwardRef(() => EvolutionApiService))
    private readonly evolution: EvolutionApiService,
  ) {}

  /** Mapea el string libre `metodoPagoAdelanto` al enum de caja (fallback EFECTIVO). */
  static toMetodoPagoVenta(metodo?: string | null): MetodoPagoVenta {
    const valor = (metodo ?? '').toUpperCase().trim();
    return (Object.values(MetodoPagoVenta) as string[]).includes(valor)
      ? (valor as MetodoPagoVenta)
      : MetodoPagoVenta.EFECTIVO;
  }

  /**
   * B8 ampliado: adelanto y descuento no pueden exceder el costo total,
   * ni tampoco su SUMA (adelanto + descuento > costo = saldo negativo que
   * después bloquea el cobro con "montos inconsistentes"). Suma == costo
   * sí se permite (orden 100% adelantada, saldo 0, es cobrable).
   * Con costoTotal null (aún sin diagnosticar) no hay contra qué validar.
   */
  private static validarMontosOrden(params: {
    costoTotal: number | null;
    adelanto: number;
    descuento: number;
    /** Subtotal de componentes (repuestos+M.O.) que el cliente paga (modelo aditivo). */
    subtotalComponentes?: number;
  }) {
    // Base facturable = costo del servicio + componentes (repuestos+M.O.).
    // Con costoTotal null y sin componentes no hay contra qué validar.
    const comp = params.subtotalComponentes ?? 0;
    if (params.costoTotal === null && comp === 0) return;
    const base = Math.round(((params.costoTotal ?? 0) + comp) * 100) / 100;
    if (params.adelanto > base) {
      throw new BadRequestException(
        'El adelanto no puede ser mayor al total (servicio + repuestos)',
      );
    }
    if (params.descuento > base) {
      throw new BadRequestException(
        'El descuento no puede ser mayor al total (servicio + repuestos)',
      );
    }
    const suma = Math.round((params.adelanto + params.descuento) * 100) / 100;
    if (suma > base) {
      throw new BadRequestException(
        'La suma de adelanto y descuento no puede superar el total (servicio + repuestos)',
      );
    }
  }

  /**
   * Notificaciones fire-and-forget: el fallo no debe romper el flujo de la
   * orden, pero sí quedar logueado — sin esto, "al cliente no le llegó
   * nada" es indiagnosticable.
   */
  private static logNotifFallida(contexto: string) {
    return (e: unknown) =>
      console.warn(
        `Notificacion de orden fallida (${contexto}):`,
        e instanceof Error ? e.message : e,
      );
  }

  /**
   * Registra en caja el DELTA del adelanto de una orden, respetando el medio
   * de pago del abono (YAPE/PLIN/TARJETA/EFECTIVO/TRANSFERENCIA):
   * - delta > 0 (cliente abona / amplía) → INGRESO ADELANTO_SERVICIO.
   * - delta < 0 (corrección / devolución parcial) → EGRESO ADELANTO_SERVICIO.
   *
   * Usa `registrarMovimientoEnCajaOTesoreria`: si el usuario no tiene caja
   * abierta cae a la Caja Central de la sede — el dinero recibido NUNCA se
   * pierde (mismo criterio que devoluciones). Cada abono parcial queda con
   * SU método del momento aunque `metodoPagoAdelanto` guarde solo el último.
   */
  private async registrarDeltaAdelantoEnCaja(
    tx: Prisma.TransactionClient,
    params: {
      empresaId: string;
      ordenId: string;
      codigo: string | null;
      sedeId: string | null;
      usuarioId: string;
      adelantoAnterior: number;
      adelantoNuevo: number;
      metodoPago?: string | null;
      /** Nota para la fila del libro de adelantos. */
      nota?: string | null;
      /** Componente al que se imputa el abono. null = al costo del servicio. */
      servicioComponenteId?: string | null;
      /** true = anulación de una fila existente: registra caja SIN crear fila. */
      sinFila?: boolean;
    },
  ) {
    const delta =
      Math.round((params.adelantoNuevo - params.adelantoAnterior) * 100) / 100;
    if (Math.abs(delta) < 0.01) return;

    // LIBRO de adelantos: toda variación queda como fila con fecha/hora,
    // método y usuario (los ajustes negativos también, para que
    // Σ filas no anuladas == orden.adelanto SIEMPRE).
    if (!params.sinFila) {
      let creadoPorNombre: string | null = null;
      try {
        const u = await tx.usuario.findUnique({
          where: { id: params.usuarioId },
          select: { persona: { select: { nombres: true, apellidos: true } } },
        });
        creadoPorNombre = u?.persona
          ? `${u.persona.nombres} ${u.persona.apellidos ?? ''}`.trim()
          : null;
      } catch {
        // El snapshot de nombre es best-effort.
      }
      await tx.adelantoOrdenServicio.create({
        data: {
          ordenServicioId: params.ordenId,
          monto: new Prisma.Decimal(delta.toFixed(2)),
          metodoPago: params.metodoPago || 'EFECTIVO',
          nota:
            params.nota ??
            (delta < 0 ? 'Ajuste/corrección del total de adelanto' : null),
          // Solo los abonos se imputan: una fila de ajuste negativo corrige el
          // total de la orden, no el pago de un repuesto.
          servicioComponenteId:
            delta > 0 ? (params.servicioComponenteId ?? null) : null,
          creadoPor: params.usuarioId,
          creadoPorNombre,
        },
      });
    }

    // Fallback de sede: muchas órdenes se crean sin sedeId (el form no lo
    // exige). El dinero lo recibe quien registra → usar la sede de SU caja
    // abierta; si tampoco hay, la sede más antigua activa de la empresa
    // (su Caja Central absorbe el delta). El dinero recibido NUNCA queda
    // sin registrar.
    let sedeId = params.sedeId;
    if (!sedeId) {
      const cajaUsuario = await tx.caja.findFirst({
        where: {
          empresaId: params.empresaId,
          usuarioId: params.usuarioId,
          estado: 'ABIERTA',
          esCajaCentral: false,
        },
        select: { sedeId: true },
      });
      sedeId = cajaUsuario?.sedeId ?? null;
    }
    if (!sedeId) {
      const sedePrincipal = await tx.sede.findFirst({
        where: {
          empresaId: params.empresaId,
          isActive: true,
          deletedAt: null,
        },
        orderBy: { creadoEn: 'asc' },
        select: { id: true },
      });
      sedeId = sedePrincipal?.id ?? null;
    }
    if (!sedeId) {
      // Empresa sin ninguna sede activa: no existe caja posible.
      console.warn(
        `Adelanto orden ${params.codigo}: empresa sin sedes activas, no se registró en caja (S/ ${delta})`,
      );
      return;
    }

    await this.cajaService.registrarMovimientoEnCajaOTesoreria(
      params.empresaId,
      sedeId,
      params.usuarioId,
      {
        tipo: delta > 0 ? TipoMovimientoCaja.INGRESO : TipoMovimientoCaja.EGRESO,
        categoria: CategoriaMovimientoCaja.ADELANTO_SERVICIO,
        metodoPago: OrdenServicioService.toMetodoPagoVenta(params.metodoPago),
        monto: Math.abs(delta),
        // Solo ASCII: estas descripciones se imprimen en tickets térmicos
        // (cierre de caja) cuyos code pages no tienen "→"/"—".
        descripcion:
          delta > 0
            ? `Adelanto orden ${params.codigo}` +
              (params.adelantoAnterior > 0
                ? ` (abono: S/ ${params.adelantoAnterior.toFixed(2)} -> S/ ${params.adelantoNuevo.toFixed(2)})`
                : '')
            : `Corrección adelanto orden ${params.codigo} (S/ ${params.adelantoAnterior.toFixed(2)} -> S/ ${params.adelantoNuevo.toFixed(2)})`,
        ordenServicioId: params.ordenId,
      },
      tx,
    );
  }

  async create(dto: CreateOrdenServicioDto, usuarioId?: string) {
    // Validar XOR: debe tener clienteId O clienteEmpresaId, pero no ambos ni ninguno
    if (!dto.clienteId && !dto.clienteEmpresaId) {
      throw new BadRequestException(
        'Debe especificar clienteId (persona) o clienteEmpresaId (empresa)',
      );
    }
    if (dto.clienteId && dto.clienteEmpresaId) {
      throw new BadRequestException(
        'No puede especificar clienteId y clienteEmpresaId simultáneamente',
      );
    }

    // Validar contacto solo si es cliente empresa
    if (dto.contactoClienteEmpresaId && !dto.clienteEmpresaId) {
      throw new BadRequestException(
        'contactoClienteEmpresaId solo aplica cuando se usa clienteEmpresaId',
      );
    }

    // B8 (paridad con transitionEstado/update): la orden no puede NACER
    // con montos inconsistentes.
    OrdenServicioService.validarMontosOrden({
      costoTotal: dto.costoTotal ?? null,
      adelanto: dto.adelanto ?? 0,
      descuento: dto.descuento ?? 0,
    });

    // Validar cliente persona
    if (dto.clienteId) {
      const cliente = await this.prisma.empresaPersona.findFirst({
        where: { id: dto.clienteId, empresaId: dto.empresaId },
      });
      if (!cliente) {
        throw new BadRequestException(
          'El cliente no existe o no pertenece a esta empresa',
        );
      }
    }

    // Validar cliente empresa
    if (dto.clienteEmpresaId) {
      const clienteEmpresa = await this.prisma.clienteEmpresa.findFirst({
        where: { id: dto.clienteEmpresaId, empresaId: dto.empresaId, deletedAt: null, isActive: true },
      });
      if (!clienteEmpresa) {
        throw new BadRequestException(
          'El cliente empresa no existe, está inactivo o no pertenece a esta empresa',
        );
      }

      // Validar contacto si se especificó
      if (dto.contactoClienteEmpresaId) {
        const contacto = await this.prisma.clienteEmpresaContacto.findFirst({
          where: { id: dto.contactoClienteEmpresaId, clienteEmpresaId: dto.clienteEmpresaId },
        });
        if (!contacto) {
          throw new BadRequestException(
            'El contacto no existe o no pertenece al cliente empresa',
          );
        }
      }
    }

    // Validar que el técnico existe y pertenece a la empresa
    if (dto.tecnicoId) {
      const tecnico = await this.prisma.usuario.findFirst({
        where: {
          id: dto.tecnicoId,
          empresas: { some: { empresaId: dto.empresaId } },
        },
      });
      if (!tecnico) {
        throw new BadRequestException(
          'El técnico no existe o no pertenece a esta empresa',
        );
      }
    }

    // Validar que el servicio existe y pertenece a la empresa
    if (dto.servicioId) {
      const servicio = await this.prisma.servicio.findFirst({
        where: { id: dto.servicioId, empresaId: dto.empresaId },
      });
      if (!servicio) {
        throw new BadRequestException(
          'El servicio no existe o no pertenece a esta empresa',
        );
      }
    }

    // Validar que la sede existe y pertenece a la empresa
    if (dto.sedeId) {
      const sede = await this.prisma.sede.findFirst({
        where: { id: dto.sedeId, empresaId: dto.empresaId },
      });
      if (!sede) {
        throw new BadRequestException(
          'La sede no existe o no pertenece a esta empresa',
        );
      }
    }

    // Validar que el modelo de equipo existe y pertenece a la empresa
    if (dto.modeloEquipoId) {
      const modeloEquipo = await this.prisma.modeloEquipo.findFirst({
        where: { id: dto.modeloEquipoId, empresaId: dto.empresaId },
      });
      if (!modeloEquipo) {
        throw new BadRequestException(
          'El modelo de equipo no existe o no pertenece a esta empresa',
        );
      }
    }

    // Validar datos personalizados contra campos configurados
    if (dto.datosPersonalizados) {
      await this.validateDatosPersonalizados(
        dto.empresaId,
        dto.datosPersonalizados,
        dto.servicioId,
      );
    }

    // Generar código de orden
    const codigo = await this.configuracionCodigosService.generarCodigoOrdenServicio(
      dto.empresaId,
      dto.sedeId,
    );

    const { empresaId, fechaAvisoPersonalizado, fechaPrometida, ...restDto } =
      dto;

    // Transacción: la orden y el registro del adelanto en caja son atómicos
    // (si falla caja, no queda una orden con adelanto sin rastro de dinero).
    const orden = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.ordenServicio.create({
        data: {
          empresaId,
          ...restDto,
          codigo,
          estado: EstadoOrdenServicio.RECIBIDO,
          fechaAvisoPersonalizado: fechaAvisoPersonalizado
            ? new Date(fechaAvisoPersonalizado)
            : undefined,
          fechaPrometida: fechaPrometida
            ? new Date(fechaPrometida)
            : undefined,
        },
        include: ORDEN_SERVICIO_FULL_INCLUDE,
      });

      // Adelanto inicial → INGRESO en caja con su medio de pago
      const adelantoInicial = Number(creada.adelanto ?? 0);
      if (adelantoInicial > 0 && usuarioId) {
        await this.registrarDeltaAdelantoEnCaja(tx, {
          empresaId,
          ordenId: creada.id,
          codigo: creada.codigo,
          sedeId: creada.sedeId,
          usuarioId,
          adelantoAnterior: 0,
          adelantoNuevo: adelantoInicial,
          metodoPago: creada.metodoPagoAdelanto,
        });
      }

      return creada;
    });

    // Notificar al cliente (fire-and-forget)
    const servicioNombre = orden.servicio?.nombre ?? 'Servicio';
    this.notificarClienteOrden(
      orden.clienteId,
      'Nueva orden de servicio',
      `Tu orden ${orden.codigo} (${servicioNombre}) ha sido registrada`,
      empresaId,
      orden.id,
      'created',
    ).catch(OrdenServicioService.logNotifFallida('orden creada'));

    return orden;
  }

  async transitionEstado(
    empresaId: string,
    id: string,
    dto: TransitionEstadoDto,
    usuarioId?: string,
  ) {
    // B1 FIX: Bloquear transición directa a TERCERIZADO desde este endpoint
    if (dto.nuevoEstado === EstadoOrdenServicio.TERCERIZADO) {
      throw new BadRequestException(
        'No se puede cambiar a TERCERIZADO directamente. Use el módulo de tercerización.',
      );
    }

    // Verificar que la orden existe antes de iniciar la transacción
    await this.findOne(empresaId, id);

    // B2 FIX: Toda la lógica de transición dentro de una transacción para evitar race conditions
    const updatedOrden = await this.prisma.$transaction(async (tx) => {
      // Lock pesimista: serializa transiciones/ediciones concurrentes de la
      // misma orden (valida VALID_TRANSITIONS y calcula el delta del
      // adelanto sobre el estado REAL, no sobre una lectura paralela).
      await tx.$queryRawUnsafe(
        `SELECT id FROM "OrdenServicio" WHERE id = $1 AND "empresaId" = $2 FOR UPDATE`,
        id,
        empresaId,
      );
      // Re-leer la orden DENTRO de la transacción para evitar race conditions
      const orden = await tx.ordenServicio.findFirst({
        where: { id, empresaId },
        include: {
          componentes: {
            include: { componente: { include: { tipoComponente: true } } },
          },
        },
      });

      if (!orden) {
        throw new NotFoundException('Orden de servicio no encontrada');
      }

      const allowed = VALID_TRANSITIONS[orden.estado];
      if (!allowed || !allowed.includes(dto.nuevoEstado)) {
        throw new BadRequestException(
          `No se puede cambiar de "${orden.estado}" a "${dto.nuevoEstado}". ` +
          `Transiciones válidas: ${allowed?.join(', ') || 'ninguna (estado terminal)'}`,
        );
      }

      const updateData: any = {
        estado: dto.nuevoEstado,
      };

      if (dto.notas) {
        updateData.notas = dto.notas;
      }

      if (dto.diagnostico) {
        updateData.diagnostico = dto.diagnostico;
      }

      // Costos: costoTotal, adelanto, descuento - permitidos en estados operativos
      const allowCostStates: EstadoOrdenServicio[] = [
        EstadoOrdenServicio.RECIBIDO,
        EstadoOrdenServicio.EN_DIAGNOSTICO,
        EstadoOrdenServicio.ESPERANDO_APROBACION,
        EstadoOrdenServicio.EN_REPARACION,
        EstadoOrdenServicio.REPARADO,
        EstadoOrdenServicio.LISTO_ENTREGA,
        EstadoOrdenServicio.ENTREGADO,
      ];

      // B8 FIX: adelanto/descuento (incluida su suma) no exceden costoTotal.
      // Solo se valida si la transición toca montos: una orden con datos
      // legacy inconsistentes igual puede transicionar sin modificarlos.
      if (
        dto.costoTotal !== undefined ||
        dto.adelanto !== undefined ||
        dto.descuento !== undefined
      ) {
        OrdenServicioService.validarMontosOrden({
          costoTotal:
            dto.costoTotal ??
            (orden.costoTotal ? Number(orden.costoTotal) : null),
          adelanto: dto.adelanto ?? Number(orden.adelanto ?? 0),
          descuento: dto.descuento ?? Number(orden.descuento ?? 0),
          subtotalComponentes: OrdenServicioService.subtotalComponentes(orden as any),
        });
      }

      if (dto.costoTotal !== undefined) {
        if (allowCostStates.includes(dto.nuevoEstado)) {
          updateData.costoTotal = dto.costoTotal;
        }
      }
      if (dto.adelanto !== undefined) {
        if (allowCostStates.includes(dto.nuevoEstado)) {
          // Guard: orden ya cobrada (vínculo a venta o comprobante) → el
          // adelanto está saldado, no se puede modificar (dinero fantasma).
          if (Number(dto.adelanto) !== Number(orden.adelanto ?? 0)) {
            const cobrada =
              orden.comprobanteId != null ||
              (await tx.ventaDetalle.findUnique({
                where: { ordenServicioId: id },
                select: { id: true },
              })) != null;
            if (cobrada) {
              throw new BadRequestException(
                `La orden ${orden.codigo} ya fue cobrada: el adelanto no se puede modificar`,
              );
            }
          }
          updateData.adelanto = dto.adelanto;
          if (dto.metodoPagoAdelanto) {
            updateData.metodoPagoAdelanto = dto.metodoPagoAdelanto;
          }
        }
      }
      if (dto.descuento !== undefined) {
        if (allowCostStates.includes(dto.nuevoEstado)) {
          updateData.descuento = dto.descuento;
        }
      }

      // Actualizar estadoDiagnostico según el estado
      if (dto.nuevoEstado === EstadoOrdenServicio.EN_DIAGNOSTICO) {
        updateData.estadoDiagnostico = EstadoDiagnostico.EN_PROGRESO;
      } else if (dto.nuevoEstado === EstadoOrdenServicio.ESPERANDO_APROBACION) {
        updateData.estadoDiagnostico = EstadoDiagnostico.COMPLETADO;
      } else if (
        dto.nuevoEstado === EstadoOrdenServicio.EN_REPARACION ||
        dto.nuevoEstado === EstadoOrdenServicio.REPARADO ||
        dto.nuevoEstado === EstadoOrdenServicio.ENTREGADO ||
        dto.nuevoEstado === EstadoOrdenServicio.FINALIZADO ||
        dto.nuevoEstado === EstadoOrdenServicio.CANCELADO
      ) {
        if (orden.estadoDiagnostico && orden.estadoDiagnostico !== EstadoDiagnostico.COMPLETADO) {
          updateData.estadoDiagnostico = EstadoDiagnostico.COMPLETADO;
        }
      }

      // Registrar fecha de entrega
      if (dto.nuevoEstado === EstadoOrdenServicio.ENTREGADO) {
        updateData.fechaEntrega = new Date();
      }

      // Sincronizar estado de componentes según transición
      const syncComponentes =
        dto.nuevoEstado === EstadoOrdenServicio.EN_REPARACION ||
        dto.nuevoEstado === EstadoOrdenServicio.REPARADO ||
        dto.nuevoEstado === EstadoOrdenServicio.ENTREGADO;

      let componenteEstado: EstadoComponente | null = null;
      if (syncComponentes) {
        componenteEstado =
          dto.nuevoEstado === EstadoOrdenServicio.EN_REPARACION
            ? EstadoComponente.EN_REPARACION
            : dto.nuevoEstado === EstadoOrdenServicio.REPARADO
              ? EstadoComponente.DISPONIBLE
              : EstadoComponente.EN_USO; // ENTREGADO
      }

      // Reingreso: cuando se reabre una orden entregada/finalizada
      const isReingreso =
        (orden.estado === EstadoOrdenServicio.ENTREGADO ||
          orden.estado === EstadoOrdenServicio.FINALIZADO) &&
        dto.nuevoEstado === EstadoOrdenServicio.EN_DIAGNOSTICO;

      if (isReingreso) {
        if (!dto.motivoReingreso && !dto.notas) {
          throw new BadRequestException(
            'Debe indicar el motivo del reingreso',
          );
        }
        if (orden.cantidadReingresos >= 5) {
          throw new BadRequestException(
            'Se excedió el máximo de reingresos (5) para esta orden',
          );
        }
        updateData.cantidadReingresos = { increment: 1 };
        updateData.motivoReingreso = dto.motivoReingreso || dto.notas;
        updateData.estadoDiagnostico = EstadoDiagnostico.PENDIENTE;
        updateData.fechaEntrega = null;
      }

      const [result] = await Promise.all([
        tx.ordenServicio.update({
          where: { id },
          data: updateData,
          include: ORDEN_SERVICIO_FULL_INCLUDE,
        }),
        tx.historialOrdenServicio.create({
          data: {
            ordenServicioId: id,
            estadoAnterior: orden.estado,
            estadoNuevo: dto.nuevoEstado,
            notas: isReingreso
              ? `[REINGRESO] ${dto.motivoReingreso || dto.notas || ''}`
              : dto.notas,
            diagnostico: dto.diagnostico,
            costoTotal: dto.costoTotal,
            comunicarCliente: dto.comunicarCliente ?? false,
            creadoPor: usuarioId,
          },
        }),
      ]);

      // Sync component estados DENTRO de la transacción
      if (syncComponentes && componenteEstado) {
        await tx.servicioComponente.updateMany({
          where: { ordenServicioId: id },
          data: { estadoComponente: componenteEstado },
        });
      }

      // Cambio de adelanto en la transición → delta en caja con su medio
      if (updateData.adelanto !== undefined && usuarioId) {
        await this.registrarDeltaAdelantoEnCaja(tx, {
          empresaId,
          ordenId: id,
          codigo: orden.codigo,
          sedeId: orden.sedeId,
          usuarioId,
          adelantoAnterior: Number(orden.adelanto ?? 0),
          adelantoNuevo: Number(dto.adelanto),
          metodoPago: dto.metodoPagoAdelanto ?? orden.metodoPagoAdelanto,
        });
      }

      return result;
    });

    // Generar aviso de mantenimiento al completar la orden (solo para clientes persona)
    if (
      (dto.nuevoEstado === EstadoOrdenServicio.ENTREGADO ||
        dto.nuevoEstado === EstadoOrdenServicio.FINALIZADO) &&
      updatedOrden.incluirAvisoMantenimiento &&
      updatedOrden.clienteId
    ) {
      try {
        await this.avisoMantenimientoService.crearAvisoParaOrden({
          id: updatedOrden.id,
          empresaId,
          clienteId: updatedOrden.clienteId,
          tipoServicio: updatedOrden.tipoServicio,
          tipoEquipo: updatedOrden.tipoEquipo,
          marcaEquipo: updatedOrden.marcaEquipo,
          fechaEntrega: updatedOrden.fechaEntrega,
          actualizadoEn: updatedOrden.actualizadoEn,
          fechaAvisoPersonalizado: updatedOrden.fechaAvisoPersonalizado,
        });
      } catch {
        // No bloquear la transición si falla la creación del aviso
      }
    }

    // Notificar al cliente sobre el cambio de estado (fire-and-forget)
    const estadoLabels: Record<string, string> = {
      EN_DIAGNOSTICO: 'En diagnóstico',
      ESPERANDO_APROBACION: 'Esperando tu aprobación',
      EN_REPARACION: 'En reparación',
      PENDIENTE_PIEZAS: 'Pendiente de piezas',
      REPARADO: 'Reparado',
      LISTO_ENTREGA: 'Listo para entrega',
      ENTREGADO: 'Entregado',
      FINALIZADO: 'Finalizado',
      CANCELADO: 'Cancelado',
    };

    const estadoLabel = estadoLabels[dto.nuevoEstado] ?? dto.nuevoEstado;

    const servicioNombreTransition = updatedOrden.servicio?.nombre ?? 'Servicio';
    this.notificarClienteOrden(
      updatedOrden.clienteId,
      `Orden ${estadoLabel.toLowerCase()}`,
      `Tu orden ${updatedOrden.codigo} (${servicioNombreTransition}) está: ${estadoLabel}`,
      empresaId,
      id,
      'status_changed',
    ).catch(OrdenServicioService.logNotifFallida('cambio de estado'));

    // WhatsApp al cliente, solo si el usuario marcó "comunicar al cliente".
    // Antes esto abría wa.me en el celular del técnico y había que darle
    // enviar a mano; con la instancia Evolution de la empresa sale solo.
    if (dto.comunicarCliente) {
      void this.enviarWhatsappCambioEstado(
        empresaId,
        updatedOrden,
        estadoLabel,
      );
    }

    return updatedOrden;
  }

  /**
   * Avisa al cliente por WhatsApp desde la instancia Evolution de la EMPRESA.
   *
   * Best-effort en todo: sin integración conectada, sin teléfono o si
   * Evolution falla, NO se toca la transición — el cambio de estado ya está
   * guardado y no puede deshacerse por un mensaje.
   */
  private async enviarWhatsappCambioEstado(
    empresaId: string,
    orden: any,
    estadoLabel: string,
  ): Promise<void> {
    try {
      const telefono: string | undefined =
        orden.cliente?.persona?.telefono ?? orden.cliente?.telefono;
      if (!telefono) return;

      const integracion = await this.prisma.integracionWhatsapp.findFirst({
        where: { empresaId, estado: 'CONECTADO' },
        select: { instanceName: true },
      });
      if (!integracion) return;

      const empresa = await this.prisma.empresa.findUnique({
        where: { id: empresaId },
        select: { nombre: true },
      });

      const nombre = orden.cliente?.persona?.nombres?.split(' ')?.[0] ?? '';
      const saludo = nombre ? `Hola ${nombre}!` : 'Hola!';
      const texto =
        `${saludo}\n\nTu orden *${orden.codigo}* en ` +
        `${empresa?.nombre ?? 'nuestro taller'} cambió de estado:\n` +
        `*${estadoLabel}*`;

      // Peruano de 9 dígitos → Evolution exige el código de país.
      const limpio = telefono.replace(/\D/g, '');
      const numero = limpio.length === 9 ? `51${limpio}` : limpio;

      await this.evolution.sendText({
        instanceName: integracion.instanceName,
        number: numero,
        text: texto,
      });
    } catch (e) {
      this.logger.warn(
        `WhatsApp cambio de estado ${orden?.codigo}: ${(e as Error).message}`,
      );
    }
  }

  async findHistorial(empresaId: string, ordenId: string) {
    // Verificar que la orden pertenece a la empresa
    await this.findOne(empresaId, ordenId);

    return this.prisma.historialOrdenServicio.findMany({
      where: { ordenServicioId: ordenId },
      orderBy: { creadoEn: 'asc' },
    });
  }

  /**
   * Notifica al cliente sobre su orden de servicio
   * Busca el usuarioId a partir del clienteId (EmpresaPersona)
   */
  private async notificarClienteOrden(
    clienteId: string | null,
    titulo: string,
    cuerpo: string,
    empresaId: string,
    ordenId: string,
    action: string,
  ) {
    if (!clienteId) return;

    // Obtener el usuarioId del cliente
    const empresaPersona = await this.prisma.empresaPersona.findFirst({
      where: { id: clienteId },
      select: { persona: { select: { usuario: { select: { id: true } } } } },
    });

    const usuarioId = empresaPersona?.persona?.usuario?.id;
    if (!usuarioId) return;

    await this.notificacionService.enviarAUsuario(
      usuarioId,
      titulo,
      cuerpo,
      {
        tipo: TipoNotificacion.ORDEN_SERVICIO,
        // target 'cliente' → el deep-link de la app lo lleva a /mis-ordenes
        // (la cuenta puede tener loginMode 'management' por otros roles).
        data: { ordenId, action, target: 'cliente' },
        empresaId,
      },
    );
  }

  async findOrdenesCliente(empresaId: string, personaId: string, query: QueryOrdenServicioDto) {
    const empresaPersona = await this.prisma.empresaPersona.findFirst({
      where: { personaId, empresaId, deletedAt: null },
      select: { id: true },
    });

    if (!empresaPersona) {
      return { data: [], total: 0, page: 1, limit: 10, totalPages: 0 };
    }

    query.clienteId = empresaPersona.id;
    return this.findAll(empresaId, query, true);
  }

  /**
   * Detalle de orden para el cliente (vista simplificada)
   */
  async findOrdenCliente(empresaId: string, personaId: string, ordenId: string) {
    const empresaPersona = await this.prisma.empresaPersona.findFirst({
      where: { personaId, empresaId, deletedAt: null },
      select: { id: true },
    });

    if (!empresaPersona) {
      throw new NotFoundException('No eres cliente de esta empresa');
    }

    const orden = await this.prisma.ordenServicio.findFirst({
      where: {
        id: ordenId,
        empresaId,
        clienteId: empresaPersona.id,
      },
      include: {
        servicio: true,
        modeloEquipo: true,
        componentes: {
          include: { componente: { include: { tipoComponente: true } } },
        },
      },
    });

    if (!orden) {
      throw new NotFoundException('Orden no encontrada');
    }

    // Retornar solo lo necesario para el cliente
    return {
      id: orden.id,
      codigo: orden.codigo,
      tipoServicio: orden.tipoServicio,
      estado: orden.estado,
      estadoDiagnostico: orden.estadoDiagnostico,
      prioridad: orden.prioridad,
      // Equipo
      tipoEquipo: orden.tipoEquipo,
      marcaEquipo: orden.marcaEquipo,
      modeloEquipo: orden.modeloEquipo
        ? `${orden.modeloEquipo.marca} ${orden.modeloEquipo.modelo}`
        : null,
      numeroSerie: orden.numeroSerie,
      // Servicio
      servicio: orden.servicio ? { id: orden.servicio.id, nombre: orden.servicio.nombre } : null,
      // Descripción
      descripcionProblema: orden.descripcionProblema,
      notas: orden.notas,
      diagnostico: orden.diagnostico,
      // Costos (modelo aditivo: el cliente paga servicio + repuestos − descuento)
      costoTotal: orden.costoTotal ? Number(orden.costoTotal) : null,
      descuento: orden.descuento ? Number(orden.descuento) : null,
      adelanto: orden.adelanto ? Number(orden.adelanto) : null,
      costoFinal: OrdenServicioService.costoNeto(orden), // facturable − descuento (total al cliente)
      saldoPendiente: OrdenServicioService.saldoPendiente(orden),
      // Componentes
      componentes: orden.componentes?.map((c) => ({
        nombre: c.componente?.codigo ?? 'Componente',
        tipo: c.componente?.tipoComponente?.nombre,
        costoAccion: c.costoAccion ? Number(c.costoAccion) : null,
        costoRepuestos: c.costoRepuestos ? Number(c.costoRepuestos) : null,
        tipoAccion: c.tipoAccion,
      })),
      // Fechas
      fechaEntrega: orden.fechaEntrega,
      creadoEn: orden.creadoEn,
    };
  }

  /**
   * Historial de orden para el cliente (verifica que sea su orden)
   */
  async findHistorialCliente(empresaId: string, personaId: string, ordenId: string) {
    const empresaPersona = await this.prisma.empresaPersona.findFirst({
      where: { personaId, empresaId, deletedAt: null },
      select: { id: true },
    });

    if (!empresaPersona) {
      throw new NotFoundException('No eres cliente de esta empresa');
    }

    // Verificar que la orden pertenece al cliente
    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenId, empresaId, clienteId: empresaPersona.id },
      select: { id: true },
    });

    if (!orden) {
      throw new NotFoundException('Orden no encontrada');
    }

    return this.prisma.historialOrdenServicio.findMany({
      where: { ordenServicioId: ordenId },
      orderBy: { creadoEn: 'asc' },
      select: {
        id: true,
        estadoAnterior: true,
        estadoNuevo: true,
        notas: true,
        comunicarCliente: true,
        creadoEn: true,
      },
    });
  }

  async findAll(
    empresaId: string,
    query: QueryOrdenServicioDto,
    esCliente = false,
  ) {
    const limit = Math.min(query.limit ?? 10, 100);

    const where: any = { empresaId };

    if (query.search) {
      where.OR = [
        { codigo: { contains: query.search, mode: 'insensitive' } },
        { descripcionProblema: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.estado) where.estado = query.estado;
    // Multi-sede: filtra por la sede de la OS (estricto).
    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.tipoServicio) where.tipoServicio = query.tipoServicio;
    if (query.prioridad) where.prioridad = query.prioridad;
    if (query.clienteId) where.clienteId = query.clienteId;
    if (query.clienteEmpresaId) where.clienteEmpresaId = query.clienteEmpresaId;
    if (query.tecnicoId) where.tecnicoId = query.tecnicoId;

    if (query.fechaDesde && query.fechaHasta) {
      if (new Date(query.fechaDesde) > new Date(query.fechaHasta)) {
        throw new BadRequestException('fechaDesde debe ser anterior a fechaHasta');
      }
    }

    if (query.fechaDesde || query.fechaHasta) {
      where.creadoEn = {};
      if (query.fechaDesde) where.creadoEn.gte = new Date(query.fechaDesde);
      // B10 FIX: Incluir todo el día de fechaHasta (hasta las 23:59:59.999)
      if (query.fechaHasta) {
        const endDate = new Date(query.fechaHasta);
        endDate.setHours(23, 59, 59, 999);
        where.creadoEn.lte = endDate;
      }
    }

    const findArgs: any = {
      where,
      orderBy: { creadoEn: 'desc' },
      take: limit,
      include: ORDEN_SERVICIO_BASE_INCLUDE,
    };

    if (query.cursor) {
      findArgs.cursor = { id: query.cursor };
      findArgs.skip = 1; // skip the cursor itself
    }

    const [data, total] = await Promise.all([
      this.prisma.ordenServicio.findMany(findArgs),
      this.prisma.ordenServicio.count({ where }),
    ]);

    // Conteo de mensajes no leídos por orden (campanita en la card). El staff
    // ve los mensajes del cliente sin leer; el cliente, los del staff.
    const ordenIds = data.map((o) => o.id);
    if (ordenIds.length > 0) {
      const noLeidos = await this.prisma.mensajeServicio.groupBy({
        by: ['ordenServicioId'],
        where: {
          ordenServicioId: { in: ordenIds },
          esCliente: !esCliente,
          leidoEn: null,
        },
        _count: { _all: true },
      });
      const countMap = new Map(
        noLeidos.map((n) => [n.ordenServicioId, n._count._all]),
      );
      for (const o of data as any[]) {
        o.mensajesNoLeidos = countMap.get(o.id) ?? 0;
      }
    }

    return createCursorPaginatedResponse(data, total, limit, (item) => item.id);
  }

  async findOne(empresaId: string, id: string) {
    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id, empresaId },
      include: ORDEN_SERVICIO_DETAIL_INCLUDE,
    });

    if (!orden) {
      throw new NotFoundException('Orden de servicio no encontrada');
    }

    return orden;
  }

  // B4 FIX: Validar que la orden no esté en estado terminal antes de permitir update
  async update(
    empresaId: string,
    id: string,
    dto: UpdateOrdenServicioDto,
    usuarioId?: string,
  ) {
    const existing = await this.findOne(empresaId, id);

    if (ESTADOS_TERMINALES.includes(existing.estado)) {
      throw new BadRequestException(
        `No se puede editar una orden en estado ${existing.estado}`,
      );
    }

    // B8 (paridad con transitionEstado): adelanto/descuento (incluida su
    // suma) no exceden costo. Solo si el update toca montos.
    if (
      dto.costoTotal !== undefined ||
      dto.adelanto !== undefined ||
      dto.descuento !== undefined
    ) {
      OrdenServicioService.validarMontosOrden({
        costoTotal:
          dto.costoTotal ??
          (existing.costoTotal ? Number(existing.costoTotal) : null),
        adelanto: dto.adelanto ?? Number(existing.adelanto ?? 0),
        descuento: dto.descuento ?? Number(existing.descuento ?? 0),
        subtotalComponentes: OrdenServicioService.subtotalComponentes(existing as any),
      });
    }

    // Orden ya cobrada (vía venta o legacy): el adelanto está saldado en el
    // comprobante — modificarlo registraría dinero fantasma en caja sobre
    // una operación cerrada. ENTREGADO no es estado terminal (permite
    // reingreso), así que el guard va por el vínculo de cobro.
    if (dto.adelanto !== undefined && Number(dto.adelanto) !== Number(existing.adelanto ?? 0)) {
      const cobrada =
        existing.comprobanteId != null ||
        (await this.prisma.ventaDetalle.findUnique({
          where: { ordenServicioId: id },
          select: { id: true },
        })) != null;
      if (cobrada) {
        throw new BadRequestException(
          `La orden ${existing.codigo} ya fue cobrada: el adelanto no se puede modificar`,
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // Lock pesimista: serializa ediciones concurrentes. El "adelanto
      // anterior" para el delta de caja se lee BAJO el lock — sin esto,
      // N PUTs paralelos leían el mismo anterior y la caja sumaba los N
      // deltas completos (detectado por el test de concurrencia: orden
      // con adelanto 90 y S/180 en caja).
      await tx.$queryRawUnsafe(
        `SELECT id FROM "OrdenServicio" WHERE id = $1 FOR UPDATE`,
        existing.id,
      );
      const fresh = await tx.ordenServicio.findUnique({
        where: { id: existing.id },
        select: { adelanto: true },
      });
      const adelantoAnterior = Number(fresh?.adelanto ?? 0);

      const updated = await tx.ordenServicio.update({
        where: { id: existing.id },
        data: dto,
        include: ORDEN_SERVICIO_DETAIL_INCLUDE,
      });

      // Cambio de adelanto → delta en caja con su medio de pago
      if (dto.adelanto !== undefined && usuarioId) {
        await this.registrarDeltaAdelantoEnCaja(tx, {
          empresaId,
          ordenId: existing.id,
          codigo: existing.codigo,
          sedeId: existing.sedeId,
          usuarioId,
          adelantoAnterior,
          adelantoNuevo: Number(dto.adelanto),
          metodoPago: dto.metodoPagoAdelanto ?? existing.metodoPagoAdelanto,
        });
      }

      return updated;
    });
  }

  // ───────────────────────── Libro de adelantos ─────────────────────────

  /**
   * Registra un NUEVO abono de adelanto (ACUMULATIVO): el monto se SUMA al
   * total — nunca lo reemplaza. Motivación: con el campo total editable,
   * registrar un 2º abono (50 + 10) se interpretaba como corrección
   * (50 → 10) y devolvía dinero en caja. Cada abono queda como fila del
   * libro con fecha/hora, método y usuario.
   */
  async agregarAdelanto(
    empresaId: string,
    id: string,
    usuarioId: string,
    dto: {
      monto: number;
      metodoPago?: string;
      nota?: string;
      servicioComponenteId?: string;
    },
  ) {
    if (!dto.monto || dto.monto <= 0) {
      throw new BadRequestException('El monto del adelanto debe ser mayor a 0');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Lock: serializa abonos/ediciones concurrentes sobre el total.
      await tx.$queryRawUnsafe(
        `SELECT id FROM "OrdenServicio" WHERE id = $1 AND "empresaId" = $2 FOR UPDATE`,
        id,
        empresaId,
      );
      const orden = await tx.ordenServicio.findFirst({
        where: { id, empresaId },
        include: {
          componentes: {
            select: { id: true, costoAccion: true, costoRepuestos: true },
          },
          ventaDetalle: { select: { id: true } },
        },
      });
      if (!orden) throw new NotFoundException('Orden de servicio no encontrada');
      if (orden.estado === EstadoOrdenServicio.CANCELADO) {
        throw new BadRequestException('La orden está cancelada');
      }
      if (orden.ventaDetalle || orden.comprobanteId) {
        throw new BadRequestException(
          'La orden ya fue cobrada: no se pueden registrar más adelantos',
        );
      }

      // Imputación a un componente: es una ETIQUETA sobre el mismo saldo de la
      // orden, pero tiene que ser verdadera — un componente de OTRA orden o un
      // id inventado dejaría el libro diciendo algo falso.
      if (dto.servicioComponenteId) {
        const comp = orden.componentes.find(
          (c) => c.id === dto.servicioComponenteId,
        );
        if (!comp) {
          throw new BadRequestException(
            'El componente indicado no pertenece a esta orden',
          );
        }
        const costoComp =
          Number(comp.costoAccion ?? 0) + Number(comp.costoRepuestos ?? 0);
        // Con el componente todavía sin costear no hay contra qué validar
        // (mismo criterio que `costoTotal` null): se permite imputar.
        if (costoComp > 0) {
          const yaImputado = await tx.adelantoOrdenServicio.aggregate({
            where: {
              ordenServicioId: id,
              servicioComponenteId: dto.servicioComponenteId,
              anulado: false,
            },
            _sum: { monto: true },
          });
          const acumulado =
            Math.round(
              (Number(yaImputado._sum.monto ?? 0) + dto.monto) * 100,
            ) / 100;
          if (acumulado > costoComp) {
            throw new BadRequestException(
              `Imputado a ese componente ya habría S/ ${acumulado.toFixed(2)} ` +
                `y su costo es S/ ${costoComp.toFixed(2)}`,
            );
          }
        }
      }

      const adelantoAnterior = Number(orden.adelanto ?? 0);
      const adelantoNuevo =
        Math.round((adelantoAnterior + dto.monto) * 100) / 100;

      OrdenServicioService.validarMontosOrden({
        costoTotal: orden.costoTotal === null ? null : Number(orden.costoTotal),
        adelanto: adelantoNuevo,
        descuento: Number(orden.descuento ?? 0),
        subtotalComponentes: OrdenServicioService.subtotalComponentes(orden),
      });

      await tx.ordenServicio.update({
        where: { id },
        data: {
          adelanto: new Prisma.Decimal(adelantoNuevo.toFixed(2)),
          metodoPagoAdelanto: dto.metodoPago ?? orden.metodoPagoAdelanto,
        },
      });

      await this.registrarDeltaAdelantoEnCaja(tx, {
        empresaId,
        ordenId: id,
        codigo: orden.codigo,
        sedeId: orden.sedeId,
        usuarioId,
        adelantoAnterior,
        adelantoNuevo,
        metodoPago: dto.metodoPago ?? orden.metodoPagoAdelanto,
        nota: dto.nota ?? null,
        servicioComponenteId: dto.servicioComponenteId ?? null,
      });

      return tx.ordenServicio.findUnique({
        where: { id },
        include: ORDEN_SERVICIO_DETAIL_INCLUDE,
      });
    });
  }

  /**
   * Anula UNA fila del libro de adelantos (abono registrado por error o
   * devuelto al cliente): marca la fila, resta del total y registra el
   * EGRESO en caja. No genera fila nueva (el flag `anulado` la excluye
   * de la suma).
   */
  async anularAdelanto(
    empresaId: string,
    id: string,
    adelantoId: string,
    usuarioId: string,
  ) {
    return await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM "OrdenServicio" WHERE id = $1 AND "empresaId" = $2 FOR UPDATE`,
        id,
        empresaId,
      );
      const orden = await tx.ordenServicio.findFirst({
        where: { id, empresaId },
        include: { ventaDetalle: { select: { id: true } } },
      });
      if (!orden) throw new NotFoundException('Orden de servicio no encontrada');
      if (orden.ventaDetalle || orden.comprobanteId) {
        throw new BadRequestException(
          'La orden ya fue cobrada: el adelanto ya se aplicó al comprobante',
        );
      }

      const fila = await tx.adelantoOrdenServicio.findFirst({
        where: { id: adelantoId, ordenServicioId: id },
      });
      if (!fila) throw new NotFoundException('Adelanto no encontrado');
      if (fila.anulado) {
        throw new BadRequestException('Este adelanto ya fue anulado');
      }
      const montoFila = Number(fila.monto);
      if (montoFila <= 0) {
        throw new BadRequestException(
          'Los ajustes/correcciones no se anulan individualmente',
        );
      }

      const adelantoAnterior = Number(orden.adelanto ?? 0);
      const adelantoNuevo =
        Math.round((adelantoAnterior - montoFila) * 100) / 100;
      if (adelantoNuevo < -0.009) {
        throw new BadRequestException(
          'El total de adelantos quedaría negativo: revisa las filas del libro',
        );
      }

      await tx.adelantoOrdenServicio.update({
        where: { id: adelantoId },
        data: { anulado: true, anuladoEn: new Date(), anuladoPor: usuarioId },
      });
      await tx.ordenServicio.update({
        where: { id },
        data: { adelanto: new Prisma.Decimal(Math.max(0, adelantoNuevo).toFixed(2)) },
      });

      await this.registrarDeltaAdelantoEnCaja(tx, {
        empresaId,
        ordenId: id,
        codigo: orden.codigo,
        sedeId: orden.sedeId,
        usuarioId,
        adelantoAnterior,
        adelantoNuevo,
        metodoPago: fila.metodoPago,
        sinFila: true, // la anulación no crea fila: el flag excluye la original
      });

      return tx.ordenServicio.findUnique({
        where: { id },
        include: ORDEN_SERVICIO_DETAIL_INCLUDE,
      });
    });
  }

  // B9 FIX: Validar estado y tecnicoId antes de asignar técnico
  async assignTecnico(empresaId: string, id: string, tecnicoId: string) {
    if (!tecnicoId) {
      throw new BadRequestException('tecnicoId es requerido');
    }

    const orden = await this.findOne(empresaId, id);

    if (ESTADOS_TERMINALES.includes(orden.estado)) {
      throw new BadRequestException(
        `No se puede asignar técnico a una orden en estado ${orden.estado}`,
      );
    }

    // Verificar que el técnico existe y pertenece a la empresa
    const tecnico = await this.prisma.usuario.findFirst({
      where: {
        id: tecnicoId,
        empresas: { some: { empresaId } },
      },
    });

    if (!tecnico) {
      throw new BadRequestException('El técnico no existe o no pertenece a esta empresa');
    }

    return this.prisma.ordenServicio.update({
      where: { id },
      data: { tecnicoId },
      include: ORDEN_SERVICIO_BASE_INCLUDE,
    });
  }

  private async validateDatosPersonalizados(
    empresaId: string,
    datos: Record<string, any>,
    servicioId?: string,
  ) {
    // Resolver la plantilla del servicio (si tiene una asignada). Cada
    // plantilla agrupa sus propios campos requeridos (ej. una plantilla
    // CELULAR pide "Marca del celular", una LAPTOP pide otros). Sin este
    // filtro el backend exigía TODOS los campos requeridos de todas las
    // plantillas de la empresa, lo cual rompe cuando hay >1 plantilla.
    let plantillaId: string | null = null;
    if (servicioId) {
      const servicio = await this.prisma.servicio.findUnique({
        where: { id: servicioId },
        select: { plantillaServicioId: true },
      });
      plantillaId = servicio?.plantillaServicioId ?? null;
    }

    // Campos aplicables (globales + de la plantilla del servicio). Se traen
    // TODOS los activos, no solo requeridos: los requeridos validan
    // presencia y todo valor presente valida su TIPO.
    const campos = await this.prisma.configuracionCamposServicio.findMany({
      where: {
        empresaId,
        isActive: true,
        OR: plantillaId
            ? [{ plantillaId: null }, { plantillaId }]
            : [{ plantillaId: null }],
      },
    });

    for (const campo of campos) {
      const valor = datos[campo.nombre];
      const presente =
        campo.nombre in datos && valor !== null && valor !== '';
      if (campo.esRequerido && !presente) {
        throw new BadRequestException(
          `El campo "${campo.nombre}" es requerido`,
        );
      }
      if (presente) {
        this.validarTipoCampo(campo, valor);
      }
    }
  }

  /**
   * Valida que el valor respete el formato de su tipo de campo.
   * Deliberadamente LAXO (NUMERO acepta string numérica, etc.): los
   * clientes guardan casi todo como string. Solo rechaza lo
   * inequívocamente inválido — antes `datosPersonalizados` era JSON
   * libre y cualquier basura entraba a la BD.
   *
   * Convenciones de almacenamiento (paridad Flutter dynamic_form_renderer
   * y web dynamic-fields-form):
   * - OPCION_MULTIPLE / CHECKBOX_MULTIPLE → array<string>
   * - PATRON_DESBLOQUEO → "0-1-2-5-8" (índices 0-8 del grid 3x3)
   * - CODIGO_BARRAS → string tal cual lo entregó el lector/cámara
   * - PIN_CLAVE → string (puede empezar en 0; nunca se normaliza)
   * - MONEDA → number (o string numérico)
   * - FIRMA → string, URL del PNG en el storage
   * - DOCUMENTO_IDENTIDAD → string de 8 / 9 / 11 dígitos
   * - TABLA → array de filas {columna: valor}; columnas en `opciones`
   * - INSPECCION_VISUAL → JSON-string {silueta, puntos[]}
   * - OBJETO → mapa de subcampos
   * - ARCHIVO → boolean (switch); se toleran URLs legacy
   * - permiteOtro → el texto libre REEMPLAZA el valor (no se valida
   *   pertenencia a opciones en ese caso)
   */
  private validarTipoCampo(
    campo: {
      nombre: string;
      tipoCampo: TipoCampoServicio;
      opciones: unknown;
      permiteOtro: boolean;
    },
    valor: unknown,
  ): void {
    const fail = (esperado: string): never => {
      throw new BadRequestException(
        `El campo "${campo.nombre}" tiene un valor inválido: se esperaba ${esperado}`,
      );
    };

    switch (campo.tipoCampo) {
      case TipoCampoServicio.NUMERO: {
        if (typeof valor !== 'number' && typeof valor !== 'string') {
          fail('un número');
        }
        if (Number.isNaN(Number(valor))) fail('un número');
        break;
      }
      case TipoCampoServicio.EMAIL:
        if (
          typeof valor !== 'string' ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)
        ) {
          fail('un email válido');
        }
        break;
      case TipoCampoServicio.FECHA:
        if (typeof valor !== 'string' || Number.isNaN(Date.parse(valor))) {
          fail('una fecha válida');
        }
        break;
      case TipoCampoServicio.CHECKBOX:
        if (typeof valor !== 'boolean') fail('verdadero/falso');
        break;
      case TipoCampoServicio.ARCHIVO:
        // Switch booleano en los clientes actuales; URLs legacy toleradas.
        if (
          typeof valor !== 'boolean' &&
          typeof valor !== 'string' &&
          !Array.isArray(valor)
        ) {
          fail('verdadero/falso');
        }
        break;
      case TipoCampoServicio.OPCION_MULTIPLE:
      case TipoCampoServicio.CHECKBOX_MULTIPLE:
        if (!Array.isArray(valor) || valor.some((v) => typeof v !== 'string')) {
          fail('una lista de opciones');
        }
        break;
      case TipoCampoServicio.OPCION_SIMPLES: {
        if (typeof valor !== 'string') fail('una opción (texto)');
        // Pertenencia a la lista solo si el campo NO permite "Otro" (el
        // texto libre reemplaza el valor) y opciones es lista de strings.
        const ops = Array.isArray(campo.opciones) ? campo.opciones : null;
        if (
          !campo.permiteOtro &&
          ops &&
          ops.length > 0 &&
          ops.every((o) => typeof o === 'string') &&
          !ops.includes(valor as string)
        ) {
          fail('una de las opciones configuradas');
        }
        break;
      }
      case TipoCampoServicio.TABLA: {
        // Lista de filas; cada fila es un objeto {columna: valor}. Las
        // columnas se definen en `opciones` (misma forma que OBJETO), pero
        // NO se exige que la fila las traiga todas: una celda vacía es
        // legítima y el usuario llena la tabla de a poco.
        if (!Array.isArray(valor)) fail('una lista de filas');
        const filas = valor as unknown[];
        if (
          filas.some(
            (f) => typeof f !== 'object' || f === null || Array.isArray(f),
          )
        ) {
          fail('filas con formato {columna: valor}');
        }
        break;
      }
      case TipoCampoServicio.MONEDA: {
        if (typeof valor !== 'number' && typeof valor !== 'string') {
          fail('un monto');
        }
        if (Number.isNaN(Number(valor))) fail('un monto');
        break;
      }
      case TipoCampoServicio.PLACA_VEHICULO:
        // Formatos peruanos conviven (ABC-123, A1B-234, viejos de 6): se
        // exige texto y largo razonable, no un patrón — rechazar una placa
        // legítima por formato es peor que aceptar una mal tipeada.
        if (typeof valor !== 'string' || valor.trim().length > 12) {
          fail('una placa');
        }
        break;
      case TipoCampoServicio.LICENCIA_CONDUCIR:
        if (typeof valor !== 'string') fail('un número de licencia');
        break;
      case TipoCampoServicio.FOTO:
        // URL del archivo en el storage, igual que FIRMA.
        if (typeof valor !== 'string') fail('la URL de la foto');
        break;
      case TipoCampoServicio.PRODUCTO_CATALOGO:
        // Se guarda el NOMBRE del producto elegido (texto), no su id: la
        // orden documenta lo que se usó y no debe romperse si el producto
        // se borra del catálogo después.
        if (typeof valor !== 'string') fail('un producto');
        break;
      case TipoCampoServicio.PIN_CLAVE:
        // Se guarda tal cual: un PIN puede empezar en 0 y ser alfanumérico.
        if (typeof valor !== 'string') fail('un texto (PIN o clave)');
        break;
      case TipoCampoServicio.FIRMA:
        // URL del PNG subido al storage; el trazo no viaja en la orden.
        if (typeof valor !== 'string') fail('la URL de la firma');
        break;
      case TipoCampoServicio.DOCUMENTO_IDENTIDAD:
        // DNI (8), CE (9) o RUC (11). Solo dígitos y largo: el nombre lo
        // resuelve RENIEC/SUNAT en el cliente, aquí no se re-consulta.
        if (typeof valor !== 'string' || !/^\d{8}$|^\d{9}$|^\d{11}$/.test(valor)) {
          fail('un DNI (8), CE (9) o RUC (11 dígitos)');
        }
        break;
      case TipoCampoServicio.CODIGO_BARRAS:
        // Escaneado con la cámara o tecleado por un lector físico (que se
        // comporta como teclado). El contenido depende del simbolismo del
        // código, así que solo se exige texto: validarlo más (largo de un
        // IMEI, dígito verificador) rompería etiquetas internas y SKUs.
        if (typeof valor !== 'string') fail('un texto (código escaneado)');
        break;
      case TipoCampoServicio.PATRON_DESBLOQUEO:
        if (typeof valor !== 'string' || !/^[0-8](-[0-8])*$/.test(valor)) {
          fail('un patrón de desbloqueo válido (índices 0-8)');
        }
        break;
      case TipoCampoServicio.INSPECCION_VISUAL: {
        if (typeof valor !== 'string') fail('datos de inspección visual');
        try {
          const parsed: unknown = JSON.parse(valor as string);
          if (
            typeof parsed !== 'object' ||
            parsed === null ||
            Array.isArray(parsed)
          ) {
            fail('datos de inspección visual válidos');
          }
        } catch {
          fail('datos de inspección visual válidos');
        }
        break;
      }
      case TipoCampoServicio.OBJETO:
        if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) {
          fail('un grupo de subcampos');
        }
        break;
      case TipoCampoServicio.HORA:
      case TipoCampoServicio.TELEFONO:
      case TipoCampoServicio.URL:
      case TipoCampoServicio.TEXTO:
      case TipoCampoServicio.TEXTO_AREA:
      default:
        if (typeof valor !== 'string' && typeof valor !== 'number') {
          fail('texto');
        }
        break;
    }
  }

  // ─── Mensajería ───

  private readonly MENSAJE_SELECT = {
    id: true,
    contenido: true,
    esCliente: true,
    usuarioId: true,
    creadoEn: true,
    leidoEn: true,
    usuario: {
      select: {
        persona: { select: { nombres: true, apellidos: true } },
      },
    },
  } as const;

  /// Cuenta mensajes del cliente sin leer (para el badge), SIN marcarlos leídos.
  async contarMensajesNoLeidos(empresaId: string, ordenServicioId: string) {
    await this.findOne(empresaId, ordenServicioId);
    const count = await this.prisma.mensajeServicio.count({
      where: { ordenServicioId, esCliente: true, leidoEn: null },
    });
    return { count };
  }

  async listarMensajes(empresaId: string, ordenServicioId: string) {
    await this.findOne(empresaId, ordenServicioId);

    // Marcar mensajes del cliente como leídos
    await this.prisma.mensajeServicio.updateMany({
      where: { ordenServicioId, esCliente: true, leidoEn: null },
      data: { leidoEn: new Date() },
    });

    return this.prisma.mensajeServicio.findMany({
      where: { ordenServicioId },
      select: this.MENSAJE_SELECT,
      orderBy: { creadoEn: 'asc' },
    });
  }

  async listarMensajesCliente(empresaId: string, personaId: string, ordenServicioId: string) {
    const empresaPersona = await this.prisma.empresaPersona.findFirst({
      where: { personaId, empresaId, deletedAt: null },
      select: { id: true },
    });
    if (!empresaPersona) throw new NotFoundException('No eres cliente de esta empresa');

    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenServicioId, empresaId, clienteId: empresaPersona.id },
      select: { id: true },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');

    // Marcar mensajes del técnico como leídos
    await this.prisma.mensajeServicio.updateMany({
      where: { ordenServicioId, esCliente: false, leidoEn: null },
      data: { leidoEn: new Date() },
    });

    return this.prisma.mensajeServicio.findMany({
      where: { ordenServicioId },
      select: this.MENSAJE_SELECT,
      orderBy: { creadoEn: 'asc' },
    });
  }

  async enviarMensajeTecnico(empresaId: string, usuarioId: string, ordenServicioId: string, contenido: string) {
    const orden = await this.findOne(empresaId, ordenServicioId);

    const mensaje = await this.prisma.mensajeServicio.create({
      data: {
        empresaId,
        ordenServicioId,
        usuarioId,
        contenido,
        esCliente: false,
      },
      select: this.MENSAJE_SELECT,
    });

    // Notificar al cliente
    this.notificarClienteOrden(
      orden.clienteId,
      'Nuevo mensaje sobre tu servicio',
      contenido.length > 100 ? contenido.substring(0, 100) + '...' : contenido,
      empresaId,
      ordenServicioId,
      'MENSAJE',
    ).catch(OrdenServicioService.logNotifFallida('mensaje al cliente'));

    return mensaje;
  }

  async enviarMensajeCliente(
    empresaId: string,
    personaId: string,
    usuarioId: string,
    ordenServicioId: string,
    contenido: string,
  ) {
    const empresaPersona = await this.prisma.empresaPersona.findFirst({
      where: { personaId, empresaId, deletedAt: null },
      select: { id: true },
    });
    if (!empresaPersona) throw new NotFoundException('No eres cliente de esta empresa');

    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id: ordenServicioId, empresaId, clienteId: empresaPersona.id },
      select: { id: true, tecnicoId: true, codigo: true },
    });
    if (!orden) throw new NotFoundException('Orden no encontrada');

    const mensaje = await this.prisma.mensajeServicio.create({
      data: {
        empresaId,
        ordenServicioId,
        usuarioId,
        contenido,
        esCliente: true,
      },
      select: this.MENSAJE_SELECT,
    });

    // Notificar al técnico (si hay) y SIEMPRE a los admins de la empresa.
    // tipo ORDEN_SERVICIO + data.ordenId para que el deep-link rutee a la orden.
    const notifTitulo = `Mensaje del cliente - ${orden.codigo}`;
    const notifCuerpo = contenido.length > 100 ? contenido.substring(0, 100) + '...' : contenido;
    const notifOpts = {
      tipo: TipoNotificacion.ORDEN_SERVICIO,
      data: { ordenId: ordenServicioId, action: 'MENSAJE', target: 'staff' },
      empresaId,
    };

    if (orden.tecnicoId) {
      this.notificacionService.enviarAUsuario(
        orden.tecnicoId, notifTitulo, notifCuerpo, notifOpts,
      ).catch(OrdenServicioService.logNotifFallida('mensaje al tecnico'));
    }
    this.notificarAdminsEmpresa(
      empresaId, notifTitulo, notifCuerpo, notifOpts, orden.tecnicoId ?? undefined,
    ).catch(OrdenServicioService.logNotifFallida('mensaje a admins'));

    return mensaje;
  }

  private async notificarAdminsEmpresa(
    empresaId: string,
    titulo: string,
    cuerpo: string,
    options: { tipo: TipoNotificacion; data: Record<string, string>; empresaId: string },
    excludeUserId?: string,
  ) {
    const admins = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        rol: { in: ['EMPRESA_ADMIN', 'SUPER_ADMIN'] },
      },
      select: { usuarioId: true },
    });

    const adminIds = [...new Set(admins.map((a) => a.usuarioId))].filter(
      (id) => id !== excludeUserId,
    );
    if (adminIds.length > 0) {
      await this.notificacionService.enviarAUsuarios(adminIds, titulo, cuerpo, options);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Cobro de órdenes vía Venta Rápida (POS)
  //
  // El cobro de órdenes migró al pipeline de venta (caja multi-medio, SUNAT,
  // crédito con cuotas, bancarización). VentaService invoca estos métodos
  // dentro de SU transacción. El flujo legacy `cobrarOrden` fue RETIRADO
  // (el endpoint responde 410; ver orden-servicio.controller).
  // ─────────────────────────────────────────────────────────────────────────

  /** Estados en los que una orden puede cobrarse */
  private static readonly ESTADOS_COBRABLES: EstadoOrdenServicio[] = [
    EstadoOrdenServicio.REPARADO,
    EstadoOrdenServicio.LISTO_ENTREGA,
  ];

  /** Suma de los componentes (mano de obra + repuestos) que el cliente paga. */
  private static subtotalComponentes(orden: {
    componentes?: Array<{ costoAccion: Prisma.Decimal | null; costoRepuestos: Prisma.Decimal | null }> | null;
  }): number {
    if (!orden.componentes) return 0;
    const total = orden.componentes.reduce(
      (s, c) => s + Number(c.costoAccion ?? 0) + Number(c.costoRepuestos ?? 0),
      0,
    );
    return Math.round(total * 100) / 100;
  }

  /** Base facturable al cliente = costo del servicio + componentes (repuestos+M.O.).
   * MODELO ADITIVO: el cliente paga los repuestos/componentes MÁS el costo del
   * servicio (factura tipo taller: repuestos + servicio = total). */
  private static facturable(orden: {
    costoTotal: Prisma.Decimal | null;
    componentes?: Array<{ costoAccion: Prisma.Decimal | null; costoRepuestos: Prisma.Decimal | null }> | null;
  }): number {
    return Number(orden.costoTotal ?? 0) + OrdenServicioService.subtotalComponentes(orden);
  }

  private static saldoPendiente(orden: {
    costoTotal: Prisma.Decimal | null;
    adelanto: Prisma.Decimal | null;
    descuento: Prisma.Decimal | null;
    componentes?: Array<{ costoAccion: Prisma.Decimal | null; costoRepuestos: Prisma.Decimal | null }> | null;
  }): number {
    const facturable = OrdenServicioService.facturable(orden);
    const adelanto = Number(orden.adelanto ?? 0);
    const descuento = Number(orden.descuento ?? 0);
    return Math.round((facturable - adelanto - descuento) * 100) / 100;
  }

  /** Costo neto del servicio (facturable − descuento, SIN restar adelanto).
   * Es el monto por el que se factura: el comprobante sale por el TOTAL
   * (repuestos + servicio) y el adelanto entra como pago aplicado. */
  static costoNeto(orden: {
    costoTotal: Prisma.Decimal | null;
    descuento: Prisma.Decimal | null;
    componentes?: Array<{ costoAccion: Prisma.Decimal | null; costoRepuestos: Prisma.Decimal | null }> | null;
  }): number {
    const facturable = OrdenServicioService.facturable(orden);
    const descuento = Number(orden.descuento ?? 0);
    return Math.round((facturable - descuento) * 100) / 100;
  }

  /**
   * Valida (y bloquea con FOR UPDATE) las órdenes referenciadas por líneas
   * de venta con `ordenServicioId`. Llamar DENTRO de la transacción de la
   * venta, antes de crearla.
   *
   * Garantías:
   * - Orden pertenece al tenant y está REPARADO/LISTO_ENTREGA.
   * - Línea pura (sin producto/variante/combo), cantidad 1, sin descuento
   *   de línea (el descuento comercial vive en la orden).
   * - `precioUnitario` == COSTO NETO vigente del servicio (costo − descuento,
   *   SIN restar adelanto: el comprobante sale por el total y el adelanto
   *   entra como pago aplicado). 409 SALDO_ORDEN_DESACTUALIZADO si la orden
   *   cambió mientras estaba en el carrito.
   * - Sin doble cobro: FOR UPDATE serializa cobros concurrentes y el check
   *   de VentaDetalle existente convierte al perdedor en 409 ORDEN_YA_COBRADA
   *   (el @unique de BD respalda como última línea de defensa).
   */
  async validarYBloquearCobroVenta(
    tx: Prisma.TransactionClient,
    empresaId: string,
    detalles: Array<{
      ordenServicioId?: string;
      productoId?: string;
      varianteId?: string;
      comboId?: string;
      cantidad: number;
      precioUnitario: number;
      descuento?: number;
      descripcion: string;
    }>,
  ) {
    const lineasOrden = detalles.filter((d) => d.ordenServicioId);
    if (lineasOrden.length === 0) return [];

    // Línea pura: una orden no se mezcla con producto/combo en el mismo item
    for (const d of lineasOrden) {
      if (d.productoId || d.varianteId || d.comboId) {
        throw new BadRequestException(
          `La línea "${d.descripcion}" combina ordenServicioId con producto/combo`,
        );
      }
      if (Number(d.cantidad) !== 1) {
        throw new BadRequestException(
          `La línea "${d.descripcion}" cobra una orden de servicio: la cantidad debe ser 1`,
        );
      }
      if ((d.descuento ?? 0) > 0) {
        throw new BadRequestException(
          `La línea "${d.descripcion}" cobra una orden de servicio: el descuento se gestiona en la orden, no en la venta`,
        );
      }
    }

    const ids = lineasOrden.map((d) => d.ordenServicioId!);
    const duplicados = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (duplicados.length > 0) {
      throw new BadRequestException(
        'La venta incluye la misma orden de servicio más de una vez',
      );
    }

    // Lock pesimista: serializa dos cobros simultáneos de la misma orden
    await tx.$queryRawUnsafe(
      `SELECT id FROM "OrdenServicio" WHERE id = ANY($1) AND "empresaId" = $2 FOR UPDATE`,
      ids,
      empresaId,
    );

    const ordenes = await tx.ordenServicio.findMany({
      where: { id: { in: ids }, empresaId },
      include: {
        servicio: { select: { nombre: true } },
        componentes: { select: { costoAccion: true, costoRepuestos: true } },
      },
    });

    const ordenesMap = new Map(ordenes.map((o) => [o.id, o]));

    // Doble cobro PRIMERO: tras el FOR UPDATE, el perdedor de una carrera
    // ve la venta que commiteó el ganador. Este check va ANTES que el de
    // estado para que reciba 409 ORDEN_YA_COBRADA (estructurado, con el
    // código de la venta ganadora) y no un 400 "está en ENTREGADO"
    // (detectado por el test de concurrencia).
    const yaCobradas = await tx.ventaDetalle.findMany({
      where: { ordenServicioId: { in: ids } },
      select: {
        ordenServicioId: true,
        venta: { select: { codigo: true } },
      },
    });
    if (yaCobradas.length > 0) {
      const codigos = yaCobradas
        .map((v) => ordenesMap.get(v.ordenServicioId!)?.codigo ?? v.ordenServicioId)
        .join(', ');
      throw new ConflictException({
        code: 'ORDEN_YA_COBRADA',
        message: `Orden(es) ya cobrada(s) en otra venta: ${codigos} (${yaCobradas
          .map((v) => v.venta.codigo)
          .join(', ')})`,
        // Ids para que el cliente quite EXACTAMENTE esas líneas del carrito
        ordenes: yaCobradas.map((v) => ({
          ordenServicioId: v.ordenServicioId,
          codigo: ordenesMap.get(v.ordenServicioId!)?.codigo ?? null,
          ventaCodigo: v.venta.codigo,
        })),
      });
    }

    const divergencias: Array<{
      ordenServicioId: string;
      codigo: string | null;
      descripcion: string;
      precioCliente: number;
      saldoServer: number;
    }> = [];

    for (const d of lineasOrden) {
      const orden = ordenesMap.get(d.ordenServicioId!);
      if (!orden) {
        throw new NotFoundException(
          `Orden de servicio de la línea "${d.descripcion}" no encontrada`,
        );
      }
      if (!OrdenServicioService.ESTADOS_COBRABLES.includes(orden.estado)) {
        throw new BadRequestException(
          `La orden ${orden.codigo} está en estado ${orden.estado}. ` +
            `Solo se cobran órdenes en REPARADO o LISTO_ENTREGA`,
        );
      }
      if (OrdenServicioService.facturable(orden) <= 0) {
        throw new BadRequestException(
          `La orden ${orden.codigo} no tiene un monto a cobrar (servicio + repuestos)`,
        );
      }
      // saldo == 0 (100% adelantada) SÍ es cobrable: el cliente no paga
      // nada hoy pero la boleta debe emitirse por el total (sin esto, el
      // servicio totalmente prepagado nunca obtenía comprobante). Solo se
      // rechaza el saldo NEGATIVO (adelanto+descuento > costo = datos
      // inconsistentes que descuadrarían el cobro).
      const saldo = OrdenServicioService.saldoPendiente(orden);
      if (saldo < 0) {
        throw new BadRequestException(
          `La orden ${orden.codigo} tiene montos inconsistentes (adelanto + descuento superan el costo). ` +
            `Corregí los costos de la orden antes de cobrarla`,
        );
      }
      // El precio de línea es el COSTO NETO (factura por el total del
      // servicio); el adelanto se aplica como pago, no como descuento.
      const costoNeto = OrdenServicioService.costoNeto(orden);
      if (Math.abs(Number(d.precioUnitario) - costoNeto) > 0.01) {
        divergencias.push({
          ordenServicioId: orden.id,
          codigo: orden.codigo,
          descripcion: d.descripcion,
          precioCliente: Number(d.precioUnitario),
          saldoServer: costoNeto,
        });
      }
    }

    if (divergencias.length > 0) {
      throw new ConflictException({
        code: 'SALDO_ORDEN_DESACTUALIZADO',
        message:
          divergencias.length === 1
            ? `El costo de la orden ${divergencias[0].codigo} cambió de S/ ` +
              `${divergencias[0].precioCliente.toFixed(2)} a S/ ` +
              `${divergencias[0].saldoServer.toFixed(2)}. Refrescá el carrito y volvé a intentar.`
            : `${divergencias.length} órdenes tienen montos desactualizados. ` +
              `Refrescá el carrito y volvé a intentar.`,
        divergencias,
      });
    }

    return ordenes;
  }

  /**
   * Marca las órdenes como FINALIZADO tras el cobro vía venta POS.
   * Llamar DENTRO de la transacción de la venta, después de crear la venta
   * y el comprobante. Efectos: estado, estadoDiagnostico, historial y
   * componentes → EN_USO.
   *
   * 🔴 NO toca `fechaEntrega`: cobrar y entregar son cosas distintas. Es
   * habitual que el cliente pague y se lleve el equipo otro día, y estampar
   * la fecha acá la falseaba (además de adelantar el aviso de mantenimiento,
   * que se ancla en ella). La entrega física se registra aparte con
   * `registrarEntrega`.
   */
  async marcarOrdenesCobradasPorVenta(
    tx: Prisma.TransactionClient,
    params: {
      ordenes: Array<{
        id: string;
        estado: EstadoOrdenServicio;
        estadoDiagnostico: EstadoDiagnostico | null;
      }>;
      ventaCodigo: string;
      comprobante: { id: string; codigoGenerado: string } | null;
      usuarioId: string;
    },
  ) {
    const { ordenes, ventaCodigo, comprobante, usuarioId } = params;
    const actualizadas: any[] = [];

    for (const orden of ordenes) {
      const updated = await tx.ordenServicio.update({
        where: { id: orden.id },
        data: {
          // Al cobrarse, la orden queda FINALIZADA automáticamente (pagada + cerrada).
          // `fechaEntrega` queda NULL a propósito: marca la entrega física y la
          // pone `registrarEntrega`. Null aquí = "cobrada, equipo sin retirar".
          estado: EstadoOrdenServicio.FINALIZADO,
          comprobanteId: comprobante?.id ?? null,
          ...(orden.estadoDiagnostico &&
          orden.estadoDiagnostico !== EstadoDiagnostico.COMPLETADO
            ? { estadoDiagnostico: EstadoDiagnostico.COMPLETADO }
            : {}),
        },
        include: { servicio: { select: { nombre: true } } },
      });

      await tx.historialOrdenServicio.create({
        data: {
          ordenServicioId: orden.id,
          estadoAnterior: orden.estado,
          estadoNuevo: EstadoOrdenServicio.FINALIZADO,
          notas:
            `Orden cobrada y finalizada vía Venta Rápida ${ventaCodigo}` +
            (comprobante ? ` — Comprobante ${comprobante.codigoGenerado}` : ''),
          comunicarCliente: true,
          creadoPor: usuarioId,
        },
      });

      // Mismo sync de componentes que la transición manual a ENTREGADO
      await tx.servicioComponente.updateMany({
        where: { ordenServicioId: orden.id },
        data: { estadoComponente: EstadoComponente.EN_USO },
      });

      actualizadas.push(updated);
    }

    return actualizadas;
  }

  /**
   * Efectos post-commit del cobro vía venta: push al cliente.
   * Fire-and-forget (el caller hace .catch).
   *
   * El aviso de mantenimiento NO se crea acá: se ancla en `fechaEntrega`, así
   * que sale recién cuando el cliente retira el equipo (`registrarEntrega`).
   * Contarlo desde el pago adelantaba el recordatorio.
   */
  async procesarPostCobroOrdenes(empresaId: string, ordenes: any[]) {
    for (const orden of ordenes) {
      const servicioNombre = orden.servicio?.nombre ?? 'Servicio';
      await this.notificarClienteOrden(
        orden.clienteId,
        'Servicio finalizado',
        `Tu orden ${orden.codigo} (${servicioNombre}) ha sido cobrada y finalizada.`,
        empresaId,
        orden.id,
        'status_changed',
      ).catch(OrdenServicioService.logNotifFallida('finalización post-cobro'));
    }
  }

  /**
   * Registra la ENTREGA FÍSICA del equipo al cliente.
   *
   * Es un hecho separado del cobro: el cliente paga en Venta Rápida (la orden
   * queda FINALIZADO) y puede llevarse el equipo otro día. Hasta entonces el
   * equipo sigue en el taller y hay que poder verlo.
   *
   * NO cambia el estado: la orden ya está FINALIZADA por el cobro. La señal es
   * `fechaEntrega` (null = cobrada, sin retirar). En el historial sí se anota
   * como ENTREGADO para que la línea de tiempo muestre la entrega.
   */
  async registrarEntrega(
    empresaId: string,
    id: string,
    usuarioId: string,
    notas?: string,
  ) {
    const orden = await this.prisma.ordenServicio.findFirst({
      where: { id, empresaId },
      select: { id: true, estado: true, fechaEntrega: true },
    });
    if (!orden) throw new NotFoundException('Orden de servicio no encontrada');

    if (orden.fechaEntrega) {
      throw new BadRequestException(
        'Esta orden ya figura como entregada. Si el equipo volvió, registrá un reingreso.',
      );
    }
    if (orden.estado !== EstadoOrdenServicio.FINALIZADO) {
      throw new BadRequestException(
        `Solo se registra la entrega de una orden ya cobrada. Estado actual: "${orden.estado}".`,
      );
    }

    const notaLimpia = notas?.trim();
    const [actualizada] = await this.prisma.$transaction([
      this.prisma.ordenServicio.update({
        where: { id },
        data: { fechaEntrega: new Date() },
        include: ORDEN_SERVICIO_FULL_INCLUDE,
      }),
      this.prisma.historialOrdenServicio.create({
        data: {
          ordenServicioId: id,
          estadoAnterior: orden.estado,
          // El estado de la orden NO cambia; esto es el evento para la línea
          // de tiempo, que se rotula por `estadoNuevo`.
          estadoNuevo: EstadoOrdenServicio.ENTREGADO,
          notas: notaLimpia
            ? `Equipo entregado al cliente — ${notaLimpia}`
            : 'Equipo entregado al cliente',
          creadoPor: usuarioId,
        },
      }),
    ]);

    // El aviso de mantenimiento se ancla en fechaEntrega: recién ahora que el
    // equipo volvió a manos del cliente tiene sentido contarlo. Best-effort.
    if (actualizada.incluirAvisoMantenimiento && actualizada.clienteId) {
      try {
        await this.avisoMantenimientoService.crearAvisoParaOrden({
          id: actualizada.id,
          empresaId,
          clienteId: actualizada.clienteId,
          tipoServicio: actualizada.tipoServicio,
          tipoEquipo: actualizada.tipoEquipo,
          marcaEquipo: actualizada.marcaEquipo,
          fechaEntrega: actualizada.fechaEntrega,
          actualizadoEn: actualizada.actualizadoEn,
          fechaAvisoPersonalizado: actualizada.fechaAvisoPersonalizado,
        });
      } catch {
        // No bloquear la entrega por el aviso
      }
    }

    return actualizada;
  }

  /**
   * Reversa del cobro cuando se ANULA la venta: la orden vuelve a
   * LISTO_ENTREGA (re-cobrable), se desvincula el comprobante y se libera
   * el candado @unique poniendo VentaDetalle.ordenServicioId en null.
   * Llamar DENTRO de la transacción de anulación de la venta.
   */
  async revertirCobroPorVentaAnulada(
    tx: Prisma.TransactionClient,
    empresaId: string,
    detalles: Array<{ id: string; ordenServicioId: string }>,
    usuarioId: string,
    ventaCodigo: string,
  ) {
    for (const detalle of detalles) {
      const orden = await tx.ordenServicio.findFirst({
        where: { id: detalle.ordenServicioId, empresaId },
        select: { id: true, estado: true, codigo: true },
      });
      if (!orden) continue;

      await tx.ordenServicio.update({
        where: { id: orden.id },
        data: {
          estado: EstadoOrdenServicio.LISTO_ENTREGA,
          fechaEntrega: null,
          comprobanteId: null,
        },
      });

      await tx.historialOrdenServicio.create({
        data: {
          ordenServicioId: orden.id,
          estadoAnterior: orden.estado,
          estadoNuevo: EstadoOrdenServicio.LISTO_ENTREGA,
          notas: `[ANULACIÓN VENTA] Se anuló la venta ${ventaCodigo} que cobró esta orden. La orden vuelve a estar pendiente de cobro`,
          creadoPor: usuarioId,
        },
      });

      // Espeja el estado de componentes de LISTO_ENTREGA (post-REPARADO)
      await tx.servicioComponente.updateMany({
        where: { ordenServicioId: orden.id },
        data: { estadoComponente: EstadoComponente.DISPONIBLE },
      });

      // Libera el candado @unique para permitir re-cobro
      await tx.ventaDetalle.update({
        where: { id: detalle.id },
        data: { ordenServicioId: null },
      });
    }
  }

  /**
   * Órdenes cobrables para el selector de Venta Rápida: REPARADO/LISTO_ENTREGA
   * con saldo > 0 y sin venta vinculada. Payload liviano.
   */
  async findCobrables(empresaId: string, search?: string, sedeId?: string) {
    const searchTrim = search?.trim();
    const ordenes = await this.prisma.ordenServicio.findMany({
      where: {
        empresaId,
        // Multi-sede: la venta se emite con la serie de la sede de la CAJA, y el
        // adelanto ya se asentó en la caja de la sede de la ORDEN. Si el selector
        // ofrece órdenes de otra sede, el cobro cruza plata entre sedes.
        ...(sedeId ? { sedeId } : {}),
        estado: { in: OrdenServicioService.ESTADOS_COBRABLES },
        // Sin filtro de costoTotal: una orden de solo repuestos (costoTotal null)
        // igual es cobrable por el total facturable; se filtra abajo por > 0.
        ventaDetalle: null,
        ...(searchTrim
          ? {
              OR: [
                { codigo: { contains: searchTrim, mode: 'insensitive' } },
                { tipoEquipo: { contains: searchTrim, mode: 'insensitive' } },
                { marcaEquipo: { contains: searchTrim, mode: 'insensitive' } },
                {
                  cliente: {
                    persona: {
                      OR: [
                        { nombres: { contains: searchTrim, mode: 'insensitive' } },
                        { apellidos: { contains: searchTrim, mode: 'insensitive' } },
                        { dni: { contains: searchTrim } },
                      ],
                    },
                  },
                },
                {
                  clienteEmpresa: {
                    OR: [
                      { razonSocial: { contains: searchTrim, mode: 'insensitive' } },
                      { numeroDocumento: { contains: searchTrim } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        cliente: {
          select: {
            id: true,
            persona: {
              select: { nombres: true, apellidos: true, dni: true, telefono: true, email: true },
            },
          },
        },
        clienteEmpresa: {
          select: { id: true, razonSocial: true, numeroDocumento: true, email: true, direccion: true },
        },
        servicio: { select: { nombre: true } },
        componentes: { select: { costoAccion: true, costoRepuestos: true } },
      },
      orderBy: { actualizadoEn: 'desc' },
      take: 30,
    });

    return ordenes
      .map((o) => {
        const saldoPendiente = OrdenServicioService.saldoPendiente(o);
        // costoTotal expuesto = base facturable (servicio + componentes) para que
        // el cliente calcule costoNeto = costoTotal − descuento igual que el server.
        const facturable = OrdenServicioService.costoNeto({ ...o, descuento: null });
        return {
          id: o.id,
          codigo: o.codigo,
          estado: o.estado,
          tipoServicio: o.tipoServicio,
          servicioNombre: o.servicio?.nombre ?? null,
          tipoEquipo: o.tipoEquipo,
          marcaEquipo: o.marcaEquipo,
          numeroSerie: o.numeroSerie,
          costoTotal: facturable,
          adelanto: Number(o.adelanto ?? 0),
          descuento: Number(o.descuento ?? 0),
          saldoPendiente,
          cliente: o.cliente
            ? {
                clienteId: o.cliente.id,
                nombre: `${o.cliente.persona?.nombres ?? ''} ${o.cliente.persona?.apellidos ?? ''}`.trim(),
                numeroDocumento: o.cliente.persona?.dni ?? null,
                telefono: o.cliente.persona?.telefono ?? null,
                email: o.cliente.persona?.email ?? null,
              }
            : null,
          clienteEmpresa: o.clienteEmpresa
            ? {
                clienteEmpresaId: o.clienteEmpresa.id,
                razonSocial: o.clienteEmpresa.razonSocial,
                ruc: o.clienteEmpresa.numeroDocumento,
                email: o.clienteEmpresa.email ?? null,
                direccion: o.clienteEmpresa.direccion ?? null,
              }
            : null,
        };
      })
      // costoTotal (=facturable) > 0: hay algo que facturar (servicio y/o
      // repuestos). saldo == 0 (100% adelantada) se incluye; solo se excluye el
      // saldo negativo (datos inconsistentes).
      .filter((o) => o.costoTotal > 0 && o.saldoPendiente >= 0);
  }
}
