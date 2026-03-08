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
import { EstadoOrdenServicio, EstadoDiagnostico, EstadoComponente } from '@prisma/client';
import { CreateOrdenServicioDto } from './dto/create-orden-servicio.dto';
import { UpdateOrdenServicioDto } from './dto/update-orden-servicio.dto';
import { TransitionEstadoDto } from './dto/transition-estado.dto';
import { QueryOrdenServicioDto } from './dto/query-orden-servicio.dto';
import { createCursorPaginatedResponse } from '../common/utils/pagination.util';

const VALID_TRANSITIONS: Record<EstadoOrdenServicio, EstadoOrdenServicio[]> = {
  RECIBIDO: [EstadoOrdenServicio.EN_DIAGNOSTICO, EstadoOrdenServicio.CANCELADO, EstadoOrdenServicio.TERCERIZADO],
  EN_DIAGNOSTICO: [
    EstadoOrdenServicio.ESPERANDO_APROBACION,
    EstadoOrdenServicio.EN_REPARACION,
    EstadoOrdenServicio.CANCELADO,
    EstadoOrdenServicio.TERCERIZADO,
  ],
  ESPERANDO_APROBACION: [
    EstadoOrdenServicio.EN_REPARACION,
    EstadoOrdenServicio.CANCELADO,
    EstadoOrdenServicio.TERCERIZADO,
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
  LISTO_ENTREGA: [EstadoOrdenServicio.ENTREGADO],
  ENTREGADO: [EstadoOrdenServicio.FINALIZADO, EstadoOrdenServicio.EN_DIAGNOSTICO],
  CANCELADO: [],
  FINALIZADO: [EstadoOrdenServicio.EN_DIAGNOSTICO],
  TERCERIZADO: [EstadoOrdenServicio.REPARADO, EstadoOrdenServicio.RECIBIDO],
};

@Injectable()
export class OrdenServicioService {
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
    @Inject(forwardRef(() => AvisoMantenimientoService))
    private avisoMantenimientoService: AvisoMantenimientoService,
  ) {}

  async create(dto: CreateOrdenServicioDto) {
    // Validar que el cliente existe y pertenece a la empresa
    const cliente = await this.prisma.empresaPersona.findFirst({
      where: {
        id: dto.clienteId,
        empresaId: dto.empresaId,
      },
    });

    if (!cliente) {
      throw new BadRequestException(
        'El cliente no existe o no pertenece a esta empresa',
      );
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

    return this.prisma.ordenServicio.create({
      data: {
        empresaId,
        ...restDto,
        codigo,
        estado: EstadoOrdenServicio.RECIBIDO,
        fechaAvisoPersonalizado: fechaAvisoPersonalizado
          ? new Date(fechaAvisoPersonalizado)
          : undefined,
      },
      include: {
        cliente: { include: { persona: true } },
        tecnico: { include: { persona: true } },
        modeloEquipo: true,
        servicio: true,
        componentes: {
          include: { componente: { include: { tipoComponente: true } } },
        },
      },
    });
  }

  async transitionEstado(
    empresaId: string,
    id: string,
    dto: TransitionEstadoDto,
    usuarioId?: string,
  ) {
    const orden = await this.findOne(empresaId, id);

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
      // Limpiar estadoDiagnostico cuando se sale de fase de diagnóstico
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
      updateData.cantidadReingresos = { increment: 1 };
      updateData.motivoReingreso = dto.motivoReingreso || dto.notas;
      updateData.estadoDiagnostico = EstadoDiagnostico.PENDIENTE;
      updateData.fechaEntrega = null;
    }

    // Usar transacción interactiva para garantizar atomicidad completa
    // (incluye validación de reingresos, update de orden, historial y sync de componentes)
    const updatedOrden = await this.prisma.$transaction(async (tx) => {
      // Re-leer la orden dentro de la transacción para evitar race condition en reingresos
      if (isReingreso) {
        const freshOrden = await tx.ordenServicio.findUnique({ where: { id } });
        if (freshOrden && freshOrden.cantidadReingresos >= 5) {
          throw new BadRequestException(
            'Se excedió el máximo de reingresos (5) para esta orden',
          );
        }
      }

      const [result] = await Promise.all([
        tx.ordenServicio.update({
          where: { id },
          data: updateData,
          include: {
            cliente: { include: { persona: true } },
            tecnico: { include: { persona: true } },
            modeloEquipo: true,
            servicio: true,
            componentes: {
              include: { componente: { include: { tipoComponente: true } } },
            },
          },
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

    // Generar aviso de mantenimiento al completar la orden
    if (
      (dto.nuevoEstado === EstadoOrdenServicio.ENTREGADO ||
        dto.nuevoEstado === EstadoOrdenServicio.FINALIZADO) &&
      updatedOrden.incluirAvisoMantenimiento
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
    if (query.tecnicoId) where.tecnicoId = query.tecnicoId;

    if (query.fechaDesde && query.fechaHasta) {
      if (new Date(query.fechaDesde) > new Date(query.fechaHasta)) {
        throw new BadRequestException('fechaDesde debe ser anterior a fechaHasta');
      }
    }

    if (query.fechaDesde || query.fechaHasta) {
      where.creadoEn = {};
      if (query.fechaDesde) where.creadoEn.gte = new Date(query.fechaDesde);
      if (query.fechaHasta) where.creadoEn.lte = new Date(query.fechaHasta);
    }

    const findArgs: any = {
      where,
      orderBy: { creadoEn: 'desc' },
      take: limit,
      include: {
        cliente: { include: { persona: true } },
        tecnico: { include: { persona: true } },
        modeloEquipo: true,
        servicio: true,
      },
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
      include: {
        cliente: { include: { persona: true } },
        tecnico: { include: { persona: true } },
        modeloEquipo: true,
        servicio: true,
        componentes: {
          include: { componente: { include: { tipoComponente: true } } },
        },
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
      },
    });

    if (!orden) {
      throw new NotFoundException('Orden de servicio no encontrada');
    }

    return orden;
  }

  async update(empresaId: string, id: string, dto: UpdateOrdenServicioDto) {
    const existing = await this.findOne(empresaId, id);

    return this.prisma.ordenServicio.update({
      where: { id: existing.id },
      data: dto,
      include: {
        cliente: { include: { persona: true } },
        tecnico: { include: { persona: true } },
        modeloEquipo: true,
        servicio: true,
        componentes: {
          include: { componente: { include: { tipoComponente: true } } },
        },
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
      },
    });
  }

  async assignTecnico(empresaId: string, id: string, tecnicoId: string) {
    await this.findOne(empresaId, id);

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
      include: {
        cliente: { include: { persona: true } },
        tecnico: { include: { persona: true } },
        modeloEquipo: true,
        servicio: true,
      },
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
}
