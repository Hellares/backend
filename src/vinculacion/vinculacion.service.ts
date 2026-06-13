import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { EstadoVinculacion, TipoNotificacion } from '@prisma/client';
import { CreateVinculacionDto } from './dto/create-vinculacion.dto';
import { RespondVinculacionDto } from './dto/respond-vinculacion.dto';
import { QueryVinculacionDto } from './dto/query-vinculacion.dto';

@Injectable()
export class VinculacionService {
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
    private notificacionService: NotificacionService,
  ) {}

  /** Notifica a los admins de una empresa (push + in-app). No rompe el flujo si falla. */
  private async notificarAdminsEmpresa(
    empresaId: string,
    titulo: string,
    cuerpo: string,
    data: Record<string, string>,
  ) {
    try {
      const admins = await this.prisma.empresaUsuarioRol.findMany({
        where: {
          empresaId,
          estado: 'ACTIVO',
          rol: { in: ['EMPRESA_ADMIN', 'SUPER_ADMIN'] },
        },
        select: { usuarioId: true },
      });
      const ids = [...new Set(admins.map((a) => a.usuarioId))];
      if (ids.length === 0) return;
      await this.notificacionService.enviarAUsuarios(ids, titulo, cuerpo, {
        tipo: TipoNotificacion.SISTEMA,
        data,
        empresaId,
      });
    } catch {
      /* no romper el flujo de vinculación si falla la notificación */
    }
  }

  // ─── Check RUC: verificar si existe una Empresa tenant con ese RUC ───

  async checkRuc(ruc: string, empresaId: string) {
    // Buscar empresa tenant con ese RUC
    const empresa = await this.prisma.empresa.findFirst({
      where: {
        ruc,
        id: { not: empresaId },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, nombre: true, logo: true, rubro: true },
    });

    if (!empresa) return null;

    // Buscar si ya existe un ClienteEmpresa con ese RUC en la empresa solicitante
    const clienteEmpresa = await this.prisma.clienteEmpresa.findFirst({
      where: {
        empresaId,
        numeroDocumento: ruc,
        deletedAt: null,
      },
      select: { id: true, razonSocial: true, empresaVinculadaId: true },
    });

    // Verificar si ya hay vinculación activa
    const vinculacionExistente = clienteEmpresa ? await this.prisma.vinculacionEmpresa.findFirst({
      where: {
        empresaSolicitanteId: empresaId,
        empresaVinculadaId: empresa.id,
        estado: { in: [EstadoVinculacion.PENDIENTE, EstadoVinculacion.ACEPTADA] },
      },
      select: { id: true, estado: true },
    }) : null;

    return {
      ...empresa,
      clienteEmpresaId: clienteEmpresa?.id ?? null,
      clienteEmpresaRazonSocial: clienteEmpresa?.razonSocial ?? null,
      yaVinculada: clienteEmpresa?.empresaVinculadaId != null,
      vinculacionExistente: vinculacionExistente ?? null,
    };
  }

  // ─── Crear solicitud de vinculación ───

  async crear(dto: CreateVinculacionDto) {
    const { empresaSolicitanteId, mensaje } = dto;
    let { clienteEmpresaId } = dto;

    if (!clienteEmpresaId && !dto.ruc) {
      throw new BadRequestException('Se requiere clienteEmpresaId o ruc');
    }

    let clienteEmpresa: any;
    let empresaVinculada: any;

    if (clienteEmpresaId) {
      // Caso 1: ya tiene clienteEmpresaId
      clienteEmpresa = await this.prisma.clienteEmpresa.findFirst({
        where: { id: clienteEmpresaId, empresaId: empresaSolicitanteId, deletedAt: null },
      });
      if (!clienteEmpresa) {
        throw new NotFoundException('Cliente empresa no encontrado');
      }

      empresaVinculada = await this.prisma.empresa.findFirst({
        where: { ruc: clienteEmpresa.numeroDocumento, id: { not: empresaSolicitanteId }, isActive: true, deletedAt: null },
      });
    } else {
      // Caso 2: viene por RUC → buscar empresa tenant y auto-crear ClienteEmpresa si no existe
      empresaVinculada = await this.prisma.empresa.findFirst({
        where: { ruc: dto.ruc, id: { not: empresaSolicitanteId }, isActive: true, deletedAt: null },
        select: {
          id: true, nombre: true, logo: true, rubro: true,
          ruc: true, razonSocial: true,
          email: true, telefono: true, direccionFiscal: true,
          departamento: true, provincia: true, distrito: true,
          estadoContribuyente: true, condicionContribuyente: true, ubigeo: true,
        },
      });

      if (!empresaVinculada) {
        throw new BadRequestException('No se encontró una empresa registrada con ese RUC');
      }

      // Buscar ClienteEmpresa existente con ese RUC
      clienteEmpresa = await this.prisma.clienteEmpresa.findFirst({
        where: { empresaId: empresaSolicitanteId, numeroDocumento: dto.ruc, deletedAt: null },
      });

      // Si no existe, crear automáticamente
      if (!clienteEmpresa) {
        const { codigoClienteEmpresa: codigo } =
          await this.configuracionCodigosService.generarCodigoClienteEmpresa(empresaSolicitanteId);

        clienteEmpresa = await this.prisma.clienteEmpresa.create({
          data: {
            empresaId: empresaSolicitanteId,
            codigo,
            razonSocial: empresaVinculada.razonSocial || empresaVinculada.nombre,
            tipoDocumento: 'RUC',
            numeroDocumento: dto.ruc,
            email: empresaVinculada.email,
            telefono: empresaVinculada.telefono,
            direccion: empresaVinculada.direccionFiscal,
            departamento: empresaVinculada.departamento,
            provincia: empresaVinculada.provincia,
            distrito: empresaVinculada.distrito,
            estadoContribuyente: empresaVinculada.estadoContribuyente,
            condicionContribuyente: empresaVinculada.condicionContribuyente,
            ubigeo: empresaVinculada.ubigeo,
            creadoPor: 'vinculacion-auto',
          },
        });
      }

      clienteEmpresaId = clienteEmpresa.id;
    }

    if (!empresaVinculada) {
      throw new BadRequestException(
        'No se encontró una empresa registrada con el RUC de este cliente',
      );
    }

    // Validar que no haya vinculación activa (PENDIENTE o ACEPTADA)
    const vinculacionExistente = await this.prisma.vinculacionEmpresa.findFirst({
      where: {
        empresaSolicitanteId,
        empresaVinculadaId: empresaVinculada.id,
        estado: { in: [EstadoVinculacion.PENDIENTE, EstadoVinculacion.ACEPTADA] },
      },
    });

    if (vinculacionExistente) {
      throw new ConflictException(
        vinculacionExistente.estado === EstadoVinculacion.PENDIENTE
          ? 'Ya existe una solicitud pendiente para esta empresa'
          : 'Ya existe una vinculación activa con esta empresa',
      );
    }

    const creada = await this.prisma.vinculacionEmpresa.create({
      data: {
        empresaSolicitanteId,
        empresaVinculadaId: empresaVinculada.id,
        clienteEmpresaId,
        mensaje,
      },
      include: {
        empresaSolicitante: {
          select: { id: true, nombre: true, logo: true, rubro: true },
        },
        empresaVinculada: {
          select: { id: true, nombre: true, logo: true, rubro: true },
        },
      },
    });

    // Avisar a los admins de la empresa destino que recibieron una solicitud.
    const solicitanteNombre = creada.empresaSolicitante?.nombre ?? 'Una empresa';
    await this.notificarAdminsEmpresa(
      empresaVinculada.id,
      'Nueva solicitud de vinculación B2B',
      `${solicitanteNombre} quiere vincularse contigo para tercerización.`,
      { action: 'VINCULACION_RECIBIDA', vinculacionId: creada.id, route: '/empresa/vinculacion' },
    );

    return creada;
  }

  // ─── Responder solicitud (aceptar/rechazar) ───

  async responder(
    vinculacionId: string,
    empresaId: string,
    dto: RespondVinculacionDto,
  ) {
    const vinculacion = await this.prisma.vinculacionEmpresa.findUnique({
      where: { id: vinculacionId },
      include: { empresaVinculada: { select: { nombre: true } } },
    });

    if (!vinculacion) {
      throw new NotFoundException('Solicitud de vinculación no encontrada');
    }

    if (vinculacion.empresaVinculadaId !== empresaId) {
      throw new ForbiddenException('No tienes permiso para responder esta solicitud');
    }

    if (vinculacion.estado !== EstadoVinculacion.PENDIENTE) {
      throw new BadRequestException('Esta solicitud ya fue respondida');
    }

    const vinculadaNombre = vinculacion.empresaVinculada?.nombre ?? 'La empresa';

    if (!dto.aceptar) {
      if (!dto.motivoRechazo) {
        throw new BadRequestException('El motivo de rechazo es requerido');
      }

      const rechazada = await this.prisma.vinculacionEmpresa.update({
        where: { id: vinculacionId },
        data: {
          estado: EstadoVinculacion.RECHAZADA,
          motivoRechazo: dto.motivoRechazo,
          fechaRespuesta: new Date(),
        },
      });

      await this.notificarAdminsEmpresa(
        vinculacion.empresaSolicitanteId,
        'Solicitud de vinculación rechazada',
        `${vinculadaNombre} rechazó tu solicitud: ${dto.motivoRechazo}`,
        { action: 'VINCULACION_RESPONDIDA', vinculacionId, route: '/empresa/vinculacion' },
      );

      return rechazada;
    }

    // Aceptar: actualizar vinculación y setear empresaVinculadaId en ClienteEmpresa
    const aceptada = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.vinculacionEmpresa.update({
        where: { id: vinculacionId },
        data: {
          estado: EstadoVinculacion.ACEPTADA,
          fechaRespuesta: new Date(),
        },
      });

      await tx.clienteEmpresa.update({
        where: { id: vinculacion.clienteEmpresaId },
        data: { empresaVinculadaId: vinculacion.empresaVinculadaId },
      });

      return updated;
    });

    await this.notificarAdminsEmpresa(
      vinculacion.empresaSolicitanteId,
      'Solicitud de vinculación aceptada',
      `${vinculadaNombre} aceptó tu solicitud de vinculación B2B.`,
      { action: 'VINCULACION_RESPONDIDA', vinculacionId, route: '/empresa/vinculacion' },
    );

    return aceptada;
  }

  // ─── Cancelar solicitud (solo solicitante, solo PENDIENTE) ───

  async cancelar(vinculacionId: string, empresaId: string) {
    const vinculacion = await this.prisma.vinculacionEmpresa.findUnique({
      where: { id: vinculacionId },
    });

    if (!vinculacion) {
      throw new NotFoundException('Solicitud de vinculación no encontrada');
    }

    if (vinculacion.empresaSolicitanteId !== empresaId) {
      throw new ForbiddenException('Solo la empresa solicitante puede cancelar');
    }

    if (vinculacion.estado !== EstadoVinculacion.PENDIENTE) {
      throw new BadRequestException('Solo se pueden cancelar solicitudes pendientes');
    }

    return this.prisma.vinculacionEmpresa.update({
      where: { id: vinculacionId },
      data: { estado: EstadoVinculacion.CANCELADA },
    });
  }

  // ─── Desvincular (cualquier parte, solo ACEPTADA) ───

  async desvincular(vinculacionId: string, empresaId: string) {
    const vinculacion = await this.prisma.vinculacionEmpresa.findUnique({
      where: { id: vinculacionId },
    });

    if (!vinculacion) {
      throw new NotFoundException('Vinculación no encontrada');
    }

    if (
      vinculacion.empresaSolicitanteId !== empresaId &&
      vinculacion.empresaVinculadaId !== empresaId
    ) {
      throw new ForbiddenException('No tienes permiso para desvincular');
    }

    if (vinculacion.estado !== EstadoVinculacion.ACEPTADA) {
      throw new BadRequestException('Solo se pueden desvincular vinculaciones aceptadas');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.vinculacionEmpresa.update({
        where: { id: vinculacionId },
        data: { estado: EstadoVinculacion.DESVINCULADA },
      });

      await tx.clienteEmpresa.update({
        where: { id: vinculacion.clienteEmpresaId },
        data: { empresaVinculadaId: null },
      });

      return updated;
    });
  }

  // ─── Listar vinculaciones ───

  async listar(empresaId: string, dto: QueryVinculacionDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (dto.tipo === 'enviadas') {
      where.empresaSolicitanteId = empresaId;
    } else if (dto.tipo === 'recibidas') {
      where.empresaVinculadaId = empresaId;
    } else {
      where.OR = [
        { empresaSolicitanteId: empresaId },
        { empresaVinculadaId: empresaId },
      ];
    }

    if (dto.estado) {
      where.estado = dto.estado;
    }

    const [data, total] = await Promise.all([
      this.prisma.vinculacionEmpresa.findMany({
        where,
        skip,
        take: limit,
        orderBy: { creadoEn: 'desc' },
        include: {
          empresaSolicitante: {
            select: { id: true, nombre: true, logo: true, rubro: true },
          },
          empresaVinculada: {
            select: { id: true, nombre: true, logo: true, rubro: true },
          },
          clienteEmpresa: {
            select: { id: true, razonSocial: true, numeroDocumento: true },
          },
        },
      }),
      this.prisma.vinculacionEmpresa.count({ where }),
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

  // ─── Obtener detalle ───

  async getById(id: string, empresaId: string) {
    const vinculacion = await this.prisma.vinculacionEmpresa.findUnique({
      where: { id },
      include: {
        empresaSolicitante: {
          select: {
            id: true, nombre: true, logo: true, rubro: true,
            telefono: true, email: true, direccionFiscal: true,
          },
        },
        empresaVinculada: {
          select: {
            id: true, nombre: true, logo: true, rubro: true,
            telefono: true, email: true, direccionFiscal: true,
          },
        },
        clienteEmpresa: {
          select: {
            id: true, razonSocial: true, nombreComercial: true,
            numeroDocumento: true, email: true, telefono: true,
          },
        },
      },
    });

    if (!vinculacion) {
      throw new NotFoundException('Vinculación no encontrada');
    }

    if (
      vinculacion.empresaSolicitanteId !== empresaId &&
      vinculacion.empresaVinculadaId !== empresaId
    ) {
      throw new ForbiddenException('No tienes acceso a esta vinculación');
    }

    return vinculacion;
  }

  // ─── Solicitudes pendientes para mi empresa ───

  async getPendientes(empresaId: string) {
    return this.prisma.vinculacionEmpresa.findMany({
      where: {
        empresaVinculadaId: empresaId,
        estado: EstadoVinculacion.PENDIENTE,
      },
      include: {
        empresaSolicitante: {
          select: { id: true, nombre: true, logo: true, rubro: true },
        },
        clienteEmpresa: {
          select: { id: true, razonSocial: true, numeroDocumento: true },
        },
      },
      orderBy: { fechaSolicitud: 'asc' },
    });
  }
}
