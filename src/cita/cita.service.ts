import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { EstadoCita, EstadoOrdenServicio, TipoNotificacion } from '@prisma/client';
import { CreateCitaDto } from './dto/create-cita.dto';
import { UpdateCitaDto } from './dto/update-cita.dto';
import {
  QueryCitaDto,
  QueryDisponibilidadDto,
  QueryTecnicosDisponiblesDto,
} from './dto/query-cita.dto';
import { TransitionEstadoCitaDto } from './dto/transition-estado-cita.dto';
import { CreateCitaItemDto, UpdateCitaItemDto } from './dto/cita-item.dto';
import { NotificacionService } from '../notificacion/notificacion.service';

// State machine de citas
const VALID_TRANSITIONS: Record<EstadoCita, EstadoCita[]> = {
  PENDIENTE: [EstadoCita.CONFIRMADA, EstadoCita.CANCELADA],
  CONFIRMADA: [EstadoCita.EN_PROCESO, EstadoCita.CANCELADA, EstadoCita.NO_ASISTIO],
  EN_PROCESO: [EstadoCita.COMPLETADA, EstadoCita.CANCELADA],
  COMPLETADA: [],
  CANCELADA: [],
  NO_ASISTIO: [],
};

const ESTADOS_EDITABLES: EstadoCita[] = [EstadoCita.PENDIENTE, EstadoCita.CONFIRMADA];
const ESTADOS_ACTIVOS: EstadoCita[] = [
  EstadoCita.PENDIENTE,
  EstadoCita.CONFIRMADA,
  EstadoCita.EN_PROCESO,
];
const ESTADOS_TERMINALES: EstadoCita[] = [
  EstadoCita.COMPLETADA,
  EstadoCita.CANCELADA,
  EstadoCita.NO_ASISTIO,
];

const CITA_BASE_INCLUDE = {
  servicio: { select: { id: true, nombre: true, duracionMinutos: true, duracionHoras: true, precio: true } },
  tecnico: { include: { persona: { select: { nombres: true, apellidos: true } } } },
  cliente: { include: { persona: { select: { nombres: true, apellidos: true, telefono: true, email: true } } } },
  clienteEmpresa: { select: { id: true, razonSocial: true, nombreComercial: true, telefono: true } },
  sede: { select: { id: true, nombre: true, codigo: true } },
} as const;

const CITA_DETAIL_INCLUDE = {
  ...CITA_BASE_INCLUDE,
  ordenServicio: { select: { id: true, codigo: true, estado: true } },
  siguienteCita: { select: { id: true, codigo: true, fecha: true, horaInicio: true, estado: true } },
  citaAnterior: { select: { id: true, codigo: true, fecha: true, horaInicio: true, estado: true } },
  historial: { orderBy: { creadoEn: 'desc' as const } },
  items: {
    include: { producto: { select: { id: true, nombre: true, codigoEmpresa: true } } },
    orderBy: { creadoEn: 'asc' as const },
  },
} as const;

@Injectable()
export class CitaService {
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
    private notificacionService: NotificacionService,
  ) {}

  // ─── CRUD ───

  async create(dto: CreateCitaDto) {
    // Validar que exactamente un tipo de cliente exista
    if (!dto.clienteId && !dto.clienteEmpresaId) {
      throw new BadRequestException(
        'Debe especificar clienteId (persona) o clienteEmpresaId (empresa)',
      );
    }
    if (dto.clienteId && dto.clienteEmpresaId) {
      throw new BadRequestException(
        'Debe especificar solo uno: clienteId (persona) o clienteEmpresaId (empresa), no ambos',
      );
    }

    // Validar que horaInicio < horaFin
    if (dto.horaInicio >= dto.horaFin) {
      throw new BadRequestException('La hora de inicio debe ser anterior a la hora de fin');
    }

    // Validar que la fecha no sea en el pasado (comparar solo la parte date en UTC)
    const hoyStr = new Date().toISOString().split('T')[0];
    if (dto.fecha < hoyStr) {
      throw new BadRequestException('No se puede crear una cita en una fecha pasada');
    }

    // Validar sede pertenece a empresa
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId: dto.empresaId, isActive: true },
    });
    if (!sede) throw new NotFoundException('Sede no encontrada');

    // Validar que la cita esté dentro del horario de atención de la sede
    this.validarHorarioSede(sede, dto.fecha, dto.horaInicio, dto.horaFin);

    // Validar servicio pertenece a empresa
    const servicio = await this.prisma.servicio.findFirst({
      where: { id: dto.servicioId, empresaId: dto.empresaId, isActive: true },
    });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');

    // Validar técnico: acepta UsuarioSedeRol.TECNICO_SERVICIO o EmpresaUsuarioRol.TECNICO
    await this.validarTecnico(dto.tecnicoId, dto.sedeId, dto.empresaId);

    // Validar antigüedad mínima
    if (servicio.antigenciaMinimaHoras != null && servicio.antigenciaMinimaHoras > 0) {
      const ahora = new Date();
      const fechaCita = new Date(dto.fecha);
      const [h, m] = dto.horaInicio.split(':').map(Number);
      fechaCita.setHours(h, m, 0, 0);
      const diffHoras = (fechaCita.getTime() - ahora.getTime()) / (1000 * 60 * 60);
      if (diffHoras < servicio.antigenciaMinimaHoras) {
        throw new BadRequestException(
          `El servicio requiere al menos ${servicio.antigenciaMinimaHoras} horas de anticipación`,
        );
      }
    }

    // Usar transacción serializable para prevenir race conditions en solapamiento
    const result = await this.prisma.$transaction(async (tx) => {
      // Validar solapamiento dentro de la transacción
      const citasExistentes = await tx.cita.findMany({
        where: {
          empresaId: dto.empresaId,
          tecnicoId: dto.tecnicoId,
          fecha: new Date(dto.fecha),
          estado: { notIn: [EstadoCita.CANCELADA, EstadoCita.NO_ASISTIO] },
        },
        select: { horaInicio: true, horaFin: true },
      });

      if (this.haySolapamiento(dto.horaInicio, dto.horaFin, citasExistentes)) {
        throw new BadRequestException('El técnico ya tiene una cita en ese horario');
      }

      // Generar código
      const codigo = await this.configuracionCodigosService.generarCodigoCita(
        dto.empresaId,
      );

      return tx.cita.create({
        data: {
          empresaId: dto.empresaId,
          sedeId: dto.sedeId,
          servicioId: dto.servicioId,
          tecnicoId: dto.tecnicoId,
          clienteId: dto.clienteId,
          clienteEmpresaId: dto.clienteEmpresaId,
          codigo,
          fecha: new Date(dto.fecha),
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          costoServicio: servicio.precio ? Number(servicio.precio) : 0,
          costoTotal: servicio.precio ? Number(servicio.precio) : 0,
          notas: dto.notas,
          creadoPor: dto.creadoPor,
        },
        include: CITA_BASE_INCLUDE,
      });
    }, { isolationLevel: 'Serializable' });

    // Notificar al técnico (fire-and-forget)
    const fechaStr = new Date(dto.fecha).toISOString().split('T')[0];
    this.notificacionService.enviarAUsuario(
      dto.tecnicoId,
      'Nueva cita asignada',
      `Cita ${result.codigo} para el ${fechaStr} a las ${dto.horaInicio}`,
      {
        tipo: TipoNotificacion.CITA,
        data: { citaId: result.id, action: 'created' },
        empresaId: dto.empresaId,
      },
    ).catch(() => {});

    // Notificar al cliente (si tiene cuenta de usuario)
    this.notificarCliente(
      result,
      'Tu cita ha sido agendada',
      `Cita ${result.codigo} programada para el ${fechaStr} a las ${dto.horaInicio}`,
      dto.empresaId,
      { citaId: result.id, action: 'created' },
    );

    return result;
  }

  async findCitasCliente(empresaId: string, personaId: string, query: QueryCitaDto) {
    // Buscar el EmpresaPersona del cliente en esta empresa
    const empresaPersona = await this.prisma.empresaPersona.findFirst({
      where: { personaId, empresaId, deletedAt: null },
      select: { id: true },
    });

    if (!empresaPersona) {
      return { data: [], total: 0, page: 1, limit: 20, totalPages: 0 };
    }

    // Reutilizar findAll con el clienteId forzado
    query.clienteId = empresaPersona.id;
    return this.findAll(empresaId, query);
  }

  async findAll(empresaId: string, query: QueryCitaDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const where: any = { empresaId };

    if (query.fecha) {
      where.fecha = new Date(query.fecha);
    } else {
      if (query.fechaDesde || query.fechaHasta) {
        where.fecha = {};
        if (query.fechaDesde) where.fecha.gte = new Date(query.fechaDesde);
        if (query.fechaHasta) where.fecha.lte = new Date(query.fechaHasta);
      }
    }

    if (query.tecnicoId) where.tecnicoId = query.tecnicoId;
    if (query.sedeId) where.sedeId = query.sedeId;
    if (query.estado) where.estado = query.estado;
    if (query.servicioId) where.servicioId = query.servicioId;
    if (query.clienteId) where.clienteId = query.clienteId;
    if (query.clienteEmpresaId) where.clienteEmpresaId = query.clienteEmpresaId;

    const [data, total] = await Promise.all([
      this.prisma.cita.findMany({
        where,
        include: CITA_BASE_INCLUDE,
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.cita.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(empresaId: string, id: string) {
    const cita = await this.prisma.cita.findFirst({
      where: { id, empresaId },
      include: CITA_DETAIL_INCLUDE,
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');
    return cita;
  }

  async update(empresaId: string, id: string, dto: UpdateCitaDto) {
    const cita = await this.prisma.cita.findFirst({
      where: { id, empresaId },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    if (!ESTADOS_EDITABLES.includes(cita.estado)) {
      throw new BadRequestException(
        `No se puede editar una cita en estado ${cita.estado}`,
      );
    }

    // Validar exclusividad mutua de clientes
    const clienteIdFinal = dto.clienteId !== undefined ? dto.clienteId : cita.clienteId;
    const clienteEmpresaIdFinal = dto.clienteEmpresaId !== undefined ? dto.clienteEmpresaId : cita.clienteEmpresaId;
    if (clienteIdFinal && clienteEmpresaIdFinal) {
      throw new BadRequestException(
        'Una cita no puede tener clienteId y clienteEmpresaId al mismo tiempo',
      );
    }

    // Validar existencia del nuevo cliente si cambia
    if (dto.clienteId) {
      const cliente = await this.prisma.empresaPersona.findFirst({
        where: { id: dto.clienteId, empresaId },
      });
      if (!cliente) throw new NotFoundException('Cliente persona no encontrado');
    }
    if (dto.clienteEmpresaId) {
      const clienteEmpresa = await this.prisma.clienteEmpresa.findFirst({
        where: { id: dto.clienteEmpresaId, empresaId },
      });
      if (!clienteEmpresa) throw new NotFoundException('Cliente empresa no encontrado');
    }

    const tecnicoId = dto.tecnicoId ?? cita.tecnicoId;
    const fecha = dto.fecha ?? cita.fecha.toISOString().split('T')[0];
    const horaInicio = dto.horaInicio ?? cita.horaInicio;
    const horaFin = dto.horaFin ?? cita.horaFin;

    // Validar que horaInicio < horaFin
    if (horaInicio >= horaFin) {
      throw new BadRequestException('La hora de inicio debe ser anterior a la hora de fin');
    }

    // Si cambia fecha u hora, validar horario de sede
    if (dto.fecha || dto.horaInicio || dto.horaFin) {
      const sede = await this.prisma.sede.findFirst({
        where: { id: cita.sedeId, empresaId, isActive: true },
      });
      if (sede) {
        this.validarHorarioSede(sede, fecha, horaInicio, horaFin);
      }
    }

    // Si cambia técnico, validar que pertenece a la empresa
    if (dto.tecnicoId) {
      await this.validarTecnico(dto.tecnicoId, cita.sedeId, empresaId);
    }

    // Validar adelanto no exceda costoTotal
    if (dto.adelanto !== undefined) {
      const costoServicio = dto.costoServicio ?? Number(cita.costoServicio ?? 0);
      const costoProductos = Number(cita.costoProductos ?? 0);
      const descuento = dto.descuento ?? Number(cita.descuento ?? 0);
      const costoTotal = costoServicio + costoProductos - descuento;
      if (dto.adelanto > Math.max(0, costoTotal)) {
        throw new BadRequestException(
          `El adelanto (${dto.adelanto}) no puede ser mayor al costo total (${Math.max(0, costoTotal)})`,
        );
      }
    }

    // Si cambia técnico, fecha u hora, revalidar solapamiento con transacción
    if (dto.tecnicoId || dto.fecha || dto.horaInicio || dto.horaFin) {
      return this.prisma.$transaction(async (tx) => {
        const citasExistentes = await tx.cita.findMany({
          where: {
            empresaId,
            tecnicoId,
            fecha: new Date(fecha),
            estado: { notIn: [EstadoCita.CANCELADA, EstadoCita.NO_ASISTIO] },
            id: { not: id },
          },
          select: { horaInicio: true, horaFin: true },
        });

        if (this.haySolapamiento(horaInicio, horaFin, citasExistentes)) {
          throw new BadRequestException('El técnico ya tiene una cita en ese horario');
        }

        const updated = await tx.cita.update({
          where: { id },
          data: this.buildUpdateData(dto),
          include: CITA_BASE_INCLUDE,
        });

        if (dto.costoServicio !== undefined || dto.descuento !== undefined) {
          await this.recalcularCostosInTx(tx, id);
        }

        return updated;
      }, { isolationLevel: 'Serializable' });
    }

    // Si cambian costos, usar transacción para atomicidad
    if (dto.costoServicio !== undefined || dto.descuento !== undefined) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.cita.update({
          where: { id },
          data: this.buildUpdateData(dto),
          include: CITA_BASE_INCLUDE,
        });
        await this.recalcularCostosInTx(tx, id);
        return updated;
      });
    }

    return this.prisma.cita.update({
      where: { id },
      data: this.buildUpdateData(dto),
      include: CITA_BASE_INCLUDE,
    });
  }

  // ─── State Machine ───

  async transitionEstado(
    empresaId: string,
    id: string,
    dto: TransitionEstadoCitaDto,
    usuarioId: string,
  ) {
    const cita = await this.prisma.cita.findFirst({
      where: { id, empresaId },
      include: { servicio: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    const allowed = VALID_TRANSITIONS[cita.estado];
    if (!allowed.includes(dto.nuevoEstado)) {
      throw new BadRequestException(
        `No se puede cambiar de ${cita.estado} a ${dto.nuevoEstado}`,
      );
    }

    if (dto.nuevoEstado === EstadoCita.CANCELADA && !dto.motivoCancelacion) {
      throw new BadRequestException('Debe indicar motivo de cancelación');
    }

    const updateData: any = {
      estado: dto.nuevoEstado,
    };

    if (dto.nuevoEstado === EstadoCita.CANCELADA) {
      updateData.canceladoPor = usuarioId;
      updateData.motivoCancelacion = dto.motivoCancelacion;
    }

    // Generar OrdenServicio al completar si se solicita
    let ordenServicioCreada = null;
    if (
      dto.nuevoEstado === EstadoCita.COMPLETADA &&
      dto.generarOrden &&
      !cita.ordenServicioId
    ) {
      ordenServicioCreada = await this.generarOrdenServicio(cita, empresaId);
      updateData.ordenServicioId = ordenServicioCreada.id;
    }

    const citaActualizada = await this.prisma.cita.update({
      where: { id },
      data: updateData,
      include: CITA_DETAIL_INCLUDE,
    });

    // Registrar historial
    await this.prisma.historialCita.create({
      data: {
        citaId: id,
        estadoAnterior: cita.estado,
        estadoNuevo: dto.nuevoEstado,
        notas: dto.notas,
        creadoPor: usuarioId,
      },
    });

    // Programar siguiente cita si se solicita
    let siguienteCitaCreada = null;
    if (
      dto.nuevoEstado === EstadoCita.COMPLETADA &&
      dto.siguienteCita
    ) {
      const sc = dto.siguienteCita;
      const tecnicoIdSiguiente = sc.tecnicoId ?? cita.tecnicoId;

      // Validar que horaInicio < horaFin
      if (sc.horaInicio >= sc.horaFin) {
        throw new BadRequestException('La hora de inicio de la siguiente cita debe ser anterior a la hora de fin');
      }

      // Validar solapamiento del técnico en la fecha de la siguiente cita
      await this.validarSolapamiento(
        empresaId,
        tecnicoIdSiguiente,
        sc.fecha,
        sc.horaInicio,
        sc.horaFin,
      );

      // Validar horario de sede
      const sede = await this.prisma.sede.findFirst({
        where: { id: cita.sedeId, empresaId, isActive: true },
      });
      if (sede) {
        this.validarHorarioSede(sede, sc.fecha, sc.horaInicio, sc.horaFin);
      }

      const codigoSiguiente = await this.configuracionCodigosService.generarCodigoCita(empresaId);
      siguienteCitaCreada = await this.prisma.cita.create({
        data: {
          empresaId,
          sedeId: cita.sedeId,
          servicioId: cita.servicioId,
          tecnicoId: tecnicoIdSiguiente,
          clienteId: cita.clienteId,
          clienteEmpresaId: cita.clienteEmpresaId,
          codigo: codigoSiguiente,
          fecha: new Date(sc.fecha),
          horaInicio: sc.horaInicio,
          horaFin: sc.horaFin,
          notas: sc.notas,
          creadoPor: usuarioId,
        },
        select: { id: true, codigo: true, fecha: true, horaInicio: true },
      });

      // Vincular cita actual → siguiente
      await this.prisma.cita.update({
        where: { id },
        data: { siguienteCitaId: siguienteCitaCreada.id },
      });
    }

    const resultado = {
      ...citaActualizada,
      ...(ordenServicioCreada && {
        ordenServicioGenerada: {
          id: ordenServicioCreada.id,
          codigo: ordenServicioCreada.codigo,
        },
      }),
      ...(siguienteCitaCreada && {
        siguienteCitaCreada: {
          id: siguienteCitaCreada.id,
          codigo: siguienteCitaCreada.codigo,
        },
      }),
    };

    // Notificar al técnico sobre el cambio de estado (fire-and-forget)
    const estadoLabel = {
      CONFIRMADA: 'confirmada',
      EN_PROCESO: 'en proceso',
      COMPLETADA: 'completada',
      CANCELADA: 'cancelada',
      NO_ASISTIO: 'marcada como no asistió',
    }[dto.nuevoEstado] ?? dto.nuevoEstado;

    this.notificacionService.enviarAUsuario(
      cita.tecnicoId,
      `Cita ${estadoLabel}`,
      `La cita ${citaActualizada.codigo} ha sido ${estadoLabel}`,
      {
        tipo: TipoNotificacion.CITA,
        data: { citaId: id, action: 'status_changed', nuevoEstado: dto.nuevoEstado },
        empresaId,
      },
    ).catch(() => {});

    // Notificar al cliente sobre el cambio de estado
    const clienteEstadoMsg: Record<string, string> = {
      CONFIRMADA: 'Tu cita ha sido confirmada',
      EN_PROCESO: 'Tu cita está en proceso',
      COMPLETADA: 'Tu cita ha sido completada',
      CANCELADA: 'Tu cita ha sido cancelada',
    };
    const msgCliente = clienteEstadoMsg[dto.nuevoEstado];
    if (msgCliente) {
      this.notificarCliente(
        cita,
        msgCliente,
        `Cita ${citaActualizada.codigo} — ${msgCliente.toLowerCase()}`,
        empresaId,
        { citaId: id, action: 'status_changed', nuevoEstado: dto.nuevoEstado },
      );
    }

    return resultado;
  }

  // ─── Clientes con citas ───

  async getClientesConCitas(empresaId: string, search?: string) {
    // Obtener clienteIds únicos que tienen al menos una cita
    const citasPersona = await this.prisma.cita.findMany({
      where: { empresaId, clienteId: { not: null } },
      select: { clienteId: true },
      distinct: ['clienteId'],
    });

    const citasEmpresa = await this.prisma.cita.findMany({
      where: { empresaId, clienteEmpresaId: { not: null } },
      select: { clienteEmpresaId: true },
      distinct: ['clienteEmpresaId'],
    });

    const clienteIds = citasPersona.map((c) => c.clienteId).filter(Boolean) as string[];
    const clienteEmpresaIds = citasEmpresa.map((c) => c.clienteEmpresaId).filter(Boolean) as string[];

    // Buscar personas
    const wherePersona: any = { id: { in: clienteIds } };
    if (search) {
      wherePersona.persona = {
        OR: [
          { nombres: { contains: search, mode: 'insensitive' } },
          { apellidos: { contains: search, mode: 'insensitive' } },
          { telefono: { contains: search } },
        ],
      };
    }

    const personas = clienteIds.length > 0
      ? await this.prisma.empresaPersona.findMany({
          where: wherePersona,
          include: {
            persona: { select: { nombres: true, apellidos: true, telefono: true, email: true } },
          },
          take: 50,
        })
      : [];

    // Buscar empresas cliente
    const whereEmpresa: any = { id: { in: clienteEmpresaIds } };
    if (search) {
      whereEmpresa.OR = [
        { razonSocial: { contains: search, mode: 'insensitive' } },
        { nombreComercial: { contains: search, mode: 'insensitive' } },
        { telefono: { contains: search } },
      ];
    }

    const empresas = clienteEmpresaIds.length > 0
      ? await this.prisma.clienteEmpresa.findMany({
          where: whereEmpresa,
          select: { id: true, razonSocial: true, nombreComercial: true, telefono: true },
          take: 50,
        })
      : [];

    // Contar citas por cliente
    const conteos = await this.prisma.cita.groupBy({
      by: ['clienteId', 'clienteEmpresaId'],
      where: { empresaId },
      _count: true,
    });

    const conteoMap = new Map<string, number>();
    for (const c of conteos) {
      const key = c.clienteId ?? c.clienteEmpresaId;
      if (key) conteoMap.set(key, c._count);
    }

    // Unificar resultados
    const clientes = [
      ...personas.map((p) => ({
        tipo: 'persona' as const,
        clienteId: p.id,
        clienteEmpresaId: null as string | null,
        nombre: `${p.persona.nombres} ${p.persona.apellidos}`,
        telefono: p.persona.telefono,
        email: p.persona.email,
        totalCitas: conteoMap.get(p.id) ?? 0,
      })),
      ...empresas.map((e) => ({
        tipo: 'empresa' as const,
        clienteId: null as string | null,
        clienteEmpresaId: e.id,
        nombre: e.nombreComercial ?? e.razonSocial,
        telefono: e.telefono,
        email: null as string | null,
        totalCitas: conteoMap.get(e.id) ?? 0,
      })),
    ];

    // Ordenar por total de citas descendente
    clientes.sort((a, b) => b.totalCitas - a.totalCitas);

    return { clientes, total: clientes.length };
  }

  // ─── Historial de citas por cliente ───

  async getHistorialCliente(
    empresaId: string,
    clienteId: string,
    clienteEmpresaId?: string,
  ) {
    const where: any = { empresaId };

    if (clienteId) {
      where.clienteId = clienteId;
    } else if (clienteEmpresaId) {
      where.clienteEmpresaId = clienteEmpresaId;
    } else {
      return { citas: [], total: 0 };
    }

    const citas = await this.prisma.cita.findMany({
      where,
      include: {
        ...CITA_BASE_INCLUDE,
        siguienteCita: { select: { id: true, codigo: true, fecha: true, horaInicio: true, estado: true } },
      },
      orderBy: [{ fecha: 'desc' }, { horaInicio: 'desc' }],
      take: 50,
    });

    return {
      citas,
      total: citas.length,
    };
  }

  // ─── Disponibilidad ───

  async getDisponibilidad(empresaId: string, query: QueryDisponibilidadDto) {
    // 1. Obtener sede con horario
    const sede = await this.prisma.sede.findFirst({
      where: { id: query.sedeId, empresaId, isActive: true },
    });
    if (!sede) throw new NotFoundException('Sede no encontrada');

    // 2. Obtener servicio con duración
    const servicio = await this.prisma.servicio.findFirst({
      where: { id: query.servicioId, empresaId, isActive: true },
    });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');

    const duracionMinutos = servicio.duracionMinutos
      ?? (servicio.duracionHoras ? Number(servicio.duracionHoras) * 60 : 30);

    // 3. Obtener horario del día
    const fecha = new Date(query.fecha);
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const diaSemana = dias[fecha.getDay()];
    const horario = (sede.horarioAtencion as any)?.[diaSemana];

    if (!horario || !horario.inicio || !horario.fin) {
      return { slots: [], mensaje: 'La sede no atiende este día' };
    }

    // 4. Determinar técnicos a consultar
    let tecnicoIds: string[] = [];
    if (query.tecnicoId) {
      tecnicoIds = [query.tecnicoId];
    } else {
      // Buscar por UsuarioSedeRol.TECNICO_SERVICIO
      const tecnicosSede = await this.prisma.usuarioSedeRol.findMany({
        where: {
          sedeId: query.sedeId,
          rol: 'TECNICO_SERVICIO',
          isActive: true,
        },
        select: { usuarioId: true },
      });
      tecnicoIds = tecnicosSede.map((t) => t.usuarioId);

      // Fallback: buscar por EmpresaUsuarioRol.TECNICO
      if (tecnicoIds.length === 0) {
        const tecnicosEmpresa = await this.prisma.empresaUsuarioRol.findMany({
          where: {
            empresaId,
            rol: 'TECNICO',
            isActive: true,
          },
          select: { usuarioId: true },
        });
        tecnicoIds = tecnicosEmpresa.map((t) => t.usuarioId);
      }
    }

    if (tecnicoIds.length === 0) {
      return { slots: [], mensaje: 'No hay técnicos disponibles' };
    }

    // 5. Obtener citas existentes (no canceladas/no-asistió) para esos técnicos en esa fecha
    const citasExistentes = await this.prisma.cita.findMany({
      where: {
        empresaId,
        tecnicoId: { in: tecnicoIds },
        fecha: new Date(query.fecha),
        estado: { notIn: [EstadoCita.CANCELADA, EstadoCita.NO_ASISTIO] },
      },
      select: { tecnicoId: true, horaInicio: true, horaFin: true },
    });

    // 6. Generar slots
    const slots = this.generarSlots(
      horario.inicio,
      horario.fin,
      duracionMinutos,
      citasExistentes,
      tecnicoIds,
      servicio.antigenciaMinimaHoras,
      fecha,
    );

    return { slots, duracionMinutos };
  }

  async getTecnicosDisponibles(empresaId: string, query: QueryTecnicosDisponiblesDto) {
    // Obtener servicio para la duración
    const servicio = await this.prisma.servicio.findFirst({
      where: { id: query.servicioId, empresaId, isActive: true },
    });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');

    const duracionMinutos = servicio.duracionMinutos
      ?? (servicio.duracionHoras ? Number(servicio.duracionHoras) * 60 : 30);

    // Calcular horaFin
    const horaFin = this.sumarMinutos(query.horaInicio, duracionMinutos);

    // Obtener técnicos de la sede (UsuarioSedeRol o EmpresaUsuarioRol)
    let tecnicosSede = await this.prisma.usuarioSedeRol.findMany({
      where: {
        sedeId: query.sedeId,
        rol: 'TECNICO_SERVICIO',
        isActive: true,
      },
      include: {
        usuario: { include: { persona: { select: { nombres: true, apellidos: true } } } },
      },
    });

    // Fallback: buscar por EmpresaUsuarioRol.TECNICO
    if (tecnicosSede.length === 0) {
      const tecnicosEmpresa = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId,
          rol: 'TECNICO',
          isActive: true,
        },
        include: {
          usuario: { include: { persona: { select: { nombres: true, apellidos: true } } } },
        },
      });
      // Adaptar al mismo shape que tecnicosSede
      tecnicosSede = tecnicosEmpresa.map((t) => ({
        ...t,
        sedeId: query.sedeId,
        usuarioId: t.usuarioId,
        usuario: t.usuario,
      })) as any;
    }

    // Obtener citas existentes para esa fecha
    const citasExistentes = await this.prisma.cita.findMany({
      where: {
        empresaId,
        tecnicoId: { in: tecnicosSede.map((t) => t.usuarioId) },
        fecha: new Date(query.fecha),
        estado: { notIn: [EstadoCita.CANCELADA, EstadoCita.NO_ASISTIO] },
      },
      select: { tecnicoId: true, horaInicio: true, horaFin: true },
    });

    // Verificar disponibilidad de cada técnico
    return tecnicosSede.map((ts) => {
      const citasTecnico = citasExistentes.filter((c) => c.tecnicoId === ts.usuarioId);
      const disponible = !this.haySolapamiento(
        query.horaInicio,
        horaFin,
        citasTecnico,
      );
      return {
        tecnicoId: ts.usuarioId,
        nombre: `${ts.usuario.persona.nombres} ${ts.usuario.persona.apellidos}`,
        disponible,
      };
    });
  }

  // ─── Items / Productos de la cita ───

  async addItem(empresaId: string, citaId: string, dto: CreateCitaItemDto) {
    const cita = await this.prisma.cita.findFirst({
      where: { id: citaId, empresaId },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    if (ESTADOS_TERMINALES.includes(cita.estado)) {
      throw new BadRequestException(
        `No se pueden agregar items a una cita en estado ${cita.estado}`,
      );
    }

    // Si viene productoId, validar que existe y tomar nombre
    if (dto.productoId) {
      const producto = await this.prisma.producto.findFirst({
        where: { id: dto.productoId, empresaId, isActive: true },
      });
      if (!producto) throw new NotFoundException('Producto no encontrado');
      if (!dto.nombre) dto.nombre = producto.nombre;
    }

    const subtotal = dto.cantidad * dto.precioUnitario;

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.citaItem.create({
        data: {
          citaId,
          productoId: dto.productoId,
          nombre: dto.nombre,
          descripcion: dto.descripcion,
          cantidad: dto.cantidad,
          precioUnitario: dto.precioUnitario,
          subtotal,
        },
        include: {
          producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
        },
      });

      await this.recalcularCostosInTx(tx, citaId);
      return item;
    });
  }

  async updateItem(empresaId: string, citaId: string, itemId: string, dto: UpdateCitaItemDto) {
    const cita = await this.prisma.cita.findFirst({
      where: { id: citaId, empresaId },
      select: { estado: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    if (ESTADOS_TERMINALES.includes(cita.estado)) {
      throw new BadRequestException(
        `No se pueden modificar items de una cita en estado ${cita.estado}`,
      );
    }

    const existingItem = await this.prisma.citaItem.findFirst({
      where: { id: itemId, cita: { id: citaId, empresaId } },
    });
    if (!existingItem) throw new NotFoundException('Item no encontrado');

    const cantidad = dto.cantidad ?? Number(existingItem.cantidad);
    const precioUnitario = dto.precioUnitario ?? Number(existingItem.precioUnitario);
    const subtotal = cantidad * precioUnitario;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.citaItem.update({
        where: { id: itemId },
        data: {
          ...(dto.nombre && { nombre: dto.nombre }),
          ...(dto.descripcion !== undefined && { descripcion: dto.descripcion }),
          ...(dto.cantidad && { cantidad: dto.cantidad }),
          ...(dto.precioUnitario !== undefined && { precioUnitario: dto.precioUnitario }),
          subtotal,
        },
        include: {
          producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
        },
      });

      await this.recalcularCostosInTx(tx, citaId);
      return updated;
    });
  }

  async removeItem(empresaId: string, citaId: string, itemId: string) {
    const cita = await this.prisma.cita.findFirst({
      where: { id: citaId, empresaId },
      select: { estado: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    if (ESTADOS_TERMINALES.includes(cita.estado)) {
      throw new BadRequestException(
        `No se pueden eliminar items de una cita en estado ${cita.estado}`,
      );
    }

    const existingItem = await this.prisma.citaItem.findFirst({
      where: { id: itemId, cita: { id: citaId, empresaId } },
    });
    if (!existingItem) throw new NotFoundException('Item no encontrado');

    await this.prisma.$transaction(async (tx) => {
      await tx.citaItem.delete({ where: { id: itemId } });
      await this.recalcularCostosInTx(tx, citaId);
    });
  }

  async getItems(empresaId: string, citaId: string) {
    const cita = await this.prisma.cita.findFirst({
      where: { id: citaId, empresaId },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    const items = await this.prisma.citaItem.findMany({
      where: { citaId },
      include: {
        producto: { select: { id: true, nombre: true, codigoEmpresa: true } },
      },
      orderBy: { creadoEn: 'asc' },
    });

    const total = items.reduce((acc, item) => acc + Number(item.subtotal), 0);

    return { items, total };
  }

  // ─── Helpers privados ───

  private generarSlots(
    horaInicioSede: string,
    horaFinSede: string,
    duracionMinutos: number,
    citasExistentes: { tecnicoId: string; horaInicio: string; horaFin: string }[],
    tecnicoIds: string[],
    antigenciaMinHoras: number | null,
    fecha: Date,
  ) {
    const slots: {
      horaInicio: string;
      horaFin: string;
      disponible: boolean;
      tecnicosDisponibles: number;
    }[] = [];

    if (duracionMinutos <= 0) {
      return [];
    }

    let cursor = this.horaToMinutos(horaInicioSede);
    const finSede = this.horaToMinutos(horaFinSede);

    if (cursor >= finSede) {
      return [];
    }

    const ahora = new Date();

    while (cursor + duracionMinutos <= finSede) {
      const slotInicio = this.minutosToHora(cursor);
      const slotFin = this.minutosToHora(cursor + duracionMinutos);

      // Contar técnicos disponibles para este slot
      let tecnicosLibres = 0;
      for (const tecnicoId of tecnicoIds) {
        const citasTecnico = citasExistentes.filter((c) => c.tecnicoId === tecnicoId);
        if (!this.haySolapamiento(slotInicio, slotFin, citasTecnico)) {
          tecnicosLibres++;
        }
      }

      let disponible = tecnicosLibres > 0;

      // Validar antigüencia mínima
      if (disponible && antigenciaMinHoras != null && antigenciaMinHoras > 0) {
        const slotDate = new Date(fecha);
        const [h, m] = slotInicio.split(':').map(Number);
        slotDate.setHours(h, m, 0, 0);
        const diffHoras = (slotDate.getTime() - ahora.getTime()) / (1000 * 60 * 60);
        if (diffHoras < antigenciaMinHoras) {
          disponible = false;
        }
      }

      slots.push({
        horaInicio: slotInicio,
        horaFin: slotFin,
        disponible,
        tecnicosDisponibles: disponible ? tecnicosLibres : 0,
      });

      cursor += duracionMinutos;
    }

    return slots;
  }

  private haySolapamiento(
    horaInicio: string,
    horaFin: string,
    citas: { horaInicio: string; horaFin: string }[],
  ): boolean {
    const inicio = this.horaToMinutos(horaInicio);
    const fin = this.horaToMinutos(horaFin);
    return citas.some((c) => {
      const cInicio = this.horaToMinutos(c.horaInicio);
      const cFin = this.horaToMinutos(c.horaFin);
      return inicio < cFin && fin > cInicio;
    });
  }

  private async validarSolapamiento(
    empresaId: string,
    tecnicoId: string,
    fecha: string,
    horaInicio: string,
    horaFin: string,
    excludeCitaId?: string,
  ) {
    const citasExistentes = await this.prisma.cita.findMany({
      where: {
        empresaId,
        tecnicoId,
        fecha: new Date(fecha),
        estado: { notIn: [EstadoCita.CANCELADA, EstadoCita.NO_ASISTIO] },
        ...(excludeCitaId && { id: { not: excludeCitaId } }),
      },
      select: { horaInicio: true, horaFin: true },
    });

    if (this.haySolapamiento(horaInicio, horaFin, citasExistentes)) {
      throw new BadRequestException(
        'El técnico ya tiene una cita en ese horario',
      );
    }
  }

  private async generarOrdenServicio(cita: any, empresaId: string) {
    const codigo = await this.configuracionCodigosService.generarCodigoOrdenServicio(
      empresaId,
    );

    return this.prisma.ordenServicio.create({
      data: {
        empresaId,
        codigo,
        servicioId: cita.servicioId,
        tecnicoId: cita.tecnicoId,
        clienteId: cita.clienteId,
        clienteEmpresaId: cita.clienteEmpresaId,
        sedeId: cita.sedeId,
        tipoServicio: cita.servicio?.tipoServicio ?? 'REPARACION',
        estado: EstadoOrdenServicio.RECIBIDO,
        descripcionProblema: cita.notas,
      },
      select: { id: true, codigo: true },
    });
  }

  /**
   * Recalcula costoProductos y costoTotal de una cita
   */
  private async recalcularCostos(citaId: string) {
    const items = await this.prisma.citaItem.findMany({
      where: { citaId },
      select: { subtotal: true },
    });
    const costoProductos = items.reduce((acc, i) => acc + Number(i.subtotal), 0);

    const cita = await this.prisma.cita.findUnique({
      where: { id: citaId },
      select: { costoServicio: true, descuento: true },
    });

    const costoServicio = Number(cita?.costoServicio ?? 0);
    const descuento = Number(cita?.descuento ?? 0);
    const costoTotal = costoServicio + costoProductos - descuento;

    await this.prisma.cita.update({
      where: { id: citaId },
      data: {
        costoProductos,
        costoTotal: Math.max(0, costoTotal),
      },
    });
  }

  private horaToMinutos(hora: string): number {
    const [h, m] = hora.split(':').map(Number);
    if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
      throw new BadRequestException(`Formato de hora inválido: ${hora}. Use HH:mm (00:00-23:59)`);
    }
    return h * 60 + m;
  }

  private minutosToHora(minutos: number): string {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  private sumarMinutos(hora: string, minutos: number): string {
    return this.minutosToHora(this.horaToMinutos(hora) + minutos);
  }

  /**
   * Valida que la cita esté dentro del horario de atención de la sede
   */
  private validarHorarioSede(
    sede: any,
    fecha: string,
    horaInicio: string,
    horaFin: string,
  ) {
    const dias = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const diaSemana = dias[new Date(fecha).getDay()];
    const horario = (sede.horarioAtencion as any)?.[diaSemana];

    if (!horario || !horario.inicio || !horario.fin) {
      throw new BadRequestException(`La sede no atiende el día ${diaSemana}`);
    }

    const sedeInicio = this.horaToMinutos(horario.inicio);
    const sedeFin = this.horaToMinutos(horario.fin);
    const citaInicio = this.horaToMinutos(horaInicio);
    const citaFin = this.horaToMinutos(horaFin);

    if (citaInicio < sedeInicio || citaFin > sedeFin) {
      throw new BadRequestException(
        `La cita debe estar dentro del horario de atención de la sede (${horario.inicio} - ${horario.fin})`,
      );
    }
  }

  /**
   * Valida que el técnico pertenezca a la sede o empresa con rol adecuado
   */
  private async validarTecnico(tecnicoId: string, sedeId: string, empresaId: string) {
    // Buscar como TECNICO_SERVICIO en la sede
    const tecnicoSede = await this.prisma.usuarioSedeRol.findFirst({
      where: {
        usuarioId: tecnicoId,
        sedeId,
        rol: 'TECNICO_SERVICIO',
        isActive: true,
      },
    });
    if (tecnicoSede) return;

    // Fallback: buscar como TECNICO a nivel empresa
    const tecnicoEmpresa = await this.prisma.empresaUsuarioRol.findFirst({
      where: {
        usuarioId: tecnicoId,
        empresaId,
        rol: 'TECNICO',
        isActive: true,
      },
    });
    if (tecnicoEmpresa) return;

    throw new BadRequestException(
      'El técnico no tiene rol de técnico en esta sede o empresa',
    );
  }

  /**
   * Construye el objeto de datos para actualizar una cita desde el DTO
   */
  private buildUpdateData(dto: UpdateCitaDto) {
    const data: any = {};
    if (dto.servicioId !== undefined) data.servicioId = dto.servicioId;
    if (dto.tecnicoId !== undefined) data.tecnicoId = dto.tecnicoId;
    if (dto.clienteId !== undefined) data.clienteId = dto.clienteId;
    if (dto.clienteEmpresaId !== undefined) data.clienteEmpresaId = dto.clienteEmpresaId;
    if (dto.fecha !== undefined) data.fecha = new Date(dto.fecha);
    if (dto.horaInicio !== undefined) data.horaInicio = dto.horaInicio;
    if (dto.horaFin !== undefined) data.horaFin = dto.horaFin;
    if (dto.costoServicio !== undefined) data.costoServicio = dto.costoServicio;
    if (dto.descuento !== undefined) data.descuento = dto.descuento;
    if (dto.adelanto !== undefined) data.adelanto = dto.adelanto;
    if (dto.metodoPagoAdelanto !== undefined) data.metodoPagoAdelanto = dto.metodoPagoAdelanto;
    if (dto.datosPersonalizados !== undefined) data.datosPersonalizados = dto.datosPersonalizados;
    if (dto.notas !== undefined) data.notas = dto.notas;
    return data;
  }

  /**
   * Recalcula costoProductos y costoTotal dentro de una transacción
   */
  private async recalcularCostosInTx(tx: any, citaId: string) {
    const items = await tx.citaItem.findMany({
      where: { citaId },
      select: { subtotal: true },
    });
    const costoProductos = items.reduce((acc: number, i: any) => acc + Number(i.subtotal), 0);

    const cita = await tx.cita.findUnique({
      where: { id: citaId },
      select: { costoServicio: true, descuento: true },
    });

    const costoServicio = Number(cita?.costoServicio ?? 0);
    const descuento = Number(cita?.descuento ?? 0);
    const costoTotal = costoServicio + costoProductos - descuento;

    await tx.cita.update({
      where: { id: citaId },
      data: {
        costoProductos,
        costoTotal: Math.max(0, costoTotal),
      },
    });
  }

  /**
   * Obtiene el usuarioId del cliente de una cita (si tiene cuenta)
   * Busca: EmpresaPersona → Persona → Usuario
   */
  private async getClienteUsuarioId(
    clienteId?: string | null,
    clienteEmpresaId?: string | null,
  ): Promise<string | null> {
    if (clienteId) {
      const empresaPersona = await this.prisma.empresaPersona.findUnique({
        where: { id: clienteId },
        select: {
          persona: {
            select: {
              usuario: { select: { id: true } },
            },
          },
        },
      });
      return empresaPersona?.persona?.usuario?.id ?? null;
    }
    // ClienteEmpresa no tiene usuario asociado directamente
    return null;
  }

  /**
   * Notifica al cliente de la cita (si tiene cuenta de usuario)
   */
  private async notificarCliente(
    cita: { clienteId?: string | null; clienteEmpresaId?: string | null; codigo: string },
    titulo: string,
    cuerpo: string,
    empresaId: string,
    extraData?: Record<string, string>,
  ) {
    const clienteUsuarioId = await this.getClienteUsuarioId(
      cita.clienteId,
      cita.clienteEmpresaId,
    );
    if (!clienteUsuarioId) return;

    this.notificacionService.enviarAUsuario(
      clienteUsuarioId,
      titulo,
      cuerpo,
      {
        tipo: TipoNotificacion.CITA,
        data: { ...extraData },
        empresaId,
      },
    ).catch(() => {});
  }

  // ─── Endpoints para cliente ───

  private async resolveClienteId(empresaId: string, personaId: string) {
    const ep = await this.prisma.empresaPersona.findFirst({
      where: { personaId, empresaId, deletedAt: null },
      select: { id: true },
    });
    if (!ep) throw new NotFoundException('No eres cliente de esta empresa');
    return ep.id;
  }

  async findCitaCliente(empresaId: string, personaId: string, citaId: string) {
    const clienteId = await this.resolveClienteId(empresaId, personaId);

    const cita = await this.prisma.cita.findFirst({
      where: { id: citaId, empresaId, clienteId },
      include: {
        servicio: { select: { id: true, nombre: true, duracionMinutos: true } },
        sede: { select: { id: true, nombre: true } },
        ordenServicio: { select: { id: true, codigo: true, estado: true } },
      },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    return {
      id: cita.id,
      codigo: cita.codigo,
      estado: cita.estado,
      fecha: cita.fecha,
      horaInicio: cita.horaInicio,
      horaFin: cita.horaFin,
      servicio: cita.servicio ? { id: cita.servicio.id, nombre: cita.servicio.nombre, duracion: cita.servicio.duracionMinutos } : null,
      sede: cita.sede ? { id: cita.sede.id, nombre: cita.sede.nombre } : null,
      notas: cita.notas,
      costoServicio: cita.costoServicio ? Number(cita.costoServicio) : null,
      costoProductos: cita.costoProductos ? Number(cita.costoProductos) : null,
      costoTotal: cita.costoTotal ? Number(cita.costoTotal) : null,
      descuento: cita.descuento ? Number(cita.descuento) : null,
      adelanto: cita.adelanto ? Number(cita.adelanto) : null,
      ordenServicio: cita.ordenServicio,
      motivoCancelacion: cita.motivoCancelacion,
      creadoEn: cita.creadoEn,
    };
  }

  async findHistorialCitaCliente(empresaId: string, personaId: string, citaId: string) {
    const clienteId = await this.resolveClienteId(empresaId, personaId);

    const cita = await this.prisma.cita.findFirst({
      where: { id: citaId, empresaId, clienteId },
      select: { id: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    return this.prisma.historialCita.findMany({
      where: { citaId },
      orderBy: { creadoEn: 'asc' },
      select: {
        id: true,
        estadoAnterior: true,
        estadoNuevo: true,
        notas: true,
        creadoEn: true,
      },
    });
  }

  // ─── Mensajería en citas ───

  private readonly MENSAJE_CITA_SELECT = {
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

  async listarMensajesCita(empresaId: string, citaId: string) {
    await this.findOne(empresaId, citaId);

    await this.prisma.mensajeServicio.updateMany({
      where: { citaId, esCliente: true, leidoEn: null },
      data: { leidoEn: new Date() },
    });

    return this.prisma.mensajeServicio.findMany({
      where: { citaId },
      select: this.MENSAJE_CITA_SELECT,
      orderBy: { creadoEn: 'asc' },
    });
  }

  async listarMensajesCitaCliente(empresaId: string, personaId: string, citaId: string) {
    const clienteId = await this.resolveClienteId(empresaId, personaId);

    const cita = await this.prisma.cita.findFirst({
      where: { id: citaId, empresaId, clienteId },
      select: { id: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    await this.prisma.mensajeServicio.updateMany({
      where: { citaId, esCliente: false, leidoEn: null },
      data: { leidoEn: new Date() },
    });

    return this.prisma.mensajeServicio.findMany({
      where: { citaId },
      select: this.MENSAJE_CITA_SELECT,
      orderBy: { creadoEn: 'asc' },
    });
  }

  async enviarMensajeCitaTecnico(empresaId: string, usuarioId: string, citaId: string, contenido: string) {
    const cita = await this.findOne(empresaId, citaId);

    const mensaje = await this.prisma.mensajeServicio.create({
      data: { empresaId, citaId, usuarioId, contenido, esCliente: false },
      select: this.MENSAJE_CITA_SELECT,
    });

    // Notificar al cliente
    if (cita.clienteId) {
      const ep = await this.prisma.empresaPersona.findFirst({
        where: { id: cita.clienteId },
        select: { persona: { select: { usuario: { select: { id: true } } } } },
      });
      const clienteUsuarioId = ep?.persona?.usuario?.id;
      if (clienteUsuarioId) {
        this.notificacionService.enviarAUsuario(
          clienteUsuarioId,
          'Nuevo mensaje sobre tu cita',
          contenido.length > 100 ? contenido.substring(0, 100) + '...' : contenido,
          { tipo: TipoNotificacion.MENSAJE, data: { citaId, action: 'MENSAJE' }, empresaId },
        ).catch(() => {});
      }
    }

    return mensaje;
  }

  async enviarMensajeCitaCliente(empresaId: string, personaId: string, usuarioId: string, citaId: string, contenido: string) {
    const clienteId = await this.resolveClienteId(empresaId, personaId);

    const cita = await this.prisma.cita.findFirst({
      where: { id: citaId, empresaId, clienteId },
      select: { id: true, tecnicoId: true, codigo: true },
    });
    if (!cita) throw new NotFoundException('Cita no encontrada');

    const mensaje = await this.prisma.mensajeServicio.create({
      data: { empresaId, citaId, usuarioId, contenido, esCliente: true },
      select: this.MENSAJE_CITA_SELECT,
    });

    const notifTitulo = `Mensaje del cliente - ${cita.codigo}`;
    const notifCuerpo = contenido.length > 100 ? contenido.substring(0, 100) + '...' : contenido;
    const notifOpts = { tipo: TipoNotificacion.MENSAJE, data: { citaId, action: 'MENSAJE' }, empresaId };

    if (cita.tecnicoId) {
      this.notificacionService.enviarAUsuario(
        cita.tecnicoId, notifTitulo, notifCuerpo, notifOpts,
      ).catch(() => {});
    } else {
      // Sin técnico: notificar admins
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
}
