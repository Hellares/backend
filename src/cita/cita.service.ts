import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { EstadoCita, EstadoOrdenServicio } from '@prisma/client';
import { CreateCitaDto } from './dto/create-cita.dto';
import { UpdateCitaDto } from './dto/update-cita.dto';
import {
  QueryCitaDto,
  QueryDisponibilidadDto,
  QueryTecnicosDisponiblesDto,
} from './dto/query-cita.dto';
import { TransitionEstadoCitaDto } from './dto/transition-estado-cita.dto';

// State machine de citas
const VALID_TRANSITIONS: Record<EstadoCita, EstadoCita[]> = {
  PENDIENTE: [EstadoCita.CONFIRMADA, EstadoCita.CANCELADA, EstadoCita.NO_ASISTIO],
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
  historial: { orderBy: { creadoEn: 'desc' as const } },
} as const;

@Injectable()
export class CitaService {
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
  ) {}

  // ─── CRUD ───

  async create(dto: CreateCitaDto) {
    // Validar que al menos un tipo de cliente exista
    if (!dto.clienteId && !dto.clienteEmpresaId) {
      throw new BadRequestException(
        'Debe especificar clienteId (persona) o clienteEmpresaId (empresa)',
      );
    }

    // Validar sede pertenece a empresa
    const sede = await this.prisma.sede.findFirst({
      where: { id: dto.sedeId, empresaId: dto.empresaId, isActive: true },
    });
    if (!sede) throw new NotFoundException('Sede no encontrada');

    // Validar servicio pertenece a empresa
    const servicio = await this.prisma.servicio.findFirst({
      where: { id: dto.servicioId, empresaId: dto.empresaId, isActive: true },
    });
    if (!servicio) throw new NotFoundException('Servicio no encontrado');

    // Validar técnico: acepta UsuarioSedeRol.TECNICO_SERVICIO o EmpresaUsuarioRol.TECNICO
    const tecnicoSede = await this.prisma.usuarioSedeRol.findFirst({
      where: {
        usuarioId: dto.tecnicoId,
        sedeId: dto.sedeId,
        rol: 'TECNICO_SERVICIO',
        isActive: true,
      },
    });
    if (!tecnicoSede) {
      // Fallback: verificar si tiene rol TECNICO a nivel empresa
      const tecnicoEmpresa = await this.prisma.empresaUsuarioRol.findFirst({
        where: {
          usuarioId: dto.tecnicoId,
          empresaId: dto.empresaId,
          rol: 'TECNICO',
          isActive: true,
        },
      });
      if (!tecnicoEmpresa) {
        throw new BadRequestException('El técnico no tiene rol de técnico en esta empresa');
      }
    }

    // Validar solapamiento
    await this.validarSolapamiento(
      dto.empresaId,
      dto.tecnicoId,
      dto.fecha,
      dto.horaInicio,
      dto.horaFin,
    );

    // Validar antigüedad mínima
    if (servicio.antigenciaMinimaHoras) {
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

    // Generar código
    const codigo = await this.configuracionCodigosService.generarCodigoCita(
      dto.empresaId,
    );

    return this.prisma.cita.create({
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
        notas: dto.notas,
        creadoPor: dto.creadoPor,
      },
      include: CITA_BASE_INCLUDE,
    });
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

    const tecnicoId = dto.tecnicoId ?? cita.tecnicoId;
    const fecha = dto.fecha ?? cita.fecha.toISOString().split('T')[0];
    const horaInicio = dto.horaInicio ?? cita.horaInicio;
    const horaFin = dto.horaFin ?? cita.horaFin;

    // Si cambia técnico, fecha u hora, revalidar solapamiento
    if (dto.tecnicoId || dto.fecha || dto.horaInicio || dto.horaFin) {
      await this.validarSolapamiento(
        empresaId,
        tecnicoId,
        fecha,
        horaInicio,
        horaFin,
        id, // excluir la propia cita
      );
    }

    // Si cambia técnico, validar que pertenece a la empresa
    if (dto.tecnicoId) {
      const tecnicoSede = await this.prisma.usuarioSedeRol.findFirst({
        where: {
          usuarioId: dto.tecnicoId,
          sedeId: cita.sedeId,
          rol: 'TECNICO_SERVICIO',
          isActive: true,
        },
      });
      if (!tecnicoSede) {
        const tecnicoEmpresa = await this.prisma.empresaUsuarioRol.findFirst({
          where: {
            usuarioId: dto.tecnicoId,
            empresaId,
            rol: 'TECNICO',
            isActive: true,
          },
        });
        if (!tecnicoEmpresa) {
          throw new BadRequestException('El técnico no tiene rol de técnico en esta empresa');
        }
      }
    }

    return this.prisma.cita.update({
      where: { id },
      data: {
        ...(dto.servicioId && { servicioId: dto.servicioId }),
        ...(dto.tecnicoId && { tecnicoId: dto.tecnicoId }),
        ...(dto.clienteId !== undefined && { clienteId: dto.clienteId }),
        ...(dto.clienteEmpresaId !== undefined && { clienteEmpresaId: dto.clienteEmpresaId }),
        ...(dto.fecha && { fecha: new Date(dto.fecha) }),
        ...(dto.horaInicio && { horaInicio: dto.horaInicio }),
        ...(dto.horaFin && { horaFin: dto.horaFin }),
        ...(dto.notas !== undefined && { notas: dto.notas }),
      },
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

    return {
      ...citaActualizada,
      ...(ordenServicioCreada && {
        ordenServicioGenerada: {
          id: ordenServicioCreada.id,
          codigo: ordenServicioCreada.codigo,
        },
      }),
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

    let cursor = this.horaToMinutos(horaInicioSede);
    const finSede = this.horaToMinutos(horaFinSede);

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
      if (disponible && antigenciaMinHoras) {
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

  private horaToMinutos(hora: string): number {
    const [h, m] = hora.split(':').map(Number);
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
}
