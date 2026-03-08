import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { EstadoOrdenServicio, EstadoTercerizacion, OrigenOrden } from '@prisma/client';
import { CreateTercerizacionDto } from './dto/create-tercerizacion.dto';
import { RespondTercerizacionDto } from './dto/respond-tercerizacion.dto';
import { CompleteTercerizacionDto } from './dto/complete-tercerizacion.dto';
import { QueryTercerizacionDto } from './dto/query-tercerizacion.dto';
import { QueryDirectorioDto } from './dto/query-directorio.dto';

@Injectable()
export class TercerizacionService {
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
  ) {}

  // ─── Directorio: buscar empresas que aceptan tercerización ───

  async buscarEmpresas(empresaId: string, dto: QueryDirectorioDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      aceptaTercerizacion: true,
      isActive: true,
      deletedAt: null,
      id: { not: empresaId }, // Excluir empresa propia
      estadoSuscripcion: 'ACTIVA',
    };

    if (dto.search) {
      where.OR = [
        { nombre: { contains: dto.search, mode: 'insensitive' } },
        { razonSocial: { contains: dto.search, mode: 'insensitive' } },
      ];
    }

    if (dto.tipoServicio) {
      where.tiposServicioTercerizacion = {
        array_contains: [dto.tipoServicio],
      };
    }

    // Filtros de ubicación por sede principal
    const sedeWhere: any = { esPrincipal: true, isActive: true };
    if (dto.departamento) sedeWhere.departamento = { contains: dto.departamento, mode: 'insensitive' };
    if (dto.distrito) sedeWhere.distrito = { contains: dto.distrito, mode: 'insensitive' };

    if (dto.departamento || dto.distrito) {
      where.sedes = { some: sedeWhere };
    }

    const [empresas, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          nombre: true,
          logo: true,
          rubro: true,
          telefono: true,
          email: true,
          descripcion: true,
          descripcionTercerizacion: true,
          tiposServicioTercerizacion: true,
          departamento: true,
          provincia: true,
          distrito: true,
          direccionFiscal: true,
          sedes: {
            where: { esPrincipal: true, isActive: true },
            select: {
              id: true,
              nombre: true,
              direccion: true,
              distrito: true,
              provincia: true,
              departamento: true,
              coordenadas: true,
              telefono: true,
              horarioAtencion: true,
            },
            take: 1,
          },
          servicios: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true,
              nombre: true,
              precio: true,
            },
            take: 10,
          },
        },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.empresa.count({ where }),
    ]);

    return {
      data: empresas.map((e) => ({
        ...e,
        sedePrincipal: e.sedes[0] || null,
        sedes: undefined,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Crear solicitud de tercerización ───

  async crear(dto: CreateTercerizacionDto) {
    const { empresaOrigenId, empresaDestinoId, ordenOrigenId, notasOrigen, descripcionProblema: dtoDescripcion, sintomas: dtoSintomas } = dto;

    // Validar que no se terceriza a sí mismo
    if (empresaOrigenId === empresaDestinoId) {
      throw new BadRequestException('No puedes tercerizar a tu propia empresa');
    }

    // Validar que la empresa destino acepta tercerización
    const empresaDestino = await this.prisma.empresa.findFirst({
      where: {
        id: empresaDestinoId,
        aceptaTercerizacion: true,
        isActive: true,
      },
    });
    if (!empresaDestino) {
      throw new BadRequestException('La empresa destino no acepta tercerización o no existe');
    }

    // Validar que la orden existe y pertenece a la empresa origen
    const orden = await this.prisma.ordenServicio.findFirst({
      where: {
        id: ordenOrigenId,
        empresaId: empresaOrigenId,
      },
      include: {
        componentes: {
          include: {
            componente: {
              include: { tipoComponente: true },
            },
          },
        },
      },
    });

    if (!orden) {
      throw new NotFoundException('Orden de servicio no encontrada');
    }

    // Validar que la orden no está ya tercerizada
    const tercerizacionExistente = await this.prisma.tercerizacionServicio.findUnique({
      where: { ordenOrigenId },
    });
    if (tercerizacionExistente) {
      throw new BadRequestException('Esta orden ya tiene una solicitud de tercerización');
    }

    // Validar estado válido para tercerizar
    const estadosValidos: EstadoOrdenServicio[] = [
      EstadoOrdenServicio.RECIBIDO,
      EstadoOrdenServicio.EN_DIAGNOSTICO,
      EstadoOrdenServicio.ESPERANDO_APROBACION,
    ];
    if (!estadosValidos.includes(orden.estado)) {
      throw new BadRequestException(
        `No se puede tercerizar una orden en estado ${orden.estado}`,
      );
    }

    // Preparar snapshot de datos del equipo (solo lo necesario, sin datos del cliente)
    const datosEquipo = {
      tipoEquipo: orden.tipoEquipo,
      marcaEquipo: orden.marcaEquipo,
      numeroSerie: orden.numeroSerie,
      condicionEquipo: orden.condicionEquipo,
      accesorios: orden.accesorios,
      tipoServicio: orden.tipoServicio,
      prioridad: orden.prioridad,
    };

    // Snapshot de componentes
    const componentesData = orden.componentes.map((sc) => ({
      tipoAccion: sc.tipoAccion,
      descripcionAccion: sc.descripcionAccion,
      observaciones: sc.observaciones,
      componente: {
        nombre: (sc.componente as any).tipoComponente?.nombre ?? sc.componente.codigo,
        codigo: sc.componente.codigo,
        marca: sc.componente.marca,
        modelo: sc.componente.modelo,
        numeroSerie: sc.componente.numeroSerie,
        especificaciones: sc.componente.especificaciones,
      },
    }));

    // Crear tercerización y actualizar orden en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      const tercerizacion = await tx.tercerizacionServicio.create({
        data: {
          empresaOrigenId,
          empresaDestinoId,
          ordenOrigenId,
          datosEquipo,
          descripcionProblema: dtoDescripcion || orden.descripcionProblema,
          sintomas: dtoSintomas || orden.sintomas,
          componentesData: componentesData.length > 0 ? componentesData : undefined,
          notasOrigen,
        },
      });

      // Marcar orden como tercerizada
      await tx.ordenServicio.update({
        where: { id: ordenOrigenId },
        data: {
          estado: EstadoOrdenServicio.TERCERIZADO,
          origenOrden: OrigenOrden.B2B_ENVIADO,
        },
      });

      // Registrar en historial
      await tx.historialOrdenServicio.create({
        data: {
          ordenServicioId: ordenOrigenId,
          estadoAnterior: orden.estado,
          estadoNuevo: EstadoOrdenServicio.TERCERIZADO,
          notas: `Tercerizado a empresa: ${empresaDestino.nombre}`,
        },
      });

      return tercerizacion;
    });

    return result;
  }

  // ─── Responder solicitud (aceptar/rechazar) ───

  async responder(
    tercerizacionId: string,
    empresaId: string,
    dto: RespondTercerizacionDto,
  ) {
    const tercerizacion = await this.prisma.tercerizacionServicio.findUnique({
      where: { id: tercerizacionId },
      include: {
        ordenOrigen: {
          include: {
            componentes: { include: { componente: true } },
          },
        },
        empresaOrigen: { select: { id: true, nombre: true, ruc: true, telefono: true, email: true } },
      },
    });

    if (!tercerizacion) {
      throw new NotFoundException('Solicitud de tercerización no encontrada');
    }

    if (tercerizacion.empresaDestinoId !== empresaId) {
      throw new ForbiddenException('No tienes permiso para responder esta solicitud');
    }

    if (tercerizacion.estado !== EstadoTercerizacion.PENDIENTE) {
      throw new BadRequestException('Esta solicitud ya fue respondida');
    }

    if (!dto.aceptar) {
      // Rechazar
      if (!dto.motivoRechazo) {
        throw new BadRequestException('El motivo de rechazo es requerido');
      }

      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.tercerizacionServicio.update({
          where: { id: tercerizacionId },
          data: {
            estado: EstadoTercerizacion.RECHAZADO,
            motivoRechazo: dto.motivoRechazo,
            notasDestino: dto.notasDestino,
            fechaRespuesta: new Date(),
          },
        });

        // Devolver orden origen a su estado anterior (RECIBIDO)
        await tx.ordenServicio.update({
          where: { id: tercerizacion.ordenOrigenId },
          data: {
            estado: EstadoOrdenServicio.RECIBIDO,
            origenOrden: OrigenOrden.CLIENTE_FINAL,
          },
        });

        await tx.historialOrdenServicio.create({
          data: {
            ordenServicioId: tercerizacion.ordenOrigenId,
            estadoAnterior: EstadoOrdenServicio.TERCERIZADO,
            estadoNuevo: EstadoOrdenServicio.RECIBIDO,
            notas: `Tercerización rechazada: ${dto.motivoRechazo}`,
          },
        });

        return updated;
      });
    }

    // Aceptar: crear orden en empresa destino
    return this.prisma.$transaction(async (tx) => {
      // Buscar o crear la empresa origen como Persona + EmpresaPersona (cliente B2B)
      // Usamos el RUC como identificador único para empresas
      const rucOrigen = tercerizacion.empresaOrigen.ruc;
      let persona = rucOrigen
        ? await tx.persona.findFirst({ where: { dni: rucOrigen } })
        : null;

      if (!persona) {
        persona = await tx.persona.create({
          data: {
            nombres: tercerizacion.empresaOrigen.nombre,
            apellidos: 'B2B',
            dni: rucOrigen,
            telefono: tercerizacion.empresaOrigen.telefono,
            email: tercerizacion.empresaOrigen.email,
            esCliente: true,
            observaciones: `Empresa B2B - ${tercerizacion.empresaOrigen.nombre}`,
          },
        });
      }

      let clienteB2B = await tx.empresaPersona.findFirst({
        where: {
          empresaId,
          personaId: persona.id,
        },
      });

      if (!clienteB2B) {
        clienteB2B = await tx.empresaPersona.create({
          data: {
            empresaId,
            personaId: persona.id,
            rol: 'CLIENTE',
          },
        });
      }

      // Generar código de orden para empresa destino
      const codigo = await this.configuracionCodigosService.generarCodigoOrdenServicio(
        empresaId,
      );

      const datosEquipo = tercerizacion.datosEquipo as any;

      // Crear orden en empresa destino
      const ordenDestino = await tx.ordenServicio.create({
        data: {
          empresaId,
          clienteId: clienteB2B.id,
          codigo,
          tipoServicio: datosEquipo.tipoServicio || 'REPARACION',
          prioridad: datosEquipo.prioridad || 'NORMAL',
          tipoEquipo: datosEquipo.tipoEquipo,
          marcaEquipo: datosEquipo.marcaEquipo,
          numeroSerie: datosEquipo.numeroSerie,
          condicionEquipo: datosEquipo.condicionEquipo,
          accesorios: datosEquipo.accesorios,
          descripcionProblema: tercerizacion.descripcionProblema,
          sintomas: tercerizacion.sintomas,
          estado: EstadoOrdenServicio.RECIBIDO,
          origenOrden: OrigenOrden.B2B_RECIBIDO,
          notas: `Servicio tercerizado por: ${tercerizacion.empresaOrigen.nombre}`,
        },
      });

      // Actualizar tercerización
      const updated = await tx.tercerizacionServicio.update({
        where: { id: tercerizacionId },
        data: {
          estado: EstadoTercerizacion.ACEPTADO,
          ordenDestinoId: ordenDestino.id,
          notasDestino: dto.notasDestino,
          fechaRespuesta: new Date(),
        },
      });

      return updated;
    });
  }

  // ─── Completar tercerización (empresa destino) ───

  async completar(
    tercerizacionId: string,
    empresaId: string,
    dto: CompleteTercerizacionDto,
  ) {
    const tercerizacion = await this.prisma.tercerizacionServicio.findUnique({
      where: { id: tercerizacionId },
    });

    if (!tercerizacion) {
      throw new NotFoundException('Tercerización no encontrada');
    }

    if (tercerizacion.empresaDestinoId !== empresaId) {
      throw new ForbiddenException('No tienes permiso para completar esta tercerización');
    }

    if (
      tercerizacion.estado !== EstadoTercerizacion.ACEPTADO &&
      tercerizacion.estado !== EstadoTercerizacion.EN_PROCESO
    ) {
      throw new BadRequestException(
        `No se puede completar una tercerización en estado ${tercerizacion.estado}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Actualizar tercerización
      const updated = await tx.tercerizacionServicio.update({
        where: { id: tercerizacionId },
        data: {
          estado: EstadoTercerizacion.COMPLETADO,
          precioB2B: dto.precioB2B,
          metodoPagoB2B: dto.metodoPagoB2B,
          notasDestino: dto.notasDestino,
          fechaCompletado: new Date(),
        },
      });

      // Actualizar orden origen: vuelve a REPARADO para que la empresa origen continúe
      await tx.ordenServicio.update({
        where: { id: tercerizacion.ordenOrigenId },
        data: { estado: EstadoOrdenServicio.REPARADO },
      });

      await tx.historialOrdenServicio.create({
        data: {
          ordenServicioId: tercerizacion.ordenOrigenId,
          estadoAnterior: EstadoOrdenServicio.TERCERIZADO,
          estadoNuevo: EstadoOrdenServicio.REPARADO,
          notas: `Tercerización completada. Precio B2B: ${dto.precioB2B}`,
        },
      });

      // Marcar orden destino como finalizada
      if (tercerizacion.ordenDestinoId) {
        await tx.ordenServicio.update({
          where: { id: tercerizacion.ordenDestinoId },
          data: { estado: EstadoOrdenServicio.FINALIZADO },
        });
      }

      return updated;
    });
  }

  // ─── Cancelar tercerización (empresa origen) ───

  async cancelar(tercerizacionId: string, empresaId: string) {
    const tercerizacion = await this.prisma.tercerizacionServicio.findUnique({
      where: { id: tercerizacionId },
    });

    if (!tercerizacion) {
      throw new NotFoundException('Tercerización no encontrada');
    }

    if (tercerizacion.empresaOrigenId !== empresaId) {
      throw new ForbiddenException('Solo la empresa origen puede cancelar');
    }

    if (
      tercerizacion.estado === EstadoTercerizacion.COMPLETADO ||
      tercerizacion.estado === EstadoTercerizacion.CANCELADO
    ) {
      throw new BadRequestException('No se puede cancelar en este estado');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.tercerizacionServicio.update({
        where: { id: tercerizacionId },
        data: { estado: EstadoTercerizacion.CANCELADO },
      });

      // Devolver orden origen a RECIBIDO
      await tx.ordenServicio.update({
        where: { id: tercerizacion.ordenOrigenId },
        data: {
          estado: EstadoOrdenServicio.RECIBIDO,
          origenOrden: OrigenOrden.CLIENTE_FINAL,
        },
      });

      await tx.historialOrdenServicio.create({
        data: {
          ordenServicioId: tercerizacion.ordenOrigenId,
          estadoAnterior: EstadoOrdenServicio.TERCERIZADO,
          estadoNuevo: EstadoOrdenServicio.RECIBIDO,
          notas: 'Tercerización cancelada por la empresa origen',
        },
      });

      // Cancelar orden destino si existe
      if (tercerizacion.ordenDestinoId) {
        await tx.ordenServicio.update({
          where: { id: tercerizacion.ordenDestinoId },
          data: { estado: EstadoOrdenServicio.CANCELADO },
        });
      }

      return updated;
    });
  }

  // ─── Listar tercerizaciones de una empresa ───

  async listar(empresaId: string, dto: QueryTercerizacionDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (dto.tipo === 'enviadas') {
      where.empresaOrigenId = empresaId;
    } else if (dto.tipo === 'recibidas') {
      where.empresaDestinoId = empresaId;
    } else {
      where.OR = [
        { empresaOrigenId: empresaId },
        { empresaDestinoId: empresaId },
      ];
    }

    if (dto.estado) {
      where.estado = dto.estado;
    }

    const [data, total] = await Promise.all([
      this.prisma.tercerizacionServicio.findMany({
        where,
        skip,
        take: limit,
        orderBy: { creadoEn: 'desc' },
        include: {
          empresaOrigen: {
            select: { id: true, nombre: true, logo: true, telefono: true },
          },
          empresaDestino: {
            select: { id: true, nombre: true, logo: true, telefono: true },
          },
          ordenOrigen: {
            select: {
              id: true,
              codigo: true,
              tipoEquipo: true,
              marcaEquipo: true,
              estado: true,
              tipoServicio: true,
            },
          },
          ordenDestino: {
            select: {
              id: true,
              codigo: true,
              estado: true,
            },
          },
        },
      }),
      this.prisma.tercerizacionServicio.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ─── Obtener detalle de una tercerización ───

  async getById(id: string, empresaId: string) {
    const tercerizacion = await this.prisma.tercerizacionServicio.findUnique({
      where: { id },
      include: {
        empresaOrigen: {
          select: {
            id: true, nombre: true, logo: true, rubro: true,
            telefono: true, email: true, direccionFiscal: true,
            departamento: true, provincia: true, distrito: true,
          },
        },
        empresaDestino: {
          select: {
            id: true, nombre: true, logo: true, rubro: true,
            telefono: true, email: true, direccionFiscal: true,
            departamento: true, provincia: true, distrito: true,
          },
        },
        ordenOrigen: {
          select: {
            id: true, codigo: true, tipoEquipo: true, marcaEquipo: true,
            numeroSerie: true, estado: true, tipoServicio: true,
            prioridad: true, descripcionProblema: true,
          },
        },
        ordenDestino: {
          select: {
            id: true, codigo: true, estado: true, costoTotal: true,
          },
        },
      },
    });

    if (!tercerizacion) {
      throw new NotFoundException('Tercerización no encontrada');
    }

    // Verificar que la empresa participa
    if (
      tercerizacion.empresaOrigenId !== empresaId &&
      tercerizacion.empresaDestinoId !== empresaId
    ) {
      throw new ForbiddenException('No tienes acceso a esta tercerización');
    }

    return tercerizacion;
  }

  // ─── Solicitudes pendientes para empresa destino ───

  async getPendientes(empresaId: string) {
    return this.prisma.tercerizacionServicio.findMany({
      where: {
        empresaDestinoId: empresaId,
        estado: EstadoTercerizacion.PENDIENTE,
      },
      include: {
        empresaOrigen: {
          select: { id: true, nombre: true, logo: true, telefono: true },
        },
        ordenOrigen: {
          select: {
            id: true, codigo: true, tipoEquipo: true, marcaEquipo: true,
            tipoServicio: true, prioridad: true, descripcionProblema: true,
          },
        },
      },
      orderBy: { fechaSolicitud: 'asc' },
    });
  }
}
