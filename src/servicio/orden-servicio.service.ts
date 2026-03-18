import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { AvisoMantenimientoService } from '../aviso-mantenimiento/aviso-mantenimiento.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { TipoNotificacion } from '@prisma/client';
import { EstadoOrdenServicio, EstadoDiagnostico, EstadoComponente, Prisma } from '@prisma/client';
import { CreateOrdenServicioDto } from './dto/create-orden-servicio.dto';
import { CobrarOrdenDto } from './dto/cobrar-orden.dto';
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
} as const;

const ORDEN_SERVICIO_FULL_INCLUDE = {
  ...ORDEN_SERVICIO_BASE_INCLUDE,
  componentes: {
    include: { componente: { include: { tipoComponente: true } } },
  },
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
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
    @Inject(forwardRef(() => AvisoMantenimientoService))
    private avisoMantenimientoService: AvisoMantenimientoService,
    private notificacionService: NotificacionService,
  ) {}

  async create(dto: CreateOrdenServicioDto) {
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
      );
    }

    // Generar código de orden
    const codigo = await this.configuracionCodigosService.generarCodigoOrdenServicio(
      dto.empresaId,
      dto.sedeId,
    );

    const { empresaId, fechaAvisoPersonalizado, ...restDto } = dto;

    const orden = await this.prisma.ordenServicio.create({
      data: {
        empresaId,
        ...restDto,
        codigo,
        estado: EstadoOrdenServicio.RECIBIDO,
        fechaAvisoPersonalizado: fechaAvisoPersonalizado
          ? new Date(fechaAvisoPersonalizado)
          : undefined,
      },
      include: ORDEN_SERVICIO_FULL_INCLUDE,
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
    ).catch(() => {});

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

      // B8 FIX: Validar que adelanto y descuento no excedan costoTotal
      const effectiveCostoTotal = dto.costoTotal ?? (orden.costoTotal ? Number(orden.costoTotal) : null);
      if (dto.adelanto !== undefined && effectiveCostoTotal !== null && dto.adelanto > effectiveCostoTotal) {
        throw new BadRequestException('El adelanto no puede ser mayor al costo total');
      }
      if (dto.descuento !== undefined && effectiveCostoTotal !== null && dto.descuento > effectiveCostoTotal) {
        throw new BadRequestException('El descuento no puede ser mayor al costo total');
      }

      if (dto.costoTotal !== undefined) {
        if (allowCostStates.includes(dto.nuevoEstado)) {
          updateData.costoTotal = dto.costoTotal;
        }
      }
      if (dto.adelanto !== undefined) {
        if (allowCostStates.includes(dto.nuevoEstado)) {
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
    ).catch(() => {});

    return updatedOrden;
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
        data: { ordenId, action },
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
    return this.findAll(empresaId, query);
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
      // Costos
      costoTotal: orden.costoTotal ? Number(orden.costoTotal) : null,
      descuento: orden.descuento ? Number(orden.descuento) : null,
      adelanto: orden.adelanto ? Number(orden.adelanto) : null,
      // Componentes
      componentes: orden.componentes?.map((c) => ({
        nombre: c.componente?.codigo ?? 'Componente',
        tipo: c.componente?.tipoComponente?.nombre,
        costoAccion: c.costoAccion ? Number(c.costoAccion) : null,
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

  async findAll(empresaId: string, query: QueryOrdenServicioDto) {
    const limit = Math.min(query.limit ?? 10, 100);

    const where: any = { empresaId };

    if (query.search) {
      where.OR = [
        { codigo: { contains: query.search, mode: 'insensitive' } },
        { descripcionProblema: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.estado) where.estado = query.estado;
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
  async update(empresaId: string, id: string, dto: UpdateOrdenServicioDto) {
    const existing = await this.findOne(empresaId, id);

    if (ESTADOS_TERMINALES.includes(existing.estado)) {
      throw new BadRequestException(
        `No se puede editar una orden en estado ${existing.estado}`,
      );
    }

    return this.prisma.ordenServicio.update({
      where: { id: existing.id },
      data: dto,
      include: ORDEN_SERVICIO_DETAIL_INCLUDE,
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
  ) {
    const campos = await this.prisma.configuracionCamposServicio.findMany({
      where: {
        empresaId,
        isActive: true,
        esRequerido: true,
      },
    });

    for (const campo of campos) {
      if (!(campo.nombre in datos) || datos[campo.nombre] === null || datos[campo.nombre] === '') {
        throw new BadRequestException(
          `El campo "${campo.nombre}" es requerido`,
        );
      }
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
    ).catch(() => {});

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

    // Notificar al técnico o admins de la empresa
    const notifTitulo = `Mensaje del cliente - ${orden.codigo}`;
    const notifCuerpo = contenido.length > 100 ? contenido.substring(0, 100) + '...' : contenido;
    const notifOpts = {
      tipo: TipoNotificacion.MENSAJE,
      data: { ordenServicioId, action: 'MENSAJE' },
      empresaId,
    };

    if (orden.tecnicoId) {
      this.notificacionService.enviarAUsuario(
        orden.tecnicoId, notifTitulo, notifCuerpo, notifOpts,
      ).catch(() => {});
    } else {
      // Sin técnico asignado: notificar a admins de la empresa
      this.notificarAdminsEmpresa(empresaId, notifTitulo, notifCuerpo, notifOpts).catch(() => {});
    }

    return mensaje;
  }

  private async notificarAdminsEmpresa(
    empresaId: string,
    titulo: string,
    cuerpo: string,
    options: { tipo: TipoNotificacion; data: Record<string, string>; empresaId: string },
  ) {
    const admins = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        rol: { in: ['EMPRESA_ADMIN', 'SUPER_ADMIN'] },
      },
      select: { usuarioId: true },
    });

    const adminIds = admins.map((a) => a.usuarioId);
    if (adminIds.length > 0) {
      await this.notificacionService.enviarAUsuarios(adminIds, titulo, cuerpo, options);
    }
  }

  /**
   * Cobrar una orden de servicio: genera ComprobanteElectronico + PagoComprobante
   * y cambia el estado a ENTREGADO
   */
  async cobrarOrden(empresaId: string, ordenId: string, dto: CobrarOrdenDto, usuarioId: string) {
    return await this.prisma.$transaction(async (tx) => {
      const ordenRaw = await tx.ordenServicio.findFirst({
        where: { id: ordenId, empresaId },
        include: {
          cliente: { include: { persona: true } },
          clienteEmpresa: true,
          componentes: {
            include: { componente: true },
          },
          servicio: true,
        },
      });

      if (!ordenRaw) {
        throw new NotFoundException('Orden de servicio no encontrada');
      }

      const orden = ordenRaw as any;

      // Validar que la orden esté en un estado cobrable
      const estadosCobrables: EstadoOrdenServicio[] = [
        EstadoOrdenServicio.REPARADO,
        EstadoOrdenServicio.LISTO_ENTREGA,
      ];
      if (!estadosCobrables.includes(orden.estado)) {
        throw new BadRequestException(
          `No se puede cobrar una orden en estado ${orden.estado}. Debe estar en REPARADO o LISTO_ENTREGA`,
        );
      }

      if (!orden.costoTotal || Number(orden.costoTotal) <= 0) {
        throw new BadRequestException('La orden no tiene costo total definido');
      }

      const costoTotal = Number(orden.costoTotal);
      const adelanto = Number(orden.adelanto || 0);
      const descuento = Number(orden.descuento || 0);
      const saldoPendiente = costoTotal - adelanto - descuento;

      // Datos del cliente
      const nombreCliente = orden.clienteEmpresa?.razonSocial
        || (orden.cliente?.persona
          ? `${orden.cliente.persona.nombres} ${orden.cliente.persona.apellidos || ''}`.trim()
          : 'CLIENTE VARIOS');
      const documentoCliente = orden.clienteEmpresa?.ruc
        || orden.cliente?.persona?.numeroDocumento || null;
      const emailCliente = orden.clienteEmpresa?.email
        || orden.cliente?.persona?.email || null;
      const direccionCliente = orden.clienteEmpresa?.direccion || null;

      // Crear comprobante electrónico
      const tipoComprobante = dto.tipoComprobante || 'BOLETA';

      // ConfiguracionFacturacion = datos tributarios de la empresa (IGV, credenciales SUNAT)
      const configFacturacion = await tx.configuracionFacturacion.findUnique({
        where: { empresaId },
      });

      // Sede = punto de emisión (series y correlativos)
      const sede = orden.sedeId
        ? await tx.sede.findFirst({ where: { id: orden.sedeId } })
        : null;

      let comprobanteId: string | null = null;

      if (sede) {
        // Series y correlativos vienen de la Sede (punto de emisión)
        const serie = tipoComprobante === 'FACTURA'
          ? sede.serieFactura
          : sede.serieBoleta;

        let correlativo: string;
        if (tipoComprobante === 'FACTURA') {
          correlativo = String(sede.ultimoNumeroFactura + 1);
          await tx.sede.update({ where: { id: sede.id }, data: { ultimoNumeroFactura: sede.ultimoNumeroFactura + 1 } });
        } else {
          correlativo = String(sede.ultimoNumeroBoleta + 1);
          await tx.sede.update({ where: { id: sede.id }, data: { ultimoNumeroBoleta: sede.ultimoNumeroBoleta + 1 } });
        }

        const codigoGenerado = `${serie}-${correlativo.padStart(8, '0')}`;

        // IGV desde ConfiguracionFacturacion (config tributaria global)
        const porcentajeIGV = Number(configFacturacion?.porcentajeIGV || 18);
        const factorIGV = 1 + porcentajeIGV / 100;
        const incluyeIGV = configFacturacion?.incluirIGV ?? true;
        const subtotal = incluyeIGV ? saldoPendiente / factorIGV : saldoPendiente;
        const igv = incluyeIGV ? saldoPendiente - subtotal : 0;

        // Preparar detalles del comprobante
        const detallesComprobante = orden.componentes.length > 0
          ? orden.componentes.map((comp: any) => {
              const costoAccion = Number(comp.costoAccion || 0);
              const costoRepuestos = Number(comp.costoRepuestos || 0);
              const totalItem = costoAccion + costoRepuestos;
              const valorUnit = incluyeIGV ? totalItem / factorIGV : totalItem;
              return {
                descripcion: `${comp.componente?.nombre || 'Componente'} - ${comp.tipoAccion}`,
                cantidad: new Prisma.Decimal(1),
                valorUnitario: new Prisma.Decimal(valorUnit.toFixed(2)),
                precioUnitario: new Prisma.Decimal(totalItem.toFixed(2)),
                valorVenta: new Prisma.Decimal(valorUnit.toFixed(2)),
                igv: new Prisma.Decimal((totalItem - valorUnit).toFixed(2)),
                subtotal: new Prisma.Decimal(valorUnit.toFixed(2)),
                total: new Prisma.Decimal(totalItem.toFixed(2)),
              };
            })
          : [{
              descripcion: orden.servicio?.nombre || `Servicio - ${orden.tipoServicio}`,
              cantidad: new Prisma.Decimal(1),
              valorUnitario: new Prisma.Decimal(subtotal.toFixed(2)),
              precioUnitario: new Prisma.Decimal(saldoPendiente.toFixed(2)),
              valorVenta: new Prisma.Decimal(subtotal.toFixed(2)),
              igv: new Prisma.Decimal(igv.toFixed(2)),
              subtotal: new Prisma.Decimal(subtotal.toFixed(2)),
              total: new Prisma.Decimal(saldoPendiente.toFixed(2)),
            }];

        const comprobante = await tx.comprobanteElectronico.create({
          data: {
            empresaId,
            clienteId: orden.clienteId,
            clienteEmpresaId: orden.clienteEmpresaId,
            tipoComprobante: tipoComprobante as any,
            serie,
            correlativo: correlativo.padStart(8, '0'),
            codigoGenerado,
            tipoDocumento: dto.tipoDocumentoCliente || (tipoComprobante === 'FACTURA' ? '6' : '1'),
            numeroDocumento: documentoCliente,
            nombreCliente,
            direccionCliente,
            emailCliente,
            moneda: 'PEN',
            gravada: new Prisma.Decimal(subtotal.toFixed(2)),
            igv: new Prisma.Decimal(igv.toFixed(2)),
            totalIgv: new Prisma.Decimal(igv.toFixed(2)),
            total: new Prisma.Decimal(saldoPendiente.toFixed(2)),
            estado: 'REGISTRADO' as any,
            detalles: {
              create: detallesComprobante,
            },
          },
        });

        comprobanteId = comprobante.id;

        // Registrar pago del comprobante
        const montoPago = dto.condicionPago === 'CREDITO'
          ? 0
          : Math.min(dto.montoRecibido || saldoPendiente, saldoPendiente);

        await tx.pagoComprobante.create({
          data: {
            comprobanteId: comprobante.id,
            metodoPago: dto.metodoPago || 'EFECTIVO',
            monto: new Prisma.Decimal(montoPago.toFixed(2)),
            referencia: dto.referenciaPago || null,
            estado: dto.condicionPago === 'CREDITO' ? 'PENDIENTE' : 'COMPLETADO',
          },
        });

        console.log(`Comprobante ${codigoGenerado} generado para orden ${orden.codigo}`);
      }

      // Actualizar orden: vincular comprobante y cambiar estado a ENTREGADO
      const updatedOrden = await tx.ordenServicio.update({
        where: { id: ordenId },
        data: {
          comprobanteId,
          estado: EstadoOrdenServicio.ENTREGADO,
          notas: dto.observaciones
            ? `${orden.notas ? orden.notas + '\n' : ''}[Cobro] ${dto.observaciones}`
            : orden.notas,
        },
        include: ORDEN_SERVICIO_DETAIL_INCLUDE,
      });

      // Registrar en historial
      await tx.historialOrdenServicio.create({
        data: {
          ordenServicioId: ordenId,
          estadoAnterior: orden.estado,
          estadoNuevo: EstadoOrdenServicio.ENTREGADO,
          notas: `Orden cobrada. Método: ${dto.metodoPago || 'EFECTIVO'}. Comprobante: ${tipoComprobante}`,
          creadoPor: usuarioId,
        },
      });

      // Notificar al cliente
      if (orden.clienteId) {
        try {
          const clientePersona = await tx.empresaPersona.findFirst({
            where: { id: orden.clienteId },
            select: { personaId: true },
          });
          const usuario = clientePersona
            ? await tx.usuario.findFirst({ where: { personaId: clientePersona.personaId }, select: { id: true } })
            : null;
          if (usuario) {
            await this.notificacionService.enviarAUsuario(
              usuario.id,
              'Servicio completado',
              `Tu orden ${orden.codigo} ha sido cobrada y entregada.`,
              {
                tipo: TipoNotificacion.ORDEN_SERVICIO,
                empresaId,
                data: { ordenId: orden.id },
              },
            );
          }
        } catch {
          // No fallar el cobro si la notificación falla
        }
      }

      return {
        orden: updatedOrden,
        comprobante: comprobanteId ? { id: comprobanteId } : null,
        resumen: {
          costoTotal,
          adelanto,
          descuento,
          saldoPendiente,
          montoPagado: dto.montoRecibido || saldoPendiente,
          vuelto: Math.max(0, (dto.montoRecibido || saldoPendiente) - saldoPendiente),
        },
      };
    });
  }
}
