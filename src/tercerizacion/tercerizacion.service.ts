import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfiguracionCodigosService } from '../configuracion-codigos/configuracion-codigos.service';
import { NotificacionService } from '../notificacion/notificacion.service';
import { CajaService } from '../caja/caja.service';
import {
  EstadoOrdenServicio,
  EstadoTercerizacion,
  EstadoVinculacion,
  OrigenOrden,
  TipoNotificacion,
  TipoNotaTercerizacion,
  TipoMovimientoCaja,
  CategoriaMovimientoCaja,
  MetodoPagoVenta,
} from '@prisma/client';
import { CreateTercerizacionDto } from './dto/create-tercerizacion.dto';
import { CreateNotaTercerizacionDto } from './dto/create-nota-tercerizacion.dto';
import { RespondTercerizacionDto } from './dto/respond-tercerizacion.dto';
import { CompleteTercerizacionDto } from './dto/complete-tercerizacion.dto';
import { QueryTercerizacionDto } from './dto/query-tercerizacion.dto';
import { QueryDirectorioDto } from './dto/query-directorio.dto';
import { PagarTerceroDto } from './dto/pagar-tercero.dto';

@Injectable()
export class TercerizacionService {
  constructor(
    private prisma: PrismaService,
    private configuracionCodigosService: ConfiguracionCodigosService,
    private notificacionService: NotificacionService,
    private cajaService: CajaService,
  ) {}

  /// Notificaciones fire-and-forget: el fallo no rompe el flujo B2B pero
  /// queda logueado (mismo criterio que orden-servicio.service).
  private static logNotifFallida(contexto: string) {
    return (e: unknown) =>
      console.warn(
        `Notificacion B2B fallida (${contexto}):`,
        e instanceof Error ? e.message : e,
      );
  }

  /// Push a los admins de la empresa contraparte de un evento B2B, con
  /// deep-link al detalle de la tercerización.
  private async notificarAdminsB2B(
    empresaId: string,
    titulo: string,
    cuerpo: string,
    tercerizacionId: string,
    action: string,
  ) {
    const admins = await this.prisma.empresaUsuarioRol.findMany({
      where: {
        empresaId,
        estado: 'ACTIVO',
        rol: { in: ['EMPRESA_ADMIN', 'SUPER_ADMIN'] },
      },
      select: { usuarioId: true },
    });
    const adminIds = [...new Set(admins.map((a) => a.usuarioId))];
    if (adminIds.length === 0) return;

    await this.notificacionService.enviarAUsuarios(adminIds, titulo, cuerpo, {
      tipo: TipoNotificacion.ORDEN_SERVICIO,
      data: { tercerizacionId, action, target: 'staff' },
      empresaId,
    });
  }

  /// Auto-entrada de bitácora en una transición de estado (fire-and-forget:
  /// no rompe el cambio de estado si falla).
  private async registrarNotaEstado(
    tercerizacionId: string,
    empresaAutorId: string,
    contenido: string,
  ) {
    await this.prisma.tercerizacionNota
      .create({
        data: {
          tercerizacionId,
          empresaAutorId,
          tipo: TipoNotaTercerizacion.CAMBIO_ESTADO,
          contenido,
        },
      })
      .catch(TercerizacionService.logNotifFallida('nota cambio de estado'));
  }

  // ─── Bitácora compartida (origen ↔ destino): apuntes/requerimientos/estados ───

  async listarNotas(tercerizacionId: string, empresaId: string) {
    const t = await this.prisma.tercerizacionServicio.findUnique({
      where: { id: tercerizacionId },
      select: { empresaOrigenId: true, empresaDestinoId: true },
    });
    if (!t) throw new NotFoundException('Tercerización no encontrada');
    if (t.empresaOrigenId !== empresaId && t.empresaDestinoId !== empresaId) {
      throw new ForbiddenException('No tienes acceso a esta tercerización');
    }
    return this.prisma.tercerizacionNota.findMany({
      where: { tercerizacionId },
      orderBy: { creadoEn: 'asc' },
    });
  }

  async agregarNota(
    tercerizacionId: string,
    empresaId: string,
    usuarioId: string,
    dto: CreateNotaTercerizacionDto,
  ) {
    const t = await this.prisma.tercerizacionServicio.findUnique({
      where: { id: tercerizacionId },
      select: {
        empresaOrigenId: true,
        empresaDestinoId: true,
        ordenOrigen: { select: { codigo: true } },
      },
    });
    if (!t) throw new NotFoundException('Tercerización no encontrada');
    const esOrigen = t.empresaOrigenId === empresaId;
    const esDestino = t.empresaDestinoId === empresaId;
    if (!esOrigen && !esDestino) {
      throw new ForbiddenException('No tienes acceso a esta tercerización');
    }

    const tipo =
      dto.tipo === 'REQUERIMIENTO'
        ? TipoNotaTercerizacion.REQUERIMIENTO
        : TipoNotaTercerizacion.NOTA;

    const nota = await this.prisma.tercerizacionNota.create({
      data: {
        tercerizacionId,
        empresaAutorId: empresaId,
        usuarioId,
        tipo,
        contenido: dto.contenido.trim(),
      },
    });

    // Avisar a la empresa contraparte (deep-link al detalle de la tercerización).
    const otraEmpresa = esOrigen ? t.empresaDestinoId : t.empresaOrigenId;
    const etiquetaTipo =
      tipo === TipoNotaTercerizacion.REQUERIMIENTO ? 'Requerimiento' : 'Nota';
    this.notificarAdminsB2B(
      otraEmpresa,
      `${etiquetaTipo} en tercerización ${t.ordenOrigen?.codigo ?? ''}`.trim(),
      dto.contenido.length > 100 ? `${dto.contenido.slice(0, 100)}...` : dto.contenido,
      tercerizacionId,
      'b2b_nota',
    ).catch(TercerizacionService.logNotifFallida('nota B2B'));

    return nota;
  }

  // ─── Pago al tercero: EGRESO PAGO_PROVEEDOR en la caja del origen ───

  async registrarPagoTercero(
    tercerizacionId: string,
    empresaId: string,
    usuarioId: string,
    dto: PagarTerceroDto,
  ) {
    const t = await this.prisma.tercerizacionServicio.findUnique({
      where: { id: tercerizacionId },
      include: {
        empresaDestino: { select: { nombre: true } },
        ordenOrigen: { select: { codigo: true } },
      },
    });
    if (!t) throw new NotFoundException('Tercerización no encontrada');
    if (t.empresaOrigenId !== empresaId) {
      throw new ForbiddenException('Solo la empresa origen puede registrar el pago al tercero');
    }
    if (t.estado !== EstadoTercerizacion.COMPLETADO) {
      throw new BadRequestException('Solo se puede pagar una tercerización completada');
    }
    if (t.pagadoB2B) {
      throw new BadRequestException('El pago al tercero ya fue registrado');
    }
    const monto = Number(t.precioB2B ?? 0);
    if (monto <= 0) {
      throw new BadRequestException('La tercerización no tiene un precio B2B definido');
    }

    const caja = await this.cajaService.getCajaActiva(empresaId, usuarioId);
    if (!caja) {
      throw new BadRequestException(
        'Necesitas una caja abierta para registrar el pago al tercero',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const movimiento = await this.cajaService.crearMovimientoAutomatico(
        empresaId,
        caja.id,
        {
          tipo: TipoMovimientoCaja.EGRESO,
          categoria: CategoriaMovimientoCaja.PAGO_PROVEEDOR,
          metodoPago: dto.metodoPago as MetodoPagoVenta,
          monto,
          descripcion:
            `Pago tercerización ${t.ordenOrigen?.codigo ?? ''} a ${t.empresaDestino?.nombre ?? 'empresa tercera'}`.trim(),
          ordenServicioId: t.ordenOrigenId,
          registradoPorId: usuarioId,
          metadata: { tercerizacionId, pagoB2B: true },
        },
        tx,
      );
      if (!movimiento) {
        throw new BadRequestException(
          'No se pudo registrar el egreso en caja (¿caja cerrada?)',
        );
      }
      return tx.tercerizacionServicio.update({
        where: { id: tercerizacionId },
        data: {
          pagadoB2B: true,
          fechaPagoB2B: new Date(),
          movimientoPagoB2BId: movimiento.id,
          metodoPagoB2B: dto.metodoPago,
        },
      });
    });

    await this.registrarNotaEstado(
      tercerizacionId,
      empresaId,
      `Pago al tercero registrado: S/ ${monto.toFixed(2)} (${dto.metodoPago})`,
    );

    return result;
  }

  // ─── Empresas vinculadas que aceptan tercerización ───

  async getEmpresasVinculadas(empresaId: string) {
    // Obtener IDs de empresas vinculadas (aceptadas)
    const vinculaciones = await this.prisma.vinculacionEmpresa.findMany({
      where: {
        estado: EstadoVinculacion.ACEPTADA,
        OR: [
          { empresaSolicitanteId: empresaId },
          { empresaVinculadaId: empresaId },
        ],
      },
      select: {
        empresaSolicitanteId: true,
        empresaVinculadaId: true,
      },
    });

    // Extraer IDs de las otras empresas
    const empresaIds = vinculaciones.map((v) =>
      v.empresaSolicitanteId === empresaId
        ? v.empresaVinculadaId
        : v.empresaSolicitanteId,
    );

    if (empresaIds.length === 0) return [];

    // Buscar solo las que aceptan tercerización y están operativas
    // (mismo criterio que el directorio general)
    const empresas = await this.prisma.empresa.findMany({
      where: {
        id: { in: empresaIds },
        aceptaTercerizacion: true,
        isActive: true,
        deletedAt: null,
        estadoSuscripcion: 'ACTIVA',
      },
      select: {
        id: true,
        nombre: true,
        logo: true,
        rubro: true,
        telefono: true,
        email: true,
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
          },
          take: 1,
        },
      },
      orderBy: { nombre: 'asc' },
    });

    return empresas.map((e) => ({
      ...e,
      sedePrincipal: e.sedes[0] || null,
      sedes: undefined,
      esVinculada: true,
    }));
  }

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

    // Validar que la empresa destino acepta tercerización y está operativa
    // (mismo criterio que el directorio: suscripción ACTIVA).
    const empresaDestino = await this.prisma.empresa.findFirst({
      where: {
        id: empresaDestinoId,
        aceptaTercerizacion: true,
        isActive: true,
        estadoSuscripcion: 'ACTIVA',
      },
    });
    if (!empresaDestino) {
      throw new BadRequestException(
        'La empresa destino no acepta tercerización, no existe o no está activa',
      );
    }

    const empresaOrigen = await this.prisma.empresa.findUnique({
      where: { id: empresaOrigenId },
      select: { nombre: true },
    });

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

    // B3 FIX: Guardar estado previo para restaurar al rechazar/cancelar.
    // También origenOrden: una orden B2B_RECIBIDO re-tercerizada debe
    // recuperar su marca B2B al rechazarse, no quedar como CLIENTE_FINAL.
    const estadoPrevioOrigen = orden.estado;
    const origenOrdenPrevio = orden.origenOrden;

    // Crear tercerización y actualizar orden en transacción
    const result = await this.prisma.$transaction(async (tx) => {
      // B3.1: Re-verificar que la orden no fue tercerizada concurrentemente
      const ordenActual = await tx.ordenServicio.findUnique({ where: { id: ordenOrigenId } });
      if (ordenActual?.estado === EstadoOrdenServicio.TERCERIZADO) {
        throw new BadRequestException('Esta orden ya está siendo tercerizada');
      }

      const existente = await tx.tercerizacionServicio.findUnique({ where: { ordenOrigenId } });
      if (existente) {
        throw new BadRequestException('Esta orden ya tiene una solicitud de tercerización');
      }

      const tercerizacion = await tx.tercerizacionServicio.create({
        data: {
          empresaOrigenId,
          empresaDestinoId,
          ordenOrigenId,
          datosEquipo: { ...datosEquipo, estadoPrevioOrigen, origenOrdenPrevio },
          descripcionProblema: dtoDescripcion || orden.descripcionProblema,
          sintomas: dtoSintomas || orden.sintomas,
          componentesData: componentesData.length > 0 ? componentesData : undefined,
          // Snapshot denormalizado de campos personalizados elegidos por el origen.
          datosAdicionales:
            Array.isArray(dto.datosAdicionales) && dto.datosAdicionales.length > 0
              ? (dto.datosAdicionales as any)
              : undefined,
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

    this.notificarAdminsB2B(
      empresaDestinoId,
      'Nueva solicitud de tercerización',
      `${empresaOrigen?.nombre ?? 'Una empresa'} te envió la orden ${orden.codigo} (${datosEquipo.tipoServicio})`,
      result.id,
      'b2b_solicitud',
    ).catch(TercerizacionService.logNotifFallida('nueva solicitud'));

    await this.registrarNotaEstado(
      result.id,
      empresaOrigenId,
      `Solicitud de tercerización enviada${notasOrigen ? `. Nota: ${notasOrigen}` : ''}`,
    );

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
        empresaDestino: { select: { nombre: true } },
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

      const rechazada = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.tercerizacionServicio.update({
          where: { id: tercerizacionId },
          data: {
            estado: EstadoTercerizacion.RECHAZADO,
            motivoRechazo: dto.motivoRechazo,
            notasDestino: dto.notasDestino,
            fechaRespuesta: new Date(),
          },
        });

        // B3 FIX: Restaurar estado previo en vez de siempre RECIBIDO.
        // origenOrden también se restaura (cadenas de re-tercerización:
        // una orden B2B_RECIBIDO no debe quedar como CLIENTE_FINAL).
        const datosEquipo = tercerizacion.datosEquipo as any;
        const estadoRestaurar = datosEquipo?.estadoPrevioOrigen || EstadoOrdenServicio.RECIBIDO;
        const origenRestaurar =
          datosEquipo?.origenOrdenPrevio || OrigenOrden.CLIENTE_FINAL;

        await tx.ordenServicio.update({
          where: { id: tercerizacion.ordenOrigenId },
          data: {
            estado: estadoRestaurar,
            origenOrden: origenRestaurar,
          },
        });

        await tx.historialOrdenServicio.create({
          data: {
            ordenServicioId: tercerizacion.ordenOrigenId,
            estadoAnterior: EstadoOrdenServicio.TERCERIZADO,
            estadoNuevo: estadoRestaurar,
            notas: `Tercerización rechazada: ${dto.motivoRechazo}`,
          },
        });

        return updated;
      });

      this.notificarAdminsB2B(
        tercerizacion.empresaOrigenId,
        'Tercerización rechazada',
        `${tercerizacion.empresaDestino.nombre} rechazó la orden ${tercerizacion.ordenOrigen.codigo}. Motivo: ${dto.motivoRechazo}`,
        tercerizacionId,
        'b2b_rechazada',
      ).catch(TercerizacionService.logNotifFallida('rechazo'));

      await this.registrarNotaEstado(
        tercerizacionId,
        empresaId,
        `Rechazada. Motivo: ${dto.motivoRechazo}`,
      );

      return rechazada;
    }

    // Aceptar: crear orden en empresa destino
    const aceptada = await this.prisma.$transaction(async (tx) => {
      // Buscar o crear la empresa origen como Persona + EmpresaPersona (cliente B2B)
      // Usamos el RUC como identificador único para empresas. Sin RUC,
      // dedup por la observación B2B (antes cada aceptación creaba una
      // Persona duplicada con dni null).
      const rucOrigen = tercerizacion.empresaOrigen.ruc;
      let persona = rucOrigen
        ? await tx.persona.findFirst({ where: { dni: rucOrigen } })
        : await tx.persona.findFirst({
            where: {
              dni: null,
              esCliente: true,
              observaciones: `Empresa B2B - ${tercerizacion.empresaOrigen.nombre}`,
            },
          });

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

    this.notificarAdminsB2B(
      tercerizacion.empresaOrigenId,
      'Tercerización aceptada',
      `${tercerizacion.empresaDestino.nombre} aceptó la orden ${tercerizacion.ordenOrigen.codigo} y comenzará el servicio`,
      tercerizacionId,
      'b2b_aceptada',
    ).catch(TercerizacionService.logNotifFallida('aceptación'));

    await this.registrarNotaEstado(
      tercerizacionId,
      empresaId,
      'Aceptada. El taller iniciará el servicio.',
    );

    return aceptada;
  }

  // ─── Completar tercerización (empresa destino) ───

  async completar(
    tercerizacionId: string,
    empresaId: string,
    dto: CompleteTercerizacionDto,
  ) {
    const tercerizacion = await this.prisma.tercerizacionServicio.findUnique({
      where: { id: tercerizacionId },
      include: {
        empresaDestino: { select: { nombre: true } },
        ordenOrigen: { select: { codigo: true } },
      },
    });

    if (!tercerizacion) {
      throw new NotFoundException('Tercerización no encontrada');
    }

    if (tercerizacion.empresaDestinoId !== empresaId) {
      throw new ForbiddenException('No tienes permiso para completar esta tercerización');
    }

    // B6 FIX: Solo permitir completar desde ACEPTADO (EN_PROCESO era estado muerto)
    if (tercerizacion.estado !== EstadoTercerizacion.ACEPTADO) {
      throw new BadRequestException(
        `No se puede completar una tercerización en estado ${tercerizacion.estado}`,
      );
    }

    const completada = await this.prisma.$transaction(async (tx) => {
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

      // B5 FIX: Verificar estado de la orden destino antes de forzar FINALIZADO
      if (tercerizacion.ordenDestinoId) {
        const ordenDestino = await tx.ordenServicio.findUnique({
          where: { id: tercerizacion.ordenDestinoId },
        });

        if (ordenDestino) {
          const estadosCompletables: EstadoOrdenServicio[] = [
            EstadoOrdenServicio.REPARADO,
            EstadoOrdenServicio.LISTO_ENTREGA,
            EstadoOrdenServicio.ENTREGADO,
          ];

          // Solo finalizar si la orden destino pasó por el flujo de reparación
          if (estadosCompletables.includes(ordenDestino.estado)) {
            await tx.ordenServicio.update({
              where: { id: tercerizacion.ordenDestinoId },
              data: { estado: EstadoOrdenServicio.FINALIZADO },
            });

            await tx.historialOrdenServicio.create({
              data: {
                ordenServicioId: tercerizacion.ordenDestinoId,
                estadoAnterior: ordenDestino.estado,
                estadoNuevo: EstadoOrdenServicio.FINALIZADO,
                notas: `Tercerización completada. Precio B2B: ${dto.precioB2B}`,
              },
            });
          }
        }
      }

      return updated;
    });

    this.notificarAdminsB2B(
      tercerizacion.empresaOrigenId,
      'Tercerización completada',
      `${tercerizacion.empresaDestino.nombre} completó la orden ${tercerizacion.ordenOrigen.codigo}. Precio B2B: S/ ${Number(dto.precioB2B).toFixed(2)}`,
      tercerizacionId,
      'b2b_completada',
    ).catch(TercerizacionService.logNotifFallida('completada'));

    await this.registrarNotaEstado(
      tercerizacionId,
      empresaId,
      `Completada. Precio B2B: S/ ${Number(dto.precioB2B).toFixed(2)}`,
    );

    return completada;
  }

  // ─── Cancelar tercerización (empresa origen) ───

  async cancelar(tercerizacionId: string, empresaId: string) {
    const tercerizacion = await this.prisma.tercerizacionServicio.findUnique({
      where: { id: tercerizacionId },
      include: {
        empresaOrigen: { select: { nombre: true } },
        ordenOrigen: { select: { codigo: true } },
      },
    });

    if (!tercerizacion) {
      throw new NotFoundException('Tercerización no encontrada');
    }

    if (tercerizacion.empresaOrigenId !== empresaId) {
      throw new ForbiddenException('Solo la empresa origen puede cancelar');
    }

    if (
      tercerizacion.estado === EstadoTercerizacion.COMPLETADO ||
      tercerizacion.estado === EstadoTercerizacion.CANCELADO ||
      tercerizacion.estado === EstadoTercerizacion.RECHAZADO
    ) {
      throw new BadRequestException('No se puede cancelar en este estado');
    }

    // Una tercerización ACEPTADA solo se cancela si el taller destino aún
    // no empezó (orden espejo en RECIBIDO/EN_DIAGNOSTICO). Cancelar trabajo
    // en curso o ya cobrado pisaría la orden del destino por fuera de su
    // flujo — eso se coordina entre empresas, no unilateralmente.
    let ordenDestino: { id: string; estado: EstadoOrdenServicio } | null = null;
    if (tercerizacion.ordenDestinoId) {
      ordenDestino = await this.prisma.ordenServicio.findUnique({
        where: { id: tercerizacion.ordenDestinoId },
        select: { id: true, estado: true },
      });
      const cancelables: EstadoOrdenServicio[] = [
        EstadoOrdenServicio.RECIBIDO,
        EstadoOrdenServicio.EN_DIAGNOSTICO,
      ];
      if (ordenDestino && !cancelables.includes(ordenDestino.estado)) {
        throw new BadRequestException(
          `La empresa destino ya está trabajando la orden (${ordenDestino.estado}). ` +
            'Coordina la cancelación directamente con ella',
        );
      }
    }

    const cancelada = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tercerizacionServicio.update({
        where: { id: tercerizacionId },
        data: { estado: EstadoTercerizacion.CANCELADO },
      });

      // B3 FIX: Restaurar estado previo en vez de siempre RECIBIDO.
      // origenOrden también (cadenas de re-tercerización).
      const datosEquipo = tercerizacion.datosEquipo as any;
      const estadoRestaurar = datosEquipo?.estadoPrevioOrigen || EstadoOrdenServicio.RECIBIDO;
      const origenRestaurar =
        datosEquipo?.origenOrdenPrevio || OrigenOrden.CLIENTE_FINAL;

      await tx.ordenServicio.update({
        where: { id: tercerizacion.ordenOrigenId },
        data: {
          estado: estadoRestaurar,
          origenOrden: origenRestaurar,
        },
      });

      await tx.historialOrdenServicio.create({
        data: {
          ordenServicioId: tercerizacion.ordenOrigenId,
          estadoAnterior: EstadoOrdenServicio.TERCERIZADO,
          estadoNuevo: estadoRestaurar,
          notas: 'Tercerización cancelada por la empresa origen',
        },
      });

      // Cancelar orden destino si existe (con rastro en su historial)
      if (ordenDestino) {
        await tx.ordenServicio.update({
          where: { id: ordenDestino.id },
          data: { estado: EstadoOrdenServicio.CANCELADO },
        });
        await tx.historialOrdenServicio.create({
          data: {
            ordenServicioId: ordenDestino.id,
            estadoAnterior: ordenDestino.estado,
            estadoNuevo: EstadoOrdenServicio.CANCELADO,
            notas: `Tercerización cancelada por la empresa origen (${tercerizacion.empresaOrigen.nombre})`,
          },
        });
      }

      return updated;
    });

    this.notificarAdminsB2B(
      tercerizacion.empresaDestinoId,
      'Tercerización cancelada',
      `${tercerizacion.empresaOrigen.nombre} canceló la solicitud de la orden ${tercerizacion.ordenOrigen.codigo}`,
      tercerizacionId,
      'b2b_cancelada',
    ).catch(TercerizacionService.logNotifFallida('cancelación'));

    await this.registrarNotaEstado(
      tercerizacionId,
      empresaId,
      'Cancelada por la empresa origen.',
    );

    return cancelada;
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
            prioridad: true, descripcionProblema: true, costoTotal: true,
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
